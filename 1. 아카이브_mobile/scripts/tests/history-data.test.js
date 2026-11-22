/* 역사 연표 지도 — 분류표·큰 사건 데이터 검증 (node --test). 서버를 띄우지 않고 data 파일만 읽는다. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', '..', 'public', 'data');
const readJSON = p => JSON.parse(fs.readFileSync(path.join(DATA, p), 'utf8'));
const LANES = ['한국', '중국', '일본', '서양', '세계'];

function historyFactIds() {
  const ids = new Set();
  for (const f of fs.readdirSync(path.join(DATA, 'knowledge_db')).filter(f => f.endsWith('.json'))) {
    const d = readJSON(path.join('knowledge_db', f));
    (d.history_facts || []).forEach(h => ids.add(h.id));
  }
  return ids;
}
function seriesItemIds() {
  const ids = new Set();
  for (const f of fs.readdirSync(path.join(DATA, 'deep_layers')).filter(f => f.endsWith('.json'))) {
    (readJSON(path.join('deep_layers', f)).series || []).forEach(s => s.items.forEach(id => ids.add(id)));
  }
  return ids;
}
const themesFile = () => readJSON(path.join('course_db', 'history_themes.json'));
const allThemes = () => { const t = themesFile(); return [...(t.themes || []), ...(t.business || [])]; };
const placedIds = () => allThemes().flatMap(t => t.items);

test('분류표 테마 id는 겹치지 않는다', () => {
  const ids = allThemes().map(t => t.id);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), []);
});

test('편은 분류표 안에서 한 번만 나온다', () => {
  const ids = placedIds();
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), []);
});

test('연재 편은 분류표에 들어가지 않는다', () => {
  const series = seriesItemIds();
  assert.deepEqual(placedIds().filter(id => series.has(id)), []);
});

test('분류표의 편은 모두 실제 역사 편이다', () => {
  const facts = historyFactIds();
  assert.deepEqual(placedIds().filter(id => !facts.has(id)), []);
});

test('lane과 기간이 올바르다', () => {
  for (const t of themesFile().themes) {
    assert.ok(LANES.includes(t.lane), `${t.id} lane=${t.lane}`);
    assert.ok(t.label && t.sub, `${t.id} 이름·부제`);
    const [a, b] = t.years;
    assert.ok(Number.isInteger(a) && Number.isInteger(b) && a <= b, `${t.id} years=${t.years}`);
    assert.ok(t.items.length > 0, `${t.id} 편 없음`);
  }
});

const backbone = () => readJSON(path.join('course_db', 'history_backbone.json')).events;

test('큰 사건은 lane·연도·이름이 있고 id가 겹치지 않는다', () => {
  const ev = backbone();
  assert.ok(ev.length >= 120, `큰 사건 ${ev.length}개`);
  for (const e of ev) {
    assert.ok(LANES.includes(e.lane), `${e.id} lane=${e.lane}`);
    assert.ok(Number.isInteger(e.year), `${e.id} year=${e.year}`);
    assert.ok(e.title && e.title.trim(), `${e.id} 이름 없음`);
  }
  const ids = ev.map(e => e.id);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), []);
});

test('일본 큰 사건이 있다', () => {
  assert.ok(backbone().filter(e => e.lane === '일본').length >= 10);
});

const aliases = () => themesFile().aliases || {};

test('같은 주제 합치기: 예전 글은 실제 역사 편이고, 원래 글은 지도에 있는 편이다', () => {
  const facts = historyFactIds(), series = seriesItemIds(), placed = new Set(placedIds());
  const a = aliases();
  assert.ok(Object.keys(a).length > 0, 'aliases 없음');
  for (const [old, main] of Object.entries(a)) {
    assert.ok(facts.has(old), `${old} 없는 편`);
    assert.ok(!placed.has(old) && !series.has(old), `${old}는 이미 테마·연재에 있음`);
    assert.ok(placed.has(main) || series.has(main), `${old} → ${main}: 원래 글이 지도에 없음`);
  }
});

test('역사 편은 전부 연재·시대 테마·기업 이야기·같은 주제 합치기 중 한 곳에 있다', () => {
  const where = new Set([...seriesItemIds(), ...placedIds(), ...Object.keys(aliases())]);
  assert.deepEqual([...historyFactIds()].filter(id => !where.has(id)), []);
});
