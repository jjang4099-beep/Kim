/**
 * 역사 연표 지도 — 순수 함수 모음 (server.js가 퀘스트 응답·'이 길 걷기' 배달에 쓴다. 테스트: scripts/tests/history-timeline.test.js)
 *
 * 갈래(lane) 하나 = 한국·중국·일본·서양·세계. 갈래의 단계 = 연재(deep_layers series, id 'c:<sid>')
 *   + 시대 테마(course_db/history_themes.json, id 'h:<themeId>')를 시작 연도순으로 섞은 것.
 * 분류표에 아직 없는 새 편은 갈래 끝 '아직 묶지 않은 이야기'(id 'h:<lane>-etc')로 — 지도에서 사라지지 않게.
 * 예전 글 중 같은 주제가 이미 있는 것은 aliases로 원래 글에 합친다(foldAliases).
 */

/* 갈래 기본 정보 — catalog의 역사 groups가 있으면 그 이름을 쓰고, 없는 갈래(세계)는 이 기본값 */
const LANES = [
  { lane: '한국', id: 'korea', label: '한국사' },
  { lane: '중국', id: 'china', label: '중국사' },
  { lane: '일본', id: 'japan', label: '일본사' },
  { lane: '서양', id: 'west',  label: '유럽사·미국사' },
  { lane: '세계', id: 'world', label: '그 밖의 세계' },
];

/* 연도 단서가 왕조 이름뿐일 때의 대략값 */
const ERA_YEAR = {
  '고조선': -400, '고구려': 400, '백제': 450, '신라': 550, '통일신라': 750, '고려': 1100,
  '조선': 1550, '조선 전기': 1450, '조선 중·후기': 1700, '개항기': 1880, '대한제국': 1900, '일제강점기': 1930,
};

function _yearInText(txt) {
  let m = txt.match(/(BC|기원전)\s*(\d{1,2})\s*세기/);
  if (m) return -(Number(m[2]) * 100 - 50);
  m = txt.match(/(BC|기원전)\s*(\d+)/);
  if (m) return -Number(m[2]);
  m = txt.match(/(\d{1,2})\s*세기/);
  if (m && !/\d{3,4}/.test(txt)) return (Number(m[1]) - 1) * 100 + 50;
  m = txt.match(/(\d{1,4})/);
  return m ? Number(m[1]) : null;
}

/** 편의 연도 — 제목 끝 괄호 → period → 왕조 대략값. 못 찾으면 null */
function yearOf(item) {
  const title = String(item?.title || ''), period = String(item?.period || '');
  const paren = [...title.matchAll(/\(([^()]*\d[^()]*)\)/g)].pop();
  let y = paren ? _yearInText(paren[1]) : null;
  if (y === null && period) y = _yearInText(period);
  if (y === null && period) {
    const key = Object.keys(ERA_YEAR).filter(k => period.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    if (key) y = ERA_YEAR[key];
  }
  return y;
}

const _byYear = (ids, facts) => ids
  .map((id, i) => ({ id, i, y: yearOf(facts[id]) ?? Infinity }))
  .sort((a, b) => a.y - b.y || a.i - b.i)
  .map(o => o.id);
const _span = (ids, facts) => {
  const ys = ids.map(id => yearOf(facts[id])).filter(y => y !== null);
  return ys.length ? [Math.min(...ys), Math.max(...ys)] : [0, 0];
};

/**
 * 갈래의 단계들 — 시작 연도순(같으면 연재 먼저), 미배치 편이 있으면 맨 끝에 '아직 묶지 않은 이야기'.
 * @returns {{kind:'series'|'era'|'etc', id:string, title:string, sub:string, desc:string, years:[number,number], itemIds:string[]}[]}
 */
function laneStages(lane, { series = [], themes = [], courses = {}, facts = {}, unplaced = [] }) {
  const out = [];
  series.filter(s => s.lane === lane).forEach(s => {
    const itemIds = s.items.filter(id => facts[id]);   // 연재는 연재 순서 그대로
    if (!itemIds.length) return;
    out.push({ kind: 'series', id: `c:${s.id}`, title: s.title, sub: courses[s.id]?.sub || '', desc: courses[s.id]?.desc || '',
               years: _span(itemIds, facts), itemIds });
  });
  themes.filter(t => t.lane === lane).forEach(t => {
    const itemIds = _byYear(t.items.filter(id => facts[id]), facts);
    if (!itemIds.length) return;
    out.push({ kind: 'era', id: `h:${t.id}`, title: t.label, sub: t.sub || '', desc: '', years: [t.years[0], t.years[1]], itemIds });
  });
  out.sort((a, b) => a.years[0] - b.years[0] || (a.kind === 'series' ? -1 : 1) - (b.kind === 'series' ? -1 : 1));
  if (unplaced.length) {
    const itemIds = _byYear(unplaced, facts);
    out.push({ kind: 'etc', id: `h:${lane}-etc`, title: '아직 묶지 않은 이야기', sub: '분류표에 아직 없는 편', desc: '',
               years: _span(itemIds, facts), itemIds });
  }
  return out;
}

/** 기업 이야기(경제 분야) 단계 — id 'b:<id>', 편은 연도순 */
function businessStages(business = [], facts = {}) {
  return business.map(t => ({ kind: 'business', id: `b:${t.id}`, title: t.label, sub: t.sub || '', desc: '',
    years: [t.years[0], t.years[1]], itemIds: _byYear(t.items.filter(id => facts[id]), facts) }))
    .filter(s => s.itemIds.length);
}

/** 고른 단계에서 isOpen인 첫 편 → 없으면 같은 갈래 뒤 단계들에서 차례로. 끝까지 없으면 null */
function nextThemeItem(stages, stageId, isOpen) {
  const from = stages.findIndex(s => s.id === stageId);
  if (from < 0) return null;
  for (const stage of stages.slice(from)) {
    const id = stage.itemIds.find(isOpen);
    if (id) return { stage, id };
  }
  return null;
}

/** {id: 받은 날} 에 aliases({예전 글: 원래 글})를 접는다 — 원래 글은 둘 중 더 이른 날. 새 객체를 돌려준다 */
function foldAliases(got, aliases = {}) {
  const out = { ...got };
  for (const [old, main] of Object.entries(aliases)) {
    if (!out[old]) continue;
    if (!out[main] || out[old] < out[main]) out[main] = out[old];
  }
  return out;
}

/** 분류표에 없는 편의 기본 갈래 */
const laneOfItem = item => (item?.era === '한국사' ? '한국' : '서양');

module.exports = { LANES, yearOf, laneStages, businessStages, nextThemeItem, foldAliases, laneOfItem };
