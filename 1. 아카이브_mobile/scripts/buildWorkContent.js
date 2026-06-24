/**
 * buildWorkContent.js — 직장인(PROFESSIONAL) 전용 배달 콘텐츠 생성기
 * ────────────────────────────────────────────────────────────────
 * 우리 스택(SQLite + Gemini)으로 이식한 버전.
 *   · 원본 scripts/buildClassicDB·buildInsightDB·buildIdiomDB.js 는 MongoDB+Anthropic 기준이라 그대로 못 돌림.
 *   · 출력: JSON 시드 파일 → public/data/work_db/  (knowledge_db 와 같은 "시드→SQLite 적재" 방식)
 *   · 모든 콘텐츠는 mode/targetMode = 'work' 고정 → 수험생(EXAM) 배달에는 절대 반영 안 됨.
 *
 * 실행 (이 파일이 있는 mobile 앱 폴더 기준):
 *   node scripts/buildWorkContent.js            # 파일럿 (소량, 기본)
 *   node scripts/buildWorkContent.js all        # 파일럿 전체 타입
 *   node scripts/buildWorkContent.js classic    # 고전만
 *   node scripts/buildWorkContent.js all --full # 전체 생성 (대량 — 비용/시간 큼)
 *
 * 재실행 안전: 같은 id 는 스킵하고 새 항목만 append.
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ── 설정 ──────────────────────────────────────────────
const OUT_DIR  = path.join(__dirname, '..', 'public', 'data', 'work_db');
const argv     = process.argv.slice(2);
const TYPE     = (argv.find(a => !a.startsWith('--')) || 'all').toLowerCase();
const FULL     = argv.includes('--full');
/* 제공자: 기본 Claude(Anthropic) — 원본 스크립트·제안서 비용이 Claude 토큰 기준.
   --gemini 로 무료 Gemini 사용 가능하나 무료등급은 분당5/일20 한도라 대량 생성 부적합. */
const PROVIDER     = argv.includes('--gemini') ? 'gemini' : 'claude';
const CLAUDE_KEY   = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const GEMINI_KEY   = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

if (PROVIDER === 'claude' && !CLAUDE_KEY) { console.error('❌ ANTHROPIC_API_KEY 가 .env 에 없습니다.'); process.exit(1); }
if (PROVIDER === 'gemini' && !GEMINI_KEY) { console.error('❌ GEMINI_API_KEY 가 .env 에 없습니다.'); process.exit(1); }

const delay = ms => new Promise(r => setTimeout(r, ms));

/* 호출 간 최소 간격 — Claude(유료) 1.2s / Gemini(무료) 15s */
const MIN_GAP_MS = Number(process.env.LLM_MIN_GAP_MS || (PROVIDER === 'gemini' ? 15000 : 1200));
let _lastCall = 0;
async function pace() {
  const wait = _lastCall + MIN_GAP_MS - Date.now();
  if (wait > 0) await delay(wait);
  _lastCall = Date.now();
}

let _gModel = null;
function gModel() {
  if (!_gModel) _gModel = new GoogleGenerativeAI(GEMINI_KEY).getGenerativeModel({ model: GEMINI_MODEL });
  return _gModel;
}

// 제공자별 LLM 호출 → 원문 텍스트 반환
async function callLLM(prompt, maxTokens) {
  if (PROVIDER === 'gemini') {
    const r = await gModel().generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
    });
    return r.response.text();
  }
  // Claude Messages API (raw fetch — SDK 불필요, 배포본에 의존성 추가 없음)
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) { const t = await res.text(); const err = new Error(`${res.status} ${t.slice(0, 240)}`); err.status = res.status; throw err; }
  const data = await res.json();
  return (data.content || []).map(c => c.text || '').join('');
}

