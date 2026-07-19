'use strict';
/* ══════════════════════════════════════════════════
   8대 지식 도메인 온톨로지 + 모드(직장인/수험생) 정규화
   server.js와 db/items.js가 공통으로 사용 (server.js에서 이관)
══════════════════════════════════════════════════ */

const DOMAINS = {
  business:   { label: '비즈니스·경제', icon: '📈' },
  language:   { label: '언어·표현',     icon: '🌐' },
  humanities: { label: '역사·문명',     icon: '📜' },
  psychology: { label: '심리·철학',     icon: '🧠' },
  science:    { label: '과학·기술',     icon: '🔬' },
  arts:       { label: '문화·예술',     icon: '🎨' },
  life:       { label: '건강·라이프',   icon: '⚕️' },
  society:    { label: '사회·정치',     icon: '🌍' },
};

// 구형 category → domain 매핑 (마이그레이션 + 호환성)
const CATEGORY_TO_DOMAIN = {
  en:        'language',
  zh:        'language',
  history:   'humanities',
  economy:   'business',
  youtube:   'business',
  inbox:     'business',
  psychology:'psychology',
  science:   'science',
  arts:      'arts',
  life:      'life',
  society:   'society',
};

function getDomain(item) {
  if (item.domain && DOMAINS[item.domain]) return item.domain;
  return CATEGORY_TO_DOMAIN[item.category] || 'business';
}

/* ══════════════════════════════════════════════════════════
   모드 격리(Isolation) — 'EXAM_PREP'(수험생) | 'PROFESSIONAL'(직장인)
   클라이언트는 'exam'/'work'로 보냄 → 정규화하여 DB에 적재/조회
══════════════════════════════════════════════════════════ */
const MODE_EXAM = 'EXAM_PREP';
const MODE_PRO  = 'PROFESSIONAL';

/** 클라이언트 모드값('exam'/'work'/'EXAM_PREP'/'PROFESSIONAL')을 표준 ENUM으로 정규화 */
function normalizeMode(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'exam' || v === 'exam_prep' || v === 'student') return MODE_EXAM;
  return MODE_PRO;   // 기본/직장인
}

/** 아이템 콘텐츠로 모드를 추론 (기존 데이터 백필·fallback용) */
function deriveItemMode(item) {
  if (item && item.mode) return normalizeMode(item.mode);
  const isExam = item && (
    item.domain === 'exam' ||
    item.category === 'exam' ||
    item.type === 'wrong_answer' ||
    !!item.wrongAnswer
  );
  return isExam ? MODE_EXAM : MODE_PRO;
}

module.exports = { DOMAINS, CATEGORY_TO_DOMAIN, getDomain, MODE_EXAM, MODE_PRO, normalizeMode, deriveItemMode };
