/**
 * SJ 지식 서재 (Knowledge Library) — server.js v3
 *
 * 실행:  node server.js  |  npm run dev (nodemon)
 * 환경변수:
 *   PORT=3000
 *   ANTHROPIC_API_KEY=sk-ant-...   (없으면 규칙 기반 동작)
 */

'use strict';
require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const fs       = require('fs');
const path     = require('path');
const https    = require('https');
const http     = require('http');
const { load: cheerioLoad } = require('cheerio');
const { v4: uuidv4 } = require('uuid');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Gemini 클라이언트 (키가 있을 때만 초기화)
const _geminiClient = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

const PORT    = process.env.PORT || 3000;
const DB_PATH  = path.join(__dirname, 'data', 'archive.json');
const CAT_PATH = path.join(__dirname, 'data', 'categories.json');
const FEED_PATH = path.join(__dirname, 'data', 'dailyFeeds.json');
const SUB_PATH  = path.join(__dirname, 'data', 'subscriptions.json');

// ── 카테고리 헬퍼 ────────────────────────────────
function readCategories() {
  try {
    const cats = JSON.parse(fs.readFileSync(CAT_PATH, 'utf-8'));
    // 마이그레이션: 모든 카테고리에 subCategories 배열 보장
    cats.forEach(c => { if (!Array.isArray(c.subCategories)) c.subCategories = []; });
    return cats;
  }
  catch { return []; }
}
function writeCategories(data) {
  fs.writeFileSync(CAT_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// ── 구독 설정 헬퍼 ────────────────────────────────
// 기본 구독 항목 (최초 실행 시 생성)
// options: { count(어학 구문 수), includeParagraph(짧은 지문), includeDialogue(실전 대화문) }
const DEFAULT_SUBSCRIPTIONS = [
  { id: 'us_market', label: '미국 시황 요약', type: 'market', lang: '', category: 'economy', enabled: true, icon: 'ti-flag', desc: '간밤 미국 증시·경제 핵심',
    topic: '증시 전반', topicOptions: ['증시 전반', '산업·섹터', '거시 지표'],
    options: { count: 5, includeParagraph: true, includeDialogue: false } },
  { id: 'kr_market', label: '한국 시황 요약', type: 'market', lang: '', category: 'economy', enabled: true, icon: 'ti-building-bank', desc: '오늘 코스피·환율·금리',
    topic: '증시 전반', topicOptions: ['증시 전반', '산업·섹터', '거시 지표'],
    options: { count: 5, includeParagraph: true, includeDialogue: false } },
  { id: 'en_expr', label: '영어 표현 배달', type: 'language', lang: '영어', category: 'en', enabled: true, icon: 'ti-language', desc: '맞춤 영어 표현',
    topic: '비즈니스 영어', topicOptions: ['비즈니스 영어', '일상 회화', '테크 시사'],
    options: { count: 5, includeParagraph: false, includeDialogue: true } },
  { id: 'cn_phrase', label: '중국어 표현 배달', type: 'language', lang: '중국어', category: 'en', enabled: false, icon: 'ti-message-language', desc: '맞춤 중국어 표현',
    topic: '일상 회화', topicOptions: ['일상 회화', '여행 중국어', '비즈니스 중국어'],
    options: { count: 5, includeParagraph: false, includeDialogue: false } },
];

// 사용자가 바꿀 수 있는 필드만 병합 (정의 필드는 서버 기준 유지)
function normalizeSub(stored, def) {
  const base = { ...def };
  if (!stored) return base;
  base.enabled = (typeof stored.enabled === 'boolean') ? stored.enabled : def.enabled;
  base.topic   = (def.topicOptions || []).includes(stored.topic) ? stored.topic : def.topic;
  base.options = {
    count: [5, 10].includes(Number(stored.options?.count)) ? Number(stored.options.count) : def.options.count,
    includeParagraph: !!(stored.options?.includeParagraph),
    includeDialogue:  !!(stored.options?.includeDialogue),
  };
  return base;
}

function readSubscriptions() {
  let stored = [];
  try { stored = JSON.parse(fs.readFileSync(SUB_PATH, 'utf-8')); }
  catch { writeSubscriptions(DEFAULT_SUBSCRIPTIONS); return JSON.parse(JSON.stringify(DEFAULT_SUBSCRIPTIONS)); }
  // 서버 정의 기준으로 정규화 (구버전 데이터 자동 마이그레이션)
  const map = {};
  stored.forEach(s => { if (s && s.id) map[s.id] = s; });
  return DEFAULT_SUBSCRIPTIONS.map(def => normalizeSub(map[def.id], def));
}
function writeSubscriptions(data) {
  fs.mkdirSync(path.dirname(SUB_PATH), { recursive: true });
  fs.writeFileSync(SUB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// ── 데일리 피드 저장소 헬퍼 ────────────────────────
// 구조: { "YYYY-MM-DD": { [subId]: feedObject } }
function readFeeds() {
  try { return JSON.parse(fs.readFileSync(FEED_PATH, 'utf-8')); }
  catch { return {}; }
}
function writeFeeds(data) {
  fs.mkdirSync(path.dirname(FEED_PATH), { recursive: true });
  fs.writeFileSync(FEED_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));           // 웹훅·확장 프로그램 대응
app.use(express.urlencoded({ extended: true }));    // form-encoded 지원
// ── 기기 판별: 모바일이면 index_mobile.html, PC면 index_pc.html ──
function isMobileUA(ua = '') {
  return /Mobile|Android|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)
    && !/iPad/i.test(ua);
}
app.get('/', (req, res) => {
  const ua   = req.headers['user-agent'] || '';
  const view = req.query.view; // ?view=pc 또는 ?view=mobile 로 수동 전환
  const mobile = view === 'mobile' || (view !== 'pc' && isMobileUA(ua));
  const file = mobile ? 'index_mobile.html' : 'index_pc.html';
  res.sendFile(path.join(__dirname, 'public', file));
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// ══════════════════════════════════════════════════
//  DB 헬퍼
// ══════════════════════════════════════════════════

function readDB() {
  if (!fs.existsSync(DB_PATH)) return [];
  try {
    const items = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    // 마이그레이션: 기존 항목은 status='active', myInsight='' 기본값 부여
    let dirty = false;
    items.forEach(item => {
      if (item.status === undefined) { item.status = 'active'; dirty = true; }
      if (item.myInsight === undefined) { item.myInsight = ''; dirty = true; }
      if (item.subCategory === undefined) { item.subCategory = ''; dirty = true; }
      // 백그라운드 분석 상태/결과 필드
      if (item.analysisStatus === undefined) {
        item.analysisStatus = (item.aiSummary && item.aiSummary.length > 0) ? 'done' : 'none';
        dirty = true;
      }
      if (item.aiAnalysis === undefined) { item.aiAnalysis = item.aiSummary || ''; dirty = true; }
      if (item.thumbnailUrl === undefined) { item.thumbnailUrl = ''; dirty = true; }
    });
    if (dirty) fs.writeFileSync(DB_PATH, JSON.stringify(items, null, 2), 'utf-8');
    return items;
  }
  catch { return []; }
}

function writeDB(data) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
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

// ══════════════════════════════════════════════════
//  Gemini API 래퍼 — @google/generative-ai SDK
// ══════════════════════════════════════════════════

// 모델 우선순위: 환경변수 모델 → 예비 모델들 순으로 시도
// (429 할당량/503 과부하 시 다음 모델로 자동 폴백)
const GEMINI_FALLBACK_MODELS = [...new Set([
  process.env.GEMINI_MODEL || 'gemini-flash-latest',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
])];

const _sleep = ms => new Promise(r => setTimeout(r, ms));

async function callGemini({ prompt, system = '', maxTokens = 2000 }) {
  if (!_geminiClient) return null;

  for (const modelName of GEMINI_FALLBACK_MODELS) {
    // 모델당 최대 3회: 일시적 429(RPM)/503은 백오프 재시도, 영구 소진은 즉시 스킵
    const backoff = [0, 5000, 9000]; // 1차 즉시, 2차 5초, 3차 9초
    let skipModel = false;

    for (let attempt = 0; attempt < backoff.length && !skipModel; attempt++) {
      if (backoff[attempt]) await _sleep(backoff[attempt]);
      try {
        const model = _geminiClient.getGenerativeModel({
          model: modelName,
          systemInstruction: system || undefined,
          generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3 },
        });
        const result = await model.generateContent(prompt);
        const text   = result.response.text();
        if (text) {
          if (modelName !== GEMINI_FALLBACK_MODELS[0])
            console.log(`[Gemini] ${modelName} 폴백 성공`);
          return text;
        }
        return null;
      } catch (e) {
        const msg     = e.message || '';
        const is503   = /503|Service Unavailable|overloaded/i.test(msg);
        const is429   = /429|Too Many Requests|Quota|rate/i.test(msg);
        // 영구 소진(무료 티어 limit:0)만 재시도 무의미 → 다음 모델로.
        // 그 외 429는 RPM 스로틀이라 잠시 후 회복되므로 백오프 재시도.
        const isHardQuota = /limit:\s*0/i.test(msg);

        if (isHardQuota) {
          console.warn(`[Gemini:${modelName}] 무료 한도 소진 — 다음 모델`);
          skipModel = true;
        } else if ((is429 || is503) && attempt < backoff.length - 1) {
          console.warn(`[Gemini:${modelName}] ${is429 ? 'RPM 429' : '503'} — ${backoff[attempt+1]/1000}초 후 재시도(${attempt+1}/${backoff.length-1})`);
          // 다음 루프에서 backoff 대기
        } else {
          console.warn(`[Gemini:${modelName}] 실패(${msg.slice(0,60)}) — 다음 모델`);
          skipModel = true;
        }
      }
    }
  }
  console.error('[Gemini] 모든 모델 실패 — Claude 폴백');
  return null;
}

// ══════════════════════════════════════════════════
//  Claude API 래퍼 (폴백 / 단순 분류용)
// ══════════════════════════════════════════════════

async function callClaude({ model = 'claude-3-haiku-20240307', maxTokens = 600, messages, system }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

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
        try {
          const parsed = JSON.parse(raw);
          resolve(parsed.content?.[0]?.text || null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

/**
 * AI 통합 호출: Gemini 우선 → Claude 폴백
 * prompt/system 인터페이스 통일
 */
async function callAI({ prompt, system = '', maxTokens = 2000 }) {
  // 1순위: Gemini
  const geminiResult = await callGemini({ prompt, system, maxTokens });
  if (geminiResult) return geminiResult;

  // 2순위: Claude (Gemini 키 없거나 실패 시)
  const claudeResult = await callClaude({
    maxTokens,
    system: system || undefined,
    messages: [{ role: 'user', content: prompt }]
  });
  return claudeResult;
}

function safeParseJSON(text) {
  if (!text) return null;
  try {
    // 코드블록 제거 (Gemini가 ```json ... ``` 형태로 반환하는 경우)
    let cleaned = text
      .replace(/^```(?:json)?\s*/im, '')
      .replace(/\s*```\s*$/m, '')
      .trim();
    // JSON 객체 추출
    const m = cleaned.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch { return null; }
}

// ══════════════════════════════════════════════════
//  URL 감지 & 스크래핑
// ══════════════════════════════════════════════════

const URL_RE = /^https?:\/\/[^\s]{4,}$/i;

function isUrl(text) {
  return URL_RE.test(text.trim());
}

function fetchHtml(urlStr, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (redirects < 0) return reject(new Error('Too many redirects'));
    const parsed = new URL(urlStr);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.get(urlStr, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko,en;q=0.9',
      },
      timeout: 10000,
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const next = new URL(res.headers.location, urlStr).href;
        res.resume();
        return resolve(fetchHtml(next, redirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ── YouTube 전용: 영상 설명문 + 자막(transcript) 추출 ──
function parseYoutubePlayerResponse(html) {
  // 워치 페이지 HTML에 임베드된 ytInitialPlayerResponse JSON 파싱
  const m = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;\s*(?:var\s|<\/script>)/s)
         || html.match(/ytInitialPlayerResponse"\]\s*=\s*(\{.+?\})\s*;/s);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function decodeHtmlEntities(s = '') {
  return s
    .replace(/&amp;#39;/g, "'").replace(/&#39;/g, "'")
    .replace(/&amp;quot;/g, '"').replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/\n+/g, ' ');
}

async function fetchYoutubeContent(html, urlStr) {
  const player = parseYoutubePlayerResponse(html);
  if (!player) return null;

  const details = player.videoDetails || {};
  const videoTitle  = details.title || '';
  const description  = details.shortDescription || '';
  const author       = details.author || '';
  const lengthSec    = parseInt(details.lengthSeconds || '0', 10);

  // 자막 트랙 URL 찾기 (한국어 → 영어 → 첫 번째 순)
  const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  let transcript = '';
  if (tracks.length) {
    const pick = tracks.find(t => /^ko/.test(t.languageCode))
              || tracks.find(t => /^en/.test(t.languageCode))
              || tracks[0];
    if (pick?.baseUrl) {
      try {
        const xml = await fetchHtml(pick.baseUrl);
        const texts = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)]
          .map(mm => decodeHtmlEntities(mm[1]).trim())
          .filter(Boolean);
        transcript = texts.join(' ').replace(/\s+/g, ' ').trim();
      } catch (e) {
        console.warn(`[유튜브 자막] 실패 — ${e.message}`);
      }
    }
  }

  const minutes = lengthSec ? `${Math.floor(lengthSec/60)}분 ${lengthSec%60}초` : '';
  console.log(`[유튜브] 설명 ${description.length}자 + 자막 ${transcript.length}자 확보${minutes ? ` | 길이 ${minutes}` : ''}`);

  return { videoTitle, description, author, transcript, lengthSec };
}

function extractPageContent(html, urlStr) {
  const $ = cheerioLoad(html);

  // 노이즈 제거 (광고, 메뉴, 스크립트, 댓글 등)
  $([ 'script','style','nav','footer','header','aside',
      'iframe','noscript','form','button',
      '[class*="comment"]','[id*="comment"]',
      '[class*="sidebar"]','[id*="sidebar"]',
      '[class*="related"]','[class*="recommend"]',
      '[class*="ad-"]','[id*="ad-"]','[class*="banner"]',
      '[class*="popup"]','[class*="cookie"]',
      '.share','[class*="social"]'
  ].join(', ')).remove();

  const title = $('meta[property="og:title"]').attr('content')
    || $('title').text()
    || '';

  const ogDesc = $('meta[property="og:description"]').attr('content')
    || $('meta[name="description"]').attr('content')
    || '';

  // 본문 추출 우선순위: article > [role=main] > main > .content > body
  let bodyEl = $('article');
  if (!bodyEl.length) bodyEl = $('[role="main"]');
  if (!bodyEl.length) bodyEl = $('main');
  if (!bodyEl.length) bodyEl = $('.content, #content, .post-content, .article-body, .entry-content').first();
  if (!bodyEl.length) bodyEl = $('body');

  // 단락 단위로 추출해 문장 경계 보존
  const paragraphs = [];
  bodyEl.find('p, h1, h2, h3, h4, li, blockquote').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text.length > 30) paragraphs.push(text);
  });
  let bodyText = paragraphs.join('\n').trim();

  // 단락 추출 실패 시 전체 텍스트 폴백
  if (bodyText.length < 200) {
    bodyText = bodyEl.text().replace(/\s+/g, ' ').trim();
  }

  // 최대 8000자 (Claude 토큰 약 2000개)
  bodyText = bodyText.slice(0, 8000);

  const isYoutube = /youtube\.com|youtu\.be/i.test(urlStr);

  console.log(`[스크래핑] 본문 ${bodyText.length}자 확보 | 제목: ${title.slice(0,40)}`);
  return { title: title.trim(), ogDesc: ogDesc.trim(), bodyText, isYoutube };
}

async function analyzeUrlWithClaude(urlStr, pageData, manualCategory) {
  const { title, ogDesc, bodyText, isYoutube } = pageData;

  // 카테고리 힌트 결정
  const cats = readCategories().map(c => `${c.id}(${c.label})`).join(', ');
  const catHint = manualCategory
    ? `카테고리: 반드시 "${manualCategory}"`
    : isYoutube
    ? '카테고리: "youtube"'
    : `카테고리 선택 기준: ${cats} | en=영어학습·영어콘텐츠, history=역사, economy=경제·금융·주식, youtube=유튜브영상, inbox=기타`;

  // 원문 조합 (유튜브는 자막이 길어 12000자까지)
  const maxInput = isYoutube ? 12000 : 6000;
  const combined = [
    title ? `[제목] ${title}` : '',
    ogDesc ? `[설명] ${ogDesc}` : '',
    bodyText ? `[본문]\n${bodyText}` : ''
  ].filter(Boolean).join('\n\n').slice(0, maxInput);

  // ── 유튜브 전용 프롬프트: 전체 줄거리 중심 ──
  const YOUTUBE_PROMPT = `너는 영상 콘텐츠 분석 전문가다. 제공된 영상의 제목·채널·설명문·챕터(타임스탬프)·자막(있는 경우)을 종합하여, 영상을 처음부터 끝까지 본 것처럼 전체 줄거리를 충실히 재구성해라. 설명문에 챕터 목록이 있다면 그 순서를 따라 흐름을 서술하라. 단, 제공된 정보에 없는 내용을 지어내지 마라.

다음 구조로 aiSummary를 마크다운으로 작성:
1. 🎬 전체 줄거리 (Full Storyline): 영상의 흐름을 도입→전개→결론 순서로, 빠짐없이 6~10문장으로 상세히 서술. 영상에서 다룬 핵심 사례·수치·주장을 구체적으로 포함.
2. 🔑 핵심 포인트 (Key Points): 영상이 전달하는 가장 중요한 메시지 3~5개를 불릿으로.
3. 💡 나의 생각할 거리 (Insight): 이 영상의 가치와 시청자가 얻을 통찰.

shortSummary는 카드 표시용으로 영상 전체를 압축한 2~3문장(한국어).`;

  // ── 일반/경제/역사 콘텐츠 3섹션 심층 리포트 프롬프트 ──
  const DEEP_ANALYSIS_PROMPT = `너는 지식 아카이브의 수석 연구원이다. 제공된 원문을 분석하여 아래 3가지 섹션의 풍부한 마크다운 리포트를 작성하라.

1. 📌 핵심 요약 (Executive Summary): 맥락을 관통하는 3~4문장.
2. 🔑 주요 논거 및 메커니즘 (Key Takeaways): 구체적 수치, 인과관계, 비하인드 스토리를 담은 상세한 3개 이상의 단락.
3. 💡 생각할 거리 (Insight Connection): 타 분야와의 연결성 및 통찰.

위 3섹션을 마크다운으로 aiSummary 필드에 작성하라.`;

  const aiSummaryShape = isYoutube
    ? '## 🎬 전체 줄거리\\n\\n...(6~10문장)...\\n\\n## 🔑 핵심 포인트\\n\\n- ...\\n- ...\\n\\n## 💡 나의 생각할 거리\\n\\n...'
    : '## 📌 핵심 요약\\n\\n...\\n\\n## 🔑 주요 논거 및 메커니즘\\n\\n...\\n\\n## 💡 생각할 거리\\n\\n...';

  const raw = await callAI({
    maxTokens: 8192,
    system: `${isYoutube ? YOUTUBE_PROMPT : DEEP_ANALYSIS_PROMPT}

응답은 반드시 아래 JSON 형식만 출력. JSON 외 텍스트 절대 금지.`,
    prompt: `원문:
${combined}

URL: ${urlStr}
${catHint}

JSON 출력:
{
  "title": "콘텐츠 제목 (30자 이내, 핵심 내용 반영)",
  "category": "카테고리 id",
  "shortSummary": "${isYoutube ? '카드 표시용 영상 압축 요약 (2~3문장, 한국어)' : '카드 표시용 한 줄 핵심 요약 (50자 이내, 한국어)'}",
  "keywords": ["핵심키워드1", "핵심키워드2", "핵심키워드3", "키워드4"],
  "tags": ["#구체적태그1", "#구체적태그2", "#구체적태그3", "#태그4", "#태그5"],
  "aiSummary": "${aiSummaryShape}"
}`
  });

  const parsed = safeParseJSON(raw);
  if (!parsed) return null;

  // 반환 구조 정규화
  return {
    title:      parsed.title      || title.slice(0, 30) || urlStr,
    category:   parsed.category   || (isYoutube ? 'youtube' : 'inbox'),
    summary:    parsed.shortSummary || parsed.summary || '',
    aiSummary:  parsed.aiSummary  || parsed.summary || '',
    keywords:   parsed.keywords   || [],
    tags:       parsed.tags       || [],
    extras:     {},
  };
}

// 규칙 기반 폴백 (API 키 없을 때)
function analyzeUrlByRules(urlStr, pageData, manualCategory) {
  const { title, ogDesc, isYoutube } = pageData;
  let category = manualCategory || (isYoutube ? 'youtube' : 'inbox');
  if (!manualCategory && !isYoutube) {
    const t = (title + ' ' + ogDesc).toLowerCase();
    if (/英語|english|grammar|vocabulary|expression|phrase|idiom/i.test(t)) category = 'en';
    else if (/history|역사|조선|고려|세계사|war|dynasty/i.test(t)) category = 'history';
    else if (/economy|경제|주식|금융|fed|금리|gdp|etf|stock/i.test(t)) category = 'economy';
  }
  return {
    title: title.slice(0, 40) || urlStr,
    category,
    summary: ogDesc || '(요약 없음 — API 키 설정 시 자동 요약)',
    keywords: [],
    extras: {},
  };
}

// 페이지 전체 스크래핑 (본문/유튜브 자막 포함) — Gemini 없음
async function scrapePage(urlStr) {
  let pageData;
  try {
    const html = await fetchHtml(urlStr);
    pageData = extractPageContent(html, urlStr);

    // ── 유튜브: 설명문 + 자막을 본문으로 확보 ──
    if (pageData.isYoutube) {
      const yt = await fetchYoutubeContent(html, urlStr);
      if (yt) {
        if (yt.videoTitle) pageData.title = yt.videoTitle;
        const ytBody = [
          yt.author      ? `[채널] ${yt.author}` : '',
          yt.description ? `[영상 설명]\n${yt.description}` : '',
          yt.transcript  ? `[자막 전문]\n${yt.transcript}` : '',
        ].filter(Boolean).join('\n\n').trim();
        if (ytBody.length > pageData.bodyText.length) {
          pageData.bodyText = ytBody.slice(0, 12000);
        }
        pageData.hasTranscript = !!yt.transcript;
      }
    }
  } catch (e) {
    console.warn(`[스크래핑 실패] ${urlStr} — ${e.message}`);
    const isYoutube = /youtube\.com|youtu\.be/i.test(urlStr);
    pageData = { title: '', ogDesc: '', bodyText: '', isYoutube };
  }
  return pageData;
}

// 유튜브 영상 ID 추출 (watch?v=, youtu.be/, /embed/, /shorts/ 지원)
function extractYoutubeId(urlStr) {
  const m = urlStr.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

// 빠른 메타데이터만 추출 (인박스 즉시 저장용) — 본문/자막/Gemini 전부 생략
async function quickScrapeMeta(urlStr) {
  const isYoutube = /youtube\.com|youtu\.be/i.test(urlStr);
  // 유튜브 썸네일은 영상 ID만으로 즉시 구성 (HTML 파싱 불필요)
  const ytId = isYoutube ? extractYoutubeId(urlStr) : null;
  let thumbnailUrl = ytId ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` : '';

  try {
    const html = await fetchHtml(urlStr);
    const $ = cheerioLoad(html);
    let title  = $('meta[property="og:title"]').attr('content') || $('title').text() || '';
    const ogDesc = $('meta[property="og:description"]').attr('content')
      || $('meta[name="description"]').attr('content') || '';
    // 일반 기사: og:image (없으면 twitter:image) 추출
    if (!thumbnailUrl) {
      const ogImg = $('meta[property="og:image"]').attr('content')
        || $('meta[property="og:image:url"]').attr('content')
        || $('meta[name="twitter:image"]').attr('content')
        || $('meta[name="twitter:image:src"]').attr('content') || '';
      if (ogImg) { try { thumbnailUrl = new URL(ogImg, urlStr).href; } catch { thumbnailUrl = ogImg; } }
    }
    // 유튜브는 player response에서 제목/썸네일 보강
    if (isYoutube) {
      const pr = parseYoutubePlayerResponse(html);
      if (pr && pr.videoDetails) {
        if (pr.videoDetails.title) title = pr.videoDetails.title;
        const thumbs = pr.videoDetails.thumbnail && pr.videoDetails.thumbnail.thumbnails;
        if (Array.isArray(thumbs) && thumbs.length) thumbnailUrl = thumbs[thumbs.length - 1].url || thumbnailUrl;
      }
    }
    return { title: (title || urlStr).trim(), ogDesc: ogDesc.trim(), isYoutube, thumbnailUrl };
  } catch (e) {
    console.warn(`[빠른 스크랩 실패] ${urlStr} — ${e.message}`);
    // 유튜브면 ID 기반 썸네일은 그대로 사용 가능
    return { title: urlStr, ogDesc: '', isYoutube, thumbnailUrl };
  }
}

async function processUrl(urlStr, manualCategory) {
  const pageData = await scrapePage(urlStr);
  const result = await analyzeUrlWithClaude(urlStr, pageData, manualCategory)
    || analyzeUrlByRules(urlStr, pageData, manualCategory);
  return { ...result, originalUrl: urlStr, pageTitle: pageData.title };
}

// ══════════════════════════════════════════════════
//  분류 엔진
// ══════════════════════════════════════════════════

/**
 * 규칙 기반 분류 (폴백)
 * 반환: { category, confidence, keywords: [] }
 */
function classifyByRules(text) {
  const t = text.toLowerCase();

  if (/youtube\.com\/watch|youtu\.be\//.test(t))
    return { category: 'youtube', confidence: 'high', keywords: [] };

  const alpha = (text.match(/[a-zA-Z]/g) || []).length;
  const total = (text.match(/[^\s]/g) || []).length;
  if (total > 0 && alpha / total > 0.35)
    return { category: 'en', confidence: 'high', keywords: [] };

  if (/금리|증시|주가|연준|fed|fomc|etf|반도체|경제|인플레|기준금리|gdp|환율|코스피|나스닥|달러|채권|금융|투자|주식|ipo/.test(t))
    return { category: 'economy', confidence: 'medium', keywords: [] };

  if (/조선|고려|신라|백제|고구려|임진왜란|세종|이순신|태종|광해군|영조|정조|무신정권|삼별초|동학|갑오|을사|일제|독립|년대|세기|왕조|왕|장군|사건|혁명|전쟁|고대|중세/.test(t))
    return { category: 'history', confidence: 'medium', keywords: [] };

  return { category: 'inbox', confidence: 'low', keywords: [] };
}

/**
 * Gemini 기반 텍스트 분류 + 심층 분석 (우선)
 * 짧은 텍스트: 분류+한줄요약 / 긴 텍스트: 4섹션 심층 분석
 */
// 텍스트가 영어 중심인지 빠르게 판별
function looksLikeEnglish(text) {
  const letters = text.match(/[A-Za-z가-힣]/g) || [];
  const eng     = (text.match(/[A-Za-z]/g) || []).length;
  return letters.length > 20 && eng / letters.length > 0.45;
}

async function classifyWithAI(text) {
  const cats = readCategories().map(c => `${c.id}(${c.label})`).join(', ');

  // ── 영어 단어장 전용 경로 ──────────────────────────────
  if (looksLikeEnglish(text)) {
    const raw = await callAI({
      // 5개 항목×5필드(한+영) + 2.5계열 thinking 토큰 고려해 넉넉히 확보
      maxTokens: 8192,
      system: '너는 영어 어학 교육 전문가다. JSON만 출력. 절대 다른 텍스트 금지.',
      prompt: `아래 영어 텍스트에서 학습 가치가 있는 핵심 표현·단어를 최대 5개 추출하여 단어장 형태로 정리해라.

JSON 출력:
{
  "category": "en",
  "keywords": ["핵심단어1","핵심단어2","핵심단어3"],
  "shortSummary": "한 줄 한국어 요약 (50자 이내)",
  "tags": ["#영어단어","#태그2","#태그3","#태그4"],
  "aiSummary": "이 텍스트에 대한 한국어 2~3문장 학습 포인트 요약",
  "vocabEntries": [
    {
      "expression": "영어 단어 또는 구(Phrase)",
      "meaning": "명확한 한국어 뜻",
      "nuance": "뉘앙스·사용 맥락 한국어 1~2문장",
      "sourceSentence": "원문에서 발췌한 예문 (영어)",
      "practiceSentence": "실생활 응용 예문 (영어)"
    }
  ]
}

텍스트: ${text.slice(0, 4000)}`
    });

    const parsed = safeParseJSON(raw);
    if (parsed?.category === 'en' && Array.isArray(parsed.vocabEntries) && parsed.vocabEntries.length) {
      return {
        category:    'en',
        keywords:    parsed.keywords     || [],
        summary:     parsed.shortSummary || '',
        aiSummary:   parsed.aiSummary    || parsed.shortSummary || '',
        tags:        parsed.tags         || [],
        vocabEntries: parsed.vocabEntries,
        expressions: '',
        classifier:  'gemini'
      };
    }
    // 영어 판별됐지만 파싱 실패 시 아래 일반 경로로 계속
  }

  // ── 일반/경제/역사 지식 분류 경로 ───────────────────────
  const isLongText = text.length > 200;
  // thinking 토큰(2.5계열) + 풍부한 3섹션 마크다운이 잘리지 않도록 넉넉히
  const maxTokens  = isLongText ? 8192 : 800;

  // 3섹션 심층 리포트 시스템 프롬프트 (경제/금융/역사/일반)
  const deepSystem = `너는 지식 아카이브의 수석 연구원이다. 제공된 원문을 분석하여 아래 3가지 섹션의 풍부한 마크다운 리포트를 작성하라.

1. 📌 핵심 요약 (Executive Summary): 맥락을 관통하는 3~4문장.
2. 🔑 주요 논거 및 메커니즘 (Key Takeaways): 구체적 수치, 인과관계, 비하인드 스토리를 담은 상세한 3개 이상의 단락.
3. 💡 생각할 거리 (Insight Connection): 타 분야와의 연결성 및 통찰.

위 3섹션을 마크다운으로 aiSummary 필드에 작성하라. 응답은 JSON만 출력.`;

  const raw = await callAI({
    maxTokens,
    system: isLongText ? deepSystem : '너는 지식 분류 AI다. JSON만 출력. 다른 텍스트 금지.',
    prompt: `텍스트를 분석하라.

카테고리: ${cats}
※ 영어 비율 높으면 무조건 en. 없는 카테고리면 inbox.

JSON 출력:
{
  "category": "카테고리 id",
  "keywords": ["키워드1","키워드2","키워드3"],
  "shortSummary": "한국어 한 줄 핵심 요약 (50자 이내)",
  "tags": ["#구체적태그1","#태그2","#태그3","#태그4","#태그5"],
  "aiSummary": "${isLongText
    ? '## 📌 핵심 요약\\n\\n...\\n\\n## 🔑 주요 논거 및 메커니즘\\n\\n...\\n\\n## 💡 생각할 거리\\n\\n...'
    : 'shortSummary와 동일'}"
}

텍스트: ${text.slice(0, 4000)}`
  });

  const parsed = safeParseJSON(raw);
  if (parsed?.category) return {
    category:    parsed.category,
    keywords:    parsed.keywords    || [],
    summary:     parsed.shortSummary || parsed.summary || '',
    aiSummary:   parsed.aiSummary   || parsed.shortSummary || parsed.summary || '',
    tags:        parsed.tags        || [],
    vocabEntries: [],
    expressions: '',
    classifier:  'gemini'
  };
  return null;
}

async function classify(text, manualCategory) {
  if (manualCategory) return { category: manualCategory, keywords: [], summary: '', aiSummary: '', classifier: 'manual' };
  const c = await classifyWithAI(text);
  if (c) return c;
  const r = classifyByRules(text);
  return { ...r, summary: '', aiSummary: '', classifier: `rules(${r.confidence})` };
}

// ══════════════════════════════════════════════════
//  데일리 지식 피드 생성 (Gemini)
// ══════════════════════════════════════════════════

/**
 * 구독 항목 1개에 대한 '오늘의 학습 콘텐츠'를 Gemini로 생성
 * - market: 팩트·수치 중심 3단락 마크다운 리포트
 * - language: 표현/뜻/뉘앙스/예문 구조화 데이터
 * 반환: feed 객체 (실패 시 null)
 */
async function generateDailyFeed(sub, dateStr) {
  const opt   = sub.options || { count: 5, includeParagraph: false, includeDialogue: false };
  const topic = sub.topic || '';
  const base = {
    id: `${dateStr}::${sub.id}`,
    date: dateStr, subId: sub.id, label: sub.label, type: sub.type,
    category: sub.category, subCategory: topic || sub.label,
    topic, options: opt,
    savedItemId: null, createdAt: new Date().toISOString(),
  };

  if (sub.type === 'language') {
    const lang  = sub.lang || '영어';
    const count = [5, 10].includes(Number(opt.count)) ? Number(opt.count) : 5;

    // 옵션에 따른 추가 출력 스펙 (엄격하게 명시)
    const paragraphSpec = opt.includeParagraph
      ? `\n  "paragraph": "위 ${count}개 표현 중 일부를 자연스럽게 녹인 ${lang} 짧은 지문(3~4문장)",\n  "paragraphKo": "그 지문의 한국어 번역",`
      : '';
    const dialogueSpec = opt.includeDialogue
      ? `\n  "dialogue": [ { "speaker": "A", "line": "${lang} 대사", "ko": "한국어 번역" }, { "speaker": "B", "line": "${lang} 대사", "ko": "한국어 번역" } ],`
      : '';

    const ruleLines = [
      `- 정확히 ${count}개의 '${topic}' 핵심 표현을 vocabEntries로 생성 (개수 엄수).`,
      opt.includeParagraph ? `- 위 표현을 활용한 ${lang} 짧은 지문(paragraph)과 한국어 번역(paragraphKo)을 반드시 포함.` : `- paragraph 필드는 생성하지 말 것.`,
      opt.includeDialogue  ? `- 위 표현으로 롤플레잉 가능한 자연스러운 2인(A/B) ${lang} 대화 스크립트(dialogue, 6~8턴)와 각 줄 한국어 번역(ko)을 반드시 포함.` : `- dialogue 필드는 생성하지 말 것.`,
    ].join('\n');

    const raw = await callAI({
      maxTokens: 8192,
      system: `너는 ${lang} 어학 교육 전문가다. 주제 '${topic}'에 특화된 실용 학습 콘텐츠를 큐레이션한다. 아래 규칙을 엄격히 지킨다.\n${ruleLines}\n반드시 JSON만 출력. 다른 텍스트 절대 금지.`,
      prompt: `오늘(${dateStr}) 주제 '${topic}'에 맞는 ${lang} 표현 ${count}개를 새롭게 큐레이션하라.

JSON 출력:
{
  "title": "오늘의 ${topic} ${lang} (한 줄 테마, 한국어)",
  "summary": "오늘 표현들의 공통 테마 한 줄 요약 (한국어 40자 이내)",
  "vocabEntries": [
    {
      "expression": "${lang} 표현/문장",
      "meaning": "명확한 한국어 뜻",
      "nuance": "뉘앙스·사용 맥락 (한국어 1~2문장)",
      "sourceSentence": "그 표현이 쓰인 자연스러운 ${lang} 예문",
      "practiceSentence": "실생활 응용 ${lang} 예문"
    }
  ],${paragraphSpec}${dialogueSpec}
  "_note": "vocabEntries 길이는 정확히 ${count}"
}`
    });
    const p = safeParseJSON(raw);
    if (p && Array.isArray(p.vocabEntries) && p.vocabEntries.length) {
      return {
        ...base,
        title: p.title || `오늘의 ${topic}`,
        summary: p.summary || '',
        report: '',
        vocabEntries: p.vocabEntries.slice(0, count),
        paragraph:   opt.includeParagraph ? (p.paragraph || '') : '',
        paragraphKo: opt.includeParagraph ? (p.paragraphKo || '') : '',
        dialogue:    opt.includeDialogue && Array.isArray(p.dialogue) ? p.dialogue : [],
      };
    }
    return null;
  }

  // market 타입
  const region = sub.id === 'kr_market' ? '한국(코스피·코스닥·환율·국내 금리)' : '미국(뉴욕증시·국채금리·달러·주요 지표)';
  const focusLine = {
    '산업·섹터': '특정 주도 산업·섹터(반도체·AI·2차전지 등)의 동향을 중심으로',
    '거시 지표': 'CPI·고용·금리 등 거시 경제 지표를 중심으로',
  }[topic] || '시장 전반의 흐름을 중심으로';

  const raw = await callAI({
    maxTokens: 8192,
    system: '너는 증권사 리서치센터의 수석 이코노미스트다. 팩트와 수치 중심으로 간결한 데일리 시황 브리핑을 작성한다. JSON만 출력. 다른 텍스트 절대 금지.',
    prompt: `오늘(${dateStr}) 기준 ${region} 시황을 ${focusLine} 학습용 데일리 브리핑으로 작성하라. 대표적인 지표·수치·인과관계를 구체적으로 포함한 3단락 마크다운 리포트로 정리하라. (실시간 데이터가 없으므로 일반적·교육적 최신 흐름 기준, 수치는 대표 레인지로 제시)

JSON 출력:
{
  "title": "오늘의 ${sub.label} 헤드라인 (한 줄)",
  "summary": "카드 표시용 핵심 요약 (한국어 50자 이내)",
  "report": "## 📊 시장 개요\\n\\n...(지수·수치 중심 1단락)...\\n\\n## 🔑 핵심 동인\\n\\n...(인과관계·이벤트 1단락)...\\n\\n## 💡 체크포인트\\n\\n...(투자자 관점 1단락)...",
  "aiEconomicKnowledge": [
    {
      "term": "경제 용어명 (한국어, 5~10자)",
      "importance": "왜 중요한가? — 이 개념이 투자·경제 이해에 왜 핵심인지 2~3문장으로 설명",
      "connection": "이 시황과의 연결고리 — 오늘 브리핑 내용과 어떻게 연결되는지 1~2문장"
    }
  ]
}
aiEconomicKnowledge는 반드시 2~3개 항목. 용어는 이 시황을 이해하는 데 필수적인 경제 용어나 메커니즘만 선별하라.`
  });
  const p = safeParseJSON(raw);
  if (p && p.report) {
    return { ...base, title: p.title || sub.label, summary: p.summary || '', report: p.report,
      aiEconomicKnowledge: Array.isArray(p.aiEconomicKnowledge) ? p.aiEconomicKnowledge : [],
      vocabEntries: [], paragraph: '', paragraphKo: '', dialogue: [] };
  }
  return null;
}

// ══════════════════════════════════════════════════
//  서재 배치 엔진 (임시 서랍 → 서가)
//  하루가 지난 inbox 항목을 Claude가 재분류
// ══════════════════════════════════════════════════

async function reshelfOldInboxItems() {
  const items   = readDB();
  const targets = items.filter(i => i.category === 'inbox' && isOlderThanOneDay(i.createdAt));
  if (!targets.length) return 0;

  let changed = 0;
  for (const item of targets) {
    const c = await classifyWithAI(item.text);
    if (c && c.category !== 'inbox') {
      item.category   = c.category;
      item.keywords   = c.keywords.length ? c.keywords : item.keywords;
      item.summary    = c.summary || item.summary;
      item.classifier = `reshelved:${c.classifier}`;
      item.reshelvedAt = new Date().toISOString();
      changed++;
    }
  }
  if (changed) {
    writeDB(items);
    console.log(`[서재배치] ${changed}개 항목을 임시 서랍에서 서가로 이동`);
  }
  return changed;
}

// 1시간마다 실행
setInterval(reshelfOldInboxItems, 60 * 60 * 1000);

// ══════════════════════════════════════════════════
//  통찰 감지: 영어↔역사 인과관계 발견
// ══════════════════════════════════════════════════

async function detectCrossInsight(newItem, recentItems) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  // 새 항목이 en 또는 history일 때만 체크
  if (!['en','history'].includes(newItem.category)) return null;

  const opposite = newItem.category === 'en' ? 'history' : 'en';
  const peers = recentItems
    .filter(i => i.category === opposite)
    .slice(0, 5)
    .map(i => `- ${i.text.slice(0,120)}`).join('\n');
  if (!peers) return null;

  const raw = await callAI({
    maxTokens: 300,
    system: '당신은 지식 간 깊은 연결고리를 발견하는 인문학자입니다. JSON만 출력.',
    prompt: `아래 두 지식 그룹 사이에 의미 있는 인과관계 또는 새로운 연결이 있으면 발견해 주세요.
없으면 반드시 {"found":false} 만 출력하세요.
있으면: {"found":true,"insight":"발견한 연결 2~3문장","title":"연결 제목 10자 이내"}

[새로 추가된 ${newItem.category === 'en' ? '영어' : '역사'} 지식]
${newItem.text.slice(0, 200)}

[기존 ${opposite === 'en' ? '영어' : '역사'} 지식]
${peers}`
  });

  const parsed = safeParseJSON(raw);
  return parsed?.found ? parsed : null;
}

// ══════════════════════════════════════════════════
//  API — CRUD
// ══════════════════════════════════════════════════

/**
 * GET /api/items
 * query: category, shelf, limit, sort(asc|desc)
 */
app.get('/api/items', (req, res) => {
  let items = readDB();
  const { category, subCategory, shelf, limit = 100, sort = 'desc', status } = req.query;

  // status 필터: 명시적으로 'inbox'를 요청한 경우만 inbox 반환
  // 그 외 모든 경우는 'active' 항목만 반환 (메인 타임라인)
  if (status === 'inbox') {
    items = items.filter(i => i.status === 'inbox');
  } else {
    items = items.filter(i => i.status === 'active');
  }

  if (category && category !== 'all') items = items.filter(i => i.category === category);
  if (subCategory) items = items.filter(i => (i.subCategory || '') === subCategory);
  if (shelf)    items = items.filter(i => i.shelf === shelf);

  items.sort((a, b) => {
    const d = new Date(a.createdAt) - new Date(b.createdAt);
    return sort === 'asc' ? d : -d;
  });

  res.json({ success: true, total: items.length, items: items.slice(0, Number(limit)) });
});

/**
 * GET /api/items/:id
 */
app.get('/api/items/:id', (req, res) => {
  const item = readDB().find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ success: false, error: '항목을 찾을 수 없습니다.' });
  res.json({ success: true, item });
});

// ══════════════════════════════════════════════════
//  API — 카테고리 관리
// ══════════════════════════════════════════════════

app.get('/api/categories', (req, res) => {
  res.json({ success: true, categories: readCategories() });
});

app.post('/api/categories', (req, res) => {
  const { label, color, icon } = req.body;
  if (!label) return res.status(400).json({ success: false, error: 'label 필수' });
  const cats = readCategories();
  const id   = label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') + '_' + Date.now().toString(36);
  const newCat = { id, label, color: color || '#6B7280', icon: icon || 'ti-folder', builtIn: false };
  cats.push(newCat);
  writeCategories(cats);
  res.status(201).json({ success: true, category: newCat });
});

app.put('/api/categories/:id', (req, res) => {
  const cats = readCategories();
  const idx  = cats.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: '없는 카테고리' });
  const { label, color, icon } = req.body;
  if (label) cats[idx].label = label;
  if (color) cats[idx].color = color;
  if (icon)  cats[idx].icon  = icon;
  writeCategories(cats);
  res.json({ success: true, category: cats[idx] });
});

app.delete('/api/categories/:id', (req, res) => {
  const cats = readCategories();
  const cat  = cats.find(c => c.id === req.params.id);
  if (!cat) return res.status(404).json({ success: false, error: '없는 카테고리' });
  if (cat.builtIn) return res.status(403).json({ success: false, error: '기본 카테고리는 삭제 불가' });
  writeCategories(cats.filter(c => c.id !== req.params.id));
  res.json({ success: true });
});

// ── 세부 카테고리(Sub-category) 관리 ──────────────
// 대분류에 세부 분류 추가
app.post('/api/categories/:id/sub', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ success: false, error: '세부 분류 이름 필수' });
  const cats = readCategories();
  const cat  = cats.find(c => c.id === req.params.id);
  if (!cat) return res.status(404).json({ success: false, error: '없는 카테고리' });
  if (!Array.isArray(cat.subCategories)) cat.subCategories = [];
  if (cat.subCategories.includes(name))
    return res.status(409).json({ success: false, error: '이미 존재하는 세부 분류' });
  cat.subCategories.push(name);
  writeCategories(cats);
  res.status(201).json({ success: true, category: cat });
});

// 대분류에서 세부 분류 삭제 (해당 sub를 쓰던 항목은 sub 비움)
app.delete('/api/categories/:id/sub', (req, res) => {
  const name = (req.body.name || req.query.name || '').trim();
  if (!name) return res.status(400).json({ success: false, error: '세부 분류 이름 필수' });
  const cats = readCategories();
  const cat  = cats.find(c => c.id === req.params.id);
  if (!cat) return res.status(404).json({ success: false, error: '없는 카테고리' });
  cat.subCategories = (cat.subCategories || []).filter(s => s !== name);
  writeCategories(cats);
  // 이 세부 분류를 쓰던 항목들의 subCategory 초기화
  const items = readDB();
  let dirty = false;
  items.forEach(i => {
    if (i.category === cat.id && i.subCategory === name) { i.subCategory = ''; dirty = true; }
  });
  if (dirty) writeDB(items);
  res.json({ success: true, category: cat });
});

// ══════════════════════════════════════════════════
//  API — 구독 설정 & 데일리 지식 피드
// ══════════════════════════════════════════════════

// 구독 설정 조회
app.get('/api/subscriptions', (req, res) => {
  res.json({ success: true, subscriptions: readSubscriptions() });
});

// 구독 설정 저장 (enabled + topic + options). 변경 시 오늘 캐시 피드 무효화
app.put('/api/subscriptions', (req, res) => {
  const prev = readSubscriptions();
  const prevMap = {}; prev.forEach(s => prevMap[s.id] = s);

  const incoming = Array.isArray(req.body.subscriptions)
    ? req.body.subscriptions
    : (req.body.id ? [req.body] : []);
  const inMap = {}; incoming.forEach(s => { if (s && s.id) inMap[s.id] = s; });

  // 서버 정의 + 사용자 입력 병합 (정규화)
  const merged = DEFAULT_SUBSCRIPTIONS.map(def => normalizeSub(inMap[def.id] || prevMap[def.id], def));
  writeSubscriptions(merged);

  // 설정이 바뀐 구독은 오늘 생성된 피드를 무효화하여 재생성 유도
  const dateStr = toDateStr();
  const feeds   = readFeeds();
  if (feeds[dateStr]) {
    let changed = false;
    merged.forEach(s => {
      const before = prevMap[s.id];
      const sig = x => x ? JSON.stringify([x.topic, x.options]) : '';
      if (feeds[dateStr][s.id] && sig(before) !== sig(s)) {
        // 아직 서재에 저장 안 된 피드만 무효화 (저장본은 보존)
        if (!feeds[dateStr][s.id].savedItemId) { delete feeds[dateStr][s.id]; changed = true; }
      }
    });
    if (changed) writeFeeds(feeds);
  }

  res.json({ success: true, subscriptions: merged });
});

// 데일리 피드 조회 (없으면 즉석 생성)
app.get('/api/daily-feed', async (req, res) => {
  const dateStr = toDateStr();
  const feeds   = readFeeds();
  if (!feeds[dateStr]) feeds[dateStr] = {};

  const subs    = readSubscriptions().filter(s => s.enabled);
  const items   = readDB();
  let generated = 0;

  for (const sub of subs) {
    if (feeds[dateStr][sub.id]) continue; // 오늘 이미 생성됨 → 재사용
    try {
      const feed = await generateDailyFeed(sub, dateStr);
      if (feed) { feeds[dateStr][sub.id] = feed; generated++; }
    } catch (e) {
      console.warn(`[데일리피드] ${sub.id} 생성 실패 — ${e.message}`);
    }
  }
  if (generated) { writeFeeds(feeds); console.log(`[데일리피드] ${dateStr} ${generated}건 생성`); }

  // 구독 순서대로 + 저장 여부(savedItemId / savedEntries가 실제 아이템으로 존재하는지) 검증
  const today = subs
    .map(sub => feeds[dateStr][sub.id])
    .filter(Boolean)
    .map(f => {
      // 삭제된 낱개 저장 흔적은 제외 (UI가 다시 저장 가능하도록)
      const validEntries = {};
      if (f.savedEntries) {
        for (const [k, id] of Object.entries(f.savedEntries)) {
          if (items.some(i => i.id === id)) validEntries[k] = id;
        }
      }
      return {
        ...f,
        saved: !!(f.savedItemId && items.some(i => i.id === f.savedItemId)),
        savedEntries: validEntries,
      };
    });

  res.json({ success: true, date: dateStr, feeds: today, subscriptions: readSubscriptions() });
});

// 데일리 피드 → 정식 지식 아이템으로 저장 (서재 등록 + 복습)
app.post('/api/daily-feed/:date/:subId/save', (req, res) => {
  const { date, subId } = req.params;
  const feeds = readFeeds();
  const feed  = feeds[date] && feeds[date][subId];
  if (!feed) return res.status(404).json({ success: false, error: '피드를 찾을 수 없습니다.' });

  const items = readDB();

  // 중복 저장 방지: 이미 저장됐고 아이템이 살아있으면 그대로 반환
  if (feed.savedItemId) {
    const exist = items.find(i => i.id === feed.savedItemId);
    if (exist) return res.json({ success: true, item: exist, alreadySaved: true });
  }

  const now    = new Date();
  const isLang = feed.type === 'language';
  const bodyText = isLang
    ? (feed.vocabEntries || []).map(v => `${v.expression} — ${v.meaning}`).join('\n')
    : (feed.report || '');

  // 어학 피드: 지문/대화문을 aiSummary(마크다운)에 함께 보존
  let langSummary = feed.summary || '';
  if (isLang) {
    const parts = [];
    if (feed.summary) parts.push(feed.summary);
    if (feed.paragraph) parts.push(`## 📖 짧은 지문\n\n${feed.paragraph}${feed.paragraphKo ? `\n\n> ${feed.paragraphKo}` : ''}`);
    if ((feed.dialogue || []).length) {
      const d = feed.dialogue.map(t => `**${t.speaker}**: ${t.line}${t.ko ? `\n  _(${t.ko})_` : ''}`).join('\n\n');
      parts.push(`## 💬 실전 대화문\n\n${d}`);
    }
    langSummary = parts.join('\n\n');
  }

  const newItem = {
    id:         uuidv4(),
    type:       'text',
    title:      feed.title || feed.label,
    text:       bodyText || feed.summary || feed.title || feed.label,
    aiSummary:  isLang ? langSummary : (feed.report || feed.summary || ''),
    aiAnalysis: isLang ? langSummary : (feed.report || feed.summary || ''),
    analysisStatus: 'done',               // 데일리 피드는 이미 분석 완료 상태
    summary:    feed.summary || '',
    myInsight:  '',
    subCategory: feed.subCategory || '',
    status:     'active',                 // 데일리 피드는 바로 타임라인에 등록
    originalUrl: null,
    sourceUrl:  null,
    category:   feed.category,
    shelf:      feed.category,
    keywords:   [],
    tags:       [`#데일리피드`, `#${feed.label}`],
    extras:     isLang ? { vocabEntries: feed.vocabEntries || [], dialogue: feed.dialogue || [], paragraph: feed.paragraph || '', paragraphKo: feed.paragraphKo || '' } : {},
    classifier: 'daily-feed',
    source:     'daily-feed',
    date:       toDateStr(now),
    time:       toTimeStr(now),
    createdAt:  now.toISOString(),
    updatedAt:  now.toISOString(),
    publishedAt: now.toISOString(),
    insights:   [],
  };

  items.unshift(newItem);
  writeDB(items);

  // 세부 분류 자동 등록 (사이드바 트리에 노출되도록)
  if (feed.subCategory) {
    const cats = readCategories();
    const cat  = cats.find(c => c.id === feed.category);
    if (cat) {
      if (!Array.isArray(cat.subCategories)) cat.subCategories = [];
      if (!cat.subCategories.includes(feed.subCategory)) {
        cat.subCategories.push(feed.subCategory);
        writeCategories(cats);
      }
    }
  }

  // 피드에 저장 흔적 기록 (중복 방지)
  feed.savedItemId = newItem.id;
  writeFeeds(feeds);

  console.log(`[데일리피드 저장] [${newItem.category}/${newItem.subCategory}] "${newItem.title}"`);
  res.status(201).json({ success: true, item: newItem, alreadySaved: false });
});

/**
 * POST /api/archive/single
 * Body: { date, subId, index }
 * 데일리 피드 묶음 중 '개별 구문/단어 1개'만 독립된 item으로 오늘 타임라인에 저장
 */
app.post('/api/archive/single', (req, res) => {
  const { date, subId, field } = req.body || {};
  const index = Number(req.body?.index);
  if (!date || !subId || Number.isNaN(index))
    return res.status(400).json({ success: false, error: 'date, subId, index 필수' });

  const feeds = readFeeds();
  const feed  = feeds[date] && feeds[date][subId];
  if (!feed) return res.status(404).json({ success: false, error: '피드를 찾을 수 없습니다.' });

  // 경제 지식 낱개 저장 분기
  if (field === 'aiEconomicKnowledge') {
    if (!Array.isArray(feed.aiEconomicKnowledge) || !feed.aiEconomicKnowledge[index])
      return res.status(400).json({ success: false, error: '해당 위치의 경제 지식을 찾을 수 없습니다.' });

    const entry = feed.aiEconomicKnowledge[index];
    if (!feed.savedEcoEntries) feed.savedEcoEntries = {};

    const items = readDB();
    const prevId = feed.savedEcoEntries[index];
    if (prevId) {
      const exist = items.find(i => i.id === prevId);
      if (exist) return res.json({ success: true, item: exist, alreadySaved: true });
    }

    const now = new Date();
    const md = [
      `## 📌 경제 핵심 개념`,
      `**${entry.term || ''}**`,
      `\n### 왜 중요한가?\n${entry.importance || ''}`,
      `\n### 이 시황과의 연결\n${entry.connection || ''}`,
    ].join('\n');

    const newItem = {
      id:         uuidv4(),
      type:       'text',
      title:      entry.term || '경제 개념',
      text:       `${entry.term || ''} — ${entry.importance || ''}`,
      aiSummary:  md,
      aiAnalysis: md,
      analysisStatus: 'done',
      summary:    entry.importance || '',
      myInsight:  '',
      subCategory: feed.subCategory || '',
      status:     'active',
      originalUrl: null,
      sourceUrl:  null,
      category:   feed.category,
      shelf:      feed.category,
      keywords:   [entry.term || ''].filter(Boolean),
      tags:       [`#데일리피드`, `#경제지식`, `#낱개저장`],
      extras:     { economicKnowledge: entry },
      classifier: 'daily-feed-eco-single',
      source:     'daily-feed',
      date:       toDateStr(now),
      time:       toTimeStr(now),
      createdAt:  now.toISOString(),
      updatedAt:  now.toISOString(),
      publishedAt: now.toISOString(),
      insights:   [],
    };

    items.unshift(newItem);
    writeDB(items);

    if (feed.subCategory) {
      const cats = readCategories();
      const cat  = cats.find(c => c.id === feed.category);
      if (cat) {
        if (!Array.isArray(cat.subCategories)) cat.subCategories = [];
        if (!cat.subCategories.includes(feed.subCategory)) {
          cat.subCategories.push(feed.subCategory);
          writeCategories(cats);
        }
      }
    }

    feed.savedEcoEntries[index] = newItem.id;
    writeFeeds(feeds);

    console.log(`[경제지식 낱개 저장] [${newItem.category}] "${newItem.title}"`);
    return res.status(201).json({ success: true, item: newItem, alreadySaved: false });
  }

  // 어학 구문 낱개 저장 (기존)
  if (feed.type !== 'language' || !Array.isArray(feed.vocabEntries) || !feed.vocabEntries[index])
    return res.status(400).json({ success: false, error: '해당 위치의 구문을 찾을 수 없습니다.' });

  const entry = feed.vocabEntries[index];
  if (!feed.savedEntries) feed.savedEntries = {};

  const items = readDB();

  const prevId = feed.savedEntries[index];
  if (prevId) {
    const exist = items.find(i => i.id === prevId);
    if (exist) return res.json({ success: true, item: exist, alreadySaved: true });
  }

  const now = new Date();

  const md = [
    `## 📌 핵심 표현`,
    `**${entry.expression || ''}** — ${entry.meaning || ''}`,
    entry.nuance ? `\n${entry.nuance}` : '',
    entry.sourceSentence ? `\n## 📝 예문\n\n- 원문: ${entry.sourceSentence}` : '',
    entry.practiceSentence ? `- 응용: ${entry.practiceSentence}` : '',
  ].filter(Boolean).join('\n');

  const newItem = {
    id:         uuidv4(),
    type:       'text',
    title:      entry.expression || feed.title || '구문',
    text:       `${entry.expression || ''} — ${entry.meaning || ''}`,
    aiSummary:  md,
    aiAnalysis: md,
    analysisStatus: 'done',
    summary:    entry.meaning || '',
    myInsight:  '',
    subCategory: feed.subCategory || '',
    status:     'active',
    originalUrl: null,
    sourceUrl:  null,
    category:   feed.category,
    shelf:      feed.category,
    keywords:   [],
    tags:       [`#데일리피드`, `#낱개저장`],
    extras:     { vocabEntries: [entry] },
    classifier: 'daily-feed-single',
    source:     'daily-feed',
    date:       toDateStr(now),
    time:       toTimeStr(now),
    createdAt:  now.toISOString(),
    updatedAt:  now.toISOString(),
    publishedAt: now.toISOString(),
    insights:   [],
  };

  items.unshift(newItem);
  writeDB(items);

  if (feed.subCategory) {
    const cats = readCategories();
    const cat  = cats.find(c => c.id === feed.category);
    if (cat) {
      if (!Array.isArray(cat.subCategories)) cat.subCategories = [];
      if (!cat.subCategories.includes(feed.subCategory)) {
        cat.subCategories.push(feed.subCategory);
        writeCategories(cats);
      }
    }
  }

  feed.savedEntries[index] = newItem.id;
  writeFeeds(feeds);

  console.log(`[낱개 저장] [${newItem.category}/${newItem.subCategory}] "${newItem.title}"`);
  res.status(201).json({ success: true, item: newItem, alreadySaved: false });
});

// ══════════════════════════════════════════════════
//  API — 태그 목록
// ══════════════════════════════════════════════════

app.get('/api/tags', (req, res) => {
  const items  = readDB();
  const tagMap = {};
  items.forEach(item => {
    (item.tags || []).forEach(tag => {
      tagMap[tag] = (tagMap[tag] || 0) + 1;
    });
  });
  const tags = Object.entries(tagMap)
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => ({ tag, count }));
  res.json({ success: true, tags });
});

/**
 * POST /api/items
 * Body: { text, source, manualCategory, url, content, note, tags }
 * URL이 입력되면 스크래핑 → AI 분석 경로로 자동 분기
 */
/**
 * 인박스 수집 핸들러 (빠른 스크랩, Gemini 호출 없음)
 * 링크/텍스트를 즉시 inbox에 저장하고 200 반환 → 서재 이관 시 백그라운드 분석
 */
async function handleCollect(req, res) {
  const body = req.body || {};

  let rawText = body.text || body.content || body.note || '';
  if (body.url && !rawText.includes(body.url)) rawText = [rawText, body.url].filter(Boolean).join('\n');
  rawText = rawText.trim();

  if (!rawText)
    return res.status(400).json({ success: false, error: '텍스트(text/content/url)가 비어 있습니다.' });

  const source    = body.source || body.origin || 'manual';
  const extraTags = Array.isArray(body.tags) ? body.tags : [];
  const now       = new Date();

  let newItem;

  // ── URL: 메타데이터만 빠르게 스크랩 (Gemini 없음) ──
  if (isUrl(rawText)) {
    const meta  = await quickScrapeMeta(rawText);
    const category = meta.isYoutube ? 'youtube' : 'inbox';
    const preview  = (meta.ogDesc || '').slice(0, 240);

    newItem = {
      id:          uuidv4(),
      type:        'url',
      title:       meta.title || rawText,
      text:        meta.ogDesc || meta.title || rawText,
      aiSummary:   '',
      aiAnalysis:  '',
      analysisStatus: 'none',          // 아직 분석 전
      thumbnailUrl: meta.thumbnailUrl || '',
      summary:     preview,
      myInsight:   '',
      subCategory: '',
      status:      'inbox',
      originalUrl: rawText,
      sourceUrl:   rawText,
      category,
      shelf:       category === 'inbox' ? 'inbox' : category,
      keywords:    [...extraTags].slice(0, 6),
      tags:        [],
      extras:      {},
      classifier:  'quick-scrape',
      source,
      date:        toDateStr(now),
      time:        toTimeStr(now),
      createdAt:   now.toISOString(),
      updatedAt:   now.toISOString(),
      insights:    [],
    };
    console.log(`[인박스 수집:URL] "${newItem.title}" (분석 보류)`);

  // ── 텍스트: 규칙 기반 즉시 분류 (Gemini 없음) ──
  } else {
    const r = classifyByRules(rawText);
    const category = body.category || body.manualCategory || r.category;

    newItem = {
      id:         uuidv4(),
      type:       'text',
      title:      rawText.split('\n')[0].slice(0, 60),
      text:       rawText,
      aiSummary:  '',
      aiAnalysis: '',
      analysisStatus: 'none',
      thumbnailUrl: '',
      summary:    '',
      myInsight:  '',
      subCategory: '',
      status:     'inbox',
      originalUrl: null,
      sourceUrl:  null,
      category,
      shelf:      category === 'inbox' ? 'inbox' : category,
      keywords:   [...extraTags].slice(0, 6),
      tags:       [],
      extras:     {},
      classifier: `rules(${r.confidence})`,
      source,
      date:       toDateStr(now),
      time:       toTimeStr(now),
      createdAt:  now.toISOString(),
      updatedAt:  now.toISOString(),
      insights:   [],
    };
    console.log(`[인박스 수집:텍스트] "${rawText.slice(0, 50)}" (분석 보류)`);
  }

  const items = readDB();
  items.unshift(newItem);
  writeDB(items);

  res.status(201).json({ success: true, item: newItem });
}

app.post('/api/items', handleCollect);
app.post('/api/inbox', handleCollect);

/**
 * PATCH /api/items/:id
 * 부분 업데이트 (카테고리 수동 변경, 메모 추가 등)
 */
app.patch('/api/items/:id', (req, res) => {
  const items = readDB();
  const idx   = items.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: '항목을 찾을 수 없습니다.' });

  const allowed = ['category','subCategory','shelf','keywords','summary','source','text','myInsight','status','tags','aiSummary'];
  allowed.forEach(k => { if (req.body[k] !== undefined) items[idx][k] = req.body[k]; });

  // 'active'로 승인 시: 날짜를 현재 시점으로 갱신
  if (req.body.status === 'active') {
    const now = new Date();
    items[idx].date      = toDateStr(now);
    items[idx].time      = toTimeStr(now);
    items[idx].publishedAt = now.toISOString();
  }

  items[idx].updatedAt = new Date().toISOString();
  writeDB(items);
  res.json({ success: true, item: items[idx] });
});

/**
 * 백그라운드 AI 분석: 서재 이관된 item을 Gemini로 심층 분석 후 aiAnalysis 업데이트
 * (클라이언트 응답 이후 비동기로 실행)
 */
async function runArchiveAnalysis(itemId) {
  // 1) 분석할 콘텐츠 확보
  let snap = readDB().find(i => i.id === itemId);
  if (!snap) return;

  try {
    let result = null;

    if (snap.type === 'url' && snap.originalUrl) {
      // 전체 스크랩(자막/본문) → URL 심층 분석
      const pageData = await scrapePage(snap.originalUrl);
      const r = await analyzeUrlWithClaude(snap.originalUrl, pageData, snap.category);
      if (r) {
        result = {
          aiSummary: r.aiSummary || r.summary || '',
          summary:   r.summary   || '',
          keywords:  r.keywords  || [],
          tags:      r.tags      || [],
          extras:    r.extras    || {},
          betterTitle: r.title,
        };
      }
    } else {
      // 텍스트 심층 분석
      const c = await classifyWithAI(snap.text || '');
      if (c) {
        result = {
          aiSummary: c.aiSummary || c.summary || '',
          summary:   c.summary   || '',
          keywords:  c.keywords  || [],
          tags:      c.tags      || [],
          extras:    c.category === 'en' ? { vocabEntries: c.vocabEntries || [] } : {},
        };
      }
    }

    // 2) 최신 DB를 다시 읽어 해당 item만 갱신 (사용자 카테고리/인사이트는 보존)
    const db  = readDB();
    const idx = db.findIndex(i => i.id === itemId);
    if (idx === -1) return; // 그 사이 삭제됨

    if (result) {
      const it = db[idx];
      it.aiAnalysis     = result.aiSummary;
      it.aiSummary      = result.aiSummary;
      if (result.summary) it.summary = result.summary;
      if (result.keywords && result.keywords.length) it.keywords = result.keywords.slice(0, 6);
      if (result.tags && result.tags.length) it.tags = result.tags;
      if (result.extras && Object.keys(result.extras).length) {
        it.extras = { ...(it.extras || {}), ...result.extras };
      }
      it.analysisStatus = 'done';
      it.updatedAt      = new Date().toISOString();
      writeDB(db);
      console.log(`[백그라운드 분석 완료] "${it.title}" → aiAnalysis ${result.aiSummary.length}자`);
    } else {
      db[idx].analysisStatus = 'failed';
      writeDB(db);
      console.warn(`[백그라운드 분석 실패] ${itemId} — Gemini 결과 없음`);
    }
  } catch (e) {
    const db  = readDB();
    const idx = db.findIndex(i => i.id === itemId);
    if (idx !== -1) { db[idx].analysisStatus = 'failed'; writeDB(db); }
    console.error(`[백그라운드 분석 오류] ${itemId} — ${e.message}`);
  }
}

/**
 * POST /api/archive
 * Body: { id, myInsight?, category?, subCategory? }
 * 인박스 → 서재 이관. 즉시 200 응답 후, 백그라운드에서 Gemini 분석 진행.
 */
app.post('/api/archive', (req, res) => {
  const { id, myInsight, category, subCategory } = req.body || {};
  if (!id) return res.status(400).json({ success: false, error: 'id 필수' });

  const items = readDB();
  const idx   = items.findIndex(i => i.id === id);
  if (idx === -1) return res.status(404).json({ success: false, error: '항목을 찾을 수 없습니다.' });

  const it  = items[idx];
  const now = new Date();

  // 서재 이관
  if (typeof myInsight === 'string') it.myInsight = myInsight;
  if (category)    { it.category = category; it.shelf = category; }
  if (subCategory !== undefined) it.subCategory = subCategory;
  it.status      = 'active';
  it.date        = toDateStr(now);
  it.time        = toTimeStr(now);
  it.publishedAt = now.toISOString();
  it.updatedAt   = now.toISOString();

  // 이미 분석된 항목(데일리피드 등)은 분석 생략, 아니면 pending
  const needsAnalysis = !(it.aiSummary && it.aiSummary.length > 0);
  it.analysisStatus = needsAnalysis ? 'pending' : 'done';

  writeDB(items);

  // 즉시 응답 (UI 즉각 갱신)
  res.json({ success: true, item: it, analyzing: needsAnalysis });

  // 응답 직후 백그라운드 분석 시작 (fire-and-forget)
  if (needsAnalysis) {
    console.log(`[서재 이관] "${it.title}" → 백그라운드 분석 시작`);
    setImmediate(() => { runArchiveAnalysis(id).catch(() => {}); });
  }
});

/**
 * DELETE /api/items/:id
 */
app.delete('/api/items/:id', (req, res) => {
  let items  = readDB();
  const prev = items.length;
  items = items.filter(i => i.id !== req.params.id);
  if (items.length === prev) return res.status(404).json({ success: false, error: '항목을 찾을 수 없습니다.' });
  writeDB(items);
  res.json({ success: true });
});

/**
 * GET /api/export-report?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&category=all|en|...
 * 기간·카테고리로 필터링한 지식 아이템을 인쇄용으로 반환
 */
app.get('/api/export-report', (req, res) => {
  const { startDate, endDate, category } = req.query;

  // 활성(서재에 꽂힌) 항목만 대상
  let items = readDB().filter(i => i.status === 'active');

  // 날짜 범위 필터 (item.date는 'YYYY-MM-DD' 문자열 → 사전식 비교 가능)
  const start = (startDate || '').trim();
  const end   = (endDate   || '').trim();
  items = items.filter(i => {
    const d = i.date || (i.createdAt || '').slice(0, 10);
    if (!d) return false;
    if (start && d < start) return false;
    if (end   && d > end)   return false;
    return true;
  });

  // 카테고리 필터
  if (category && category !== 'all') items = items.filter(i => i.category === category);

  // 최신순 정렬
  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json({
    success: true,
    meta: { startDate: start, endDate: end, category: category || 'all', total: items.length, generatedAt: new Date().toISOString() },
    items
  });
});

// ══════════════════════════════════════════════════
//  API — 통계 & 운동 대시보드
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

  // 이번 주
  const now  = new Date();
  const dow  = now.getDay() || 7;
  const wStart = new Date(now); wStart.setDate(now.getDate() - dow + 1);
  const weekCount = items.filter(i => i.date >= toDateStr(wStart)).length;

  // streak
  let streak = 0, chk = new Date();
  while (daily[toDateStr(chk)]) { streak++; chk.setDate(chk.getDate() - 1); }

  // 잔디 84일
  const grassData = Array.from({ length: 84 }, (_, k) => {
    const d = new Date(); d.setDate(d.getDate() - (83 - k));
    const ds = toDateStr(d);
    return { date: ds, count: daily[ds] || 0 };
  });

  // 서가별 카운트 (active 항목 기준 메인 타임라인과 일치)
  const shelfCounts = {};
  items.forEach(i => { shelfCounts[i.shelf || i.category] = (shelfCounts[i.shelf || i.category] || 0) + 1; });

  // 세부 카테고리별 카운트: { "category::sub": n }
  const subCounts = {};
  items.forEach(i => {
    if (i.subCategory) {
      const key = `${i.category}::${i.subCategory}`;
      subCounts[key] = (subCounts[key] || 0) + 1;
    }
  });

  res.json({
    success: true,
    stats: { total: items.length, byCategory: counts, shelfCounts, subCounts, todayCount, weekCount, streak, grassData }
  });
});

