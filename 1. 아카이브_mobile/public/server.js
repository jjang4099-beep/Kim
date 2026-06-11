/**
 * SJ 지식 서재 (Knowledge Library) — server.js v5
 *
 * 실행:  node server.js  |  npm run dev (nodemon)
 * 환경변수:
 *   PORT=3000
 *   ANTHROPIC_API_KEY=sk-ant-...       (없으면 규칙 기반 동작)
 *   GEMINI_API_KEY=AIza...              (데일리 피드 생성용)
 *   PUBLIC_VAPID_KEY=B...               (Web Push 공개키)
 *   PRIVATE_VAPID_KEY=_...              (Web Push 비밀키)
 *   VAPID_EMAIL=mailto:you@example.com  (VAPID 연락처)
 *
 * ▶ v5 추가사항
 *   - Web Push 알림: 피드 생성 완료 시 스마트폰 즉시 알림
 *   - VAPID 기반 구독 관리 (data/push_subscriptions.json)
 *   - Share Target API: /share-handler, /api/inbox
 *   - POST /api/push/subscribe   → 구독 등록
 *   - DELETE /api/push/subscribe → 구독 해제
 *   - GET /api/push/vapid-key    → 공개키 반환
 *   - GET /share-handler         → 공유 시트 수신 경량 페이지
 *   - POST /api/inbox            → 공유된 콘텐츠 인박스 저장
 */

'use strict';
require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const fs       = require('fs');
const path     = require('path');
const cron     = require('node-cron');
const webpush  = require('web-push');
const multer   = require('multer');
const { v4: uuidv4 } = require('uuid');

const PORT                   = process.env.PORT || 3000;
const DB_PATH                = path.join(__dirname, 'data', 'archive.json');
const DAILY_FEEDS_PATH       = path.join(__dirname, 'data', 'dailyFeeds.json');
const SUBSCRIPTIONS_PATH     = path.join(__dirname, 'data', 'subscriptions.json');
const USERS_PATH             = path.join(__dirname, 'data', 'users.json');
const PUSH_SUBS_PATH         = path.join(__dirname, 'data', 'push_subscriptions.json');

// ── 이미지 업로드 디렉토리 + multer 설정 ──
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 10 * 1024 * 1024 },   // 10 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('이미지 파일만 업로드 가능합니다.'));
  }
});

// ── Web Push VAPID 설정 ──
(function initVapid() {
  const pub   = process.env.PUBLIC_VAPID_KEY;
  const priv  = process.env.PRIVATE_VAPID_KEY;
  const email = process.env.VAPID_EMAIL || 'mailto:admin@sj-library.app';
  if (pub && priv) {
    webpush.setVapidDetails(email, pub, priv);
    console.log('[Push] VAPID 설정 완료');
  } else {
    console.warn('[Push] VAPID 키 미설정 — 웹 푸시 비활성화');
  }
})();

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));  // server.js가 public/ 안에 있으므로 __dirname이 곧 public 폴더
// 업로드된 이미지 정적 서빙 (URL: /uploads/파일명)
app.use('/uploads', express.static(UPLOADS_DIR));

// ══════════════════════════════════════════════════
//  범용 DB 헬퍼
// ══════════════════════════════════════════════════

function readJSON(filePath, fallback = []) {
  if (!fs.existsSync(filePath)) return fallback;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
  catch { return fallback; }
}

function writeJSON(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

const readDB    = ()      => readJSON(DB_PATH, []);
const writeDB   = (data)  => writeJSON(DB_PATH, data);

// ──────────────────────────────────────────────────
//  Daily Feeds DB (data/dailyFeeds.json)
//  구조: { "YYYY-MM-DD": { "subId": { ...feedObject } } }
// ──────────────────────────────────────────────────

function readDailyFeeds() {
  return readJSON(DAILY_FEEDS_PATH, {});
}

function writeDailyFeeds(data) {
  writeJSON(DAILY_FEEDS_PATH, data);
}

function getTodayFeeds(dateStr) {
  const all = readDailyFeeds();
  return all[dateStr] || null;
}

function saveTodayFeed(dateStr, subId, feedObj) {
  const all = readDailyFeeds();
  if (!all[dateStr]) all[dateStr] = {};
  all[dateStr][subId] = feedObj;
  writeDailyFeeds(all);
}

// ──────────────────────────────────────────────────
//  Push 구독 DB (data/push_subscriptions.json)
//  구조: [{ userId, subscription: {endpoint,keys:{p256dh,auth}}, createdAt }]
// ──────────────────────────────────────────────────

function readPushSubs() {
  return readJSON(PUSH_SUBS_PATH, []);
}

function writePushSubs(data) {
  writeJSON(PUSH_SUBS_PATH, data);
}

/**
 * 등록된 모든 구독자에게 Web Push 발송
 * @param {object} payload  { title, body, url, tag }
 */
async function sendPushToAll(payload) {
  const pub  = process.env.PUBLIC_VAPID_KEY;
  const priv = process.env.PRIVATE_VAPID_KEY;
  if (!pub || !priv) {
    console.log('[Push] VAPID 키 없음 — 발송 스킵');
    return { sent: 0, failed: 0 };
  }

  const subs     = readPushSubs();
  if (!subs.length) {
    console.log('[Push] 등록된 구독자 없음');
    return { sent: 0, failed: 0 };
  }

  const message  = JSON.stringify(payload);
  let sent = 0, failed = 0;
  const invalid  = [];

  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub.subscription, message);
      sent++;
      console.log(`[Push] ✅ 발송 성공 → ${sub.subscription.endpoint.slice(-20)}`);
    } catch (e) {
      failed++;
      console.error(`[Push] ✗ 발송 실패 (${e.statusCode}):`, e.message);
      // 410 Gone = 구독 만료 → 삭제 대상
      if (e.statusCode === 410 || e.statusCode === 404) {
        invalid.push(sub.subscription.endpoint);
      }
    }
  }

  // 만료 구독 자동 정리
  if (invalid.length) {
    const cleaned = subs.filter(s => !invalid.includes(s.subscription.endpoint));
    writePushSubs(cleaned);
    console.log(`[Push] 만료 구독 ${invalid.length}개 정리`);
  }

  return { sent, failed };
}

/**
 * 오늘의 피드에서 푸시 알림 카피 추출
 * 가장 임팩트 있는 영어 표현 or 시황 제목을 동적으로 매핑
 */
function buildPushPayload(feeds) {
  const feedArr = Object.values(feeds);

  // 영어 피드에서 첫 번째 표현 추출
  const langFeed = feedArr.find(f => f.type === 'language');
  if (langFeed) {
    const firstExpr = langFeed.vocabEntries?.[0];
    return {
      title: `📚 오늘의 영어: "${firstExpr?.expression || langFeed.title}"`,
      body:  firstExpr
        ? `${firstExpr.meaning} — ${firstExpr.nuance || ''}`
        : langFeed.summary || '영어 표현 배달이 도착했습니다!',
      url:   '/?view=mobile&action=feed',
      tag:   'sj-daily-feed'
    };
  }

  // 시황 피드에서 제목 추출
  const marketFeed = feedArr.find(f => f.type === 'market');
  if (marketFeed) {
    return {
      title: `📈 ${marketFeed.title || '오늘의 시황 배달'}`,
      body:  marketFeed.summary || '오늘의 시황 리포트가 준비됐습니다!',
      url:   '/?view=mobile&action=feed',
      tag:   'sj-daily-feed'
    };
  }

  // 폴백
  return {
    title: '📚 SJ 서재 — 오늘의 지식 배달',
    body:  '아침 지식 배달이 준비됐습니다. 지금 확인해보세요!',
    url:   '/?view=mobile&action=feed',
    tag:   'sj-daily-feed'
  };
}

// ──────────────────────────────────────────────────
//  Users DB (data/users.json)
// ──────────────────────────────────────────────────

function readUsers() {
  return readJSON(USERS_PATH, [{
    id: 'sj', name: 'SJ', delivery_time: '07:30',
    timezone: 'Asia/Seoul', enabled_feeds: ['en_expr', 'us_market']
  }]);
}

function writeUsers(data) {
  writeJSON(USERS_PATH, data);
}

function getDefaultUser() {
  const users = readUsers();
  return users[0] || null;
}

// ──────────────────────────────────────────────────
//  Subscriptions (data/subscriptions.json)
// ──────────────────────────────────────────────────

function getEnabledSubscriptions(user) {
  const subs      = readJSON(SUBSCRIPTIONS_PATH, []);
  const enabled   = new Set(user.enabled_feeds || []);
  // user.enabled_feeds 가 없으면 subscriptions.json의 enabled 플래그를 따름
  if (!user.enabled_feeds || user.enabled_feeds.length === 0) {
    return subs.filter(s => s.enabled);
  }
  return subs.filter(s => enabled.has(s.id));
}

// ══════════════════════════════════════════════════
//  날짜 헬퍼
// ══════════════════════════════════════════════════

const pad = n => String(n).padStart(2, '0');

function toDateStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function toTimeStr(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function isOlderThanOneDay(createdAt) {
  return Date.now() - new Date(createdAt).getTime() > 24 * 60 * 60 * 1000;
}

/**
 * "HH:MM" 문자열을 분(minutes) 단위로 변환
 */
function timeToMinutes(timeStr) {
  const [h, m] = (timeStr || '07:30').split(':').map(Number);
  return h * 60 + m;
}

/**
 * 현재 시각이 배달 시간 기준 [triggerBefore ~ triggerBefore+30] 분 이전인지 확인
 * @param {string} deliveryTime  "HH:MM"
 * @param {number} triggerBefore 사전 생성할 분 단위 (기본 60분 전)
 */
function isPreGenerationWindow(deliveryTime, triggerBefore = 60) {
  const now       = new Date();
  const nowMins   = now.getHours() * 60 + now.getMinutes();
  const delivMins = timeToMinutes(deliveryTime);
  const windowStart = delivMins - triggerBefore;
  const windowEnd   = windowStart + 30;         // 30분 슬롯 내에 한 번만 생성
  return nowMins >= windowStart && nowMins < windowEnd;
}

// ══════════════════════════════════════════════════
//  Gemini API 래퍼
// ══════════════════════════════════════════════════

async function callGemini(prompt, maxOutputTokens = 4096, retryCount = 0) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[Gemini] GEMINI_API_KEY 미설정 — Mock 데이터로 대체');
    return null;
  }

  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const model = genAI.getGenerativeModel({ model: modelName });
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens, temperature: 0.7 }
    });
    const finishReason = result.response.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== 'STOP') {
      console.warn('[Gemini] finishReason:', finishReason);
    }
    return result.response.text();
  } catch (e) {
    // 429 Rate limit: 잠시 대기 후 재시도 (최대 2회)
    const is429 = e.message?.includes('429') || e.message?.includes('Too Many Requests');
    if (is429 && retryCount < 2) {
      const waitSec = (retryCount + 1) * 15; // 15s, 30s
      console.warn(`[Gemini] 429 Rate limit — ${waitSec}초 대기 후 재시도 (${retryCount + 1}/2)`);
      await new Promise(r => setTimeout(r, waitSec * 1000));
      return callGemini(prompt, maxOutputTokens, retryCount + 1);
    }
    console.error('[Gemini] API 오류:', e.message.slice(0, 500));
    return null;
  }
}

function fixJsonControlChars(str) {
  // JSON 문자열 내부의 실제 제어 문자(개행·탭 등)를 JSON 이스케이프로 변환
  let result = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const code = str.charCodeAt(i);
    if (escaped) {
      result += ch; escaped = false;
    } else if (ch === '\\' && inString) {
      result += ch; escaped = true;
    } else if (ch === '"') {
      result += ch; inString = !inString;
    } else if (inString && code < 0x20) {
      if      (code === 0x0A) result += '\\n';
      else if (code === 0x0D) result += '\\r';
      else if (code === 0x09) result += '\\t';
      // 그 외 제어문자는 제거
    } else {
      result += ch;
    }
  }
  return result;
}

