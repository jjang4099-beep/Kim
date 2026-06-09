/**
 * SJ 지식 서재 (Knowledge Library) — server.js v3
 *
 * 실행:  node server.js  |  npm run dev (nodemon)
 * 환경변수:
 *   PORT=3000
 *   ANTHROPIC_API_KEY=sk-ant-...   (없으면 규칙 기반 동작)
 */

'use strict';
const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const { v4: uuidv4 } = require('uuid');

const PORT    = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'archive.json');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));           // 웹훅·확장 프로그램 대응
app.use(express.urlencoded({ extended: true }));    // form-encoded 지원
app.use(express.static(path.join(__dirname, 'public')));

// ══════════════════════════════════════════════════
//  DB 헬퍼
// ══════════════════════════════════════════════════

function readDB() {
  if (!fs.existsSync(DB_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8')); }
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
//  Claude API 래퍼 (범용)
// ══════════════════════════════════════════════════

async function callClaude({ model = 'claude-haiku-4-5-20251001', maxTokens = 600, messages, system }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const https = require('https');
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

function safeParseJSON(text) {
  if (!text) return null;
  try {
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch { return null; }
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
  if (total > 0 && alpha / total > 0.55)
    return { category: 'en', confidence: 'high', keywords: [] };

  if (/금리|증시|주가|연준|fed|fomc|etf|반도체|경제|인플레|기준금리|gdp|환율|코스피|나스닥|달러|채권|금융|투자|주식|ipo/.test(t))
    return { category: 'economy', confidence: 'medium', keywords: [] };

  if (/조선|고려|신라|백제|고구려|임진왜란|세종|이순신|태종|광해군|영조|정조|무신정권|삼별초|동학|갑오|을사|일제|독립|년대|세기|왕조|왕|장군|사건|혁명|전쟁|고대|중세/.test(t))
    return { category: 'history', confidence: 'medium', keywords: [] };

  return { category: 'inbox', confidence: 'low', keywords: [] };
}

/**
 * Claude 기반 분류 (우선)
 */
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
    category:   parsed.category,
    keywords:   parsed.keywords || [],
    summary:    parsed.summary  || '',
    classifier: 'claude'
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
//  서재 배치 엔진 (임시 서랍 → 서가)
//  하루가 지난 inbox 항목을 Claude가 재분류
// ══════════════════════════════════════════════════

async function reshelfOldInboxItems() {
  const items   = readDB();
  const targets = items.filter(i => i.category === 'inbox' && isOlderThanOneDay(i.createdAt));
  if (!targets.length) return 0;

  let changed = 0;
  for (const item of targets) {
    const c = await classifyWithClaude(item.text);
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
//  API — CRUD
// ══════════════════════════════════════════════════

/**
 * GET /api/items
 * query: category, shelf, limit, sort(asc|desc)
 */
app.get('/api/items', (req, res) => {
  let items = readDB();
  const { category, shelf, limit = 100, sort = 'desc' } = req.query;

  if (category && category !== 'all') items = items.filter(i => i.category === category);
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

/**
 * POST /api/items
 * Body (유연): { text, source, manualCategory, url, content, note, tags }
 * 웹훅·크롬 확장 호환: url/content 필드도 text로 병합
 */
app.post('/api/items', async (req, res) => {
  const body = req.body || {};

  // 입력 정규화: 여러 필드를 text로 통합
  let rawText = body.text || body.content || body.note || '';
  if (body.url && !rawText.includes(body.url)) rawText = [rawText, body.url].filter(Boolean).join('\n');
  rawText = rawText.trim();

  if (!rawText)
    return res.status(400).json({ success: false, error: '텍스트(text/content/url)가 비어 있습니다.' });

  const source          = body.source || body.origin || 'manual';
  const manualCategory  = body.category || body.manualCategory || null;
  const extraTags       = Array.isArray(body.tags) ? body.tags : [];
  const now             = new Date();

  const c = await classify(rawText, manualCategory);

  // 서가 배치: 즉시 분류 항목은 해당 카테고리 서가로, inbox는 임시 서랍
  const shelf = c.category === 'inbox' ? 'inbox' : c.category;

  const newItem = {
    id:         uuidv4(),
    text:       rawText,
    category:   c.category,
    shelf,
    keywords:   [...c.keywords, ...extraTags].slice(0, 6),
    summary:    c.summary,
    classifier: c.classifier,
    source,
    date:       toDateStr(now),
    time:       toTimeStr(now),
    createdAt:  now.toISOString(),
    updatedAt:  now.toISOString(),
    insights:   []           // 통찰 카드 저장 공간
  };

  const items = readDB();
  items.unshift(newItem);
  writeDB(items);
  console.log(`[저장] [${newItem.category}/${newItem.shelf}] "${rawText.slice(0,60)}..."`);

  // 비동기: 통찰 감지
  const recentItems = items.slice(1, 30);
  detectCrossInsight(newItem, recentItems).then(insight => {
    if (!insight) return;
    const db  = readDB();
    const idx = db.findIndex(i => i.id === newItem.id);
    if (idx !== -1) {
      db[idx].insights.push({
        id:        uuidv4(),
        title:     insight.title,
        body:      insight.insight,
        createdAt: new Date().toISOString()
      });
      writeDB(db);
      console.log(`[통찰] "${insight.title}" 발견 → ${newItem.id}`);
    }
  }).catch(() => {});

  res.status(201).json({ success: true, item: newItem });
});

/**
 * PATCH /api/items/:id
 * 부분 업데이트 (카테고리 수동 변경, 메모 추가 등)
 */
app.patch('/api/items/:id', (req, res) => {
  const items = readDB();
  const idx   = items.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: '항목을 찾을 수 없습니다.' });

  const allowed = ['category','shelf','keywords','summary','source','text'];
  allowed.forEach(k => { if (req.body[k] !== undefined) items[idx][k] = req.body[k]; });
  items[idx].updatedAt = new Date().toISOString();
  writeDB(items);
  res.json({ success: true, item: items[idx] });
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

  // 서가별 카운트
  const shelfCounts = {};
  items.forEach(i => { shelfCounts[i.shelf || i.category] = (shelfCounts[i.shelf || i.category] || 0) + 1; });

  res.json({
    success: true,
    stats: { total: items.length, byCategory: counts, shelfCounts, todayCount, weekCount, streak, grassData }
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

    const raw = await callClaude({
      maxTokens: 800,
      system: `당신은 개인 지식 사서이자 인문학 큐레이터입니다.
유저가 한 주 동안 수집한 지식들을 바탕으로,
단순 요약이 아닌 지식 간의 깊은 연결을 찾아 하나의 통합된 지식 스토리를 서술하십시오.
반드시 영어 표현과 역사적 사실을 융합하여 새로운 통찰을 만들어 주십시오.
문체는 격조 있는 한국어 산문(명조체 감성)으로 작성하십시오.`,
      messages: [{
        role: 'user',
        content: `이번 주 수집된 지식들입니다.

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
      }]
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
  if (process.env.ANTHROPIC_API_KEY && yearItems.length >= 3) {
    const sample = yearItems.slice(0, 50)
      .map(i => `[${i.category}] ${i.text.slice(0,100)}`).join('\n');
    const catSum = Object.entries(byCategory).map(([k,v]) => `${k}:${v}개`).join(', ');

    const raw = await callClaude({
      maxTokens: 1000,
      system: '당신은 개인 지식 아카이브의 연간 큐레이터입니다. 격조 있는 한국어로 작성하십시오.',
      messages: [{
        role: 'user',
        content: `${year}년 연간 지식 아카이브 분석입니다.
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
      }]
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

app.listen(PORT, () => {
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
  if (!process.env.ANTHROPIC_API_KEY)
    console.log('⚠  ANTHROPIC_API_KEY 미설정 → 규칙 기반 분류 + Mock 리포트\n');
  else
    console.log('✅ Claude API 활성화 — 서재 AI 사서 가동 중\n');

  // 서버 시작 시 즉시 임시 서랍 처리
  reshelfOldInboxItems().catch(() => {});
});