// ── JSON 생성 (펜스 제거 + 레이트리밋/과부하 백오프 재시도) ──────
async function genJSON(prompt, { retries = 4, maxOutputTokens = 4000 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    await pace();
    try {
      let text = (await callLLM(prompt, maxOutputTokens)).trim().replace(/```json|```/g, '').trim();
      const s = text.search(/[[{]/);
      if (s > 0) text = text.slice(s);
      return JSON.parse(text);
    } catch (e) {
      const msg   = e.message || '';
      const st    = e.status || 0;
      const isRate = st === 429 || msg.includes('429') || msg.includes('Too Many Requests');
      const isOver = [503, 529].includes(st) || msg.includes('503') || msg.includes('529') || msg.includes('overloaded') || msg.includes('high demand');
      if (attempt === retries || !(isRate || isOver)) throw e;
      const m = msg.match(/retry in ([\d.]+)s/i);
      const waitS = m ? Math.ceil(parseFloat(m[1])) + 1 : (isRate ? 20 : 8);
      console.log(`     ⏳ ${isRate ? '레이트리밋' : '과부하'} — ${waitS}s 대기 후 재시도 (${attempt + 1}/${retries})`);
      await delay(waitS * 1000);
    }
  }
}

// ── 시드 파일 입출력 (id 중복 스킵 append) ───────────────
function loadSeed(file, key) {
  const p = path.join(OUT_DIR, file);
  if (!fs.existsSync(p)) return { meta: {}, [key]: [] };
  try { const d = JSON.parse(fs.readFileSync(p, 'utf8')); d[key] = d[key] || []; return d; }
  catch { return { meta: {}, [key]: [] }; }
}
function saveSeed(file, key, data, label) {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  data.meta = { ...(data.meta || {}), label, mode: 'work', updated: new Date().toISOString().slice(0, 10), count: data[key].length };
  fs.writeFileSync(path.join(OUT_DIR, file), JSON.stringify(data, null, 2), 'utf8');
}
function nextIdNum(items, prefix) {
  let max = 0;
  for (const it of items) {
    const m = String(it.id || '').match(new RegExp('^' + prefix + '_(\\d+)$'));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}
const pad = n => String(n).padStart(3, '0');

// ════════════════════════════════════════════════════════
// 1) 고전 구절 (LIBER) — classic_quotes
// ════════════════════════════════════════════════════════
const CLASSICS_PILOT = FULL ? [
  { book: '명상록', author: '마르쿠스 아우렐리우스', era: 'Stoicism',   tags: ['철학','자기계발','스토아','내면','절제'] },
  { book: '군주론', author: '마키아벨리',           era: 'Renaissance', tags: ['리더십','전략','권력','현실주의','정치'] },
] : [
  { book: '명상록', author: '마르쿠스 아우렐리우스', era: 'Stoicism', tags: ['철학','자기계발','스토아','내면','절제'] },
];
async function buildClassic() {
  const KEY = 'classic_quotes', FILE = 'classic_quotes.json';
  const seed = loadSeed(FILE, KEY);
  const perBook = FULL ? 20 : 6;
  const books = CLASSICS_PILOT;   // (FULL 확장 시 전체 38권 목록으로 교체)
  let added = 0;

  for (const c of books) {
    if (seed[KEY].some(q => q.book === c.book)) { console.log(`  ⏭️  ${c.book} 이미 존재 — 스킵`); continue; }
    console.log(`  🔄 ${c.book} (${c.author}) — ${perBook}구절 생성…`);
    const prompt = `너는 세계 문학과 철학 전문가야. ${c.author}의 《${c.book}》에서 현대 직장인에게 깊은 울림을 줄 핵심 구절 ${perBook}개를 선정해줘.
선정 기준: 삶의 태도·리더십·성장·인간관계·역경 극복 / 1~4문장 / 저장·공유하고 싶을 만큼 인상적 / 원문은 자연스러운 한국어 번역.
순수 JSON 배열만 응답 (설명·마크다운 없이):
[{"quote":"구절 한국어","source":"출처(예: 17장, Act 3 Scene 1)","theme":"핵심 주제 한 단어","context":"현대 직장인 관점 해석 2~3문장"}]`;
    try {
      const arr = await genJSON(prompt);
      let n = nextIdNum(seed[KEY], 'CLQ');
      for (const q of arr) {
        seed[KEY].push({
          id: `CLQ_${pad(n++)}`, book: c.book, author: c.author, era: c.era,
          quote: q.quote || '', source: q.source || '', theme: q.theme || '',
          context: q.context || '', tags: c.tags, targetMode: 'work', used: false,
        });
        added++;
      }
      console.log(`  ✅ ${c.book} — ${arr.length}구절`);
      await delay(700);
    } catch (e) { console.error(`  ❌ ${c.book} 실패:`, e.message); }
  }
  saveSeed(FILE, KEY, seed, '고전 구절(LIBER)');
  console.log(`📖 classic_quotes: +${added} (총 ${seed[KEY].length})`);
}

// ════════════════════════════════════════════════════════
// 2) 고사성어 — idiom_cards (직장 관점만, work 전용)
// ════════════════════════════════════════════════════════
const IDIOMS_PILOT = FULL
  ? ['사필귀정','새옹지마','전화위복','지피지기','온고지신']   // (FULL 확장 시 전체 300개로 교체)
  : ['사필귀정','지피지기'];
async function buildIdiom() {
  const KEY = 'idiom_cards', FILE = 'idiom_cards.json';
  const seed = loadSeed(FILE, KEY);
  let added = 0;
  for (const idiom of IDIOMS_PILOT) {
    if (seed[KEY].some(c => c.idiom === idiom)) { console.log(`  ⏭️  ${idiom} 이미 존재 — 스킵`); continue; }
    console.log(`  🔄 ${idiom} 생성…`);
    const prompt = `"${idiom}" 고사성어를 "직장·비즈니스 관점"에서 풀어줘.
순수 JSON 객체만 응답 (설명·마크다운 없이):
{"hanja":"한자 표기(모르면 빈문자열)","meaning":"뜻풀이 1~2문장","origin":"유래·출전 1~2문장(없으면 빈문자열)","example":"이 성어를 쓴 실제 문장 1개","modernUse":"직장에서 쓰는 구체적 상황 2~3문장","tags":["태그1","태그2"]}`;
    try {
      const d = await genJSON(prompt, { maxOutputTokens: 800 });
      const n = nextIdNum(seed[KEY], 'IDC');
      seed[KEY].push({
        id: `IDC_${pad(n)}`, idiom, hanja: d.hanja || '', meaning: d.meaning || '',
        origin: d.origin || '', example: d.example || '', modernUse: d.modernUse || '',
        contextType: 'work', tags: d.tags || [], targetMode: 'work', used: false,
      });
      added++;
      console.log(`  ✅ ${idiom}`);
      await delay(600);
    } catch (e) { console.error(`  ❌ ${idiom} 실패:`, e.message); }
  }
  saveSeed(FILE, KEY, seed, '고사성어');
  console.log(`📜 idiom_cards: +${added} (총 ${seed[KEY].length})`);
}

// ════════════════════════════════════════════════════════
// 3) 오늘의 인사이트 — daily_insights (요일별 카테고리)
// ════════════════════════════════════════════════════════
const INSIGHTS_ALL = [
  { subCategory: 'psychology',           label: '심리학',     icon: '🧠', color: '#7c3aed', dayOfWeek: 1, topic: '확증 편향' },
  { subCategory: 'psychology',           label: '심리학',     icon: '🧠', color: '#7c3aed', dayOfWeek: 1, topic: '더닝-크루거 효과' },
  { subCategory: 'behavioral_economics', label: '행동경제학', icon: '💹', color: '#059669', dayOfWeek: 2, topic: '넛지 이론' },
  { subCategory: 'philosophy',           label: '철학 한 줌', icon: '🏛️', color: '#92400e', dayOfWeek: 3, topic: '스토아의 통제 이분법' },
  { subCategory: 'sociology_org',        label: '조직·사회학', icon: '🏢', color: '#0891b2', dayOfWeek: 4, topic: '파킨슨의 법칙' },
];
const INSIGHTS_PILOT = FULL ? INSIGHTS_ALL : INSIGHTS_ALL.slice(0, 2);
async function buildInsight() {
  const KEY = 'daily_insights', FILE = 'daily_insights.json';
  const seed = loadSeed(FILE, KEY);
  let added = 0;
  for (const c of INSIGHTS_PILOT) {
    if (seed[KEY].some(i => i.topic === c.topic)) { console.log(`  ⏭️  ${c.topic} 이미 존재 — 스킵`); continue; }
    console.log(`  🔄 [${c.label}] ${c.topic} 생성…`);
    const prompt = `"${c.topic}" 개념(${c.label})을 현대 직장인이 3분 안에 이해하고 바로 써먹을 수 있게 풀어줘.
순수 JSON 객체만 응답 (설명·마크다운 없이):
{"headline":"한 줄 핵심(호기심 자극)","body":"개념 설명 3~4문장(쉽게)","realLife":"직장에서 마주치는 구체적 사례 2~3문장","question":"오늘 스스로 던질 질문 1개","tags":["태그1","태그2"]}`;
    try {
      const d = await genJSON(prompt, { maxOutputTokens: 1200 });
      const n = nextIdNum(seed[KEY], 'INS');
      seed[KEY].push({
        id: `INS_${pad(n)}`, subCategory: c.subCategory, label: c.label, icon: c.icon, color: c.color,
        dayOfWeek: c.dayOfWeek, topic: c.topic, headline: d.headline || '', body: d.body || '',
        realLife: d.realLife || '', question: d.question || '', tags: d.tags || [],
        targetMode: 'work', used: false,
      });
      added++;
      console.log(`  ✅ ${c.topic}`);
      await delay(600);
    } catch (e) { console.error(`  ❌ ${c.topic} 실패:`, e.message); }
  }
  saveSeed(FILE, KEY, seed, '오늘의 인사이트');
  console.log(`💡 daily_insights: +${added} (총 ${seed[KEY].length})`);
}

// ── 메인 ──────────────────────────────────────────────
(async () => {
  const modelShown = PROVIDER === 'gemini' ? GEMINI_MODEL : CLAUDE_MODEL;
  console.log(`\n🚀 직장인 콘텐츠 생성 — type=${TYPE} mode=${FULL ? 'FULL' : 'PILOT'} provider=${PROVIDER} model=${modelShown}`);
  console.log(`   출력: ${OUT_DIR}\n`);
  const run = { classic: buildClassic, idiom: buildIdiom, insight: buildInsight };
  try {
    if (TYPE === 'all') { await buildClassic(); await buildIdiom(); await buildInsight(); }
    else if (run[TYPE]) { await run[TYPE](); }
    else { console.error(`알 수 없는 타입: ${TYPE} (classic|idiom|insight|all)`); process.exit(1); }
    console.log('\n✅ 완료. (수험생 모드에는 반영 안 됨 — work 전용 work_db/)');
  } catch (e) { console.error('\n💥 치명적 오류:', e); process.exit(1); }
})();
