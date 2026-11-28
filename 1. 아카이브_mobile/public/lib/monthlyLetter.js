/**
 * 나의 역사 — 월간 편지(11-28). 한 달의 내 기록에서 사실을 모으고, 편지 프롬프트·대체 편지를 만든다.
 * 서버 라우트 GET /api/letter/monthly/:ym 가 쓴다. 테스트: scripts/tests/monthly-letter.test.js
 * 원칙: 기록에 있는 것만 말한다. 기록이 적은 달도 꾸짖지 않는다.
 */

const dateOf = i => String(i.date || i.createdAt || '').slice(0, 10);
const thoughtOf = i => { const t = String(i.myInsight || '').trim(); return t && !t.startsWith('[') ? t : ''; };
const ownText = i => String(i.text || '').replace(/\s+/g, ' ').trim();

/** 한 달의 사실 — items는 그 유저의 기록 전부, got은 {지식 id: 받은 날}, stageOf(id) → {cat, theme, stage} | null */
function letterFacts({ ym, items = [], got = {}, stageOf = () => null }) {
  const [y, m] = ym.split('-').map(Number);
  const mine = items.filter(i => dateOf(i).startsWith(ym));
  const lifes = mine.filter(i => i.contentType === 'life').sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
  const kept = mine.filter(i => i.contentType !== 'life');
  const quotes = mine.filter(thoughtOf)
    .sort((a, b) => dateOf(b).localeCompare(dateOf(a)))
    .slice(0, 3)
    .map(i => ({ text: thoughtOf(i), title: String(i.title || ''), date: dateOf(i) }));
  const recIds = Object.keys(got).filter(id => String(got[id]).startsWith(ym));
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
    ym, label: `${y}년 ${m}월`, days, received: recIds.length, saved: kept.length,
    thoughts: mine.filter(thoughtOf).length, english, path, quotes, scenes,
    cover: (scenes.find(s => s.photo) || {}).photo || '',
    thin: !days && !recIds.length,
  };
}

/** 편지 프롬프트 — 입력은 실제 기록만 */
function letterPrompt(f) {
  const system = '너는 한 사람의 한 달 기록을 읽고 그 달을 돌려주는 짧은 편지를 쓰는 사람이다. ' +
    '목적은 읽는 사람이 자기 기록으로 "이번 달도 의미 있게 살았다, 나는 가치 있는 사람이다"를 확인하게 하는 것이다. ' +
    '기록에 실제로 있는 날짜·장소·문장·배운 내용을 구체적으로 짚어라. 기록에 없는 일을 지어내지 마라. ' +
    '기록이 적은 달이면 꾸짖지 말고, 남긴 것이 무엇이었는지 담담하게 짚어 짧게 써라. ' +
    '과장된 칭찬·자기계발 문구 대신 오래 알던 친구의 말투로. ' +
    '출력 형식: 첫 줄에 20자 안쪽의 제목(따옴표·기호 없이), 빈 줄, 그다음 한국어 4~5문장 한 문단. 마크다운·목록을 쓰지 않는다.';
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

module.exports = { letterFacts, letterPrompt, fallbackLetter, parseLetter, fingerprint };
