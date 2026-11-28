/**
 * 목표형 영어(11-28) — 내 목표에 맞춘 매일 묶음: 읽기 글(핵심 표현 굵게)·한국어 요약·말하기 표현 5개·쓰기 과제.
 * 듣기는 앱이 브라우저 음성 읽기로 들려준다. 설계: docs/superpowers/specs/2026-11-28-english-goal-design.md
 * 테스트: scripts/tests/english-daily.test.js
 */

/* 답변 수준 — 사용자가 고른다. price = 월 추가 금액(원), 결제는 다음 단계(지금은 모두 무료 체험) */
const TIERS = {
  basic:    { model: 'claude-haiku-5-5',  label: '기본',     price: 0,    note: '무료로도 쓸 만한 글' },
  standard: { model: 'claude-sonnet-5-5', label: '표준',     price: 1900, note: '자연스러운 글과 예문(추천)' },
  premium:  { model: 'claude-opus-5-5',   label: '프리미엄', price: 3900, note: '가장 섬세한 글맛과 설명' },
};
const LEVELS = { beginner: '초급', intermediate: '중급', advanced: '고급' };

/** 목표 입력 검사 — { ok, goal:{text, level, tier} } 또는 { ok:false, error } */
function validateGoal(input = {}) {
  const text = String(input.goal || '').replace(/\s+/g, ' ').trim();
  if (!text) return { ok: false, error: '목표를 한 줄로 적어 주세요' };
  if (text.length > 300) return { ok: false, error: '목표는 300자 안으로 적어 주세요' };
  const level = LEVELS[input.level] ? input.level : 'intermediate';
  const tier = TIERS[input.tier] ? input.tier : 'basic';
  return { ok: true, goal: { text, level, tier } };
}

/** 매일 묶음 프롬프트 — recent = 최근 묶음 제목(겹치지 않게) */
function dailyPrompt({ goal, date, recent = [] }) {
  const system = '너는 한국인 직장인의 영어 코치다. 학습자가 직접 적은 영어 목표에 맞춰 오늘 하루치 학습 묶음을 만든다. ' +
    '읽기 글은 학습자의 목표 상황에서 실제로 쓰일 법한 자연스러운 영어로, 그 상황을 머릿속에 그려 볼 수 있게 쓴다. ' +
    '말하기 표현은 읽기 글에 실제로 나온 표현에서 고르고, 글 안에서는 **굵게** 표시한다. ' +
    '설명(뜻·팁·요약·쓰기 과제)은 한국어 존댓말로 쓴다. ' +
    '반드시 JSON 객체 하나만 출력한다(앞뒤 설명·마크다운 금지). 형식: ' +
    '{"title": 영어 제목, "reading": 영어 읽기 글(180~250단어, 핵심 표현 5개를 **굵게**), "summaryKo": 한국어 요약 2문장, ' +
    '"expressions": [{"en": 표현, "ko": 뜻, "example": 내 목표 상황의 영어 예문, "tip": 한국어 한 줄 팁(언제·어떻게 쓰는지)} ×5], ' +
    '"writing": {"prompt": 오늘 표현을 써 보는 한국어 쓰기 과제(2~3문장 분량)}}';
  const user = [
    `날짜: ${date}`,
    `학습자의 목표: ${goal.text}`,
    `수준: ${goal.level} (${LEVELS[goal.level] || '중급'}) — 단어와 문장 길이를 이 수준에 맞춘다.`,
    recent.length ? `최근에 다룬 주제(겹치지 않게): ${recent.join(' / ')}` : '',
  ].filter(Boolean).join('\n');
  return { system, user };
}

/** 모델 출력 → 묶음. 형식이 틀리면 오류를 던진다 */
function parseDaily(raw) {
  const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s < 0 || e < s) throw new Error('묶음 형식이 아니에요');
  const d = JSON.parse(text.slice(s, e + 1));
  if (!d.reading || !String(d.reading).trim()) throw new Error('읽기 글이 비었어요');
  const ex = Array.isArray(d.expressions) ? d.expressions.filter(x => x && x.en && x.ko) : [];
  if (ex.length < 5) throw new Error('표현이 다섯 개가 안 돼요');
  return {
    title: String(d.title || '').trim(),
    reading: String(d.reading).trim(),
    summaryKo: String(d.summaryKo || '').trim(),
    expressions: ex.slice(0, 5).map(x => ({ en: String(x.en), ko: String(x.ko), example: String(x.example || ''), tip: String(x.tip || '') })),
    writing: { prompt: String(d.writing?.prompt || '').trim() },
  };
}

module.exports = { TIERS, LEVELS, validateGoal, dailyPrompt, parseDaily };