// ══════════════════════════════════════════════════
//  API — 타임머신 위젯
// ══════════════════════════════════════════════════

/**
 * GET /api/timemachine?count=3
 * 과거 항목(최근 7일 제외) 랜덤 추출
 */
app.get('/api/timemachine', (req, res) => {
  const count   = Math.min(Number(req.query.count) || 3, 10);
  const items   = readDB();
  const cutoff  = new Date(); cutoff.setDate(cutoff.getDate() - 7);
  const old     = items.filter(i => new Date(i.createdAt) < cutoff);

  if (!old.length) return res.json({ success: true, items: [] });

  // Fisher-Yates 셔플 후 slice
  for (let i = old.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [old[i], old[j]] = [old[j], old[i]];
  }
  res.json({ success: true, items: old.slice(0, count) });
});

// ══════════════════════════════════════════════════
//  API — 주간 브리핑 (강화된 스토리텔링)
// ══════════════════════════════════════════════════

app.get('/api/report/weekly', async (req, res) => {
  const items   = readDB();
  const cutoff  = new Date(); cutoff.setDate(cutoff.getDate() - 7);
  const weekly  = items.filter(i => new Date(i.createdAt) >= cutoff);

  const grouped = {};
  weekly.forEach(i => { (grouped[i.date] = grouped[i.date] || []).push(i); });

  const catCounts = {};
  weekly.forEach(i => { catCounts[i.category] = (catCounts[i.category] || 0) + 1; });

  // AI 스토리텔링 리포트
  let storyReport = null;
  if (process.env.ANTHROPIC_API_KEY && weekly.length >= 3) {
    const enItems  = weekly.filter(i => i.category === 'en').slice(0, 8)
                           .map(i => `• ${i.text.slice(0,150)}`).join('\n');
    const hiItems  = weekly.filter(i => i.category === 'history').slice(0, 8)
                           .map(i => `• ${i.text.slice(0,150)}`).join('\n');
    const ecItems  = weekly.filter(i => i.category === 'economy').slice(0, 5)
                           .map(i => `• ${i.text.slice(0,150)}`).join('\n');

    const raw = await callAI({
      maxTokens: 800,
      system: `당신은 개인 지식 사서이자 인문학 큐레이터입니다.
유저가 한 주 동안 수집한 지식들을 바탕으로,
단순 요약이 아닌 지식 간의 깊은 연결을 찾아 하나의 통합된 지식 스토리를 서술하십시오.
반드시 영어 표현과 역사적 사실을 융합하여 새로운 통찰을 만들어 주십시오.
문체는 격조 있는 한국어 산문(명조체 감성)으로 작성하십시오. JSON만 출력.`,
      prompt: `이번 주 수집된 지식들입니다.

[영어·비즈니스 표현]
${enItems || '(없음)'}

[역사 지식]
${hiItems || '(없음)'}

[경제 지식]
${ecItems || '(없음)'}

아래 JSON만 출력하세요:
{
  "headline": "이번 주 지식 브리핑 제목 (15자 이내)",
  "story": "영어↔역사↔경제를 융합한 통합 지식 스토리텔링 (200~300자)",
  "crossInsight": "영어 표현과 역사 사건 사이에서 발견한 새로운 연결 (100자)",
  "weeklyPhrase": "이번 주를 대표하는 핵심 문장 또는 표현 (영어나 한국어)"
}`
    });

    storyReport = safeParseJSON(raw);
  }

  res.json({
    success:     true,
    period:      { from: toDateStr(cutoff), to: toDateStr() },
    totalItems:  weekly.length,
    byDate:      grouped,
    byCategory:  catCounts,
    storyReport: storyReport || {
      headline:     '이번 주 지식 브리핑',
      story:        '이번 주에 수집된 지식들을 서가에 배치했습니다. ANTHROPIC_API_KEY를 설정하면 영어·역사·경제 지식을 융합한 깊이 있는 스토리텔링 리포트를 받을 수 있습니다.',
      crossInsight: 'API 키 설정 후 활성화됩니다.',
      weeklyPhrase: '知識は力なり — 지식은 힘이다'
    }
  });
});

