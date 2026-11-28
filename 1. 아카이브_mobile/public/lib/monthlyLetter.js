/**
 * 나의 역사 — 편지(11-28). 한 달(YYYY-MM) 또는 한 분기(YYYY-Qn, 11-28 사용자: 매달보다 분기로)의 내 기록에서 사실을 모으고, 편지 프롬프트·대체 편지를 만든다.
 * 서버 라우트 GET /api/letter/:period 가 쓴다. 테스트: scripts/tests/monthly-letter.test.js
 * 원칙: 기록에 있는 것만 말한다. 기록이 적은 달도 꾸짖지 않는다.
 */

const dateOf = i => String(i.date || i.createdAt || '').slice(0, 10);
const thoughtOf = i => { const t = String(i.myInsight || '').trim(); return t && !t.startsWith('[') ? t : ''; };
const ownText = i => String(i.text || '').replace(/\s+/g, ' ').trim();

/** 기간 → 달 목록 ('2026-Q4' → ['2026-10','2026-11','2026-12'], '2026-11' → ['2026-11']) */
function periodMonths(period) {
  const q = String(period).match(/^(\d{4})-Q([1-4])$/);
  if (!q) return [String(period)];
  return [0, 1, 2].map(k => `${q[1]}-${String((Number(q[2]) - 1) * 3 + 1 + k).padStart(2, '0')}`);
}
const periodLabel = period => {
  const q = String(period).match(/^(\d{4})-Q([1-4])$/);
  if (q) return `${q[1]}년 ${q[2]}분기`;
  const [y, m] = String(period).split('-').map(Number);
  return `${y}년 ${m}월`;
};

/** 기간의 사실 — items는 그 유저의 기록 전부, got은 {지식 id: 받은 날}, stageOf(id) → {cat, theme, stage} | null */
function letterFacts({ period, ym, items = [], got = {}, stageOf = () => null }) {
  period = period || ym;
  const months = periodMonths(period);
  const inPeriod = d => months.some(m => String(d).startsWith(m));
  const mine = items.filter(i => inPeriod(dateOf(i)));
  const lifes = mine.filter(i => i.contentType === 'life').sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
  const kept = mine.filter(i => i.contentType !== 'life');
  const quotes = mine.filter(thoughtOf)
    .sort((a, b) => dateOf(b).localeCompare(dateOf(a)))
    .slice(0, 3)
    .map(i => ({ text: thoughtOf(i), title: String(i.title || ''), date: dateOf(i) }));
  const recIds = Object.keys(got).filter(id => inPeriod(got[id]));
  const byStage = {};
  let english = 0;
  recIds.forEach(id => {
    const s = stageOf(id); if (!s) return;
    if (s.cat === '영어') english++;
    const k = `${s.cat}\u0001${s.theme}\u0001${s.stage}`;
    (byStage[k] ||= { cat: s.cat, theme: s.theme, stage: s.stage, count: 0 }).count++;
  });
  const path = Object.values(byStage).sort((a, b) => b.count - a.count).slice(0, 4);
  const scenes = lifes
    .filter(i => ownText(i) || ((i.life && i.life.photos) || []).length)
    .map(i => ({ date: dateOf(i), text: ownText(i).slice(0, 140), location: (i.life && i.life.location) || '', photo: ((i.life && i.life.photos) || [])[0] || '' }))
    .slice(0, 4);
  const days = new Set(mine.map(dateOf)).size;
  return {
    period, ym: period, label: periodLabel(period), days, received: recIds.length, saved: kept.length,
    thoughts: mine.filter(thoughtOf).length, english, path, quotes, scenes,
    cover: (scenes.find(s => s.photo) || {}).photo || '',
    thin: !days && !recIds.length,
  };
}

