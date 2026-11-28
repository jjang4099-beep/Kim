/* 목표형 영어 — public/lib/englishDaily.js 순수 함수 검증 (node --test) */
const test = require('node:test');
const assert = require('node:assert/strict');
const ED = require('../../public/lib/englishDaily');

test('수준 3단계와 모델', () => {
  assert.deepEqual(Object.keys(ED.TIERS), ['basic', 'standard', 'premium']);
  assert.equal(ED.TIERS.basic.model, 'claude-haiku-5-5');
  assert.equal(ED.TIERS.standard.model, 'claude-sonnet-5-5');
  assert.equal(ED.TIERS.premium.model, 'claude-opus-5-5');
  assert.equal(ED.TIERS.basic.price, 0);
});
test('목표 검사: 비었으면 오류', () => {
  assert.equal(ED.validateGoal({ goal: '  ' }).ok, false);
});
test('목표 검사: 너무 길면 오류', () => {
  assert.equal(ED.validateGoal({ goal: 'a'.repeat(301) }).ok, false);
});
test('목표 검사: 수준·답변 수준 기본값', () => {
  const r = ED.validateGoal({ goal: '1월 싱가포르 고객 미팅에서 제품 소개하기' });
  assert.equal(r.ok, true); assert.equal(r.goal.level, 'intermediate'); assert.equal(r.goal.tier, 'basic');
});
test('목표 검사: 모르는 값은 기본값으로', () => {
  const r = ED.validateGoal({ goal: '회의', level: 'x', tier: 'gold' });
  assert.equal(r.goal.level, 'intermediate'); assert.equal(r.goal.tier, 'basic');
});
test('프롬프트: 목표·수준·피할 주제가 들어간다', () => {
  const { system, user } = ED.dailyPrompt({ goal: { text: '영어 회의에서 의견 말하기', level: 'advanced' }, date: '2026-11-28', recent: ['Disagreeing politely'] });
  assert.match(user, /영어 회의에서 의견 말하기/); assert.match(user, /advanced|고급/); assert.match(user, /Disagreeing politely/);
  assert.match(system, /JSON/);
});
const good = { title: 'Speaking Up in Meetings', reading: 'When you **chime in** early, people listen.', summaryKo: '일찍 말하면 사람들이 듣는다.',
  expressions: Array.from({ length: 5 }, (_, i) => ({ en: `expr ${i}`, ko: `뜻 ${i}`, example: `ex ${i}`, tip: `tip ${i}` })),
  writing: { prompt: '다음 회의에서 할 첫 문장을 영어로 써 보세요.' } };
test('parseDaily: 올바른 JSON(코드 블록으로 감싸도)', () => {
  const p = ED.parseDaily('```json\n' + JSON.stringify(good) + '\n```');
  assert.equal(p.title, 'Speaking Up in Meetings'); assert.equal(p.expressions.length, 5); assert.equal(p.writing.prompt, good.writing.prompt);
});
test('parseDaily: 표현이 모자라면 오류', () => {
  assert.throws(() => ED.parseDaily(JSON.stringify({ ...good, expressions: good.expressions.slice(0, 2) })));
});
test('parseDaily: 읽기 글이 없으면 오류', () => {
  assert.throws(() => ED.parseDaily(JSON.stringify({ ...good, reading: '' })));
});
