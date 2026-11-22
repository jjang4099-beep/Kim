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
