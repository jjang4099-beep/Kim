/**
 * buildCountryDB.js — 여행 아카이브(Feature 5) 국가별 콘텐츠 생성기
 * ────────────────────────────────────────────────────────────────
 * buildWorkContent.js와 동일 스택(raw fetch Claude, SDK 의존성 추가 없음).
 *   · 출력: public/data/country_db/<코드>.json (1국 1파일)
 *   · 재실행 안전: 파일이 이미 있으면 스킵(강제 재생성은 --force)
 *
 * 실행 (mobile 앱 폴더 기준):
 *   node scripts/buildCountryDB.js jp          # 국가 코드 1개
 *   node scripts/buildCountryDB.js jp us fr    # 여러 개
 *   node scripts/buildCountryDB.js --force jp  # 이미 있어도 재생성
 *
 * 파일럿(2026-07-01): 일본(JP) 1개국만 먼저 생성 — 비용/품질 확인 후 나머지 확장.
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const OUT_DIR    = path.join(__dirname, '..', 'public', 'data', 'country_db');
const argv       = process.argv.slice(2);
const FORCE      = argv.includes('--force');
const codesArg   = argv.filter(a => !a.startsWith('--')).map(c => c.toUpperCase());

const CLAUDE_KEY   = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
if (!CLAUDE_KEY) { console.error('❌ ANTHROPIC_API_KEY 가 .env 에 없습니다.'); process.exit(1); }

const COUNTRY_NAMES = {
  JP: '일본', US: '미국', CN: '중국', VN: '베트남', TH: '태국', FR: '프랑스',
  IT: '이탈리아', ES: '스페인', DE: '독일', GB: '영국', SG: '싱가포르', PH: '필리핀',
  ID: '인도네시아', MY: '말레이시아', TW: '대만', HK: '홍콩', AU: '호주', NZ: '뉴질랜드',
  CA: '캐나다', MX: '멕시코', BR: '브라질', IN: '인도', AE: '아랍에미리트', TR: '터키',
  GR: '그리스', PT: '포르투갈', NL: '네덜란드', CH: '스위스', AT: '오스트리아', CZ: '체코',
};

const delay = ms => new Promise(r => setTimeout(r, ms));
const MIN_GAP_MS = Number(process.env.LLM_MIN_GAP_MS || 1200);
let _lastCall = 0;
async function pace() {
  const wait = _lastCall + MIN_GAP_MS - Date.now();
  if (wait > 0) await delay(wait);
  _lastCall = Date.now();
}

async function callClaude(prompt, maxTokens) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) { const t = await res.text(); const err = new Error(`${res.status} ${t.slice(0, 240)}`); err.status = res.status; throw err; }
  const data = await res.json();
  return (data.content || []).map(c => c.text || '').join('');
}

async function genJSON(prompt, { retries = 4, maxOutputTokens = 3200 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    await pace();
    try {
      let text = (await callClaude(prompt, maxOutputTokens)).trim().replace(/```json|```/g, '').trim();
      const s = text.search(/[[{]/);
      if (s > 0) text = text.slice(s);
      return JSON.parse(text);
    } catch (e) {
      const msg    = e.message || '';
      const st     = e.status || 0;
      const isRate = st === 429 || msg.includes('429');
      const isOver = [503, 529].includes(st) || msg.includes('overloaded') || msg.includes('high demand');
      if (attempt === retries || !(isRate || isOver)) throw e;
      const waitS = isRate ? 20 : 8;
      console.log(`     ⏳ 재시도 대기 ${waitS}s (${attempt + 1}/${retries})`);
      await delay(waitS * 1000);
    }
  }
}

function buildPrompt(name) {
  return `
"${name}"에 대한 여행자용 아카이브 데이터를 만들어줘.
한국인 여행자 관점에서 실용적이고 흥미롭게 작성해줘.

아래 JSON 형식으로만 응답해줘 (설명·마크다운 없이 순수 JSON 한 덩어리):
{
  "overview": {
    "capital": "수도", "population": "인구", "language": "공용어",
    "currency": "통화(기호 포함)", "timezoneDiff": "한국과 시차",
    "voltage": "전압", "summary": "한 줄 요약 (2문장)"
  },
  "history": [
    { "era": "시대명", "year": "연도", "event": "핵심 사건 설명 (1문장)" }
  ],
  "culture": {
    "etiquette": ["에티켓 4개"],
    "food": ["음식 문화 4개"],
    "funFacts": ["알면 다르게 보이는 것 4개"]
  },
  "language": {
    "shopping":   [{ "ko": "한국어", "local": "현지어", "pron": "발음" }],
    "restaurant": [{ "ko": "한국어", "local": "현지어", "pron": "발음" }],
    "transport":  [{ "ko": "한국어", "local": "현지어", "pron": "발음" }],
    "emergency":  [{ "ko": "한국어", "local": "현지어", "pron": "발음" }]
  },
  "practical": {
    "emergencyPhone": "긴급전화번호",
    "visa": "비자 정보 (한국인 기준)",
    "tips": ["실용팁 3개"]
  }
}
history는 5개, language의 각 카테고리는 3개씩.
  `.trim();
}

async function main() {
  const codes = codesArg.length ? codesArg : ['JP'];   // 인자 없으면 파일럿 기본값(일본)
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(`🌍 국가 DB 구축 시작 (${codes.length}개국: ${codes.join(', ')})`);

  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    const name = COUNTRY_NAMES[code];
    if (!name) { console.warn(`[${i+1}/${codes.length}] ⚠️  알 수 없는 국가 코드: ${code} — 스킵`); continue; }

    const filePath = path.join(OUT_DIR, `${code}.json`);
    if (fs.existsSync(filePath) && !FORCE) {
      console.log(`[${i+1}/${codes.length}] ⏭️  ${name}(${code}) 이미 존재 — 스킵(--force로 재생성)`);
      continue;
    }

    try {
      console.log(`[${i+1}/${codes.length}] 🔄 ${name}(${code}) 생성 중…`);
      const data = await genJSON(buildPrompt(name));
      fs.writeFileSync(filePath, JSON.stringify({ code, name, ...data }, null, 2), 'utf8');
      console.log(`[${i+1}/${codes.length}] ✅ ${name}(${code}) 완료 → ${filePath}`);
    } catch (e) {
      console.error(`[${i+1}/${codes.length}] ❌ ${name}(${code}) 실패:`, e.message);
    }
  }

  console.log('\n✅ 국가 DB 구축 완료!');
}

main().catch(e => { console.error('❌ 실행 실패:', e.message); process.exit(1); });
