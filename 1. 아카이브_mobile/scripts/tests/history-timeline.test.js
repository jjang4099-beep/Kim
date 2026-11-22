/* 역사 연표 지도 — public/lib/historyTimeline.js 순수 함수 검증 (node --test). 실제 data 파일로 조립해 본다. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const HT = require('../../public/lib/historyTimeline');

const DATA = path.join(__dirname, '..', '..', 'public', 'data');
const readJSON = p => JSON.parse(fs.readFileSync(path.join(DATA, p), 'utf8'));
const facts = {};
for (const f of fs.readdirSync(path.join(DATA, 'knowledge_db')).filter(f => f.endsWith('.json'))) {
  (readJSON(path.join('knowledge_db', f)).history_facts || []).forEach(h => { facts[h.id] = h; });
}
const series = fs.readdirSync(path.join(DATA, 'deep_layers')).filter(f => f.endsWith('.json')).sort()
  .flatMap(f => readJSON(path.join('deep_layers', f)).series || []);
const themesFile = readJSON(path.join('course_db', 'history_themes.json'));
const courses = readJSON(path.join('course_db', 'catalog.json')).courses;
const ctx = (extra = {}) => ({ series, themes: themesFile.themes, courses, facts, ...extra });

test('yearOf: 제목 끝 괄호의 기원전 연도', () => {
  assert.equal(HT.yearOf({ title: '로마 공화정의 탄생 — 권력을 나누면 오래 간다 (BC 509)' }), -509);
});
test('yearOf: 기원전 N세기는 그 세기의 가운데', () => {
  assert.equal(HT.yearOf({ title: '고조선의 8조법 — 남은 세 조항이 말해주는 것 (기원전 4세기 이전)' }), -350);
});
test('yearOf: 제목 안의 다른 숫자가 아니라 괄호 속 연도', () => {
  assert.equal(HT.yearOf({ title: '문익점과 목화 — 붓두껍 이야기보다 중요했던 3년 (1364년)' }), 1364);
});
test('yearOf: 연도가 없으면 왕조 대략값', () => {
  assert.equal(HT.yearOf({ title: '벽란도 — 아라비아 상인이 드나들던 고려의 국제항', period: '고려' }), 1100);
});
test('yearOf: 아무 단서도 없으면 null', () => {
  assert.equal(HT.yearOf({ title: 'x', period: '' }), null);
});

test('laneStages: 한국 갈래는 시작 연도순 — 고조선과 삼국의 사람들 → 삼국시대 → 통일신라', () => {
  const st = HT.laneStages('한국', ctx());
  assert.equal(st[0].id, 'h:kr-early');
  assert.ok(st.findIndex(s => s.id === 'c:samguk') < st.findIndex(s => s.id === 'h:kr-silla'));
  for (let i = 1; i < st.length; i++) assert.ok(st[i - 1].years[0] <= st[i].years[0], `${st[i - 1].id} > ${st[i].id}`);
});
test('laneStages: 연재는 c:, 시대 테마는 h:, 이름·부제·기간이 붙는다', () => {
  const st = HT.laneStages('한국', ctx());
  const s = st.find(x => x.id === 'c:samguk'), h = st.find(x => x.id === 'h:kr-imjin');
  assert.equal(s.kind, 'series'); assert.equal(s.title, '삼국시대'); assert.equal(s.sub, '을지문덕 · 김춘추');
  assert.equal(h.kind, 'era'); assert.equal(h.title, '임진왜란과 그 시대'); assert.deepEqual(h.years, [1589, 1598]);
});
test('laneStages: 시대 테마의 편은 연도순', () => {
  const h = HT.laneStages('한국', ctx()).find(x => x.id === 'h:kr-early');
  const ys = h.itemIds.map(id => HT.yearOf(facts[id]));
  assert.deepEqual(ys, [...ys].sort((a, b) => a - b));
});
test('laneStages: 미배치 편은 갈래 끝의 아직 묶지 않은 이야기로', () => {
  const st = HT.laneStages('한국', ctx({ unplaced: ['HI_X'] }));
  const last = st[st.length - 1];
  assert.equal(last.kind, 'etc'); assert.equal(last.id, 'h:한국-etc'); assert.equal(last.title, '아직 묶지 않은 이야기');
  assert.deepEqual(last.itemIds, ['HI_X']);
});
test('laneStages: 그 밖의 세계 갈래도 조립된다', () => {
  assert.ok(HT.laneStages('세계', ctx()).some(s => s.id === 'h:world-islam'));
});

test('businessStages: 기업 이야기 테마는 b: 단계', () => {
  const st = HT.businessStages(themesFile.business, facts);
  assert.equal(st[0].id, 'b:biz-merchants'); assert.equal(st[0].kind, 'business');
});

test('nextThemeItem: 고른 단계의 첫 열린 편', () => {
  const st = HT.laneStages('한국', ctx());
  const imjin = st.find(s => s.id === 'h:kr-imjin');
  assert.deepEqual(HT.nextThemeItem(st, 'h:kr-imjin', () => true), { stage: imjin, id: imjin.itemIds[0] });
});
test('nextThemeItem: 그 단계를 다 받았으면 같은 갈래 다음 단계로', () => {
  const st = HT.laneStages('한국', ctx());
  const imjin = st.find(s => s.id === 'h:kr-imjin'), i = st.indexOf(imjin), nxt = st[i + 1];
  const r = HT.nextThemeItem(st, 'h:kr-imjin', id => !imjin.itemIds.includes(id));
  assert.equal(r.stage.id, nxt.id); assert.equal(r.id, nxt.itemIds[0]);
});
test('nextThemeItem: 끝까지 열린 편이 없으면 null', () => {
  assert.equal(HT.nextThemeItem(HT.laneStages('한국', ctx()), 'h:kr-imjin', () => false), null);
});

test('foldAliases: 예전 글을 받은 날이 원래 글에 합쳐진다(더 이른 날)', () => {
  const got = HT.foldAliases({ HI_034: '2026-09-01', HI_130: '2026-10-01', HI_047: '2026-08-15' }, { HI_034: 'HI_130', HI_047: 'HI_130' });
  assert.equal(got.HI_130, '2026-08-15');
});
test('foldAliases: 원래 글을 안 받았어도 예전 글을 받았으면 받음', () => {
  assert.equal(HT.foldAliases({ HI_058: '2026-09-01' }, { HI_058: 'HI_142' }).HI_142, '2026-09-01');
});

test('laneOfItem: 한국사는 한국, 나머지는 서양', () => {
  assert.equal(HT.laneOfItem({ era: '한국사' }), '한국');
  assert.equal(HT.laneOfItem({ era: '세계사' }), '서양');
});
test('LANES: 다섯 갈래와 기본 이름', () => {
  assert.deepEqual(HT.LANES.map(l => l.lane), ['한국', '중국', '일본', '서양', '세계']);
  assert.equal(HT.LANES.find(l => l.lane === '세계').label, '그 밖의 세계');
});