/** 편지 프롬프트 — 입력은 실제 기록만 */
function letterPrompt(f) {
  const system = '너는 한 사람의 한 기간(한 분기 또는 한 달) 기록을 읽고 그 기간을 돌려주는 짧은 편지를 쓰는 사람이다. ' +
    '목적은 읽는 사람이 자기 기록으로 "이 시간도 의미 있게 살았다, 나는 가치 있는 사람이다"를 확인하게 하는 것이다. ' +
    '읽는 사람이 직접 남긴 문장이 있으면 그 문장을 편지의 중심에 두고, 그 말이 그 사람에 대해 무엇을 보여 주는지 짚어라. ' +
    '기록에 실제로 있는 날짜·장소·문장·배운 내용을 구체적으로 짚어라. 기록에 없는 일을 지어내지 마라. ' +
    '기록이 적은 기간이면 꾸짖지 말고, 남긴 것이 무엇이었는지 담담하게 짚어 짧게 써라. ' +
    '과장된 칭찬·자기계발 문구 없이, 반드시 존댓말(해요체)로 오래 알고 지낸 사람이 정중하고 따뜻하게 건네는 말투로 쓴다. ' +
    '출력 형식: 첫 줄에 20자 안쪽의 제목(따옴표·기호 없이), 빈 줄, 그다음 한국어 3~4문장 한 문단. 마크다운·목록을 쓰지 않는다.';
  const lines = [
    `${f.label} 기록 — 기록한 날 ${f.days}일, 받은 지식 ${f.received}편(영어 ${f.english}), 서재에 담은 것 ${f.saved}개, 남긴 생각 ${f.thoughts}개.`,
    `## 걸어온 길(지식 지도)\n${f.path.map(p => `- ${p.cat} · ${p.theme} · ${p.stage}: ${p.count}편`).join('\n') || '(없음)'}`,
    `## 내가 남긴 생각\n${f.quotes.map(q => `- ${q.date.slice(5)} "${q.text}" (${q.title})`).join('\n') || '(없음)'}`,
    `## 일상·여행 장면\n${f.scenes.map(s => `- ${s.date.slice(5)}${s.location ? ` (${s.location})` : ''}${s.photo ? ' [사진]' : ''} ${s.text}`).join('\n') || '(없음)'}`,
  ];
  return { system, user: lines.join('\n\n') };
}

/** AI가 없거나 실패했을 때 — 기록으로 만든 짧은 편지 */
function fallbackLetter(f) {
  if (f.thin) return { title: '쉬어 간 달', letter: `${f.label}은 조용히 지나갔어요. 쉬어 가는 달도 당신의 역사에 들어갑니다. 다음 달에 남길 한 줄을 기다릴게요.` };
  const bits = [];
  if (f.days) bits.push(`${f.days}일 동안 기록을 남겼고`);
  if (f.received) bits.push(`지식 ${f.received}편을 받아 들였어요`);
  const walk = f.path[0] ? ` 가장 오래 머문 곳은 ${f.path[0].theme}의 "${f.path[0].stage}"였어요.` : '';
  const q = f.quotes[0] ? ` 그리고 "${f.quotes[0].text}"라는 생각을 남겼죠.` : '';
  return { title: `${f.label}의 당신`, letter: `${f.label}, 당신은 ${bits.join(' ')}.${walk}${q} 이 한 달도 당신의 역사로 차곡차곡 쌓였습니다.` };
}

/** 모델 출력 → 제목·편지 */
function parseLetter(raw) {
  const text = String(raw || '').trim();
  const nl = text.indexOf('\n');
  if (nl < 0) return { title: '', letter: text };
  return { title: text.slice(0, nl).replace(/^["'#\s]+|["'\s]+$/g, '').trim(), letter: text.slice(nl).trim() };
}

/** 기록이 바뀌었는지 — 캐시 키에 붙인다 */
function fingerprint(f) {
  const s = JSON.stringify([f.days, f.received, f.saved, f.thoughts, f.english, f.path, f.quotes, f.scenes]);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

module.exports = { periodMonths, letterFacts, letterPrompt, fallbackLetter, parseLetter, fingerprint };