// ══════════════════════════════════════════════════
//  API — 연말 종합 복기 (완전 재구축)
// ══════════════════════════════════════════════════

app.get('/api/report/year-end', async (req, res) => {
  const year      = parseInt(req.query.year) || new Date().getFullYear();
  const allItems  = readDB();
  const yearItems = allItems.filter(i => (i.date || '').startsWith(String(year)));

  // 카테고리별 집계
  const byCategory = {};
  yearItems.forEach(i => { byCategory[i.category] = (byCategory[i.category] || 0) + 1; });

  // 키워드 빈도
  const kwMap = {};
  yearItems.forEach(i => (i.keywords || []).forEach(k => { kwMap[k] = (kwMap[k] || 0) + 1; }));
  const topKeywords = Object.entries(kwMap)
    .sort((a,b) => b[1]-a[1]).slice(0, 10)
    .map(([word, count]) => ({ word, count }));

  // 베스트 문장 (길이·다양성 기준)
  const bestSentences = [...yearItems]
    .filter(i => i.text && i.text.length > 20)
    .sort((a,b) => b.text.length - a.text.length)
    .slice(0, 5)
    .map(i => ({ id: i.id, text: i.text, category: i.category, date: i.date, source: i.source || '' }));

  // AI 종합 분석
  let aiAnalysis = null;
  const hasAiKey = process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (hasAiKey && yearItems.length >= 3) {
    const sample = yearItems.slice(0, 50)
      .map(i => `[${i.category}] ${i.text.slice(0,100)}`).join('\n');
    const catSum = Object.entries(byCategory).map(([k,v]) => `${k}:${v}개`).join(', ');

    const raw = await callAI({
      maxTokens: 1000,
      system: '당신은 개인 지식 아카이브의 연간 큐레이터입니다. 격조 있는 한국어로 작성하십시오. JSON만 출력.',
      prompt: `${year}년 연간 지식 아카이브 분석입니다.
카테고리 현황: ${catSum}
총 저장: ${yearItems.length}개

대표 지식 샘플:
${sample}

아래 JSON만 출력:
{
  "top3Keywords": [
    {"word":"키워드1","description":"이 키워드의 의미와 한 해 학습에서의 중요성 2문장"},
    {"word":"키워드2","description":"..."},
    {"word":"키워드3","description":"..."}
  ],
  "yearSummary": "올해 지식 학습 여정의 서사적 요약 (250자)",
  "crossCategoryInsight": "카테고리 간 수평적 연결 인사이트 (150자)",
  "letterToNextYear": "내년의 나에게 보내는 지식 성장 격려 메시지 (100자)"
}`
    });

    aiAnalysis = safeParseJSON(raw);
  }

  // Mock 폴백 (API 키 없거나 실패 시)
  if (!aiAnalysis) {
    const topCat = Object.entries(byCategory).sort((a,b)=>b[1]-a[1])[0]?.[0] || 'general';
    const catKr  = { en:'영어', history:'역사', economy:'경제', youtube:'유튜브', inbox:'임시서랍', general:'일반' };
    aiAnalysis = {
      _mock: true,
      top3Keywords: [
        { word: topKeywords[0]?.word || '학습',    description: `${year}년 가장 자주 등장한 핵심 키워드로, 총 ${topKeywords[0]?.count||1}회 수집되었습니다. 꾸준한 관심이 깊이를 만들어 냅니다.` },
        { word: topKeywords[1]?.word || '통찰',    description: '지식들 사이의 숨겨진 연결을 찾아낸 순간들을 대표합니다.' },
        { word: topKeywords[2]?.word || '서재',    description: '단순한 메모가 아닌 지식의 건축을 시작한 상징적 키워드입니다.' }
      ],
      yearSummary: `${year}년, 당신은 총 ${yearItems.length}개의 지식을 서재에 쌓았습니다. 특히 ${catKr[topCat]||topCat} 분야에 깊이를 더했으며, ${Object.keys(byCategory).length}개의 서가를 채워가는 지식 건축가의 여정을 이어왔습니다. 파편화된 정보가 아닌, 연결된 지식의 서재가 완성되어 가고 있습니다.`,
      crossCategoryInsight: `영어 표현과 역사 사건은 '인간의 보편적 언어'로 연결됩니다. API 키를 설정하면 Claude가 두 서가 사이의 깊은 인과관계를 발굴해 드립니다.`,
      letterToNextYear: `내년에도 하루 한 권의 지식을 서재에 꽂아 나가십시오. 지식의 건물은 오늘의 벽돌 한 장으로 세워집니다.`
    };
  }

  res.json({
    success: true,
    year,
    period:       { from: `${year}-01-01`, to: `${year}-12-31` },
    totalItems:   yearItems.length,
    byCategory,
    topKeywords,
    bestSentences,
    aiAnalysis
  });
});