function safeParseJSON(text) {
  if (!text) return null;
  try {
    // 마크다운 코드블록 제거 (```json, ```text, ``` 등 모두)
    const cleaned = text.replace(/```[a-z]*\s*/gi, '').trim();
    const m = cleaned.match(/[\[{][\s\S]*[\]}]/);
    if (!m) return null;
    const block = m[0];
    // 1차 시도: 그대로 파싱
    try { return JSON.parse(block); } catch {}
    // 2차 시도: 문자열 내 제어문자 이스케이프 후 파싱
    return JSON.parse(fixJsonControlChars(block));
  } catch { return null; }
}

// ══════════════════════════════════════════════════
//  피드 콘텐츠 생성 엔진 (구독 타입별)
// ══════════════════════════════════════════════════

// ──────────────────────────────────────────────────
//  요일별 테마 매핑
// ──────────────────────────────────────────────────
const WEEKDAY_THEMES = {
  en: {
    0: '비즈니스 소통 & 피드백',
    1: '비즈니스 미팅 & 회의 진행',
    2: '협상 & 제안 스킬',
    3: '네트워킹 & 관계 구축',
    4: '이메일 & 보고서 작성',
    5: '마케팅 & 프레젠테이션',
    6: '비즈니스 전략 & 리더십'
  },
  zh: {
    0: '비즈니스 관계 & 접대',
    1: '비즈니스 기초 인사 & 소개',
    2: '협상 & 가격 협의',
    3: '회의 진행 & 의견 표현',
    4: '이메일 & 커뮤니케이션',
    5: '비즈니스 성과 & 결론',
    6: '중국 비즈니스 문화 & 에티켓'
  }
};

/**
 * 영어/언어 표현 피드 생성 — 요일별 테마 + 실전 대화문 포함
 */
/* 영어 테마 ID → 한국어 레이블 매핑 */
const EN_THEME_LABELS = {
  business_meeting : '비즈니스 미팅 & 회의 진행',
  office_email     : '이메일 & 보고서 작성',
  daily_travel     : '일상/여행 회화',
  drama_spoken     : '미드 구어체 & 슬랭'
};

/* 중국어 테마 ID → 한국어 레이블 매핑 */
const ZH_THEME_LABELS = {
  biz_hsk     : '비즈니스 HSK 실무 어휘',
  biz_trip    : '중국 출장 & 식사 접대',
  daily_shop  : '일상 회화 & 쇼핑',
  drama_slang : '중드 & 유행어'
};

async function generateLanguageFeed(sub, user) {
  const lang    = sub.lang || '영어';
  const langKey = lang.includes('중국') ? 'zh' : 'en';

  /* ── 사용자 상세 설정 우선 적용 (영어/중국어 공통) ── */
  const feedSettingKey = langKey === 'en' ? 'en_expr' : 'zh_expr';
  const feedCfg        = user?.feed_settings?.[feedSettingKey] || {};
  const defCount       = langKey === 'zh' ? 5 : 7;
  const count          = feedCfg.count || sub.options?.count || defCount;
  const level          = feedCfg.level || 'intermediate';

  /* 요일별 테마 자동 결정 (0=일요일) */
  const dow      = new Date().getDay();
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const dayKr    = dayNames[dow];

  /* 사용자 집중 테마 → 요일 순환, 없으면 기본 요일 테마 */
  const themeLabels = langKey === 'en' ? EN_THEME_LABELS : ZH_THEME_LABELS;
  let theme;
  if (feedCfg.themes && feedCfg.themes.length > 0) {
    const labels = feedCfg.themes.map(t => themeLabels[t]).filter(Boolean);
    theme = labels[dow % labels.length];
  } else {
    theme = WEEKDAY_THEMES[langKey][dow] || sub.topic || `비즈니스 ${lang}`;
  }

  /* 난이도 설명 */
  const levelDesc = level === 'advanced'
    ? '원어민 수준의 고급(Advanced) 뉘앙스 표현 — 관용구·비유적 표현·고급 어휘 중심'
    : '직장인 필수 비즈니스 초중급(Intermediate) 표현 — 실전에서 바로 쓸 수 있는 핵심 어휘';

  const dialogueInstruction = lang === '영어'
    ? `"dialogue": "A: (상황 세팅 1줄)\\nB: (표현 사용 1줄)\\nA: (자연스러운 반응 1줄)"`
    : `"dialogue": "甲: (상황 세팅 1줄)\\n乙: (표현 사용 중국어 1줄)\\n甲: (반응 1줄)\\n[해석: 전체 대화 한국어 번역]"`;

  const prompt = `당신은 성재님의 개인 학습 수석 비서입니다. 바쁜 직장인인 성재님이 아침 5분 안에 오늘의 ${lang} 표현을 완벽히 소화할 수 있도록 엄선합니다.

오늘(${dayKr}요일) 집중 테마: "${theme}"
난이도: ${levelDesc}

다음 JSON 배열만 반환하세요 (마크다운 코드블록 없이):
[
  {
    "expression": "${lang} 표현 원문",
    "meaning": "한국어 뜻 (간결, 10자 이내)",
    "nuance": "뉘앙스 — 한국인이 실수하기 쉬운 포인트 또는 사용 맥락 (1~2문장)",
    "sourceSentence": "실제 비즈니스 현장 예문 (원어, 자연스러운 문장)",
    "practiceSentence": "성재님이 내일 회의/이메일에서 바로 쓸 수 있는 연습 문장",
    ${dialogueInstruction}
  }
]

조건:
- 정확히 ${count}개 표현 생성
- 집중 테마 "${theme}" + 난이도(${level === 'advanced' ? '고급' : '초중급'})에 딱 맞는 실전 표현만 선별
- dialogue는 실제 비즈니스 현장에서 바로 쓸 수 있는 짧은 대화문 (3~4줄)
- practiceSentence는 실제 직장 상황(회의·이메일·보고·협상)에 맞게 구체적으로`;

  const raw     = await callGemini(prompt, 4000);
  const entries = safeParseJSON(raw) || generateMockLanguageEntries(theme, count, lang);

  return {
    type:        'language',
    category:    sub.category || 'en',
    subCategory: theme,
    label:       sub.label,
    title:       `[${dayKr}] ${theme}: ${entries[0]?.expression || '핵심 표현'} 외 ${entries.length - 1}개`,
    summary:     `${dayKr}요일 테마 — ${theme} 핵심 ${lang} 표현 ${entries.length}선`,
    report:      '',
    theme,
    dayOfWeek:   dayKr,
    vocabEntries: entries,
    aiGenerated: !!process.env.GEMINI_API_KEY
  };
}

/**
 * 시황/경제 리포트 피드 생성 — 증시 지표 배너 + 3줄 요약 + 체크포인트 포함
 */
async function generateMarketFeed(sub, user) {
  const topic = sub.topic || '증시 전반';
  const isUS  = sub.id === 'us_market';

  const indicatorSpec = isUS
    ? `"indicators": [
        {"name":"S&P 500","value":"XXXX.XX","change":"+X.XX%","dir":"up|down"},
        {"name":"나스닥","value":"XXXXX.XX","change":"+X.XX%","dir":"up|down"},
        {"name":"다우 지수","value":"XXXXX","change":"+X.XX%","dir":"up|down"},
        {"name":"미 국채 10년물","value":"X.XX%","change":"+X bp","dir":"up|down"},
        {"name":"VIX 공포지수","value":"XX.X","change":"-X.X","dir":"up|down"}
      ]`
    : `"indicators": [
        {"name":"코스피","value":"XXXX.XX","change":"+X.XX%","dir":"up|down"},
        {"name":"코스닥","value":"XXX.XX","change":"+X.XX%","dir":"up|down"},
        {"name":"원/달러","value":"XXXX","change":"+XX원","dir":"up|down"}
      ]`;

  /* ── 사용자 시황 분석 집중도 설정 ── */
  const marketCfg       = user?.feed_settings?.[sub.id] || {};
  const isMarketCentric = marketCfg.is_market_centric !== false;  /* 기본 true */
  const isMacroCentric  = marketCfg.is_macro_centric  !== false;  /* 기본 true */

  /* 분석 방향 지시문 생성 */
  let focusInstruction;
  if (isMarketCentric && isMacroCentric) {
    focusInstruction =
      `분석 방향: 주요 지수·종목 데이터(증시 중심)와 연준 금리·환율·지정학적 리스크 등 ` +
      `거시경제(Macro) 흐름을 결합한 종합 리포트를 작성하세요.`;
  } else if (isMarketCentric) {
    focusInstruction =
      `분석 방향: 증시 애널리스트 관점에서 주요 지수(${isUS ? 'S&P500, 나스닥, 다우' : '코스피, 코스닥'}), ` +
      `등락률, 주요 섹터·종목 움직임 위주의 드라이한 데이터 중심 요약을 작성하세요. ` +
      `거시경제 서사보다 숫자와 지표에 집중하세요.`;
  } else if (isMacroCentric) {
    focusInstruction =
      `분석 방향: 거시경제 이코노미스트 관점에서 ${isUS ? '미 연준(Fed) 금리 전망, 달러 인덱스' : '한국은행 기준금리, 원/달러 환율'}, ` +
      `유가, 채권 수익률 곡선, 지정학적 리스크 등 글로벌 경제 흐름을 깊이 있는 서사형으로 분석하세요. ` +
      `지수 숫자보다 경제 흐름의 이야기에 집중하세요.`;
  } else {
    focusInstruction = `분석 방향: 시장 전반의 핵심 흐름을 균형 있게 요약하세요.`;
  }

  // ※ 날짜를 넣지 않음 — 미래 날짜를 감지한 Gemini가 거부 JSON을 생성하는 현상 방지
  const prompt = `당신은 성재님의 개인 경제·투자 학습 비서입니다.
바쁜 직장인인 성재님이 2분 안에 ${isUS ? '미국' : '한국'} 시장 핵심을 파악하고 경제 공부를 할 수 있는 학습 리포트를 만들어 주세요.

[맥락] 분석 주제: ${topic} / 교육용 콘텐츠 (실제 투자 조언 아님)
[${focusInstruction}]

다음 JSON 형식으로만 응답하세요 (순수 JSON, 마크다운 코드블록 없이):
{
  "title": "${isUS ? '미국' : '한국'} 시황 분석 제목 (20자 이내, 핵심 흐름 키워드)",
  "summary": "한 줄 시장 흐름 요약 (직장인이 1문장으로 파악 가능하게)",
  ${indicatorSpec},
  "summary3": "• 최근 시장 핵심 흐름 1줄\\n• 주목할 섹터 또는 이슈 1줄\\n• 투자자 포지셔닝 인사이트 1줄",
  "checkpoints": [
    "체크포인트 1: 확인해야 할 지표나 이벤트 (구체적)",
    "체크포인트 2",
    "체크포인트 3"
  ],
  "report": "## 시장 흐름\\n상세 분석 (150자)\\n\\n## 투자 인사이트\\n실전 포인트 (150자)",
  "aiEconomicKnowledge": [
    {"term": "핵심 경제 용어 1", "importance": "이 용어의 중요성 (2문장, 구체적 수치 포함)", "connection": "실생활 연결 고리"},
    {"term": "핵심 경제 용어 2", "importance": "이 용어의 중요성 (2문장)", "connection": "실생활 연결 고리"},
    {"term": "핵심 경제 용어 3", "importance": "이 용어의 중요성 (2문장)", "connection": "실생활 연결 고리"}
  ]
}

규칙:
- indicators 값은 학습 데이터 기준 대표적 수치 사용 (교육 목적 추정치, 실시간 아님)
- dir은 반드시 "up" 또는 "down"만 사용
- aiEconomicKnowledge는 반드시 3개
- summary3 각 줄은 반드시 "• "로 시작
- checkpoints는 반드시 3개
- 거부 메시지, 설명 텍스트, 마크다운 블록 없이 순수 JSON만 응답`;

  const raw    = await callGemini(prompt, 4096);
  // ── 거부/오류성 응답 감지 → mock으로 강제 전환 ──
  const rawParsed = safeParseJSON(raw);
  const isRefusalResponse = rawParsed && (
    !rawParsed.indicators ||
    (rawParsed.title || '').match(/API|설정|미설정|오류|불가|없음|접근|제공/i) ||
    (rawParsed.summary || '').match(/API|GEMINI_API_KEY|설정하면|실시간.*불가/i)
  );
  const parsed = (!rawParsed || isRefusalResponse)
    ? generateMockMarketReport(sub, topic, isUS)
    : rawParsed;

  return {
    type:               'market',
    category:           sub.category || 'economy',
    subCategory:        topic,
    label:              sub.label,
    title:              parsed.title       || `${isUS ? '미국' : '한국'} 시황`,
    summary:            parsed.summary     || '',
    indicators:         parsed.indicators  || [],
    summary3:           parsed.summary3    || '',
    checkpoints:        parsed.checkpoints || [],
    report:             parsed.report      || '',
    aiEconomicKnowledge: parsed.aiEconomicKnowledge || [],
    aiGenerated:        !!process.env.GEMINI_API_KEY
  };
}

/**
 * 구독 타입을 보고 적합한 생성 함수 호출
 */
async function generateFeedForSubscription(sub, user) {
  const now = new Date();
  const base = {
    id:        `${toDateStr()}::${sub.id}`,
    date:      toDateStr(),
    subId:     sub.id,
    createdAt: now.toISOString(),
    saved:     false,
    savedEntries: {}
  };

  let content;
  if (sub.type === 'language') {
    content = await generateLanguageFeed(sub, user);
  } else if (sub.type === 'market') {
    content = await generateMarketFeed(sub, user);
  } else {
    // 알 수 없는 타입 → 기본 텍스트 리포트
    content = {
      type: 'general', category: sub.category || 'inbox',
      label: sub.label, title: sub.label,
      summary: '오늘의 지식 배달', report: ''
    };
  }

  return { ...base, ...content };
}

// ──────────────────────────────────────────────────
//  Mock 폴백 (Gemini API 키 없을 때)
// ──────────────────────────────────────────────────

function generateMockLanguageEntries(topic, count, lang) {
  const isZh = (lang || '').includes('중국');
  const samples = isZh ? [
    { expression: '您好', meaning: '안녕하세요', nuance: '공식적인 비즈니스 인사', sourceSentence: '您好，我是金成在。', practiceSentence: '您好，很高兴认识您。', dialogue: '甲: 您好！\n乙: 您好，很高兴认识您。\n甲: 我是韩国公司的代表。\n[해석: 안녕하세요! / 안녕하세요, 만나서 반갑습니다. / 저는 한국 회사 대표입니다.]' },
    { expression: '请多关照', meaning: '잘 부탁드립니다', nuance: '처음 만났을 때 관용적으로 사용', sourceSentence: '以后请多关照。', practiceSentence: '这次合作请多关照。', dialogue: '甲: 这次由我负责。\n乙: 请多关照！\n甲: 我们一起努力。\n[해석: 이번에 제가 담당합니다. / 잘 부탁드립니다! / 함께 노력합시다.]' },
    { expression: '没问题', meaning: '문제없습니다', nuance: '승낙·확인할 때 가장 많이 쓰임', sourceSentence: '这个要求没问题。', practiceSentence: '交货期三天，没问题吗？', dialogue: '甲: 能在周五前完成吗？\n乙: 没问题，我来安排。\n甲: 太好了，谢谢。\n[해석: 금요일 전에 완료 가능한가요? / 문제없습니다, 제가 준비할게요. / 좋습니다, 감사합니다.]' }
  ] : [
    { expression: 'touch base', meaning: '연락하다', nuance: '짧게 상황을 확인할 때 사용. "contact"보다 가볍고 친근한 뉘앙스', sourceSentence: "Let's touch base tomorrow morning.", practiceSentence: "I'll touch base with the client before the meeting.", dialogue: "A: Do you have an update on the proposal?\nB: Not yet, let me touch base with Sarah.\nA: Great, let me know what you find out." },
    { expression: 'get the ball rolling', meaning: '시작하다', nuance: '첫 발을 내딛을 때. "start"보다 더 역동적인 느낌', sourceSentence: "Let's get the ball rolling on the Q3 campaign.", practiceSentence: "We should get the ball rolling on this project now.", dialogue: "A: The deadline is approaching.\nB: You're right. Let's get the ball rolling.\nA: I'll schedule a kickoff meeting." },
    { expression: 'on the same page', meaning: '의견 일치', nuance: '팀 내 공통 이해 확인. 회의 시작/끝에 자주 사용', sourceSentence: "Are we all on the same page about the launch date?", practiceSentence: "Before we proceed, let's make sure we're on the same page.", dialogue: "A: So we're aiming for a July launch?\nB: I thought it was August.\nA: Let's make sure we're on the same page — I'll send a summary." },
    { expression: 'circle back', meaning: '재논의하다', nuance: '나중에 다시 돌아올 것임을 시사. 현안을 잠시 미룰 때', sourceSentence: "Let's circle back on the budget after lunch.", practiceSentence: "Can we circle back to this point at the end of the meeting?", dialogue: "A: Should we address the pricing issue now?\nB: We don't have all the data yet. Let's circle back on that.\nA: Agreed. I'll add it to next week's agenda." },
    { expression: 'take this offline', meaning: '별도로 논의하다', nuance: '회의 중 특정 이슈를 개별적으로 처리하자고 제안할 때', sourceSentence: "This is getting complex — let's take this offline.", practiceSentence: "Can we take this offline and set up a separate call?", dialogue: "A: This technical issue needs more time.\nB: Agreed. Let's take this offline.\nA: I'll send you a calendar invite." }
  ];
  return samples.slice(0, Math.min(count, samples.length));
}

function generateMockMarketReport(sub, topic, isUS) {
  const indicators = isUS ? [
    { name: 'S&P 500',     value: '5,234.18', change: '+0.87%', dir: 'up'   },
    { name: '나스닥',       value: '16,428.82', change: '+1.24%', dir: 'up'   },
    { name: '다우 지수',    value: '39,112.16', change: '+0.43%', dir: 'up'   },
    { name: '미 국채 10년물', value: '4.31%',  change: '+3 bp',  dir: 'up'   },
    { name: 'VIX 공포지수', value: '14.2',    change: '-0.8',   dir: 'down' }
  ] : [
    { name: '코스피',   value: '2,634.70', change: '+0.52%', dir: 'up'   },
    { name: '코스닥',   value: '872.45',   change: '+0.34%', dir: 'up'   },
    { name: '원/달러', value: '1,352',    change: '+3원',   dir: 'up'   }
  ];
  const usSample = {
    title: '뉴욕 증시, 기술주 중심 완만한 상승',
    summary: 'AI·반도체 섹터 수요 기대감에 나스닥이 상대적 강세, 금리 불확실성은 지속',
    summary3: '• 나스닥 중심 기술주 상승 — AI 인프라 투자 기대감 반영\n• 연준 금리 동결 기조 유지, 채권시장은 소폭 약세\n• 에너지·유틸리티는 차익실현으로 상대적 약세',
    checkpoints: [
      'FOMC 위원 발언 일정 확인 (매파/비둘기파 스탠스)',
      '빅테크 실적 발표 예정 여부 체크',
      'VIX 15 이하 유지 시 위험자산 선호 지속 가능성'
    ],
    report: `## ${topic} — 오늘의 흐름\n\n기술주 중심의 완만한 상승세. AI·반도체 업황 기대감이 나스닥을 지지하고 있으며, 연준의 금리 동결 기조가 단기적으로 긍정적 환경을 제공합니다.\n\n## 오늘의 투자 인사이트\n빅테크 실적 시즌 앞두고 관망세와 매수세가 혼재. 단기 변동성보다는 중장기 AI 인프라 사이클에 집중하는 전략이 유효합니다.`,
    aiEconomicKnowledge: [
      { term: 'VIX (공포지수)', importance: '시장 참가자들의 단기 변동성 기대를 수치화한 지표. VIX 20 이하는 안정, 30 이상은 공포 구간으로 해석합니다.', connection: '날씨로 비유하면 VIX는 "기상 불안 지수" — 숫자가 높을수록 폭풍 예보, 낮을수록 맑은 날씨.' },
      { term: '매파 vs 비둘기파', importance: '중앙은행 내 금리 인상 선호(매파)와 금리 동결/인하 선호(비둘기파) 성향의 구분. FOMC 회의록과 위원 발언에서 읽어냄.', connection: '매파 발언이 많을수록 금리 인상 가능성 ↑ → 채권 약세 / 성장주 약세 패턴.' },
      { term: '섹터 로테이션', importance: '경기 사이클에 따라 투자 자금이 성장주 → 방어주 → 경기민감주 순으로 이동하는 현상.', connection: '"다 오른 종목 팔고 안 오른 종목 산다"는 투자자들의 행동 패턴.' }
    ]
  };
  const krSample = {
    title: '코스피, 외국인 매수세에 소폭 강보합',
    summary: '원/달러 환율 안정과 반도체 업황 회복 기대에 코스피 완만한 반등',
    summary3: '• 외국인 순매수 지속 — 반도체·2차전지 중심\n• 원/달러 환율 1,350원대 안착, 수출 기업 수혜\n• 코스닥은 바이오 업종 약세로 상대적 언더퍼폼',
    checkpoints: [
      '삼성전자·SK하이닉스 외국인 순매수 규모 확인',
      '원/달러 1,360원 돌파 시 수입물가 상승 우려',
      '코스닥 바이오 임상 결과 발표 일정 체크'
    ],
    report: `## ${topic} — 오늘의 흐름\n\n외국인 매수세가 대형 반도체주를 중심으로 유입되며 코스피를 지지. 원화 강세 흐름은 수출 기업에 긍정적이나 단기 차익실현 물량이 상단을 제한합니다.\n\n## 오늘의 투자 인사이트\n반도체 사이클 회복 기대와 AI 수요 증가가 국내 대형주에 유리한 환경. 단, 중국 경기 불확실성은 중단기 리스크 요인.`,
    aiEconomicKnowledge: [
      { term: '외국인 순매수', importance: '해외 기관·개인이 국내 증시에서 매수한 금액에서 매도한 금액을 뺀 값. 지속적 순매수는 강세 신호.', connection: '"외국인이 산다"는 건 한국 주식이 글로벌 자금에게 매력적이라는 신호등.' },
      { term: '원/달러 환율', importance: '환율 상승(원화 약세)은 수출기업 수익 증가 → 코스피 호재, 수입물가 상승 → 인플레 우려의 양면이 있음.', connection: '1달러에 원화가 많이 필요할수록 → 삼성·현대차 해외 이익 원화 환산시 증가.' },
      { term: '언더퍼폼', importance: '시장 평균 수익률보다 낮은 성과를 의미. 코스닥이 코스피 대비 언더퍼폼하면 중소형·성장주보다 대형주가 강하다는 신호.', connection: '"남들보다 덜 오른다"는 뜻 — 벤치마크 대비 상대적 성과 비교 용어.' }
    ]
  };
  return {
    ...(isUS ? usSample : krSample),
    indicators,
  };
}

// ══════════════════════════════════════════════════
//  핵심 생성 함수: 오늘의 전체 피드 빌드
// ══════════════════════════════════════════════════

/**
 * 유저의 활성화된 구독 피드를 모두 생성하여 dailyFeeds.json에 저장
 * @param {object} user
 * @param {boolean} force  이미 오늘 데이터가 있어도 강제 재생성
 * @returns {object}  생성된 feeds { subId: feedObj }
 */
async function buildDailyFeeds(user, force = false) {
  const today    = toDateStr();
  const existing = getTodayFeeds(today);

  if (existing && !force) {
    console.log(`[스케줄러] ${today} 피드 이미 존재 — 스킵 (force=false)`);
    return existing;
  }

  const subs = getEnabledSubscriptions(user);
  if (!subs.length) {
    console.log('[스케줄러] 활성화된 구독 없음 — 생성 스킵');
    return {};
  }

  console.log(`[스케줄러] 유저 "${user.name}" 피드 생성 시작: ${subs.map(s=>s.id).join(', ')}`);
  const startedAt = Date.now();
  const results   = {};

  for (const sub of subs) {
    try {
      console.log(`  → [${sub.id}] 생성 중…`);
      const feed   = await generateFeedForSubscription(sub, user);
      results[sub.id] = feed;
      saveTodayFeed(today, sub.id, feed);
      console.log(`  ✓ [${sub.id}] 생성 완료 (${feed.vocabEntries?.length || 0}개 항목)`);
    } catch (e) {
      console.error(`  ✗ [${sub.id}] 생성 실패:`, e.message);
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[스케줄러] 피드 생성 완료 — ${Object.keys(results).length}개, ${elapsed}초 소요`);

  // ── 오늘의 지식 배달 카드 생성 ──
  try {
    await generateDailyDelivery(user, force);
  } catch (e) {
    console.error('[스케줄러] 지식 배달 카드 생성 실패:', e.message);
  }

  // ── 생성 완료 즉시 Web Push 발송 ──
  if (Object.keys(results).length > 0) {
    const payload = buildPushPayload(results);
    console.log(`[Push] 발송 준비: "${payload.title}"`);
    sendPushToAll(payload)
      .then(r => console.log(`[Push] 발송 결과: 성공 ${r.sent}개 / 실패 ${r.failed}개`))
      .catch(e => console.error('[Push] 발송 오류:', e.message));
  }

  return results;
}

// ══════════════════════════════════════════════════
//  ★ 오늘의 지식 배달 카드 생성 (type: 'daily_delivery')
// ══════════════════════════════════════════════════

/**
 * 최근 7일 아카이브 아이템을 분석해 3~5개 지식 카드를 생성,
 * archive.json에 type:'daily_delivery' 로 저장한다.
 * @param {object} user
 * @param {boolean} force  이미 오늘 생성됐어도 재생성
 */
async function generateDailyDelivery(user, force = false) {
  const today = toDateStr();

  // 이미 오늘 생성됐으면 스킵 (force 아닐 때)
  if (!force) {
    const existing = readDB().filter(i => i.type === 'daily_delivery' && i.date === today);
    if (existing.length > 0) {
      console.log(`[배달생성] 오늘(${today}) 이미 생성된 지식 카드 ${existing.length}개 — 스킵`);
      return existing;
    }
  }

  // 최근 7일 아카이브 (daily_delivery 제외, 최대 20개)
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const recentItems = readDB()
    .filter(i => i.type !== 'daily_delivery')
    .filter(i => new Date(i.createdAt) >= weekAgo)
    .slice(0, 20);

  if (!recentItems.length) {
    console.log('[배달생성] 최근 7일 아카이브 없음 — 배달 카드 생성 스킵');
    return [];
  }

  // 코퍼스 구성
  const corpus = recentItems.map((item, i) => {
    const m       = item.analysis || {};
    const title   = m.title   || item.title   || (item.text || '').slice(0, 60);
    const summary = m.summary || item.summary || (item.text || '').slice(0, 120);
    return `[${i + 1}] [${item.category || 'inbox'}] ${title}${summary ? ' — ' + summary : ''}`;
  }).join('\n');

  const prompt = `당신은 성재님의 개인 학습 수석 비서입니다. 제공된 지식 소스를 바탕으로 바쁜 직장인인 성재님이 1분 만에 핵심을 소화할 수 있도록 다음 3가지 양식을 '엄격히' 지켜 오늘의 지식 카드 3~5개를 생성하세요:
1. [지식 핵심 요약]: 전체 맥락을 관통하는 깔끔한 3줄 요약 리포트
2. [필수 개념 및 용어]: 이 지식을 내 것으로 만들기 위해 반드시 기억해야 할 핵심 키워드나 영어 표현 2~3개 정리
3. [한 줄 리마인드]: 성재님이 오늘 하루 동안 가슴에 새겨야 할 실전 적용 포인트 한 줄

최근 성재님의 수집 지식:
${corpus}

JSON 배열로만 응답 (마크다운 코드블록 없이):
[{"title":"카드 제목(20자 이내)","category":"en|economy|history|youtube|inbox","summary3":"• 요약1\\n• 요약2\\n• 요약3","concepts":[{"term":"개념 또는 영어 표현","desc":"설명 1~2문장"},{"term":"개념2","desc":"설명"}],"reminder":"오늘 하루 실전 적용 한 줄"}]`;

  console.log('[배달생성] Gemini 호출 시작...');
  const raw   = await callGemini(prompt, 3000);
  const cards = safeParseJSON(raw);

  if (!Array.isArray(cards) || !cards.length) {
    console.warn('[배달생성] Gemini 응답 파싱 실패 — 배달 카드 생성 중단');
    return [];
  }

  const now  = new Date();
  const items = readDB();
  // force 모드: 기존 오늘 배달 카드 삭제
  const filtered = force
    ? items.filter(i => !(i.type === 'daily_delivery' && i.date === today))
    : items;

  const newCards = cards.slice(0, 5).map(card => ({
    id         : uuidv4(),
    type       : 'daily_delivery',
    category   : card.category || 'inbox',
    shelf      : card.category || 'inbox',
    title      : card.title    || '오늘의 지식',
    text       : card.summary3 || '',
    summary    : card.reminder || '',
    summary3   : card.summary3 || '',
    concepts   : card.concepts || [],
    reminder   : card.reminder || '',
    keywords   : (card.concepts || []).map(c => c.term).filter(Boolean).slice(0, 3),
    classifier : 'daily-delivery',
    source     : 'daily-delivery',
    aiGenerated: true,
    date       : today,
    time       : toTimeStr(now),
    createdAt  : now.toISOString(),
    updatedAt  : now.toISOString(),
    insights   : []
  }));

  writeDB([...newCards, ...filtered]);
  console.log(`[배달생성] ✅ ${newCards.length}개 지식 카드 저장 완료 (${today})`);
  return newCards;
}

// ══════════════════════════════════════════════════
//  ★ node-cron 스케줄러 (30분마다)
// ══════════════════════════════════════════════════

/**
 * 스케줄러 메인 로직
 * - 30분마다 실행
 * - 배달 시간 60분 전 구간에 해당하는 유저의 피드를 사전 생성
 * - 이미 오늘 생성된 피드가 있으면 건너뜀
 */
async function runScheduler() {
  const now   = toTimeStr();
  const today = toDateStr();
  console.log(`\n[스케줄러] ⏰ 실행 — ${today} ${now}`);

  const users = readUsers();

  for (const user of users) {
    const delivTime = user.delivery_time || '07:30';

    // 배달 시간 1시간 전 ~ 30분 전 구간인지 확인
    if (!isPreGenerationWindow(delivTime, 60)) {
      console.log(`[스케줄러] "${user.name}" 대기 중 (배달: ${delivTime}, 현재: ${now})`);
      continue;
    }

    // 이미 오늘 피드가 완전히 생성됐는지 확인
    const existingFeeds = getTodayFeeds(today);
    const subs          = getEnabledSubscriptions(user);
    const allDone       = subs.every(s => existingFeeds?.[s.id]);

    if (allDone) {
      console.log(`[스케줄러] "${user.name}" 오늘 피드 이미 완료 — 스킵`);
      continue;
    }

    console.log(`[스케줄러] "${user.name}" 사전 생성 시작 (배달: ${delivTime}, 현재: ${now})`);
    try {
      await buildDailyFeeds(user, false);
    } catch (e) {
      console.error(`[스케줄러] "${user.name}" 생성 실패:`, e.message);
    }
  }
}

// 30분마다 실행 (매시 0분, 30분)
cron.schedule('0,30 * * * *', () => {
  runScheduler().catch(e => console.error('[스케줄러] 치명적 오류:', e.message));
});

console.log('[스케줄러] node-cron 등록 완료 — 30분마다 실행 (매시 :00, :30)');

// ══════════════════════════════════════════════════
//  Claude API 래퍼 (분류·인사이트용)
// ══════════════════════════════════════════════════

async function callClaude({ model = 'claude-haiku-4-5-20251001', maxTokens = 600, messages, system }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const https   = require('https');
  const bodyObj = { model, max_tokens: maxTokens, messages };
  if (system) bodyObj.system = system;
  const body = JSON.stringify(bodyObj);

  return new Promise(resolve => {
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      }
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw).content?.[0]?.text || null); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

// ══════════════════════════════════════════════════
//  분류 엔진 (기존 유지)
// ══════════════════════════════════════════════════

function classifyByRules(text) {
  const t = text.toLowerCase();
  if (/youtube\.com\/watch|youtu\.be\//.test(t))
    return { category: 'youtube', confidence: 'high', keywords: [] };
  const alpha = (text.match(/[a-zA-Z]/g) || []).length;
  const total = (text.match(/[^\s]/g) || []).length;
  if (total > 0 && alpha / total > 0.55)
    return { category: 'en', confidence: 'high', keywords: [] };
  if (/금리|증시|주가|연준|fed|fomc|etf|반도체|경제|인플레|기준금리|gdp|환율|코스피|나스닥|달러|채권|금융|투자|주식|ipo/.test(t))
    return { category: 'economy', confidence: 'medium', keywords: [] };
  if (/조선|고려|신라|백제|고구려|임진왜란|세종|이순신|태종|광해군|영조|정조|무신정권|삼별초|동학|갑오|을사|일제|독립|년대|세기|왕조|왕|장군|사건|혁명|전쟁|고대|중세/.test(t))
    return { category: 'history', confidence: 'medium', keywords: [] };
  return { category: 'inbox', confidence: 'low', keywords: [] };
}

async function classifyWithClaude(text) {
  const raw = await callClaude({
    maxTokens: 250,
    messages: [{
      role: 'user',
      content: `다음 텍스트를 분류하고 핵심 키워드 3개와 한 줄 요약을 추출하세요.

카테고리:
- en       : 영어 학습, 비즈니스 영어, 영어 표현
- history  : 역사, 역사적 사건·인물 (한국사/세계사)
- economy  : 경제, 금융, 주식, 기업
- youtube  : 유튜브 링크 또는 영상 내용
- inbox    : 위에 해당하지 않는 일반 지식 (임시 서랍)

반드시 JSON만 출력:
{"category":"en","keywords":["표현","협상","비즈니스"],"summary":"협상 시 사용하는 핵심 비즈니스 영어 표현"}

텍스트: ${text.slice(0, 600)}`
    }]
  });
  const parsed = safeParseJSON(raw);
  if (parsed?.category) return {
    category: parsed.category, keywords: parsed.keywords || [],
    summary: parsed.summary || '', classifier: 'claude'
  };
  return null;
}

async function classify(text, manualCategory) {
  if (manualCategory) return { category: manualCategory, keywords: [], summary: '', classifier: 'manual' };
  const c = await classifyWithClaude(text);
  if (c) return c;
  const r = classifyByRules(text);
  return { ...r, summary: '', classifier: `rules(${r.confidence})` };
}

// ══════════════════════════════════════════════════
//  YouTube URL 메타데이터 처리
// ══════════════════════════════════════════════════

/** rawText 내 YouTube URL 추출 */
function extractYouTubeUrl(text) {
  const m = text.match(/https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?[^\s]*v=|shorts\/|embed\/)|youtu\.be\/)[\w\-]+(?:[?&][^\s]*)?/i);
  return m ? m[0] : null;
}

/** YouTube oEmbed API 호출 (API 키 불필요) */
function fetchYouTubeOEmbed(videoUrl) {
  return new Promise(resolve => {
    const https = require('https');
    const oembedPath = `/oembed?url=${encodeURIComponent(videoUrl)}&format=json`;
    const req = https.get(
      { hostname: 'www.youtube.com', path: oembedPath, headers: { 'User-Agent': 'SJ-Archive/1.0' } },
      res => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve(null); } });
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(7000, () => { req.destroy(); resolve(null); });
  });
}

/** Gemini로 YouTube 영상 한국어 분석 생성 */
async function generateYouTubeAnalysis(title, channelName) {
  const prompt = `당신은 지식 큐레이터입니다. 아래 유튜브 영상을 한국어로 분석하세요.

영상 제목: ${title}
채널: ${channelName || '알 수 없음'}

반드시 아래 JSON 형식만 출력하고 다른 텍스트는 쓰지 마세요:
{"title":"한국어로 자연스럽게 번역한 영상 제목 (30자 이내)","summary":"이 영상에서 배울 수 있는 핵심 내용 2~3문장","keywords":["키워드1","키워드2","키워드3"]}`;

  const raw = await callGemini(prompt, 400);
  if (!raw) return null;
  const parsed = safeParseJSON(raw);
  return parsed?.title ? parsed : null;
}

// ══════════════════════════════════════════════════
//  서재 배치 엔진 (기존 유지)
// ══════════════════════════════════════════════════

async function reshelfOldInboxItems() {
  const items   = readDB();
  const targets = items.filter(i => i.category === 'inbox' && isOlderThanOneDay(i.createdAt));
  if (!targets.length) return 0;
  let changed = 0;
  for (const item of targets) {
    const c = await classifyWithClaude(item.text);
    if (c && c.category !== 'inbox') {
      item.category    = c.category;
      item.keywords    = c.keywords.length ? c.keywords : item.keywords;
      item.summary     = c.summary || item.summary;
      item.classifier  = `reshelved:${c.classifier}`;
      item.reshelvedAt = new Date().toISOString();
      changed++;
    }
  }
  if (changed) { writeDB(items); console.log(`[서재배치] ${changed}개 항목 이동`); }
  return changed;
}
setInterval(reshelfOldInboxItems, 60 * 60 * 1000);

// ══════════════════════════════════════════════════
//  통찰 감지 (기존 유지)
// ══════════════════════════════════════════════════

async function detectCrossInsight(newItem, recentItems) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!['en','history'].includes(newItem.category)) return null;
  const opposite = newItem.category === 'en' ? 'history' : 'en';
  const peers = recentItems.filter(i => i.category === opposite).slice(0, 5)
    .map(i => `- ${i.text.slice(0,120)}`).join('\n');
  if (!peers) return null;

  const raw = await callClaude({
    maxTokens: 300,
    system: '당신은 지식 간 깊은 연결고리를 발견하는 인문학자입니다.',
    messages: [{
      role: 'user',
      content: `아래 두 지식 그룹 사이에 의미 있는 인과관계 또는 새로운 연결이 있으면 발견해 주세요.
없으면 반드시 {"found":false} 만 출력하세요.
있으면: {"found":true,"insight":"발견한 연결 2~3문장","title":"연결 제목 10자 이내"}

[새로 추가된 ${newItem.category === 'en' ? '영어' : '역사'} 지식]
${newItem.text.slice(0, 200)}

[기존 ${opposite === 'en' ? '영어' : '역사'} 지식]
${peers}`
    }]
  });
  const parsed = safeParseJSON(raw);
  return parsed?.found ? parsed : null;
}

// ══════════════════════════════════════════════════
//  Web Push 라우팅
// ══════════════════════════════════════════════════

/**
 * GET /api/push/vapid-key
 * 프론트엔드가 구독 등록 전에 공개 VAPID 키를 가져감
 */
app.get('/api/push/vapid-key', (req, res) => {
  const key = process.env.PUBLIC_VAPID_KEY;
  if (!key) return res.status(503).json({ success: false, error: 'VAPID 키 미설정' });
  res.json({ success: true, publicKey: key });
});

/**
 * POST /api/push/subscribe
 * Body: { subscription: { endpoint, keys: { p256dh, auth } }, userId? }
 */
app.post('/api/push/subscribe', (req, res) => {
  const { subscription, userId = 'sj' } = req.body;
  if (!subscription?.endpoint) return res.status(400).json({ success: false, error: '구독 정보 없음' });

  const subs  = readPushSubs();
  const exist = subs.find(s => s.subscription.endpoint === subscription.endpoint);
  if (exist) {
    console.log('[Push] 이미 등록된 구독 — 갱신');
    exist.subscription = subscription;
    exist.updatedAt    = new Date().toISOString();
    writePushSubs(subs);
    return res.json({ success: true, updated: true });
  }

  subs.push({ userId, subscription, createdAt: new Date().toISOString() });
  writePushSubs(subs);
  console.log(`[Push] 구독 등록 완료 (총 ${subs.length}개)`);
  res.status(201).json({ success: true, registered: true });
});

/**
 * DELETE /api/push/subscribe
 * Body: { endpoint }
 */
app.delete('/api/push/subscribe', (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ success: false, error: 'endpoint 없음' });

  const subs    = readPushSubs();
  const cleaned = subs.filter(s => s.subscription.endpoint !== endpoint);
  writePushSubs(cleaned);
  console.log(`[Push] 구독 해제 (${subs.length - cleaned.length}개 삭제)`);
  res.json({ success: true });
});

/**
 * POST /api/push/test
 * 테스트 푸시 발송 (개발용)
 */
app.post('/api/push/test', async (req, res) => {
  const payload = {
    title: '📚 SJ 서재 — 테스트 알림',
    body:  '웹 푸시가 정상적으로 작동합니다! 🎉',
    url:   '/?view=mobile&action=feed',
    tag:   'sj-test'
  };
  const result = await sendPushToAll(payload);
  res.json({ success: true, ...result });
});

// ══════════════════════════════════════════════════
//  Share Target & Inbox API
// ══════════════════════════════════════════════════

/**
 * GET /share-handler
 * PWA manifest의 share_target.action이 이 경로를 가리킴
 * Service Worker가 설치된 경우: SW의 fetch 이벤트에서 처리
 * SW 미설치 또는 폴백: 경량 HTML 페이지 서빙
 */
app.get('/share-handler', (req, res) => {
  // SW가 처리하지 못한 경우 → share-handler.html로 포워드
  // (URL 파라미터는 그대로 유지됨)
  // server.js가 /public/ 안에 있으므로 __dirname = /public
  res.sendFile(path.join(__dirname, 'share-handler.html'));
});

/**
 * POST /api/inbox
 * 공유 시트 / 빠른 수집을 통해 들어온 콘텐츠를 인박스에 저장
 * Body: { text, source?, title? }
 *
 * 일반 POST /api/items와 동일하나 category를 항상 'inbox'로 고정하고
 * AI 분류는 비동기 백그라운드로 처리 (응답 지연 없음)
 */
app.post('/api/inbox', async (req, res) => {
  const body = req.body || {};

  let rawText = body.text || body.content || body.url || '';
  if (body.url && !rawText.includes(body.url)) rawText = [rawText, body.url].filter(Boolean).join('\n');
  rawText = rawText.trim();

  if (!rawText) return res.status(400).json({ success: false, error: '내용이 비어 있습니다.' });

  const now     = new Date();
  const newItem = {
    id:         uuidv4(),
    text:       rawText,
    category:   'inbox',
    shelf:      'inbox',
    keywords:   [],
    summary:    body.title ? `공유: ${body.title}` : '',
    classifier: 'inbox-direct',
    source:     body.source || 'share-sheet',
    date:       toDateStr(now),
    time:       toTimeStr(now),
    createdAt:  now.toISOString(),
    updatedAt:  now.toISOString(),
    insights:   []
  };

  const items = readDB();
  items.unshift(newItem);
  writeDB(items);

  console.log(`[인박스] 수집: "${rawText.slice(0, 60)}" (${body.source || 'share-sheet'})`);

  // 즉시 201 반환 — AI 분류는 백그라운드로
  res.status(201).json({ success: true, item: newItem, message: '인박스에 수집되었습니다!' });

  // 비동기 AI 분류 (응답 이후)
  setImmediate(async () => {
    try {
      const c = await classify(rawText, null);
      if (c.category !== 'inbox') {
        const db  = readDB();
        const idx = db.findIndex(i => i.id === newItem.id);
        if (idx !== -1) {
          db[idx].category   = c.category;
          db[idx].shelf      = c.category;
          db[idx].keywords   = c.keywords;
          db[idx].summary    = c.summary || db[idx].summary;
          db[idx].classifier = `inbox-ai:${c.classifier}`;
          db[idx].updatedAt  = new Date().toISOString();
          writeDB(db);
          console.log(`[인박스] AI 분류 완료: "${rawText.slice(0,40)}" → ${c.category}`);
        }
      }
    } catch (e) {
      console.error('[인박스] AI 분류 실패:', e.message);
    }
  });
});

// ══════════════════════════════════════════════════
//  API — 유저 설정
// ══════════════════════════════════════════════════

/**
 * GET /api/user/settings
 * 현재 유저의 설정 조회 (배달 시간, 활성화된 피드 등)
 */
app.get('/api/user/settings', (req, res) => {
  const user = getDefaultUser();
  if (!user) return res.status(404).json({ success: false, error: '유저 없음' });

  const subs      = readJSON(SUBSCRIPTIONS_PATH, []);
  const enabled   = new Set(user.enabled_feeds || subs.filter(s=>s.enabled).map(s=>s.id));

  res.json({
    success: true,
    user: {
      id:             user.id,
      name:           user.name,
      delivery_time:  user.delivery_time,
      timezone:       user.timezone,
      enabled_feeds:  [...enabled],
      feed_settings:  user.feed_settings || {}
    },
    available_feeds: subs.map(s => ({
      id: s.id, label: s.label, type: s.type,
      category: s.category, desc: s.desc, icon: s.icon,
      enabled: enabled.has(s.id)
    }))
  });
});

/**
 * PATCH /api/user/settings
 * Body: { delivery_time?, enabled_feeds?, name? }
 */
app.patch('/api/user/settings', (req, res) => {
  const users = readUsers();
  if (!users.length) return res.status(404).json({ success: false, error: '유저 없음' });

  const user    = users[0];
  const allowed = ['delivery_time', 'enabled_feeds', 'name', 'timezone'];
  allowed.forEach(k => { if (req.body[k] !== undefined) user[k] = req.body[k]; });
  user.updated_at = new Date().toISOString();
  writeUsers(users);

  console.log(`[유저설정] 업데이트 — 배달시간: ${user.delivery_time}, 피드: ${(user.enabled_feeds||[]).join(',')}`);
  res.json({ success: true, user });
});

/**
 * PATCH /api/delivery-settings/english  (하위 호환 유지)
 * Body: { count, themes, level }
 */
app.patch('/api/delivery-settings/english', (req, res) => {
  const users = readUsers();
  if (!users.length) return res.status(404).json({ success: false, error: '유저 없음' });
  const user = users[0];
  if (!user.feed_settings) user.feed_settings = {};
  const { count, themes, level } = req.body;
  user.feed_settings.en_expr = {
    count : [5,7,10].includes(Number(count)) ? Number(count) : 7,
    themes: Array.isArray(themes) ? themes : [],
    level : ['intermediate','advanced'].includes(level) ? level : 'intermediate'
  };
  user.updated_at = new Date().toISOString();
  writeUsers(users);
  res.json({ success: true, settings: user.feed_settings.en_expr });
});

/**
 * PATCH /api/delivery-settings/all
 * Body: { feedId, settings }
 * feedId: 'en_expr' | 'zh_expr' | 'us_market' | 'kr_market'
 * settings: 피드별 상세 설정 오브젝트
 *
 * 영어/중국어: { count, themes[], level }
 * 시황:       { is_market_centric, is_macro_centric }
 */
app.patch('/api/delivery-settings/all', (req, res) => {
  const users = readUsers();
  if (!users.length) return res.status(404).json({ success: false, error: '유저 없음' });

  const user = users[0];
  if (!user.feed_settings) user.feed_settings = {};

  const { feedId, settings } = req.body;
  const VALID_FEED_IDS = ['en_expr', 'zh_expr', 'us_market', 'kr_market'];
  if (!VALID_FEED_IDS.includes(feedId)) {
    return res.status(400).json({ success: false, error: '유효하지 않은 feedId' });
  }

  /* 피드 타입별 유효성 검사 */
  if (feedId === 'en_expr' || feedId === 'zh_expr') {
    const validLangThemes = feedId === 'en_expr'
      ? ['business_meeting', 'office_email', 'daily_travel', 'drama_spoken']
      : ['biz_hsk', 'biz_trip', 'daily_shop', 'drama_slang'];
    user.feed_settings[feedId] = {
      count : [5,7,10].includes(Number(settings.count)) ? Number(settings.count) : (feedId === 'zh_expr' ? 5 : 7),
      themes: Array.isArray(settings.themes) ? settings.themes.filter(t => validLangThemes.includes(t)) : [],
      level : ['intermediate','advanced'].includes(settings.level) ? settings.level : 'intermediate'
    };
  } else {
    /* 시황 피드 */
    user.feed_settings[feedId] = {
      is_market_centric: settings.is_market_centric !== false,
      is_macro_centric : settings.is_macro_centric  !== false
    };
  }

  user.updated_at = new Date().toISOString();
  writeUsers(users);

  /* ── 설정 변경 시 오늘 해당 피드 캐시 삭제 → 배달탭 진입 시 새 설정으로 재생성 ── */
  try {
    const todayKey   = toDateStr();
    const allFeeds   = readDailyFeeds();
    if (allFeeds[todayKey] && allFeeds[todayKey][feedId]) {
      delete allFeeds[todayKey][feedId];
      writeDailyFeeds(allFeeds);
      console.log(`[배달설정/${feedId}] ✅ 오늘 캐시 삭제 완료 → 재생성 예정`);
    }
  } catch (cacheErr) {
    console.warn('[배달설정] 캐시 삭제 실패 (무시):', cacheErr.message);
  }

  console.log(`[배달설정/${feedId}] ${JSON.stringify(user.feed_settings[feedId])}`);
  res.json({ success: true, feedId, settings: user.feed_settings[feedId] });
});

// ══════════════════════════════════════════════════
//  API — 데일리 피드 (★ 핵심: 캐시 우선 즉시 반환)
// ══════════════════════════════════════════════════

/**
 * GET /api/daily-feed
 *
 * 1순위: 오늘 날짜의 pre-generated 캐시 → 즉시 반환 (0ms)
 * 2순위: 캐시 없으면 실시간 Gemini 생성 후 캐시 저장 (30~60초)
 *
 * query:
 *   ?force=true  캐시를 무시하고 강제 재생성
 */
app.get('/api/daily-feed', async (req, res) => {
  const today  = toDateStr();
  const force  = req.query.force === 'true';
  const user   = getDefaultUser();

  if (!user) return res.status(500).json({ success: false, error: '유저 설정 없음' });

  // ── 캐시 히트 체크 ──
  if (!force) {
    const cached = getTodayFeeds(today);
    if (cached && Object.keys(cached).length > 0) {
      const feeds = Object.values(cached);
      console.log(`[피드API] ✅ 캐시 히트 — ${today} (${feeds.length}개 즉시 반환)`);
      return res.json({
        success:   true,
        date:      today,
        cached:    true,
        feeds:     Object.fromEntries(feeds.map((f, i) => [i, f]))
      });
    }
  }

  // ── 캐시 미스: 실시간 생성 ──
  console.log(`[피드API] 🔄 캐시 미스 — ${today} 실시간 생성 시작`);
  try {
    const feeds = await buildDailyFeeds(user, force);
    const arr   = Object.values(feeds);
    res.json({
      success:   true,
      date:      today,
      cached:    false,
      feeds:     Object.fromEntries(arr.map((f, i) => [i, f]))
    });
  } catch (e) {
    console.error('[피드API] 생성 실패:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/daily-feed/generate
 * 수동으로 오늘 피드 재생성 트리거
 * Body: { force?: boolean }
 */
app.post('/api/daily-feed/generate', async (req, res) => {
  const user  = getDefaultUser();
  const force = req.body.force !== false;  // 기본 true
  if (!user) return res.status(500).json({ success: false, error: '유저 없음' });

  console.log('[피드API] 수동 재생성 요청');
  try {
    const feeds = await buildDailyFeeds(user, force);
    res.json({ success: true, date: toDateStr(), count: Object.keys(feeds).length, feeds });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/daily-feed/status
 * 오늘 피드 캐시 상태 확인
 */
app.get('/api/daily-feed/status', (req, res) => {
  const today   = toDateStr();
  const user    = getDefaultUser();
  const cached  = getTodayFeeds(today);
  const subs    = user ? getEnabledSubscriptions(user) : [];

  const subStatus = subs.map(s => ({
    id:        s.id,
    label:     s.label,
    generated: !!(cached?.[s.id]),
    generatedAt: cached?.[s.id]?.createdAt || null
  }));

  res.json({
    success:       true,
    date:          today,
    delivery_time: user?.delivery_time || '07:30',
    allReady:      subStatus.every(s => s.generated),
    subscriptions: subStatus
  });
});

/**
 * POST /api/daily-feed/:date/:subId/save
 * 피드 전체를 서재에 저장
 */
app.post('/api/daily-feed/:date/:subId/save', async (req, res) => {
  const { date, subId } = req.params;
  const all  = readDailyFeeds();
  const feed = all?.[date]?.[subId];

  if (!feed) return res.status(404).json({ success: false, error: '피드를 찾을 수 없습니다.' });
  if (feed.savedItemId) return res.json({ success: true, alreadySaved: true, itemId: feed.savedItemId });

  // 서재에 저장
  const text = feed.type === 'language'
    ? `[영어 배달 ${date}] ${feed.title}\n` + (feed.vocabEntries || []).map(e => `• ${e.expression}: ${e.meaning}`).join('\n')
    : `[시황 배달 ${date}] ${feed.title}\n${feed.summary}\n${feed.report || ''}`;

  const now     = new Date();
  const newItem = {
    id:         uuidv4(),
    text:       text.slice(0, 2000),
    category:   feed.category || 'en',
    shelf:      feed.category || 'en',
    keywords:   [feed.subCategory, date].filter(Boolean).slice(0, 3),
    summary:    feed.summary || feed.title || '',
    classifier: 'daily-feed',
    source:     'daily-feed',
    type:       feed.type,
    originalUrl: '',
    date:       toDateStr(now),
    time:       toTimeStr(now),
    createdAt:  now.toISOString(),
    updatedAt:  now.toISOString(),
    insights:   [],
    feedData:   feed   // 원본 피드 데이터 보존
  };

  const items = readDB();
  items.unshift(newItem);
  writeDB(items);

  // dailyFeeds에 savedItemId 기록
  all[date][subId].savedItemId = newItem.id;
  all[date][subId].saved       = true;
  writeDailyFeeds(all);

  console.log(`[피드저장] [${feed.category}] "${feed.title}" → ${newItem.id}`);
  res.status(201).json({ success: true, alreadySaved: false, itemId: newItem.id, item: newItem });
});

/**
 * POST /api/archive/single
 * 피드의 낱개 항목(단어/개념) 하나를 서재에 저장
 * Body: { date, subId, index, field? }
 */
app.post('/api/archive/single', async (req, res) => {
  const { date, subId, index, field } = req.body;
  const all  = readDailyFeeds();
  const feed = all?.[date]?.[subId];

  if (!feed) return res.status(404).json({ success: false, error: '피드를 찾을 수 없습니다.' });

  const entries = field ? (feed[field] || []) : (feed.vocabEntries || feed.aiEconomicKnowledge || []);
  const entry   = entries[index];
  if (!entry) return res.status(404).json({ success: false, error: '항목을 찾을 수 없습니다.' });

  // 중복 저장 체크
  const savedKey = `saved_${field || 'default'}_${index}`;
  if (feed.savedEntries?.[savedKey]) {
    return res.json({ success: true, alreadySaved: true });
  }

  // 텍스트 구성
  let text = '';
  if (feed.type === 'language' || entry.expression) {
    text = `${entry.expression || entry.term}\n뜻: ${entry.meaning || entry.importance}\n뉘앙스: ${entry.nuance || entry.connection || ''}\n예문: ${entry.sourceSentence || ''}`.trim();
  } else {
    text = `${entry.term || ''}: ${entry.importance || ''}\n${entry.connection || ''}`.trim();
  }

  const now     = new Date();
  const newItem = {
    id:         uuidv4(),
    text,
    category:   feed.category || 'en',
    shelf:      feed.category || 'en',
    keywords:   [entry.expression || entry.term, feed.subCategory].filter(Boolean).slice(0, 3),
    summary:    entry.meaning || entry.importance || '',
    classifier: 'daily-feed-single',
    source:     'daily-feed',
    type:       feed.type === 'language' ? 'text' : 'text',
    date:       toDateStr(now),
    time:       toTimeStr(now),
    createdAt:  now.toISOString(),
    updatedAt:  now.toISOString(),
    insights:   []
  };

  const items = readDB();
  items.unshift(newItem);
  writeDB(items);

  // savedEntries 기록
  if (!all[date][subId].savedEntries) all[date][subId].savedEntries = {};
  all[date][subId].savedEntries[savedKey] = newItem.id;
  writeDailyFeeds(all);

  console.log(`[낱개저장] "${entry.expression || entry.term}" → ${newItem.id}`);
  res.status(201).json({ success: true, alreadySaved: false, itemId: newItem.id });
});

// ══════════════════════════════════════════════════
//  API — 오늘의 지식 배달 카드
// ══════════════════════════════════════════════════

/**
 * GET /api/daily-delivery
 * 오늘 생성된 type:'daily_delivery' 카드 반환
 * ?force=true → 강제 재생성
 */
app.get('/api/daily-delivery', async (req, res) => {
  const today = toDateStr();
  const force = req.query.force === 'true';
  const user  = getDefaultUser();

  if (!user) return res.status(500).json({ success: false, error: '유저 설정 없음' });

  // 오늘 배달 카드 조회
  const existing = readDB().filter(i => i.type === 'daily_delivery' && i.date === today);

  if (existing.length > 0 && !force) {
    return res.json({ success: true, date: today, cached: true, items: existing });
  }

  // 없으면 생성
  try {
    const cards = await generateDailyDelivery(user, force);
    res.json({ success: true, date: today, cached: false, items: cards });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/daily-delivery/generate
 * 수동으로 오늘의 지식 배달 카드 재생성
 */
app.post('/api/daily-delivery/generate', async (req, res) => {
  const user  = getDefaultUser();
  const force = req.body?.force !== false;
  if (!user) return res.status(500).json({ success: false, error: '유저 없음' });

  try {
    const cards = await generateDailyDelivery(user, force);
    res.json({ success: true, date: toDateStr(), count: cards.length, items: cards });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ══════════════════════════════════════════════════
//  API — CRUD (기존 유지)
// ══════════════════════════════════════════════════

app.get('/api/items', (req, res) => {
  let items = readDB();
  const { category, shelf, limit = 100, sort = 'desc', search } = req.query;

  if (category && category !== 'all') items = items.filter(i => i.category === category);
  if (shelf)    items = items.filter(i => i.shelf === shelf);

  // 키워드 검색: 제목·요약·본문·키워드 모두 대상
  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    items = items.filter(i => {
      const m       = i.analysis || {};
      const title   = (m.title   || i.title   || '').toLowerCase();
      const summary = (m.summary || i.summary  || '').toLowerCase();
      const text    = (i.text    || '').toLowerCase();
      const kws     = (m.keywords || i.keywords || []).join(' ').toLowerCase();
      return title.includes(q) || summary.includes(q) || text.includes(q) || kws.includes(q);
    });
  }

  items.sort((a, b) => {
    const d = new Date(a.createdAt) - new Date(b.createdAt);
    return sort === 'asc' ? d : -d;
  });
  res.json({ success: true, total: items.length, items: items.slice(0, Number(limit)) });
});

app.get('/api/items/:id', (req, res) => {
  const item = readDB().find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ success: false, error: '항목을 찾을 수 없습니다.' });
  res.json({ success: true, item });
});

app.post('/api/items', async (req, res) => {
  const body = req.body || {};
  let rawText = body.text || body.content || body.note || '';
  if (body.url && !rawText.includes(body.url)) rawText = [rawText, body.url].filter(Boolean).join('\n');
  rawText = rawText.trim();
  if (!rawText) return res.status(400).json({ success: false, error: '텍스트가 비어 있습니다.' });

  const source         = body.source || body.origin || 'manual';
  const manualCategory = body.category || body.manualCategory || null;
  const extraTags      = Array.isArray(body.tags) ? body.tags : [];

  // ── YouTube URL 전용 처리 ──
  const ytUrl = extractYouTubeUrl(rawText);
  if (ytUrl) {
    console.log(`[YouTube] URL 감지: ${ytUrl}`);
    const oembed      = await fetchYouTubeOEmbed(ytUrl);
    const rawTitle    = oembed?.title         || '제목 없음';
    const thumbnail   = oembed?.thumbnail_url || '';
    const channelName = oembed?.author_name   || '';
    console.log(`[YouTube] oEmbed: "${rawTitle}" / ${channelName}`);

    const aiResult = await generateYouTubeAnalysis(rawTitle, channelName);
    const analysis = {
      title   : aiResult?.title    || rawTitle,
      summary : aiResult?.summary  || `"${rawTitle}" — ${channelName || 'YouTube'} 영상`,
      keywords: aiResult?.keywords || []
    };

    const now     = new Date();
    const newItem = {
      id         : uuidv4(),
      type       : 'youtube',
      text       : rawText,
      category   : 'youtube',
      shelf      : 'youtube',
      source     : ytUrl,
      title      : rawTitle,
      thumbnail,
      channelName,
      keywords   : [...analysis.keywords, ...extraTags].slice(0, 6),
      summary    : analysis.summary,
      analysis,
      classifier : oembed ? 'youtube-oembed' : 'youtube-rules',
      date       : toDateStr(now),
      time       : toTimeStr(now),
      createdAt  : now.toISOString(),
      updatedAt  : now.toISOString(),
      insights   : []
    };

    const items = readDB();
    items.unshift(newItem);
    writeDB(items);
    console.log(`[저장] [youtube] "${rawTitle}"`);
    return res.status(201).json({ success: true, item: newItem });
  }

  // ── 일반 텍스트/이미지 처리 ──
  const now            = new Date();
  const c              = await classify(rawText, manualCategory);
  const shelf          = c.category === 'inbox' ? 'inbox' : c.category;

  const newItem = {
    id: uuidv4(), text: rawText, category: c.category, shelf,
    keywords: [...c.keywords, ...extraTags].slice(0, 6),
    summary: c.summary, classifier: c.classifier, source,
    date: toDateStr(now), time: toTimeStr(now),
    createdAt: now.toISOString(), updatedAt: now.toISOString(), insights: []
  };

  const items = readDB();
  items.unshift(newItem);
  writeDB(items);
  console.log(`[저장] [${newItem.category}] "${rawText.slice(0,60)}"`);

  const recentItems = items.slice(1, 30);
  detectCrossInsight(newItem, recentItems).then(insight => {
    if (!insight) return;
    const db  = readDB();
    const idx = db.findIndex(i => i.id === newItem.id);
    if (idx !== -1) {
      db[idx].insights.push({ id: uuidv4(), title: insight.title, body: insight.insight, createdAt: new Date().toISOString() });
      writeDB(db);
    }
  }).catch(() => {});

  res.status(201).json({ success: true, item: newItem });
});

app.patch('/api/items/:id', (req, res) => {
  const items = readDB();
  const idx   = items.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: '항목을 찾을 수 없습니다.' });
  const allowed = ['category','shelf','keywords','summary','source','text','myInsight'];
  allowed.forEach(k => { if (req.body[k] !== undefined) items[idx][k] = req.body[k]; });
  items[idx].updatedAt = new Date().toISOString();
  writeDB(items);
  res.json({ success: true, item: items[idx] });
});

app.delete('/api/items/:id', (req, res) => {
  let items  = readDB();
  const prev = items.length;
  items      = items.filter(i => i.id !== req.params.id);
  if (items.length === prev) return res.status(404).json({ success: false, error: '항목을 찾을 수 없습니다.' });
  writeDB(items);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════
//  API — AI 기간별 학습 요약 (복습 대시보드)
// ══════════════════════════════════════════════════

/**
 * POST /api/summary
 * Body: { period, categories }
 *
 * period:
 *   'today'   → 오늘
 *   '3days'   → 최근 3일
 *   '1week'   → 지난 7일 (기본)
 *   '1month'  → 이번 달 전체
 *
 * categories: [] = 전체, ['en','economy'] = 해당 카테고리만
 *
 * 응답: { success, report, keywords[], itemCount, period, categories }
 */
app.post('/api/summary', async (req, res) => {
  const { period = '1week', categories = [] } = req.body || {};

  // ── 날짜 범위 계산 ──
  const now   = new Date();
  const today = toDateStr(now);

  function dateBefore(days) {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return toDateStr(d);
  }

  let fromDate;
  if (period === 'today') {
    fromDate = today;
  } else if (period === '3days') {
    fromDate = dateBefore(2);
  } else if (period === '1week') {
    fromDate = dateBefore(6);
  } else if (period === '1month') {
    // 이번 달 1일
    fromDate = `${today.slice(0, 7)}-01`;
  } else {
    fromDate = dateBefore(6);
  }

  // ── 데이터 필터링 ──
  let items = readDB();

  // 날짜 필터
  items = items.filter(i => i.date && i.date >= fromDate && i.date <= today);

  // 카테고리 필터 (빈 배열 = 전체)
  const cats = Array.isArray(categories) ? categories.filter(Boolean) : [];
  if (cats.length > 0) {
    items = items.filter(i => cats.includes(i.category));
  }

  const itemCount = items.length;
  console.log(`[요약API] 기간=${period}(${fromDate}~${today}), 카테고리=${cats.join(',') || '전체'}, 항목수=${itemCount}`);

  // ── 항목이 없을 때 ──
  if (itemCount === 0) {
    return res.json({
      success:    true,
      period,
      categories: cats,
      itemCount:  0,
      report:     '해당 기간에 기록된 지식 항목이 없습니다. 더 많은 지식을 아카이빙해보세요!',
      keywords:   []
    });
  }

  // ── AI 없을 때 목업 요약 ──
  if (!process.env.GEMINI_API_KEY) {
    const mock = generateMockSummary(items, period, cats);
    return res.json({ success: true, period, categories: cats, itemCount, ...mock });
  }

  // ── Gemini 프롬프트 구성 ──
  const corpus = items.slice(0, 80).map((i, idx) => {
    const cat     = i.category || 'inbox';
    const title   = i.title   || i.text?.slice(0, 80) || '';
    const summary = i.summary || i.aiSummary?.slice(0, 200) || i.text?.slice(0, 200) || '';
    const kws     = (i.keywords || []).slice(0, 3).join(', ');
    return `[${idx + 1}] [${cat}] ${title}${summary ? ' — ' + summary : ''}${kws ? ' (키워드: ' + kws + ')' : ''}`;
  }).join('\n');

  const catLabel = cats.length === 0 ? '전체 분야'
    : cats.map(c => ({ en:'English', history:'History', economy:'Economy', youtube:'YouTube', inbox:'임시서랍' }[c] || c)).join(', ');

  const periodLabel = { today:'오늘', '3days':'최근 3일', '1week':'지난 1주일', '1month':'이번 달 전체' }[period] || period;

  const prompt = `당신은 유저의 개인 학습 비서입니다.
아래는 유저 "성재"가 ${periodLabel} 동안 아카이빙한 지식 목록(${itemCount}개, 분야: ${catLabel})입니다.

---
${corpus}
---

다음 형식으로 한국어 학습 브리핑을 작성해주세요:

[종합 리포트 3줄]
• 이 기간 가장 두드러진 학습 패턴 1줄
• 핵심 개념 또는 키워드 연결 1줄
• 앞으로의 학습 방향 제안 1줄

[핵심 키워드/영어 표현 Top 5]
최근 학습에서 가장 중요한 키워드나 영어 표현 5개를 쉼표로 나열

JSON 형식으로 출력:
{
  "report": "• 리포트 줄1\\n• 리포트 줄2\\n• 리포트 줄3",
  "keywords": ["키워드1", "키워드2", "키워드3", "키워드4", "키워드5"]
}`;

  try {
    const raw = await callGemini(prompt, 600);
    const parsed = safeParseJSON(raw);

    if (parsed?.report) {
      return res.json({
        success:    true,
        period,
        categories: cats,
        itemCount,
        report:     parsed.report,
        keywords:   Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 5) : []
      });
    }

    // JSON 파싱 실패 → 원문 그대로 반환
    return res.json({
      success:    true,
      period,
      categories: cats,
      itemCount,
      report:     raw?.slice(0, 800) || '요약 생성에 실패했습니다.',
      keywords:   []
    });

  } catch (e) {
    console.error('[요약API] Gemini 호출 실패:', e.message);
    // 폴백: 목업 요약
    const mock = generateMockSummary(items, period, cats);
    return res.json({ success: true, period, categories: cats, itemCount, ...mock });
  }
});

/**
 * Gemini API 없을 때의 목업 요약 생성기
 */
function generateMockSummary(items, period, cats) {
  const catCounts = {};
  items.forEach(i => { catCounts[i.category] = (catCounts[i.category] || 0) + 1; });
  const topCat   = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0];
  const topLabel = topCat
    ? ({ en:'영어(English)', history:'역사(History)', economy:'경제(Economy)', youtube:'YouTube', inbox:'임시서랍' }[topCat[0]] || topCat[0])
    : '다양한 분야';

  const keywords = items
    .flatMap(i => i.keywords || [])
    .filter(Boolean)
    .slice(0, 5);

  const report = `• ${topLabel} 분야에 가장 많은 지식(${topCat?.[1] || 0}개)을 기록했습니다.\n`
               + `• 총 ${items.length}개의 지식 항목을 아카이빙하며 꾸준한 학습 루틴을 유지하고 있습니다.\n`
               + `• 다음 단계: 저장된 지식을 복습하고 나만의 인사이트를 추가해보세요.`;

  return { report, keywords: keywords.length ? keywords : ['학습', '아카이브', '지식', '복습', '성장'] };
}

// ══════════════════════════════════════════════════
//  Gemini 멀티모달 이미지 분석 함수
// ══════════════════════════════════════════════════

/**
 * callGeminiWithImage
 * imageBuffer : Buffer (파일 읽기 결과)
 * mimeType    : 'image/jpeg' | 'image/png' | 'image/webp' 등
 * userHint    : 유저가 입력한 메모/질문 (선택)
 * maxTokens   : 출력 최대 토큰
 */
async function callGeminiWithImage(imageBuffer, mimeType, userHint = '', maxTokens = 2000) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-1.5-flash'
  });

  const hintSection = userHint
    ? `\n\n[유저 메모 / 특별 요청]\n"${userHint}"\n위 요청을 최우선으로 반영하여 분석해 주세요.`
    : '';

  const prompt = `당신은 천재적인 지식 가이드입니다.
제공된 이미지 속 시각 자료(텍스트, 도표, 수식, 사진 등)를 정밀하게 분석하세요.${hintSection}

반드시 아래 JSON 형식으로만 출력하세요 (마크다운 코드블록 없이 순수 JSON):
{
  "title": "이 이미지를 한 문장으로 정의하는 제목 (최대 30자)",
  "summary": "사진이 담고 있는 핵심 내용 한 줄 정의",
  "concepts": [
    {"term": "개념 이름", "desc": "이 개념의 설명 (2~3문장)"},
    {"term": "개념 이름2", "desc": "설명"},
    {"term": "개념 이름3", "desc": "설명"}
  ],
  "steps": [
    "Step 1: 논리적인 단계별 풀이 또는 해석 첫 번째",
    "Step 2: 두 번째",
    "Step 3: 세 번째"
  ],
  "fullAnalysis": "전체 분석 결과를 친절하고 상세하게 마크다운 형식으로 작성"
}`;

  const imagePart = {
    inlineData: {
      data: imageBuffer.toString('base64'),
      mimeType
    }
  };

  const result = await model.generateContent([imagePart, prompt]);
  return result.response.text();
}

/**
 * 이미지 분석 목업 (Gemini API 키 없을 때)
 */
function generateMockImageAnalysis(filename, userHint) {
  return {
    title:       '이미지 분석 결과',
    summary:     '(Gemini API 키 미설정) 실제 분석을 위해 .env에 GEMINI_API_KEY를 입력하세요.',
    concepts:    [{ term: '분석 대기', desc: 'Gemini API 키가 설정되면 자동으로 개념이 추출됩니다.' }],
    steps:       ['Gemini API 키를 .env 파일에 설정하세요.', '서버를 재시작한 후 다시 시도하세요.'],
    fullAnalysis: userHint ? `유저 질문: "${userHint}"\n\nGemini API 키를 설정하면 정확한 분석이 제공됩니다.` : ''
  };
}

// ══════════════════════════════════════════════════
//  API — 이미지 업로드 & 멀티모달 분석
// ══════════════════════════════════════════════════

/**
 * POST /api/analyze-image
 * Content-Type: multipart/form-data
 * Field: image (File), memo (string, optional)
 *
 * 처리 흐름:
 *   1. multer로 이미지 임시 저장
 *   2. 영구 파일명으로 rename (uploads/UUID.ext)
 *   3. Gemini 멀티모달 API 호출
 *   4. JSON 파싱 → archive.json에 type:'image_analysis'로 저장
 *   5. 임시 파일 정리 (multer dest의 무작위 파일명 제거)
 *   6. 결과 반환
 */
app.post('/api/analyze-image', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: '이미지 파일이 없습니다.' });
  }

  const userHint = (req.body.memo || '').trim();
  const tmpPath  = req.file.path;
  const mimeType = req.file.mimetype;

  // 확장자 결정
  const extMap = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
    'image/gif': '.gif',  'image/heic': '.heic', 'image/heif': '.heif'
  };
  const ext      = extMap[mimeType] || '.jpg';
  const fileName = `${uuidv4()}${ext}`;
  const finalPath = path.join(UPLOADS_DIR, fileName);
  const imageUrl  = `/uploads/${fileName}`;

  try {
    // 임시 파일 → 영구 경로로 이동
    fs.renameSync(tmpPath, finalPath);

    console.log(`[이미지분석] 파일 저장: ${fileName} (${mimeType}, ${(req.file.size/1024).toFixed(0)}KB)`);

    // ── Gemini 멀티모달 분석 ──
    let analysisResult;
    if (!process.env.GEMINI_API_KEY) {
      console.warn('[이미지분석] GEMINI_API_KEY 미설정 — 목업 반환');
      analysisResult = generateMockImageAnalysis(fileName, userHint);
    } else {
      const imageBuffer = fs.readFileSync(finalPath);
      const rawText = await callGeminiWithImage(imageBuffer, mimeType, userHint);

      // JSON 파싱 시도 (코드블록 제거)
      const cleaned = rawText
        .replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const parsed = safeParseJSON(cleaned);

      if (parsed && parsed.title) {
        analysisResult = parsed;
      } else {
        // JSON 파싱 실패 → 원문을 fullAnalysis로
        console.warn('[이미지분석] JSON 파싱 실패 — 원문 저장');
        analysisResult = {
          title:       '사진 분석 결과',
          summary:     rawText.slice(0, 100),
          concepts:    [],
          steps:       [],
          fullAnalysis: rawText
        };
      }
    }

    const now     = new Date();
    const newItem = {
      id:           uuidv4(),
      type:         'image_analysis',
      category:     'inbox',      // 이미지 분석은 기본 인박스
      shelf:        'inbox',
      title:        analysisResult.title || '사진 분석 결과',
      text:         analysisResult.summary || '',
      summary:      analysisResult.summary || '',
      aiSummary:    analysisResult.fullAnalysis || '',
      concepts:     analysisResult.concepts || [],
      steps:        analysisResult.steps || [],
      imageUrl,
      thumbnailUrl: imageUrl,
      userHint,
      keywords:     (analysisResult.concepts || []).slice(0, 3).map(c => c.term || ''),
      classifier:   'gemini-vision',
      source:       'image-upload',
      date:         toDateStr(now),
      time:         toTimeStr(now),
      createdAt:    now.toISOString(),
      updatedAt:    now.toISOString(),
      insights:     []
    };

    const items = readDB();
    items.unshift(newItem);
    writeDB(items);

    console.log(`[이미지분석] 저장 완료: "${newItem.title}" → ${newItem.id}`);

    return res.status(201).json({
      success: true,
      item:    newItem,
      analysis: analysisResult
    });

  } catch (e) {
    console.error('[이미지분석] 실패:', e.message);
    // 임시 파일 정리
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    try { if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath); } catch {}
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ══════════════════════════════════════════════════
//  API — 통계, 타임머신, 주간 브리핑, 연말 결산, 통찰 (기존 유지)
// ══════════════════════════════════════════════════

app.get('/api/stats', (req, res) => {
  const items  = readDB();
  const counts = {};
  const daily  = {};
  items.forEach(i => {
    counts[i.category] = (counts[i.category] || 0) + 1;
    daily[i.date]      = (daily[i.date] || 0) + 1;
  });
  const today      = toDateStr();
  const todayCount = daily[today] || 0;
  const now        = new Date();
  const dow        = now.getDay() || 7;
  const wStart     = new Date(now); wStart.setDate(now.getDate() - dow + 1);
  const weekCount  = items.filter(i => i.date >= toDateStr(wStart)).length;
  let streak = 0, chk = new Date();
  while (daily[toDateStr(chk)]) { streak++; chk.setDate(chk.getDate() - 1); }
  const grassData = Array.from({ length: 84 }, (_, k) => {
    const d = new Date(); d.setDate(d.getDate() - (83 - k));
    const ds = toDateStr(d);
    return { date: ds, count: daily[ds] || 0 };
  });
  const shelfCounts = {};
  items.forEach(i => { shelfCounts[i.shelf || i.category] = (shelfCounts[i.shelf || i.category] || 0) + 1; });
  res.json({ success: true, stats: { total: items.length, byCategory: counts, shelfCounts, todayCount, weekCount, streak, grassData } });
});

app.get('/api/timemachine', (req, res) => {
  const count  = Math.min(Number(req.query.count) || 3, 10);
  const items  = readDB();
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7);
  const old    = items.filter(i => new Date(i.createdAt) < cutoff);
  if (!old.length) return res.json({ success: true, items: [] });
  for (let i = old.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [old[i], old[j]] = [old[j], old[i]];
  }
  res.json({ success: true, items: old.slice(0, count) });
});

app.get('/api/report/weekly', async (req, res) => {
  const items   = readDB();
  const cutoff  = new Date(); cutoff.setDate(cutoff.getDate() - 7);
  const weekly  = items.filter(i => new Date(i.createdAt) >= cutoff);
  const grouped = {};
  weekly.forEach(i => { (grouped[i.date] = grouped[i.date] || []).push(i); });
  const catCounts = {};
  weekly.forEach(i => { catCounts[i.category] = (catCounts[i.category] || 0) + 1; });

  let storyReport = null;
  if (process.env.ANTHROPIC_API_KEY && weekly.length >= 3) {
    const enItems = weekly.filter(i => i.category === 'en').slice(0, 8).map(i => `• ${i.text.slice(0,150)}`).join('\n');
    const hiItems = weekly.filter(i => i.category === 'history').slice(0, 8).map(i => `• ${i.text.slice(0,150)}`).join('\n');
    const ecItems = weekly.filter(i => i.category === 'economy').slice(0, 5).map(i => `• ${i.text.slice(0,150)}`).join('\n');
    const raw = await callClaude({
      maxTokens: 800,
      system: '당신은 개인 지식 사서이자 인문학 큐레이터입니다.',
      messages: [{ role: 'user', content: `이번 주 수집된 지식들입니다.\n\n[영어·비즈니스 표현]\n${enItems||'(없음)'}\n\n[역사 지식]\n${hiItems||'(없음)'}\n\n[경제 지식]\n${ecItems||'(없음)'}\n\n아래 JSON만 출력하세요:\n{"headline":"제목(15자)","story":"스토리(200~300자)","crossInsight":"영어↔역사 연결(100자)","weeklyPhrase":"핵심 문장"}` }]
    });
    storyReport = safeParseJSON(raw);
  }

  res.json({
    success: true,
    period: { from: toDateStr(cutoff), to: toDateStr() },
    totalItems: weekly.length, byDate: grouped, byCategory: catCounts,
    storyReport: storyReport || { headline: '이번 주 지식 브리핑', story: 'ANTHROPIC_API_KEY를 설정하면 AI 스토리텔링을 받을 수 있습니다.', crossInsight: 'API 키 설정 후 활성화됩니다.', weeklyPhrase: '知識は力なり' }
  });
});

app.get('/api/report/year-end', async (req, res) => {
  const year      = parseInt(req.query.year) || new Date().getFullYear();
  const allItems  = readDB();
  const yearItems = allItems.filter(i => (i.date||'').startsWith(String(year)));
  const byCategory = {};
  yearItems.forEach(i => { byCategory[i.category] = (byCategory[i.category]||0)+1; });
  const kwMap = {};
  yearItems.forEach(i => (i.keywords||[]).forEach(k => { kwMap[k]=(kwMap[k]||0)+1; }));
  const topKeywords = Object.entries(kwMap).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([word,count])=>({word,count}));
  const bestSentences = [...yearItems].filter(i=>i.text&&i.text.length>20).sort((a,b)=>b.text.length-a.text.length).slice(0,5).map(i=>({id:i.id,text:i.text,category:i.category,date:i.date,source:i.source||''}));

  let aiAnalysis = null;
  if (process.env.ANTHROPIC_API_KEY && yearItems.length >= 3) {
    const sample  = yearItems.slice(0,50).map(i=>`[${i.category}] ${i.text.slice(0,100)}`).join('\n');
    const catSum  = Object.entries(byCategory).map(([k,v])=>`${k}:${v}개`).join(', ');
    const raw = await callClaude({ maxTokens: 1000, system: '당신은 개인 지식 아카이브의 연간 큐레이터입니다.', messages: [{ role:'user', content: `${year}년 아카이브: ${catSum}\n\n${sample}\n\nJSON만 출력:\n{"top3Keywords":[{"word":"","description":""}],"yearSummary":"","crossCategoryInsight":"","letterToNextYear":""}` }] });
    aiAnalysis = safeParseJSON(raw);
  }

  if (!aiAnalysis) {
    const topCat = Object.entries(byCategory).sort((a,b)=>b[1]-a[1])[0]?.[0]||'general';
    const catKr  = {en:'영어',history:'역사',economy:'경제',youtube:'유튜브',inbox:'임시서랍',general:'일반'};
    aiAnalysis = { _mock:true, top3Keywords:[{word:topKeywords[0]?.word||'학습',description:`${year}년 가장 자주 등장한 키워드.`},{word:topKeywords[1]?.word||'통찰',description:'지식 간 연결을 찾아낸 순간들.'},{word:topKeywords[2]?.word||'서재',description:'지식 건축을 상징합니다.'}], yearSummary:`${year}년, 총 ${yearItems.length}개의 지식을 서재에 쌓았습니다.`, crossCategoryInsight:'API 키 설정 후 깊이 있는 분석을 받으세요.', letterToNextYear:'하루 한 권의 지식을 서재에 꽂아 나가십시오.' };
  }

  res.json({ success:true, year, period:{from:`${year}-01-01`,to:`${year}-12-31`}, totalItems:yearItems.length, byCategory, topKeywords, bestSentences, aiAnalysis });
});

app.get('/api/insights', (req, res) => {
  const limit = Math.min(Number(req.query.limit)||5, 20);
  const items = readDB();
  const insightCards = [];
  items.forEach(item => {
    (item.insights||[]).forEach(ins => {
      insightCards.push({...ins, sourceItem:{id:item.id,category:item.category,text:item.text.slice(0,80)}});
    });
  });
  insightCards.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  res.json({ success:true, total:insightCards.length, insights:insightCards.slice(0,limit) });
});

// ══════════════════════════════════════════════════
//  API — 구독 설정 조회·변경
// ══════════════════════════════════════════════════

app.get('/api/subscriptions', (req, res) => {
  const subs = readJSON(SUBSCRIPTIONS_PATH, []);
  res.json({ success: true, subscriptions: subs });
});

// ══════════════════════════════════════════════════
//  서버 시작
// ══════════════════════════════════════════════════

app.listen(PORT, async () => {
  console.log('\n┌──────────────────────────────────────────────────────┐');
  console.log('│      SJ 지식 서재 (Knowledge Library) v5              │');
  console.log(`│      http://localhost:${PORT}                           │`);
  console.log('│                                                      │');
  console.log('│  GET  /api/daily-feed           → 배달 피드 (캐시)   │');
  console.log('│  POST /api/daily-feed/generate  → 수동 재생성        │');
  console.log('│  GET  /api/daily-feed/status    → 캐시 상태 확인     │');
  console.log('│  GET  /api/user/settings        → 유저 설정 조회     │');
  console.log('│  PATCH /api/user/settings       → 배달 시간 변경     │');
  console.log('│  GET  /api/push/vapid-key       → VAPID 공개키       │');
  console.log('│  POST /api/push/subscribe       → 푸시 구독 등록     │');
  console.log('│  DELETE /api/push/subscribe     → 구독 해제          │');
  console.log('│  POST /api/push/test            → 테스트 알림 발송   │');
  console.log('│  POST /api/inbox                → 공유 수집 인박스   │');
  console.log('│  GET  /share-handler            → 공유 시트 수신     │');
  console.log('└──────────────────────────────────────────────────────┘\n');

  const geminiOk = !!process.env.GEMINI_API_KEY;
  const claudeOk = !!process.env.ANTHROPIC_API_KEY;
  console.log(`  Gemini API : ${geminiOk ? '✅ 활성화 (피드 AI 생성)' : '⚠  미설정 → Mock 데이터'}`);
  console.log(`  Claude API : ${claudeOk ? '✅ 활성화 (분류·인사이트)' : '⚠  미설정 → 규칙 기반 분류'}`);
  console.log('');

  // 서버 시작 시 즉시 임시 서랍 처리
  reshelfOldInboxItems().catch(() => {});

  // 서버 시작 시 오늘 캐시 상태 확인 — 없으면 즉시 생성
  const today   = toDateStr();
  const user    = getDefaultUser();
  const cached  = getTodayFeeds(today);
  const hasFeed = cached && Object.keys(cached).length > 0;

  if (!hasFeed && user) {
    console.log(`[시작] 오늘(${today}) 피드 캐시 없음 — 백그라운드 생성 시작`);
    buildDailyFeeds(user, false)
      .then(f => console.log(`[시작] 피드 사전 생성 완료 (${Object.keys(f).length}개)`))
      .catch(e => console.error('[시작] 피드 생성 실패:', e.message));
  } else {
    console.log(`[시작] 오늘(${today}) 피드 캐시 존재 (${Object.keys(cached||{}).length}개) — 즉시 반환 준비 완료`);
  }
});
