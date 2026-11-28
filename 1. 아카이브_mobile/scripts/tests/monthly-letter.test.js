/* 월간 편지 — public/lib/monthlyLetter.js 순수 함수 검증 (node --test) */
const test = require('node:test');
const assert = require('node:assert/strict');
const ML = require('../../public/lib/monthlyLetter');

const items = [
  { id: 'a', date: '2026-11-03', contentType: 'life', text: '경주 여행, 첨성대 앞에서', life: { location: '경주', photos: ['/uploads/a.jpg'] } },
  { id: 'b', date: '2026-11-10', title: '서희의 담판', feedData: { item_id: 'HI_242' }, myInsight: '말로 땅을 얻는 힘이 무섭다' },
  { id: 'c', date: '2026-11-12', title: '자동', feedData: { item_id: 'HI_1' }, myInsight: '[AI 요약] 자동 문구' },
  { id: 'd', date: '2026-11-20', title: '회의 표현', feedData: { pack_id: 'p1' }, myInsight: '내일 회의에서 써 보자' },
  { id: 'e', date: '2026-11-25', title: '사진만', contentType: 'life', life: { photos: [] } },
  { id: 'f', date: '2026-10-30', title: '지난달', myInsight: '지난달 생각' },
];
const got = { HI_242: '2026-11-10', HI_243: '2026-11-11', HI_244: '2026-11-12', p1: '2026-11-20', HI_100: '2026-10-01' };
const STAGE = { HI_242: ['역사', '한국사', '고려, 북방과 맞서다'], HI_243: ['역사', '한국사', '고려, 북방과 맞서다'], HI_244: ['역사', '한국사', '고려의 끝, 조선의 시작'], p1: ['영어', '비즈니스 영어', '회의'] };
const stageOf = id => (STAGE[id] ? { cat: STAGE[id][0], theme: STAGE[id][1], stage: STAGE[id][2] } : null);
const facts = () => ML.letterFacts({ ym: '2026-11', items, got, stageOf });

test('그달 기록만 센다 — 기록한 날·서재에 담은 것', () => {
  const f = facts();
  assert.equal(f.days, 5); assert.equal(f.saved, 3);
});
test('받은 지식과 영어는 그달 받은 것만', () => {
  const f = facts();
  assert.equal(f.received, 4); assert.equal(f.english, 1);
});
test('생각 인용은 자동 문구를 빼고 최대 3개', () => {
  const q = facts().quotes;
  assert.deepEqual(q.map(x => x.text), ['내일 회의에서 써 보자', '말로 땅을 얻는 힘이 무섭다']);
  assert.equal(facts().thoughts, 2);
});
test('걸어온 길은 단계별 받은 편 수 내림차순', () => {
  assert.deepEqual(facts().path[0], { cat: '역사', theme: '한국사', stage: '고려, 북방과 맞서다', count: 2 });
});
test('장면은 글이나 사진이 있는 일상 기록, 표지는 첫 사진', () => {
  const f = facts();
  assert.equal(f.scenes.length, 1); assert.equal(f.scenes[0].location, '경주'); assert.equal(f.cover, '/uploads/a.jpg');
});
test('분기: 석 달을 묶어 센다', () => {
  const f = ML.letterFacts({ period: '2026-Q4', items, got, stageOf });
  assert.equal(f.label, '2026년 4분기'); assert.equal(f.days, 6); assert.equal(f.received, 5);
});
test('분기: 기간 밖 기록은 빠진다', () => {
  assert.equal(ML.letterFacts({ period: '2026-Q3', items, got, stageOf }).thin, true);
});
test('periodMonths: 분기와 달', () => {
  assert.deepEqual(ML.periodMonths('2026-Q4'), ['2026-10', '2026-11', '2026-12']);
  assert.deepEqual(ML.periodMonths('2026-11'), ['2026-11']);
});
test('프롬프트는 존댓말을 요구한다', () => {
  assert.match(ML.letterPrompt(facts()).system, /존댓말/);
});
test('빈 달은 thin', () => {
  const f = ML.letterFacts({ ym: '2026-09', items, got, stageOf });
  assert.equal(f.thin, true); assert.equal(f.label, '2026년 9월');
});
test('대체 편지는 실제 숫자를 말한다', () => {
  const r = ML.fallbackLetter(facts());
  assert.ok(r.title.length > 0); assert.match(r.letter, /5일/); assert.match(r.letter, /4편/);
});
test('대체 편지: 빈 달도 꾸짖지 않는 짧은 편지', () => {
  const r = ML.fallbackLetter(ML.letterFacts({ ym: '2026-09', items, got, stageOf }));
  assert.ok(r.letter.length > 0); assert.doesNotMatch(r.letter, /못했|부족/);
});
test('parseLetter: 첫 줄은 제목, 나머지는 편지', () => {
  assert.deepEqual(ML.parseLetter('경주에서 고려까지\n\n이번 달 당신은…'), { title: '경주에서 고려까지', letter: '이번 달 당신은…' });
});
test('프롬프트에는 실제 기록만 들어간다', () => {
  const { system, user } = ML.letterPrompt(facts());
  assert.match(system, /지어내지/); assert.match(user, /말로 땅을 얻는 힘이 무섭다/); assert.doesNotMatch(user, /지난달 생각/);
});
test('지문은 기록이 바뀌면 달라진다', () => {
  const a = ML.fingerprint(facts());
  const b = ML.fingerprint(ML.letterFacts({ ym: '2026-11', items: items.slice(1), got, stageOf }));
  assert.notEqual(a, b);
});