// ══════════════════════════════════════════════════
//  API — 통찰 카드 조회
// ══════════════════════════════════════════════════

/**
 * GET /api/insights?limit=5
 * insights 배열이 있는 항목들을 최신순으로 반환
 */
app.get('/api/insights', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 5, 20);
  const items = readDB();

  const insightCards = [];
  items.forEach(item => {
    (item.insights || []).forEach(ins => {
      insightCards.push({ ...ins, sourceItem: { id: item.id, category: item.category, text: item.text.slice(0,80) } });
    });
  });

  insightCards.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ success: true, total: insightCards.length, insights: insightCards.slice(0, limit) });
});

// ══════════════════════════════════════════════════
//  서버 시작
// ══════════════════════════════════════════════════

app.listen(PORT, '0.0.0.0', () => {
  console.log('\n┌────────────────────────────────────────────────┐');
  console.log('│      SJ 지식 서재 (Knowledge Library) v3        │');
  console.log(`│      http://localhost:${PORT}                      │`);
  console.log('│                                                │');
  console.log('│  POST /api/items              → 지식 저장      │');
  console.log('│  GET  /api/items?category=en  → 서가 조회      │');
  console.log('│  GET  /api/stats              → 대시보드 통계  │');
  console.log('│  GET  /api/timemachine        → 과거 지식 위젯 │');
  console.log('│  GET  /api/report/weekly      → 주간 스토리    │');
  console.log('│  GET  /api/report/year-end    → 연말 결산      │');
  console.log('│  GET  /api/insights           → 통찰 카드      │');
  console.log('└────────────────────────────────────────────────┘\n');
  const geminiKey   = !!_geminiClient;
  const claudeKey   = !!process.env.ANTHROPIC_API_KEY;
  const geminiModel = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

  if (geminiKey) {
    console.log(`✅ Gemini API 활성화 (${geminiModel}) — 4섹션 심층 요약 엔진 가동 중`);
    if (claudeKey) console.log('   └ Claude API: 폴백 대기 중');
  } else if (claudeKey) {
    console.log('⚠  Gemini 키 없음 → Claude API 폴백 동작');
  } else {
    console.log('⚠  AI API 키 없음 → 규칙 기반 분류 (오프라인)');
  }
  console.log('');

  // 서버 시작 시 즉시 임시 서랍 처리
  reshelfOldInboxItems().catch(() => {});
});
