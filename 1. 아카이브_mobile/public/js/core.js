/**
 * core.js — SJ 서재 모바일 앱 공통 기반
 * ────────────────────────────────────────────
 * 역할: 전역 상수 · 공통 유틸 · 전역 상태(state) · 뷰 설정 · Mob 네임스페이스 선언
 * 로드 순서: ① core.js → ② app_mobile.js(Mob 메서드) → ③ app_exam.js(ExamMob) → ④ pwa.js
 * 모든 도메인 파일은 여기서 선언한 전역(DOMAINS·state·el·fetchJSON 등)과 Mob 객체에 의존한다.
 */

'use strict';

/* ──────────────────────────────────────────────
   Layer 1: 8대 지식 도메인 (서버와 동기)
────────────────────────────────────────────── */
const DOMAINS = {
  business:   { label: '비즈니스·경제', icon: '📈', color: '#10b981' },
  language:   { label: '언어·표현',     icon: '🌐', color: '#3b82f6' },
  humanities: { label: '역사·문명',     icon: '📜', color: '#8b5cf6' },
  psychology: { label: '심리·철학',     icon: '🧠', color: '#ec4899' },
  science:    { label: '과학·기술',     icon: '🔬', color: '#06b6d4' },
  arts:       { label: '문화·예술',     icon: '🎨', color: '#f59e0b' },
  life:       { label: '건강·라이프',   icon: '⚕️', color: '#84cc16' },
  society:    { label: '사회·정치',     icon: '🌍', color: '#f97316' },
};
const CATEGORY_TO_DOMAIN = {
  en:'language', zh:'language', history:'humanities',
  economy:'business', youtube:'business', inbox:'business',
  psychology:'psychology', science:'science', arts:'arts',
  life:'life', society:'society',
};
function getItemDomain(item) {
  if (item.domain && DOMAINS[item.domain]) return item.domain;
  return CATEGORY_TO_DOMAIN[item.category] || 'business';
}

/* ──────────────────────────────────────────────
   유틸 (전역 허용: el·toast·fmt·fmtFull·dayLabel·fetchJSON·parseFeedsArray·toLocalDateStr)
────────────────────────────────────────────── */
const el = id => document.getElementById(id);

function toast(msg, type = '', dur = 3000) {
  const t = el('mobToast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'mob-toast' + (type ? ' ' + type : '');
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, dur);
}

function fmt(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

function fmtFull(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
}

function dayLabel(d) {
  return ['일','월','화','수','목','금','토'][d.getDay()];
}

/* fetch + AbortController 헬퍼 */
async function fetchJSON(url, options = {}, timeoutMs = 25000) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, ...options });
    clearTimeout(timer);
    if (!res.ok) {
      /* 서버가 보낸 error 메시지를 살려서 유저에게 전달 */
      let serverMsg = '';
      try { serverMsg = (await res.json())?.error || ''; } catch {}
      throw new Error(serverMsg || `HTTP ${res.status}`);
    }
    return await res.json();
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

function parseFeedsArray(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') return Object.values(data);
  return [];
}

/* 로컬 타임존 기준 YYYY-MM-DD (toISOString은 UTC라 한국 새벽에 하루 어긋남) */
function toLocalDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* ──────────────────────────────────────────────
   배달 피드 칩 라벨 맵 (subId → 표시 정보)
────────────────────────────────────────────── */
const FEED_CHIP_MAP = {
  en_expr    : { icon: '🗽', label: 'English',   color: '#4f46e5' },
  zh_expr    : { icon: '🐉', label: '중국어',     color: '#b45309' },
  us_market  : { icon: '📈',  label: '미국 시황', color: '#059669' },
  kr_market  : { icon: '📊',  label: '한국 시황', color: '#0891b2' },
  hist_daily : { icon: '🏛️',  label: '역사',      color: '#92400e' },
  quote_daily: { icon: '💡',  label: '명언',      color: '#7c3aed' },
  idiom_daily: { icon: '📜',  label: '고사성어',  color: '#c2410c' },
};

/* ──────────────────────────────────────────────
   전역 상태 — 모든 앱 상태는 이 객체에만 저장
────────────────────────────────────────────── */
const state = {
  currentView      : 'home',
  currentCat       : 'all',
  items            : [],
  searchDebounce   : null,
  selectedImageFile: null,
  feedLoaded       : false,
  feedItems        : [],
  examDaily        : null,   /* 수험생 모드 오늘의 배달(영어단어+한국사) */
  activeFeedFilter : 'all',
  pendingFeedFilter: null,
  libraryLoaded    : false,
  libraryAIOpen    : false,
  libraryItems     : [],
  libraryFilter    : 'all',
  quiz: {
    items   : [],
    current : 0,
    score   : 0,
    answered: [],
    cat     : 'all',
  },
};

/* ──────────────────────────────────────────────
   VIEW CONFIG — 신규 뷰는 여기 등록
────────────────────────────────────────────── */
const VIEW_CONFIG = {
  home:    { el:'viewHome',    tabsVisible:true,  title:'아카이브',   showHeaderActions:true  },
  feed:    { el:'viewFeed',    tabsVisible:false, title:'지식 배달',  showHeaderActions:false },
  summary: { el:'viewSummary', tabsVisible:false, title:'내 서재',   showHeaderActions:false },
  manage:  { el:'viewManage',  tabsVisible:false, title:'학습 관리', showHeaderActions:false },
  quiz:    { el:'viewQuiz',    tabsVisible:false, title:'AI 퀴즈',   showHeaderActions:false },
};

/* ══════════════════════════════════════════════
   Mob 네임스페이스 — 메서드 본체는 app_mobile.js 등
   도메인 파일에서 Object.assign(Mob, {…})으로 채운다.
══════════════════════════════════════════════ */
const Mob = {};
