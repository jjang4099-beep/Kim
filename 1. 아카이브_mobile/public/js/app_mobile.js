/**
 * SJ 서재 — app_mobile.js v26
 * 5-button SPA Bottom Nav
 * + 홈 날짜 섹션 분리 (오늘 / 지난 지식)
 * + Smart Empty View
 * + [요약] 탭 내 서재 지식 검색
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
   유틸
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
   상태
────────────────────────────────────────────── */
const state = {
  currentView      : 'home',
  currentCat       : 'all',
  items            : [],
  searchDebounce   : null,
  selectedImageFile: null,
  feedLoaded       : false,
  feedItems        : [],
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
   VIEW CONFIG
────────────────────────────────────────────── */
const VIEW_CONFIG = {
  home:    { el:'viewHome',    tabsVisible:true,  title:'아카이브',   showHeaderActions:true  },
  feed:    { el:'viewFeed',    tabsVisible:false, title:'지식 배달',  showHeaderActions:false },
  summary: { el:'viewSummary', tabsVisible:false, title:'내 서재',   showHeaderActions:false },
  manage:  { el:'viewManage',  tabsVisible:false, title:'학습 관리', showHeaderActions:false },
  quiz:    { el:'viewQuiz',    tabsVisible:false, title:'AI 퀴즈',   showHeaderActions:false },
};

/* ══════════════════════════════════════════════
   Mob 네임스페이스
══════════════════════════════════════════════ */
const Mob = {

  /* ────────────────────────────────────────────
     초기화
  ────────────────────────────────────────────── */
  init() {
    const mode = localStorage.getItem('userMode');
    if (!mode) return; // 앱 진입 화면이 모드 선택을 처리함
    this._applyMode(mode);
    this._loadHomeItems();
    this.checkFeedBadge();
    this._initTheme();
  },

  setMode(mode) {
    const prevMode = localStorage.getItem('userMode');
    localStorage.setItem('userMode', mode);
    /* 모드가 실제로 바뀌면 이전 모드 데이터를 전역 상태에서 완전 격리(초기화) */
    if (prevMode && prevMode !== mode) this._resetModeState();
    const entrance = el('appEntrance');
    const isVisible = entrance && entrance.style.display !== 'none';
    if (isVisible) {
      entrance.classList.add('app-entrance-out');
      setTimeout(() => {
        entrance.style.display = 'none';
        this._applyMode(mode);
        this._loadHomeItems();
        this.checkFeedBadge();
      }, 650);
    } else {
      this._applyMode(mode);
      this._loadHomeItems();
      this.checkFeedBadge();
      /* 현재 보고 있는 뷰가 홈이 아니면 그 뷰도 격리된 데이터로 즉시 갱신 */
      if (state.currentView === 'manage')  this._loadManageView();
      if (state.currentView === 'summary') this._loadLibraryView(true);
      if (state.currentView === 'feed')    this._loadFeedView(true);
    }
  },

  /** 현재 세션 모드를 서버 격리 ENUM으로 변환 ('exam'→EXAM_PREP, 그 외→PROFESSIONAL) */
  _modeEnum() {
    return localStorage.getItem('userMode') === 'exam' ? 'EXAM_PREP' : 'PROFESSIONAL';
  },

  /** 모드 전환 시 이전 모드의 흔적이 남지 않도록 전역 상태를 완전 초기화 */
  _resetModeState() {
    state.items         = [];
    state.feedItems     = [];
    state.feedLoaded    = false;
    state.libraryItems  = [];
    state.libraryLoaded = false;
    state.currentCat    = 'all';
    state.activeFeedFilter = 'all';
    const feed = el('mobFeed');
    if (feed) feed.innerHTML = '';
  },

  _applyMode(mode) {
    document.body.dataset.mode = mode;
    el('modeBtnExam')?.classList.toggle('active', mode === 'exam');
    el('modeBtnWork')?.classList.toggle('active', mode === 'work');
    if (mode === 'exam') {
      ExamMob.init();
      el('examHomeHeader')?.removeAttribute('hidden');
      el('examSubjectRow')?.removeAttribute('hidden');
      el('examDashboard')?.removeAttribute('hidden');
    } else {
      el('examHomeHeader')?.setAttribute('hidden', '');
      el('examSubjectRow')?.setAttribute('hidden', '');
      el('examDashboard')?.setAttribute('hidden', '');
    }
  },

  /* ══════════════════════════════════════════
     테마 환경설정 (라이트 Papyrus / 다크 Midnight)
  ══════════════════════════════════════════ */
  _initTheme() {
    const saved = localStorage.getItem('app-theme');
    if (saved === 'light' || saved === 'dark') {
      document.documentElement.setAttribute('data-theme', saved);
    }
    this._syncThemeButtons(saved);
  },

  _setTheme(theme, btn) {
    localStorage.setItem('app-theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    this._syncThemeButtons(theme);
    const lbl = el('themeActiveLabel');
    if (lbl) {
      lbl.textContent = theme === 'light'
        ? '☀️ 파피루스(Papyrus) 라이트 모드가 적용되었습니다.'
        : '🌙 미드나잇(Midnight) 다크 모드가 적용되었습니다.';
    }
  },

  _syncThemeButtons(theme) {
    document.querySelectorAll('#themeSegButtons .mvw-theme-seg-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.theme === theme);
    });
  },

  /* ══════════════════════════════════════════
     SPA 뷰 전환
  ══════════════════════════════════════════ */
  switchView(viewName, navBtn) {
    const config = VIEW_CONFIG[viewName];
    if (!config) return;

    document.querySelectorAll('.mob-view').forEach(v => v.classList.remove('active'));
    el(config.el)?.classList.add('active');

    document.body.classList.toggle('tabs-hidden', !config.tabsVisible);

    el('mobHeaderTitle').textContent = config.title;
    const actions = el('mobHeaderActions');
    if (actions) actions.hidden = !config.showHeaderActions;

    document.querySelectorAll('.mob-nav-btn').forEach(b => b.classList.remove('active'));
    navBtn?.classList.add('active');

    if (viewName === 'home')    this.renderFeed(state.items);
    if (viewName === 'feed')    this._loadFeedView();
    if (viewName === 'manage')  {
      this._loadManageView();
      const mode = document.body.dataset.mode;
      el('modeBtnExam')?.classList.toggle('active', mode === 'exam');
      el('modeBtnWork')?.classList.toggle('active', mode === 'work');
      if (mode === 'exam') {
        el('examDashboard')?.removeAttribute('hidden');
        ExamMob._loadWeaknessAnalysis();
        ExamMob._restoreExamSettings();
      } else {
        el('examDashboard')?.setAttribute('hidden', '');
      }
    }
    if (viewName === 'summary') {
      this._loadLibraryView();
      if (document.body.dataset.mode === 'exam') {
        el('libTypeTabs')?.removeAttribute('hidden');
      }
    }

    state.currentView = viewName;
  },

  /* ══════════════════════════════════════════
     홈 뷰 — 지식 피드
  ══════════════════════════════════════════ */
  async _loadHomeItems(cat) {
    const feed = el('mobFeed');
    const load = el('mobLoading');
    if (load) load.style.display = 'flex';

    const catParam = cat || state.currentCat;

    /* ① 아카이브 먼저 — 로딩 스피너 즉시 해제 (모드 격리 쿼리) */
    const modeParam = `mode=${this._modeEnum()}`;
    try {
      const domainParam = catParam && catParam !== 'all' ? `domain=${catParam}&` : '';
      const data = await fetchJSON(`/api/items?${domainParam}${modeParam}&limit=500`, {}, 20000);
      state.items = parseFeedsArray(data?.items ?? data);
      this.renderFeed(state.items);
    } catch (e) {
      if (feed) feed.innerHTML = `<div class="mob-loading" style="color:#ef4444">
        <i class="ti ti-alert-circle"></i> 불러오기 실패 — 새로고침 해주세요
      </div>`;
    } finally {
      if (load) load.style.display = 'none';
    }

    /* ② 배달 피드 미리보기 — 직장인(전문직) 모드 전용. 수험생 모드면 원천 배제 */
    if (this._modeEnum() === 'EXAM_PREP') { state.feedItems = []; return; }
    if (state.feedItems.length > 0) return;
    try {
      const status = await fetchJSON('/api/daily-feed/status', {}, 5000);
      if (!status?.allReady) return;   /* 미생성 상태면 스킵 — 배달탭에서 생성 */
      const data = await fetchJSON(`/api/daily-feed?${modeParam}`, {}, 20000);
      state.feedItems = parseFeedsArray(data?.feeds ?? data?.items ?? data);
      this.renderFeed(state.items);
    } catch {}
  },

  setTab(cat, btn) {
    state.currentCat = cat;
    document.querySelectorAll('.mob-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    this._loadHomeItems(cat);
  },

  /* ══════════════════════════════════════════
     홈 피드 렌더링 — 날짜 섹션 분리
  ══════════════════════════════════════════ */
  renderFeed(items) {
    const feed = el('mobFeed');
    const load = el('mobLoading');
    if (!feed) return;

    /* ── 전체 빈 상태 ── */
    if (!items || items.length === 0) {
      feed.innerHTML = `<div class="mob-loading">
        <i class="ti ti-mood-empty"></i>&nbsp;아직 지식이 없어요.&nbsp;
        ➕ 버튼을 눌러 첫 번째를 저장해 보세요!
      </div>`;
      if (load) feed.prepend(load);
      return;
    }

    /* ── 최신순 정렬 ── */
    const sorted = [...items].sort((a, b) =>
      new Date(b.createdAt) - new Date(a.createdAt)
    );

    /* ── 오늘 / 지난 지식 분리 ── */
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);

    /* daily_delivery는 배달 미리보기/배달탭에서만 표시 — 홈 today/past에서 제외 */
    const userItems = sorted.filter(i => i.type !== 'daily_delivery');

    const todayItems = userItems.filter(i => {
      const d = new Date(i.createdAt); d.setHours(0,0,0,0);
      return d.getTime() === todayMidnight.getTime();
    });
    const pastItems = userItems.filter(i => {
      const d = new Date(i.createdAt); d.setHours(0,0,0,0);
      return d.getTime() < todayMidnight.getTime();
    });

    let html = '';

    /* ── [오늘] 섹션 헤더 ── */
    const hasFeedPreview = state.feedItems && state.feedItems.length > 0;
    html += `
      <div class="mob-section-hd today">
        <span>오늘 배달된 지식</span>
        <span class="mob-section-badge">${todayItems.length + (hasFeedPreview ? state.feedItems.length : 0)}개</span>
      </div>`;

    /* ── 배달 피드 카테고리 미리보기 (1 per 구독, 클릭 시 배달탭 해당 필터로 이동) ── */
    if (hasFeedPreview) {
      /* subId 기준 중복 제거 — 카테고리별 딱 1개만 보장 */
      const seenSubs = new Set();
      const previews = state.feedItems.filter(item => {
        const key = item.subId || item.label || JSON.stringify(item).slice(0, 40);
        if (seenSubs.has(key)) return false;
        seenSubs.add(key);
        return true;
      });
      html += '<div class="mob-feed-preview-list">';
      previews.forEach(item => { html += this._cardFeedPreview(item); });
      html += '</div>';
    }

    if (todayItems.length === 0 && !hasFeedPreview) {
      /* ── Smart Empty View ── */
      html += `
        <div class="mob-today-empty" id="todayEmptyBox">
          <div class="mob-today-empty-text">
            오늘 배달된 새로운 지식이 아직 없습니다.<br>
            🎁 아래 지난 지식을 복습하거나,<br>
            ➕ 버튼을 눌러 새로운 지식을 추가해 보세요!
          </div>
          <button class="mob-past-scroll-btn" onclick="Mob._scrollToPast()">
            <i class="ti ti-arrow-down"></i>&nbsp;지난 지식 바로보기
          </button>
        </div>`;
    } else if (todayItems.length > 0) {
      /* 오늘 아카이브 아이템 — daily_delivery는 compact 요약 카드로 */
      html += '<div class="mob-card-list">';
      todayItems.forEach(item => {
        html += item.type === 'daily_delivery'
          ? this._cardDlvSummary(item)
          : this.cardHTML(item);
      });
      html += '</div>';
    }

    /* ── [지난 지식] 섹션 ── */
    if (pastItems.length > 0) {
      html += `
        <div class="mob-section-hd past" id="pastSection">
          <span>지난 지식 복습하기</span>
          <span class="mob-section-badge">${pastItems.length}개</span>
        </div>`;

      /* 날짜별 그룹핑 */
      const groups = {};
      pastItems.forEach(item => {
        const key = fmtFull(item.createdAt);
        if (!groups[key]) groups[key] = [];
        groups[key].push(item);
      });
      for (const [date, group] of Object.entries(groups)) {
        html += `<div class="mob-date-divider">${date}</div>`;
        html += '<div class="mob-card-list">';
        group.forEach(item => {
          html += item.type === 'daily_delivery'
            ? this._cardDlvSummary(item)
            : this.cardHTML(item);
        });
        html += '</div>';
      }
    }

    feed.innerHTML = html;
    if (load) feed.prepend(load);
    if (load) load.style.display = 'none';

    /* 이벤트 위임 */
    feed.onclick = e => {
      const card = e.target.closest('.mob-card');
      if (!card) return;
      /* 기존 act-btn OR 가로형 카드 삭제 OR 영어 카드 액션 버튼 */
      const delBtn = e.target.closest('.mob-card-act-btn, .mob-card-h-del, .mob-en-act-btn');
      if (delBtn) {
        e.stopPropagation();
        const action = delBtn.dataset.action;
        const id     = card.dataset.id;
        if (action === 'like')   this._toggleLike(id, delBtn);
        if (action === 'source') this._openSource(id);
        if (action === 'delete') this._deleteItem(id, card);
        if (action === 'copy')   this._copyItemText(id);
        return;
      }
      /* .mob-dlv-card: 데일리 배달 카드 프리미엄 아코디언 */
      if (card.classList.contains('mob-dlv-card')) {
        card.classList.toggle('expanded');
        return;
      }
      /* .mob-card-v: 클릭 시 상세 내용 펼치기/접기 (no-detail이면 건너뜀) */
      if (card.classList.contains('mob-card-v')) {
        if (!card.classList.contains('no-detail')) card.classList.toggle('expanded');
        return;
      }
      /* 기타 카드(가로형·데일리 요약 등) → 인라인 아코디언 확장 */
      const id = card.dataset.id;
      if (id) this._toggleDetail(card, id);
    };
  },

  /* 지난 지식 섹션으로 부드럽게 스크롤 */
  _scrollToPast() {
    const pastEl = el('pastSection');
    if (pastEl) {
      pastEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  },

  /* ─────────────────────────────────────────────
     홈 화면 배달 피드 미리보기 카드 (1 per 구독)
     클릭 시 배달탭으로 이동하며 해당 칩 활성화
  ───────────────────────────────────────────── */
  _cardFeedPreview(item) {
    const subId   = item.subId || '';
    const chip    = FEED_CHIP_MAP[subId] || { icon: '📚', label: item.label || '지식', color: '#2563eb' };
    const title   = item.title   || item.label || '오늘의 지식';
    const summary = item.summary || '';
    /* 영어/중국어는 표현 수도 표시 */
    const extra = item.vocabEntries?.length
      ? ` · ${item.vocabEntries.length}개 표현`
      : '';

    return `
    <button class="mob-feed-preview-card"
            style="border-left-color:${chip.color}"
            onclick="event.stopPropagation();Mob._goToFeedFiltered('${subId}')">
      <div class="mob-fpc-left">
        <div class="mob-fpc-badge" style="color:${chip.color}">${chip.icon} ${chip.label}${extra}</div>
        <div class="mob-fpc-title">${title}</div>
        ${summary ? `<div class="mob-fpc-summary">${summary.slice(0, 55)}${summary.length > 55 ? '…' : ''}</div>` : ''}
      </div>
      <i class="ti ti-chevron-right mob-fpc-arrow"></i>
    </button>`;
  },

  /** 홈 미리보기 카드 클릭 → 배달탭으로 이동 + 해당 필터 활성화 */
  _goToFeedFiltered(subId) {
    state.pendingFeedFilter = subId || 'all';
    this.switchView('feed', el('bnFeed'));
  },

  /**
   * 홈 전용 daily_delivery 요약 카드 — 제목 + 한줄 요약만 표시
   * 클릭 시 상세 모달(openDetail) 오픈. 배달탭과 시각적 역할 분리.
   */
  _cardDlvSummary(item) {
    const id      = item._id || item.id || '';
    const title   = item.title || '오늘의 지식';
    const cat     = item.category || 'inbox';
    const rawD    = item.createdAt || item.savedAt || '';
    const dateStr = rawD
      ? (() => { const d = new Date(rawD); return isNaN(d) ? '' : `${d.getMonth()+1}/${d.getDate()}`; })()
      : '';
    /* 첫 번째 유효한 요약 줄 — summary3 > summary > text 순서 */
    const rawSummary = (item.summary3 || item.summary || item.text || '')
      .replace(/\\n/g, ' ').split('\n')[0]
      .replace(/^[•\-·]\s*/, '').trim();
    const snippet = rawSummary.length > 62 ? rawSummary.slice(0, 62) + '…' : rawSummary;

    const catIconMap = { en:'🌐', history:'🏛️', economy:'📈', inbox:'📌', youtube:'▶️' };
    const catIcon    = catIconMap[cat] || '💡';

    return `
    <div class="mob-card mob-dlv-summary" data-id="${id}">
      <div class="mob-dls-top">
        <span class="mob-dls-badge">${catIcon} ${this._catLabel(cat)}</span>
        <span class="mob-dls-meta-r">
          ${dateStr ? `<span class="mob-dls-date">${dateStr}</span>` : ''}
          <i class="ti ti-chevron-down mob-dls-chev"></i>
        </span>
      </div>
      <div class="mob-dls-title">${title}</div>
      ${snippet ? `<div class="mob-dls-snippet">${snippet}</div>` : ''}
    </div>`;
  },

  /* ──────────────────────────────────────────
     카드 HTML 생성
  ────────────────────────────────────────── */
  cardHTML(item) {
    const m    = item.analysis || {};
    const type = item.type || 'text';
    const cat  = item.category || item.shelf || 'inbox';
    if (type === 'daily_delivery') return this._cardDailyDelivery(item);
    if (type === 'language')       return this._cardFeedLanguage(item);
    if (type === 'market')         return this._cardFeedMarket(item);
    if (type === 'humanities')     return this._cardFeedHumanities(item);
    // 영어 표현 카드 → 프리미엄 English 카드 (v37)
    if (cat === 'en')              return this._cardEnglishV(item);
    // 유튜브·이미지·썸네일 보유 → 가로형 썸네일 카드 (기존 유지)
    if (type === 'youtube' || type === 'image_analysis' ||
        item.thumbnail || m.thumbnail || item.imageUrl) {
      return this._cardH(item, m);
    }
    // 텍스트 지식 (History · Economy · Inbox) → 전폭 세로형 카드 v21
    return this._cardV(item, m);
  },

  /** 영어 표현 텍스트 파싱: "[토픽] 표현 / 뜻: / 뉘앙스: / 예문: / 연습:" */
  _parseEnglishText(text) {
    const lines = (text || '').split('\n').map(l => l.trim()).filter(Boolean);
    const out = { topic: '', expression: '', meaning: '', nuance: '', example: '', practice: '' };
    if (lines[0]) {
      const m = lines[0].match(/^\[(.+?)\]\s*(.+)$/);
      if (m) { out.topic = m[1]; out.expression = m[2]; }
      else   { out.expression = lines[0]; }
    }
    lines.slice(1).forEach(l => {
      if      (l.startsWith('뜻:'))   out.meaning  = l.replace(/^뜻:\s*/, '');
      else if (l.startsWith('뉘앙스:')) out.nuance   = l.replace(/^뉘앙스:\s*/, '');
      else if (l.startsWith('예문:')) out.example  = l.replace(/^예문:\s*/, '');
      else if (l.startsWith('연습:')) out.practice = l.replace(/^연습:\s*/, '');
    });
    return out;
  },

  /** 홈 영어 카드 v53 — Papyrus/Midnight Accordion */
  _cardEnglishV(item) {
    const id  = item._id || item.id || '';
    const p   = this._parseEnglishText(item.text);
    const expr = p.expression || item.title || '영어 표현';
    const rawD = item.createdAt || item.savedAt || '';
    const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const dateStr = rawD
      ? (() => { const d = new Date(rawD); return isNaN(d) ? 'TODAY' : `${MONTHS[d.getMonth()]} ${d.getDate()}`; })()
      : 'TODAY';
    const isSentence = expr.split(/\s+/).filter(Boolean).length > 4;

    const sections = [];
    if (p.nuance)  sections.push(`<div class="alc-section"><div class="alc-section-lbl">Nuance</div><div class="alc-body-text">${p.nuance}</div></div>`);
    if (p.example) sections.push(`<div class="alc-section"><div class="alc-section-lbl">Example</div><div class="alc-body-text alc-italic">"${p.example}"</div>${p.practice ? `<div class="alc-practice-txt">${p.practice}</div>` : ''}</div>`);

    /* 전면 예문 프리뷰: example 필드 우선, 없으면 대화문 첫 줄 사용 */
    const rawEx = p.example || (p.dialogue ? p.dialogue.split('\n').find(l => l.trim()) : '') || '';
    const exDisplay = rawEx.length > 90 ? rawEx.slice(0, 88) + '…' : rawEx;
    const previewExHtml = exDisplay ? `
        <div class="alc-preview-ex">
          <span class="alc-preview-ex-en">"${exDisplay}"</span>
          ${p.meaning ? `<span class="alc-preview-ex-ko">(${p.meaning})</span>` : ''}
        </div>` : '';

    return `
    <div class="mob-card archive-lang-card" data-id="${id}">
      <div class="alc-front">
        <div class="alc-row-meta">
          <span class="alc-tag">${isSentence ? 'Sentence' : 'Expression'}</span>
          <div class="alc-meta-r">
            <span class="alc-date">${dateStr}</span>
            <button class="alc-del"
                    onclick="event.stopPropagation();Mob._deleteItem('${id}',this.closest('.mob-card'))"
                    title="삭제"><i class="ti ti-x"></i></button>
          </div>
        </div>
        <h2 class="alc-expr${isSentence ? ' alc-sentence' : ''}">${expr}</h2>
        ${p.meaning ? `<div class="alc-meaning">${p.meaning}</div>` : ''}
        ${previewExHtml}
      </div>
      ${sections.length ? `
      <button class="alc-expand-btn" onclick="event.stopPropagation();Mob._toggleAlcCard(this)">
        <span>자세히 보기</span><i class="ti ti-chevron-down"></i>
      </button>
      <div class="alc-expand-body">${sections.join('')}</div>` : ''}
    </div>`;
  },

  _toggleAlcCard(btn) {
    const card = btn.closest('.archive-lang-card');
    const body = card?.querySelector('.alc-expand-body');
    if (!body) return;
    const isOpen = card.classList.toggle('alc-open');
    const lbl  = btn.querySelector('span');
    const icon = btn.querySelector('i');
    if (isOpen) {
      body.style.maxHeight = body.scrollHeight + 'px';
      body.addEventListener('transitionend', function h() {
        body.removeEventListener('transitionend', h);
        if (card.classList.contains('alc-open')) body.style.maxHeight = 'none';
      });
      if (lbl)  lbl.textContent = '접기';
      if (icon) icon.className  = 'ti ti-chevron-up';
    } else {
      if (body.style.maxHeight === 'none') body.style.maxHeight = body.scrollHeight + 'px';
      requestAnimationFrame(() => { body.style.maxHeight = '0'; });
      if (lbl)  lbl.textContent = '자세히 보기';
      if (icon) icon.className  = 'ti ti-chevron-down';
    }
  },

  /** 홈 피드 — 영어 표현 가로형 카드 (레거시, 현재 미사용) */
  _cardEnglish(item) {
    const id      = item._id || item.id || '';
    const p       = this._parseEnglishText(item.text);
    const expr    = p.expression || item.title || '영어 표현';
    /* 요약 = 뜻 (없으면 뉘앙스/예문 순으로 대체) */
    const meaning = p.meaning || p.nuance || p.example || item.summary || '';

    return `
    <div class="mob-card mob-card-h mob-card-h-en" data-id="${id}">
      <div class="mob-card-h-body mob-en-body">
        <div class="mob-card-h-top">
          <span class="mob-card-cat">English</span>
          <button class="mob-card-h-del" data-action="delete"
                  onclick="event.stopPropagation()" title="삭제">
            <i class="ti ti-x"></i>
          </button>
        </div>
        <div class="mob-card-h-title mob-en-h-expr">${expr}</div>
        <div class="mob-card-h-summary mob-en-h-meaning">${meaning}</div>
      </div>
    </div>`;
  },

  /**
   * 전폭 세로형 카드 v21 — 텍스트 지식 (English · History · Economy · Inbox)
   * 흰 배경 + 파란 왼쪽 border · 카테고리칩+날짜 · 복사/삭제 · 볼드 제목 · 불릿 · 해시태그
   */
  _cardV(item, m = {}) {
    const id     = item._id || item.id || '';
    const rawD   = item.createdAt || item.savedAt || '';
    const dateStr = rawD
      ? (() => { const d = new Date(rawD); return isNaN(d) ? '오늘' : `${d.getMonth()+1}/${d.getDate()}`; })()
      : '오늘';

    const domain   = getItemDomain(item);
    const domMeta  = DOMAINS[domain] || { icon: '💡', label: '기타', color: '#6b7280' };
    const catIcon  = domMeta.icon;
    const catLabel = domMeta.label;

    /* ── 제목 & 불릿 생성 (preview = 항상 보임 / detail = 접힐 때 숨김) ── */
    let title          = '';
    let previewBullets = [];   // 접혔을 때도 보임 (뜻 + 예문)
    let detailBullets  = [];   // 펼쳤을 때만 보임 (뉘앙스 + 연습 + 나머지)

    if (cat === 'en') {
      const p = this._parseEnglishText(item.text);
      title = p.expression || item.title || '영어 표현';
      /* 뜻·예문 → preview / 뉘앙스·연습 → detail */
      if (p.meaning)  previewBullets.push(`<span class="mob-card-v-b-label">뜻</span> ${p.meaning}`);
      if (p.example)  previewBullets.push(`<span class="mob-card-v-b-label">예문</span> <em>${p.example}</em>`);
      if (p.nuance)   detailBullets.push(`<span class="mob-card-v-b-label">뉘앙스</span> ${p.nuance}`);
      if (p.practice) detailBullets.push(`<span class="mob-card-v-b-label">연습</span> ${p.practice}`);
    } else {
      title = m.title || item.title || (item.text || '').slice(0, 80) || '제목 없음';
      const raw = m.summary || item.summary || (item.text || '').slice(0, 300) || '';
      const rawLines = raw.includes('\n')
        ? raw.split('\n').map(l => l.trim()).filter(Boolean)
        : raw.split(/[.。]\s+/).map(l => l.trim()).filter(Boolean);
      const allBullets = rawLines.slice(0, 4).map(l => l.replace(/[.。!?！？]$/, '').trim()).filter(Boolean);
      /* 첫 1줄 preview, 나머지 detail */
      previewBullets = allBullets.slice(0, 1);
      detailBullets  = allBullets.slice(1);
    }

    /* ── Layer 2 유저 태그 + AI 키워드 해시태그 ── */
    const userTags = (item.tags || []).slice(0, 3).map(t => `<span class="mob-tag-chip user">#${t}</span>`);
    const kws = (m.keywords || item.keywords || []).slice(0, 3);
    const kwTags = kws.length
      ? kws.map(k => `<span class="mob-tag-chip kw">#${k}</span>`)
      : [`<span class="mob-tag-chip kw">#${domMeta.label}</span>`];

    /* ── HTML 조합 ── */
    const mkUL = (arr) =>
      `<ul class="mob-card-v-body">${arr.map(b => `<li>${b}</li>`).join('')}</ul>`;

    const previewHTML = previewBullets.length ? mkUL(previewBullets) : '';
    const allTagsHTML = [...userTags, ...kwTags];
    const tagsHTML    = allTagsHTML.length
      ? `<div class="mob-card-v-tags">${allTagsHTML.join('')}</div>`
      : '';
    /* detail: 나머지 불릿 + 해시태그 (내용 없으면 빈 div → 셰브론 숨김) */
    const detailInner = (detailBullets.length ? mkUL(detailBullets) : '') + tagsHTML;
    const hasDetail   = detailBullets.length > 0 || tags.length > 0;

    return `
    <div class="mob-card mob-card-v${hasDetail ? '' : ' no-detail'}" data-id="${id}" data-domain="${domain}">
      <div class="mob-card-v-top">
        <span class="mob-card-v-cat" style="--domain-color:${domMeta.color}">${catIcon} ${catLabel} · ${dateStr}</span>
        <div class="mob-card-v-acts">
          <button class="mob-card-v-del"
                  onclick="event.stopPropagation();Mob._deleteItem('${id}',this.closest('.mob-card'))" title="삭제">
            <i class="ti ti-trash"></i>
          </button>
        </div>
      </div>
      <div class="mob-card-v-title">
        <span class="mob-card-v-title-txt">${title}</span>
        ${hasDetail ? '<i class="ti ti-chevron-down mob-card-v-chevron"></i>' : ''}
      </div>
      ${previewHTML}
      <div class="mob-card-v-detail">
        ${detailInner}
      </div>
    </div>`;
  },

  /** 영어 카드 텍스트 클립보드 복사 */
  async _copyItemText(id) {
    const item = state.items.find(i => (i._id || i.id) === id);
    if (!item) return;
    try {
      await navigator.clipboard.writeText(item.text || '');
      toast('📋 복사됐습니다', 'ok');
    } catch {
      toast('복사 실패', 'err');
    }
  },

  /**
   * 유니버설 가로형 카드 (YouTube 검색 리스트 스타일)
   * 좌 40% 썸네일/플레이스홀더 + 우 60% 텍스트
   */
  _cardH(item, m) {
    const type     = item.type || 'text';
    const id       = item._id || item.id || '';
    const title    = m.title || item.title || (item.text || '').slice(0, 60) || '제목 없음';
    const summary  = m.summary || item.summary || (item.text || '').slice(0, 120) || '';
    const thumb    = item.thumbnail || m.thumbnail || item.imageUrl || '';
    const dur      = item.duration  || m.duration  || '';

    const domain   = getItemDomain(item);
    const domMeta  = DOMAINS[domain] || { icon: '💡', label: '기타' };
    const catLabel = domMeta.label;
    const emoji    = domMeta.icon;

    // AI 이미지 분석 뱃지 (이미지 타입만)
    const aiBadge = type === 'image_analysis'
      ? `<span class="mob-card-h-ai-badge">AI</span>`
      : '';

    // 좌측 영역: 썸네일 or 플레이스홀더
    const thumbArea = thumb
      ? `<img class="mob-card-h-img" src="${thumb}" alt="" loading="lazy"/>
         ${aiBadge}
         ${dur ? `<span class="mob-card-h-dur">${dur}</span>` : ''}`
      : `<div class="mob-card-h-ph" data-cat="${cat}">
           ${aiBadge}
           <span class="mob-card-h-emoji">${emoji}</span>
         </div>`;

    // 우측 출처 아이콘
    const srcIcon = item.source
      ? `<a class="mob-card-h-src" href="${item.source}" target="_blank"
            onclick="event.stopPropagation()"
            title="원문 보기">
           <i class="ti ti-external-link"></i>
         </a>`
      : '';

    return `
    <div class="mob-card mob-card-h" data-id="${id}">
      <div class="mob-card-h-thumb">${thumbArea}</div>
      <div class="mob-card-h-body">
        <div class="mob-card-h-top">
          <span class="mob-card-cat">${catLabel}</span>
          <button class="mob-card-h-del" data-action="delete"
                  onclick="event.stopPropagation()" title="삭제">
            <i class="ti ti-x"></i>
          </button>
        </div>
        <div class="mob-card-h-title">${title}</div>
        <div class="mob-card-h-summary">${summary}</div>
        ${srcIcon}
        <i class="ti ti-chevron-down mob-card-h-chev"></i>
      </div>
    </div>`;
  },

  /** 배달 피드 — 언어 표현 카드 v53 (per-entry 아코디언) */
  _cardFeedLanguage(item) {
    const entries      = item.vocabEntries   || [];
    const subId        = item.subId          || '';
    const date         = item.date           || '';
    const theme        = item.theme          || item.subCategory || '';
    const dayOfWeek    = item.dayOfWeek      || '';
    const themeTitle   = item.themeTitle     || '';
    const themeTitleEn = item.themeTitleEn   || '';
    const masterPara   = item.masterParagraph || null;
    const langIcon     = item.label?.includes('중국') ? '🐉' : '🗽';
    const isThemePack  = !!themeTitle;

    /* ── 테마 타이틀 밴드 (팩 전용) ── */
    const themeBand = isThemePack ? `
    <div class="mob-fv-theme-band">
      <div class="mob-fv-theme-kicker">🏷️ 오늘의 테마 팩</div>
      <div class="mob-fv-theme-title">${themeTitle}</div>
      ${themeTitleEn ? `<div class="mob-fv-theme-title-en">${themeTitleEn}</div>` : ''}
    </div>` : '';

    /* ── 개별 어휘 항목 렌더링 ── */
    const vocabHTML = entries.map((e, i) => {
      const dlgLines = (e.dialogue || '').replace(/\\n/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
      const dlgHTML  = dlgLines.map(l => {
        /* 화자: 패턴 — A/B/甲/乙 및 임의 이름(Team Lead, You, Manager 등) */
        if (/^[A-Za-z가-힣\s]{1,24}:\s/.test(l)) {
          const ci = l.indexOf(':');
          const sp = l.slice(0, ci).trim();
          const tx = l.slice(ci + 1).trim();
          return `<div class="mob-fv-dlg-line"><span class="mob-fv-dlg-sp">${sp}</span><span>${tx}</span></div>`;
        }
        if (l.startsWith('[해석:') || l.startsWith('[解:'))
          return `<div class="mob-fv-dlg-tr">${l.replace(/^\[해석:|^\[解:/, '').replace(/\]$/, '').trim()}</div>`;
        return `<div class="mob-fv-dlg-line"><span>${l}</span></div>`;
      }).join('');

      const nuanceLbl = isThemePack ? '원어민 비밀 노트' : 'Nuance';
      const sects = [
        e.nuance         ? `<div class="mob-fv-sect"><div class="mob-fv-sect-lbl">${nuanceLbl}</div><div class="mob-fv-sect-txt">${e.nuance}</div></div>` : '',
        dlgHTML          ? `<div class="mob-fv-sect"><div class="mob-fv-sect-lbl">Dialogue</div><div class="mob-fv-dlg">${dlgHTML}</div></div>` : '',
        e.sourceSentence ? `<div class="mob-fv-sect"><div class="mob-fv-sect-lbl">Example</div><div class="mob-fv-sect-txt mob-fv-italic">"${e.sourceSentence}"</div>${e.practiceSentence ? `<div class="mob-fv-sect-txt mob-fv-practice">${e.practiceSentence}</div>` : ''}</div>` : ''
      ].filter(Boolean).join('');

      return `
      <div class="mob-fv-item">
        <div class="mob-fv-front">
          <span class="mob-fv-num">${i + 1}</span>
          <div class="mob-fv-main">
            <div class="mob-fv-expr">${e.expression || ''}</div>
            <div class="mob-fv-meaning">${e.meaning || ''}</div>
          </div>
          <div class="mob-fv-actions">
            <button class="mob-fv-save"
                    data-sub="${subId}" data-idx="${i}"
                    onclick="event.stopPropagation();Mob._saveVocabEntry(this)"
                    title="서재에 저장"><i class="ti ti-bookmark"></i></button>
            ${sects ? `<button class="mob-fv-toggle" onclick="event.stopPropagation();Mob._toggleFvEntry(this)"><i class="ti ti-chevron-down"></i></button>` : ''}
          </div>
        </div>
        ${sects ? `<div class="mob-fv-body">${sects}</div>` : ''}
      </div>`;
    }).join('');

    /* ── 마스터 패러그래프 (팩 전용) ── */
    const masterHTML = masterPara ? this._renderMasterParagraph(masterPara) : '';

    return `
    <div class="mob-card mob-card-feed" data-id="">
      <div class="mob-feed-card-hd">
        <span class="mob-feed-badge mob-feed-badge-lang">${langIcon} ${item.label || '표현'}</span>
        ${dayOfWeek && !isThemePack ? `<span class="mob-feed-day-theme">${dayOfWeek}요일 · ${theme}</span>` : ''}
        <span class="mob-feed-card-date">${date}</span>
      </div>
      ${!isThemePack ? `<div class="mob-card-title">${item.title || '오늘의 표현'}</div>` : ''}
      ${!isThemePack && item.summary ? `<div class="mob-card-summary">${item.summary}</div>` : ''}
      ${themeBand}
      <div class="mob-feed-vocab-list">${vocabHTML}</div>
      ${masterHTML}
      <div class="mob-feed-card-ft">
        <button class="mob-feed-save-btn" onclick="event.stopPropagation();Mob._saveFeedToArchive('${subId}','${date}',this)">
          <i class="ti ti-device-floppy"></i> 전체 저장
        </button>
        <span class="mob-feed-ai-tag">${item.aiGenerated ? '✨ AI 생성' : (item.pack_id ? '📦 테마팩' : '📋 DB')}</span>
      </div>
    </div>`;
  },

  /** 마스터 패러그래프 렌더링 — 5개 표현 하이라이트 포함 */
  _renderMasterParagraph(para) {
    const highlights = para.highlights || [];
    let txt = (para.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    highlights.forEach((h, idx) => {
      const escaped = h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      txt = txt.replace(
        new RegExp(`(${escaped})`, 'gi'),
        `<mark class="mob-mpa-hl" data-n="${idx + 1}">$1</mark>`
      );
    });
    const trHTML = para.translation
      ? `<div class="mob-mpa-tr">${para.translation}</div>`
      : '';
    return `
    <div class="mob-master-para">
      <div class="mob-mpa-hd">
        <span class="mob-mpa-fire">🔥</span>
        <div class="mob-mpa-hd-text">
          <div class="mob-mpa-title">The Master Paragraph</div>
          <div class="mob-mpa-sub">오늘 배운 ${highlights.length}개 표현을 하나의 문맥으로 마스터하기</div>
        </div>
      </div>
      <div class="mob-mpa-collapse">
        <div class="mob-mpa-body">${txt}</div>
        ${trHTML}
      </div>
      <button class="mob-mpa-toggle" onclick="event.stopPropagation();Mob._toggleMasterPara(this)">
        <span>통합 지문 및 해석 보기</span><i class="ti ti-chevron-down"></i>
      </button>
    </div>`;
  },

  /** The Master Paragraph 접기/펼치기 토글 (max-height + opacity 트랜지션) */
  _toggleMasterPara(btn) {
    const wrap = btn.closest('.mob-master-para');
    const body = wrap?.querySelector('.mob-mpa-collapse');
    if (!body) return;
    const isOpen = wrap.classList.toggle('mpa-open');
    const lbl    = btn.querySelector('span');
    const icon   = btn.querySelector('i');
    if (isOpen) {
      body.style.maxHeight = body.scrollHeight + 'px';
      body.addEventListener('transitionend', function h() {
        body.removeEventListener('transitionend', h);
        if (wrap.classList.contains('mpa-open')) body.style.maxHeight = 'none';
      });
      if (lbl)  lbl.textContent = '지문 접기';
      if (icon) icon.className  = 'ti ti-chevron-up';
    } else {
      if (body.style.maxHeight === 'none') body.style.maxHeight = body.scrollHeight + 'px';
      requestAnimationFrame(() => { body.style.maxHeight = '0'; });
      if (lbl)  lbl.textContent = '통합 지문 및 해석 보기';
      if (icon) icon.className  = 'ti ti-chevron-down';
    }
  },

  /** 표현 항목 아코디언 토글 */
  _toggleFvEntry(btn) {
    const item = btn.closest('.mob-fv-item');
    const body = item?.querySelector('.mob-fv-body');
    if (!body) return;
    const isOpen = item.classList.toggle('fv-open');
    const icon   = btn.querySelector('i');
    if (isOpen) {
      body.style.maxHeight = body.scrollHeight + 'px';
      body.addEventListener('transitionend', function h() {
        body.removeEventListener('transitionend', h);
        if (item.classList.contains('fv-open')) body.style.maxHeight = 'none';
      });
      if (icon) icon.className = 'ti ti-chevron-up';
    } else {
      if (body.style.maxHeight === 'none') body.style.maxHeight = body.scrollHeight + 'px';
      requestAnimationFrame(() => { body.style.maxHeight = '0'; });
      if (icon) icon.className = 'ti ti-chevron-down';
    }
  },

  /** 대화문 아코디언 토글 (레거시 — 신규 카드는 _toggleFvEntry 사용) */
  _toggleDialogue(btn) {
    const uid   = btn.dataset.uid;
    const dlgEl = uid ? document.getElementById(uid) : btn.nextElementSibling;
    if (!dlgEl) return;
    const isHidden = dlgEl.hidden;
    dlgEl.hidden = !isHidden;
    const icon = btn.querySelector('i');
    if (icon) icon.className = isHidden ? 'ti ti-chevron-up' : 'ti ti-chevron-down';
    btn.classList.toggle('open', isHidden);
  },

  /** 어휘 표현 항목 1개만 서재에 저장 */
  async _saveVocabEntry(btn) {
    const subId = btn.dataset.sub;
    const idx   = parseInt(btn.dataset.idx);
    const feedItem = (state.feedItems || []).find(f => f.subId === subId);
    const entry    = feedItem?.vocabEntries?.[idx];
    if (!entry) { toast('표현 데이터 없음', 'err'); return; }

    const cat   = feedItem.category  || 'en';
    const topic = feedItem.subCategory || feedItem.label || '표현';

    btn.disabled  = true;
    btn.innerHTML = '<span class="mob-spin"></span>';

    try {
      const text = [
        `[${topic}] ${entry.expression}`,
        `뜻: ${entry.meaning}`,
        entry.nuance          ? `뉘앙스: ${entry.nuance}`                : '',
        entry.sourceSentence  ? `예문: ${entry.sourceSentence}`          : '',
        entry.practiceSentence? `연습: ${entry.practiceSentence}`        : ''
      ].filter(Boolean).join('\n');

      await fetchJSON('/api/items', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ text, category: cat, source: 'daily-feed-entry', mode: this._modeEnum() })
      });

      btn.innerHTML = '<i class="ti ti-check"></i>';
      btn.style.color = '#16a34a';
      toast(`"${entry.expression}" 서재에 저장됐습니다!`, 'ok');
    } catch {
      btn.disabled  = false;
      btn.innerHTML = '<i class="ti ti-bookmark"></i>';
      toast('저장 실패', 'err');
    }
  },

  // ══════════════════════════════════════════════
  //  인문학 피드 카드 렌더러 — v27
  //  역사(history) / 명언(quote) / 고사성어(idiom)
  // ══════════════════════════════════════════════

  /** 인문학 피드 카드 — subType 기반 분기 */
  _cardFeedHumanities(item) {
    const subType = item.subType || '';
    if (subType === 'history') return this._cardHumHistory(item);
    if (subType === 'quote')   return this._cardHumQuote(item);
    if (subType === 'idiom')   return this._cardHumIdiom(item);
    /* 알 수 없는 서브타입 폴백 */
    return `<div class="mob-card mob-hum-card"><div class="mob-hum-content"><div class="mob-hum-title">${item.title || '인문학 지식'}</div></div></div>`;
  },

  /** 역사 카드 v53 — Closed: 제목+교훈 / Expanded: Behind Story + Strategic Lesson */
  _cardHumHistory(item) {
    const s3Lines = (item.summary3 || '').replace(/\\n/g, '\n')
      .split('\n').map(l => l.trim().replace(/^[•\-·]\s*/, '')).filter(Boolean);

    const behindSect = item.behindStory ? `
      <div class="mob-hum-acc-sect">
        <div class="mob-hum-acc-lbl">Behind Story</div>
        <div class="mob-hum-acc-body">${item.behindStory}</div>
      </div>` : '';

    const lessonBullets = s3Lines.map(l => `
      <div class="mob-hum-acc-bullet"><span class="mob-hum-acc-dot"></span><span>${l}</span></div>`).join('');

    const lessonSect = (lessonBullets || (item.lesson && s3Lines.length === 0)) ? `
      <div class="mob-hum-acc-sect mob-hum-acc-lesson">
        <div class="mob-hum-acc-lbl">Strategic Lesson</div>
        ${lessonBullets || `<div class="mob-hum-acc-body">${item.lesson}</div>`}
      </div>` : '';

    const hasExpand = !!(behindSect || lessonSect);
    const frontLesson = item.lesson || s3Lines[0] || '';

    return `
    <div class="mob-card mob-hum-card">
      <div class="mob-hum-badge-row">
        <span class="mob-hum-badge">🏛️ 역사 · ${item.era || '역사'}</span>
        <span class="mob-hum-period">${item.period || ''}</span>
      </div>
      <div class="mob-hum-content">
        <div class="mob-hum-title">${item.title || '오늘의 역사'}</div>
        ${frontLesson ? `
        <div class="mob-hum-lesson">
          <i class="ti ti-bulb" style="flex-shrink:0;font-size:15px;margin-top:1px;color:#d97706"></i>
          <span>${frontLesson}</span>
        </div>` : ''}
      </div>
      ${hasExpand ? `
      <button class="mob-hum-behind-btn" onclick="event.stopPropagation();Mob._toggleBehindStory(this)">
        비하인드 스토리 보기 🕵️ <i class="ti ti-chevron-down"></i>
      </button>
      <div class="mob-hum-behind-panel">
        ${behindSect}${lessonSect}
      </div>` : ''}
    </div>`;
  },

  /** 오늘의 명언 카드 */
  _cardHumQuote(item) {
    const behindBlock = item.behindStory ? `
      <button class="mob-hum-behind-btn"
              onclick="event.stopPropagation();Mob._toggleBehindStory(this)">
        비하인드 스토리 보기 🕵️ <i class="ti ti-chevron-down"></i>
      </button>
      <div class="mob-hum-behind-panel">
        <div class="mob-hum-behind-txt">${item.behindStory}</div>
        ${item.context ? `<div class="mob-hum-behind-context">📍 맥락: ${item.context}</div>` : ''}
      </div>` : '';

    return `
    <div class="mob-card mob-hum-card mob-hum-quote-card">
      <div class="mob-hum-badge-row">
        <span class="mob-hum-badge">💡 오늘의 명언</span>
        <span class="mob-hum-author-badge">${item.author || ''}</span>
      </div>
      <div class="mob-hum-quote-wrap">
        <div class="mob-hum-quote-marks">"</div>
        <div class="mob-hum-quote-txt">${item.quoteKo || item.quote || ''}</div>
        ${item.quote && item.quoteKo ? `<div class="mob-hum-quote-orig">${item.quote}</div>` : ''}
        <div class="mob-hum-author-info">${item.authorInfo || item.author || ''}</div>
      </div>
      ${item.application ? `
      <div class="mob-hum-content">
        <div class="mob-hum-application">
          <i class="ti ti-sparkles" style="flex-shrink:0;font-size:14px;margin-top:1px"></i>
          <span>${item.application}</span>
        </div>
      </div>` : ''}
      ${behindBlock}
    </div>`;
  },

  /** 고사성어 카드 v53 — Closed: 성어+뜻+출처 / Expanded: 유래+Strategic Lesson */
  _cardHumIdiom(item) {
    const storySect = item.story ? `
      <div class="mob-hum-acc-sect">
        <div class="mob-hum-acc-lbl">유래 이야기</div>
        <div class="mob-hum-acc-body">${item.story}</div>
      </div>` : '';

    const behindSect = item.behindStory ? `
      <div class="mob-hum-acc-sect">
        <div class="mob-hum-acc-lbl">Behind Story</div>
        <div class="mob-hum-acc-body">${item.behindStory}</div>
      </div>` : '';

    const applSect = item.application ? `
      <div class="mob-hum-acc-sect mob-hum-acc-lesson">
        <div class="mob-hum-acc-lbl">Strategic Lesson</div>
        <div class="mob-hum-acc-body">${item.application}</div>
      </div>` : '';

    const hasExpand = !!(storySect || behindSect || applSect);

    return `
    <div class="mob-card mob-hum-card mob-hum-idiom-card">
      <div class="mob-hum-badge-row">
        <span class="mob-hum-badge">📜 고사성어</span>
        <span class="mob-hum-hanja">${item.hanja || ''}</span>
      </div>
      <div class="mob-hum-content">
        <div class="mob-hum-idiom-title">${item.idiom || item.title || ''}</div>
        ${item.meaning ? `<div class="mob-hum-meaning">${item.meaning}</div>` : ''}
        ${item.origin ? `<div class="mob-hum-origin"><i class="ti ti-book-2" style="font-size:11px;color:#d97706"></i> ${item.origin}</div>` : ''}
      </div>
      ${hasExpand ? `
      <button class="mob-hum-behind-btn" onclick="event.stopPropagation();Mob._toggleBehindStory(this)">
        자세히 보기 🕵️ <i class="ti ti-chevron-down"></i>
      </button>
      <div class="mob-hum-behind-panel">
        ${storySect}${applSect}${behindSect}
      </div>` : ''}
    </div>`;
  },

  /** 비하인드 스토리 아코디언 토글 */
  _toggleBehindStory(btn) {
    const panel = btn.nextElementSibling;
    if (!panel) return;
    const isOpen = panel.classList.toggle('open');
    btn.classList.toggle('open', isOpen);
    btn.innerHTML = isOpen
      ? '비하인드 스토리 접기 👆 <i class="ti ti-chevron-up"></i>'
      : '비하인드 스토리 보기 🕵️ <i class="ti ti-chevron-down"></i>';
  },

  /** 오늘의 지식 배달 카드 (type: 'daily_delivery') — v26 프리미엄 아카이브 리포트 */
  _cardDailyDelivery(item) {
    const id       = item._id || item.id || '';
    const title    = item.title   || '오늘의 지식';
    const concepts = item.concepts || [];
    const summary3 = (item.summary3 || item.text || '').replace(/\\n/g, '\n');
    const reminder = item.reminder || item.summary || '';
    const cat      = item.category || 'inbox';
    const catLabel = this._catLabel(cat);
    const rawD     = item.createdAt || item.savedAt || '';

    const catIconMap = { en:'🌐', history:'🏛️', economy:'📈', inbox:'📌', youtube:'▶️' };
    const catIcon    = catIconMap[cat] || '💡';

    const DOW     = ['일','월','화','수','목','금','토'];
    const dateStr = rawD
      ? (() => { const d = new Date(rawD); return isNaN(d) ? '오늘' : `${d.getMonth()+1}/${d.getDate()}`; })()
      : '오늘';
    const dayName = rawD
      ? (() => { const d = new Date(rawD); return isNaN(d) ? '' : DOW[d.getDay()] + '요일'; })()
      : '';

    /* 미니 키워드 칩 — concepts 첫 2개 term, 접혔을 때도 항상 노출 */
    const kwChips = concepts.slice(0, 2)
      .filter(c => c.term)
      .map(c => `<span class="mob-dlv-kw-chip">${c.term}</span>`)
      .join('');

    /* 3줄 요약 bullet 파싱 */
    const s3Lines = summary3
      .split('\n')
      .map(l => l.trim().replace(/^[•\-·]\s*/, ''))
      .filter(Boolean);
    const s3HTML = s3Lines.map(l => `
      <div class="mob-dlv-s3-line">
        <span class="mob-dlv-s3-dot"></span>
        <span>${l}</span>
      </div>`).join('');

    /* 핵심 개념 카드 */
    const conceptsHTML = concepts.slice(0, 3).map(c => `
      <div class="mob-dlv-concept">
        <span class="mob-dlv-concept-term">${c.term || ''}</span>
        <span class="mob-dlv-concept-desc">${c.desc || ''}</span>
      </div>`).join('');

    return `
    <div class="mob-card mob-dlv-card" data-id="${id}">
      <div class="mob-dlv-badge-row">
        <span class="mob-dlv-badge">${catIcon} ${dayName ? dayName + ' · ' : ''}${catLabel}</span>
        <div class="mob-dlv-badge-right">
          <span class="mob-dlv-date">${dateStr}</span>
          <button class="mob-dlv-save-btn"
                  onclick="event.stopPropagation();Mob._saveDeliveryCard('${id}',this)"
                  title="서재에 저장">
            <i class="ti ti-bookmark"></i>
          </button>
        </div>
      </div>
      <div class="mob-dlv-title-row">
        <span class="mob-dlv-title-txt">${title}</span>
        <i class="ti ti-chevron-down mob-dlv-chevron"></i>
      </div>
      ${kwChips ? `<div class="mob-dlv-kw-row">${kwChips}</div>` : ''}
      <div class="mob-dlv-detail">
        ${s3HTML ? `<div class="mob-dlv-summary3">${s3HTML}</div>` : ''}
        ${conceptsHTML ? `<div class="mob-dlv-concepts">${conceptsHTML}</div>` : ''}
        ${reminder ? `
        <div class="mob-dlv-reminder">
          <span class="mob-dlv-reminder-icon">✨</span>
          <span>${reminder}</span>
        </div>` : ''}
      </div>
    </div>`;
  },

  /** 데일리 배달 카드 → 서재에 복사 저장 */
  async _saveDeliveryCard(id, btn) {
    const item = state.items.find(i => (i._id || i.id) === id);
    if (!item) { toast('데이터를 찾을 수 없습니다', 'err'); return; }

    btn.disabled  = true;
    btn.innerHTML = '<span class="mob-spin"></span>';

    try {
      const text = [
        item.title || '오늘의 지식',
        item.summary3 || '',
        ...(item.concepts || []).map(c => `▸ ${c.term}: ${c.desc}`),
        item.reminder ? `✨ ${item.reminder}` : ''
      ].filter(Boolean).join('\n');

      await fetchJSON('/api/items', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ text, category: item.category || 'inbox', source: 'daily-delivery', mode: this._modeEnum() })
      });

      btn.innerHTML = '<i class="ti ti-check"></i>';
      btn.style.color = '#16a34a';
      toast(`"${item.title}" 서재에 저장됐습니다!`, 'ok');
    } catch {
      btn.disabled  = false;
      btn.innerHTML = '<i class="ti ti-bookmark"></i>';
      toast('저장 실패', 'err');
    }
  },

  /** 배달 피드 — 시황 카드 v53 (지표 미니배너 + 아코디언 상세) */
  _cardFeedMarket(item) {
    const terms      = (item.aiEconomicKnowledge || []).slice(0, 3);
    const indicators = item.indicators || [];
    const subId      = item.subId || '';
    const date       = item.date  || '';
    const isUS       = (item.label || '').includes('미국') || (item.subId || '').includes('us');

    // 상단 지표 칩 (최대 3개)
    const topInds = indicators.slice(0, 3);
    const indMiniHTML = topInds.length ? `
    <div class="mob-mkt-ind-mini">
      ${topInds.map(ind => `
        <div class="mob-mkt-ind-chip ${ind.dir || ''}">
          <span class="mob-mkt-ind-name">${ind.name}</span>
          <span class="mob-mkt-ind-val">${ind.value}</span>
          <span class="mob-mkt-ind-chg">${ind.dir === 'up' ? '▲' : '▼'} ${ind.change}</span>
        </div>`).join('')}
    </div>` : '';

    // 전체 지표 배너 (펼침 내부)
    const indFullHTML = indicators.length ? `
    <div class="mob-feed-indicators">
      ${indicators.map(ind => `
        <div class="mob-feed-ind-item ${ind.dir || ''}">
          <div class="mob-feed-ind-name">${ind.name}</div>
          <div class="mob-feed-ind-value">${ind.value}</div>
          <div class="mob-feed-ind-change">${ind.dir === 'up' ? '▲' : '▼'} ${ind.change}</div>
        </div>`).join('')}
    </div>` : '';

    // 3줄 요약
    const s3Lines = (item.summary3 || '').replace(/\\n/g, '\n').split('\n').filter(l => l.trim());
    const summary3HTML = s3Lines.length ? `
    <div class="mob-feed-summary3">
      ${s3Lines.map(l => `<div class="mob-feed-s3-line">${l.trim()}</div>`).join('')}
    </div>` : '';

    // 체크포인트
    const checkpoints = item.checkpoints || [];
    const checkHTML = checkpoints.length ? `
    <div class="mob-feed-checkpoints">
      <div class="mob-feed-check-label"><i class="ti ti-checkbox"></i> 오늘 장 필수 체크</div>
      ${checkpoints.map((c, idx) => `
        <div class="mob-feed-check-item">
          <span class="mob-feed-check-num">${idx + 1}</span>
          <span>${c}</span>
        </div>`).join('')}
    </div>` : '';

    // 핵심 경제 용어
    const termsHTML = terms.map(t => `
      <div class="mob-feed-econ-item">
        <span class="mob-feed-econ-term">${t.term || ''}</span>
        <span class="mob-feed-econ-importance">${t.importance || ''}</span>
        ${t.connection ? `<span class="mob-feed-econ-connection">${t.connection}</span>` : ''}
      </div>`).join('');

    const hasDetail = !!(indFullHTML || summary3HTML || checkHTML || termsHTML);

    return `
    <div class="mob-card mob-card-feed mob-card-feed-market" data-id="">
      <div class="mob-feed-card-hd">
        <span class="mob-feed-badge mob-feed-badge-market">${isUS ? '🗽' : '🐯'} ${item.label || '시황'}</span>
        <span class="mob-feed-card-date">${date}</span>
      </div>
      <div class="mob-card-title">${item.title || '오늘의 시황'}</div>
      ${item.summary ? `<div class="mob-card-summary">${item.summary}</div>` : ''}
      ${indMiniHTML}
      ${hasDetail ? `
      <button class="mob-mkt-expand-btn" onclick="event.stopPropagation();Mob._toggleMarketCard(this)">
        <span>상세 분석 보기</span><i class="ti ti-chevron-down"></i>
      </button>
      <div class="mob-mkt-expand-body">
        ${indFullHTML}
        ${summary3HTML}
        ${checkHTML}
        ${termsHTML ? `<div class="mob-feed-econ-list">
          <div class="mob-feed-econ-label"><i class="ti ti-bookmark"></i> 오늘의 핵심 용어</div>
          ${termsHTML}
        </div>` : ''}
      </div>` : ''}
      <div class="mob-feed-card-ft">
        <button class="mob-feed-save-btn" onclick="event.stopPropagation();Mob._saveFeedToArchive('${subId}','${date}',this)">
          <i class="ti ti-device-floppy"></i> 서재에 저장
        </button>
        <span class="mob-feed-ai-tag">${item.aiGenerated ? '✨ AI 생성' : '📋 샘플'}</span>
      </div>
    </div>`;
  },

  _toggleMarketCard(btn) {
    const card = btn.closest('.mob-card-feed-market');
    const body = card?.querySelector('.mob-mkt-expand-body');
    if (!body) return;
    const isOpen = card.classList.toggle('mkt-open');
    const lbl    = btn.querySelector('span');
    const icon   = btn.querySelector('i');
    if (isOpen) {
      body.style.maxHeight = body.scrollHeight + 'px';
      body.addEventListener('transitionend', function h() {
        body.removeEventListener('transitionend', h);
        if (card.classList.contains('mkt-open')) body.style.maxHeight = 'none';
      });
      if (lbl)  lbl.textContent = '접기';
      if (icon) icon.className  = 'ti ti-chevron-up';
    } else {
      if (body.style.maxHeight === 'none') body.style.maxHeight = body.scrollHeight + 'px';
      requestAnimationFrame(() => { body.style.maxHeight = '0'; });
      if (lbl)  lbl.textContent = '상세 분석 보기';
      if (icon) icon.className  = 'ti ti-chevron-down';
    }
  },

  /** 배달 피드 아이템 → 서재 저장 */
  async _saveFeedToArchive(subId, date, btn) {
    if (!subId || !date) return;
    try {
      btn.disabled  = true;
      btn.innerHTML = '<span class="mob-spin"></span> 저장 중…';
      const data = await fetchJSON(`/api/daily-feed/${date}/${subId}/save`, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ mode: this._modeEnum() })
      });
      if (data.success) {
        btn.innerHTML    = '<i class="ti ti-check"></i> 저장됨';
        btn.style.cursor = 'default';
        toast('서재에 저장됐습니다!', 'ok');
      } else {
        throw new Error(data.error || '저장 실패');
      }
    } catch {
      btn.disabled  = false;
      btn.innerHTML = '<i class="ti ti-device-floppy"></i> 서재에 저장';
      toast('저장에 실패했습니다', 'error');
    }
  },

  _catLabel(catOrDomain) {
    if (!catOrDomain || catOrDomain === 'all') return '전체';
    const domain = DOMAINS[catOrDomain]
      ? catOrDomain
      : (CATEGORY_TO_DOMAIN[catOrDomain] || catOrDomain);
    return DOMAINS[domain]?.label || catOrDomain;
  },

  _domainIcon(item) {
    const d = getItemDomain(item);
    return DOMAINS[d]?.icon || '💡';
  },

  _domainLabel(item) {
    const d = getItemDomain(item);
    return DOMAINS[d] ? `${DOMAINS[d].icon} ${DOMAINS[d].label}` : '💡 기타';
  },

  /* ──────────────────────────────────────────
     홈 카드 액션
  ────────────────────────────────────────── */
  async _toggleLike(id, btn) {
    btn.classList.toggle('liked');
    const liked = btn.classList.contains('liked');
    toast(liked ? '❤️ 저장됨' : '저장 해제');
    try {
      await fetchJSON(`/api/items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ liked })
      });
    } catch {}
  },

  _openSource(id) {
    const item = state.items.find(i => (i._id || i.id) === id);
    if (item?.source) window.open(item.source, '_blank');
  },

  async _deleteItem(id, card) {
    if (!confirm('이 지식을 삭제할까요?')) return;
    try {
      await fetchJSON(`/api/items/${id}`, { method: 'DELETE' });
      card.style.transition = 'opacity .25s, transform .25s';
      card.style.opacity    = '0';
      card.style.transform  = 'translateX(-20px)';
      setTimeout(() => card.remove(), 260);
      state.items = state.items.filter(i => (i._id || i.id) !== id);
      toast('삭제됨', 'ok');
    } catch { toast('삭제 실패', 'err'); }
  },

  /* ══════════════════════════════════════════
     배달 뷰
  ══════════════════════════════════════════ */
  async _loadFeedView(forceRefresh = false) {
    const content = el('mobFeedViewContent');
    const dateEl  = el('feedViewDate');
    if (!content) return;

    /* 모드 격리: 배달 지식은 직장인 전용. 수험생 모드면 전문직 피드 원천 배제 */
    if (this._modeEnum() === 'EXAM_PREP') {
      state.feedItems = [];
      content.innerHTML = `<div class="mob-loading" style="flex-direction:column;gap:8px">
        <i class="ti ti-school" style="font-size:34px;color:var(--text-3)"></i>
        <span style="font-size:13px;color:var(--text-2)">수험생 모드에서는 일반 지식 배달이 제공되지 않습니다.</span>
        <small style="color:var(--text-3)">시험에 나오는 것만 — 오답노트와 학습에 집중하세요.</small>
      </div>`;
      return;
    }

    if (state.feedLoaded && !forceRefresh) {
      if (state.pendingFeedFilter) {
        state.activeFeedFilter  = state.pendingFeedFilter;
        state.pendingFeedFilter = null;
        this._renderFeedView();
      }
      return;
    }

    const today = new Date();
    if (dateEl) dateEl.textContent = today.toLocaleDateString('ko-KR',
      { year:'numeric', month:'long', day:'numeric', weekday:'long' });

    content.innerHTML = `<div class="mob-loading"><span class="mob-spin"></span> 불러오는 중…</div>`;

    try {
      /* ── 1단계: 캐시 상태 빠른 확인 (8초 타임아웃) ── */
      let allReady = false;
      try {
        const status = await fetchJSON('/api/daily-feed/status', {}, 8000);
        allReady = !!status?.allReady;
      } catch { /* 상태 확인 실패해도 계속 진행 */ }

      /* ── 2단계: 캐시 있으면 빠른 경로, 없으면 생성 안내 후 대기 ── */
      if (!allReady) {
        content.innerHTML = `<div class="mob-loading">
          <span class="mob-spin"></span>
          <span style="display:block;margin-top:8px;font-size:13px;color:var(--text-2)">
            AI 피드 생성 중…<br>
            <small style="color:var(--text-3)">최초 생성은 30~60초 걸릴 수 있어요</small>
          </span>
        </div>`;
      }

      /* 캐시 히트면 20초, 생성 필요하면 120초 */
      const timeoutMs = allReady ? 20000 : 120000;
      const data = await fetchJSON(`/api/daily-feed?mode=${this._modeEnum()}`, {}, timeoutMs);
      state.feedItems = parseFeedsArray(data.items ?? data.feeds ?? data);

      if (state.pendingFeedFilter) {
        state.activeFeedFilter  = state.pendingFeedFilter;
        state.pendingFeedFilter = null;
      }

      this._renderFeedView();
      state.feedLoaded = true;
      const badge = el('mobFeedBadge');
      if (badge) badge.hidden = true;

    } catch (e) {
      const isTimeout = e?.name === 'AbortError' || (e?.message || '').includes('abort');
      content.innerHTML = `
        <div class="mob-loading" style="color:#ef4444;gap:12px">
          <i class="ti ti-alert-circle" style="font-size:28px"></i>
          <span style="font-size:13.5px;font-weight:600">
            ${isTimeout ? '피드 생성 시간 초과' : '피드 불러오기 실패'}
          </span>
          <span style="font-size:12px;color:var(--text-3)">
            ${isTimeout ? '서버가 바쁘거나 AI 응답이 지연됐어요.' : (e?.message || '')}
          </span>
          <button onclick="Mob._loadFeedView(true)"
            style="margin-top:4px;padding:8px 20px;border-radius:8px;border:none;
                   background:#6366f1;color:#fff;font-size:13px;font-weight:600;cursor:pointer">
            🔄 다시 시도
          </button>
          <button onclick="Mob.switchView('manage',el('bnManage'))"
            style="padding:6px 16px;border-radius:8px;border:1.5px solid var(--border);
                   background:transparent;color:var(--text-2);font-size:12px;cursor:pointer">
            관리탭에서 지금 생성
          </button>
        </div>`;
    }
  },

  _renderFeedView() {
    const content = el('mobFeedViewContent');
    if (!content) return;

    const items = state.feedItems;
    if (!items || items.length === 0) {
      el('feedFilterBar').innerHTML = '';
      content.innerHTML = `<div class="mob-loading">
        <i class="ti ti-mood-empty"></i> 오늘의 배달 피드가 없어요.<br>
        <small style="color:var(--text-3);margin-top:6px;display:block">관리탭 → 지금 생성을 눌러보세요!</small>
      </div>`;
      return;
    }

    /* ── 필터 칩 바 빌드 ── */
    el('feedFilterBar').innerHTML = this._buildFeedFilterBar(items);

    /* ── 현재 필터에 맞는 아이템 렌더 ── */
    this._renderFeedItems(state.activeFeedFilter);

    /* ── 컨텐츠 영역 onclick 위임 (아코디언·비하인드·저장 등 기존 기능 전부 유지) ── */
    content.onclick = e => {
      const card = e.target.closest('.mob-card');
      if (!card) return;

      /* mob-dlv-card: 데일리 배달 카드 아코디언 */
      if (card.classList.contains('mob-dlv-card')) {
        card.classList.toggle('expanded');
        return;
      }
      /* mob-card-v: 세로형 아카이브 카드 */
      if (card.classList.contains('mob-card-v')) {
        if (!card.classList.contains('no-detail')) card.classList.toggle('expanded');
        return;
      }
      /* 기타 archive 카드 → 인라인 아코디언 확장 */
      const id = card.dataset.id;
      if (id) this._toggleDetail(card, id);
    };
  },

  /* 배달탭 필터 칩 HTML 빌드 */
  _buildFeedFilterBar(items) {
    const seen  = new Set();
    const chips = [];

    items.forEach(item => {
      const subId = item.subId || '';
      if (subId && !seen.has(subId)) {
        seen.add(subId);
        const c = FEED_CHIP_MAP[subId] || { icon: '📚', label: item.label || subId };
        chips.push({ subId, ...c });
      }
    });

    if (chips.length === 0) return '';

    const activeFilter = state.activeFeedFilter;

    let html = `<button class="mob-feed-chip${activeFilter === 'all' ? ' active' : ''}"
                        onclick="Mob._onFeedChip('all', this)">전체</button>`;
    chips.forEach(c => {
      const isActive = activeFilter === c.subId;
      /* inline style 금지 — active 토글 시 CSS 충돌 방지. 색상은 data 속성으로만 보관 */
      html += `<button class="mob-feed-chip${isActive ? ' active' : ''}"
                       data-color="${c.color}"
                       onclick="Mob._onFeedChip('${c.subId}', this)">
                 ${c.icon} ${c.label}
               </button>`;
    });
    return html;
  },

  /* 필터 칩 클릭 핸들러 */
  _onFeedChip(cat, chipEl) {
    if (state.activeFeedFilter === cat) return;  /* 동일 칩 재클릭 시 불필요한 재렌더 방지 */
    state.activeFeedFilter = cat;
    el('feedFilterBar')?.querySelectorAll('.mob-feed-chip').forEach(c => {
      c.classList.toggle('active', c === chipEl);
    });
    this._renderFeedItems(cat);
  },

  /* 현재 필터로 배달 피드 아이템 렌더 */
  _renderFeedItems(filter) {
    const content = el('mobFeedViewContent');
    if (!content) return;

    const items  = state.feedItems || [];
    const filtered = filter === 'all'
      ? items
      : items.filter(item => (item.subId || '') === filter);

    if (filtered.length === 0) {
      content.innerHTML = `<div class="mob-loading">
        <i class="ti ti-mood-empty"></i> 해당 카테고리 피드가 없어요
      </div>`;
      return;
    }

    let html = '';
    filtered.forEach(item => { html += this.cardHTML(item); });
    content.innerHTML = html;
  },

  async checkFeedBadge() {
    try {
      const data  = await fetchJSON('/api/daily-feed/status', {}, 10000);
      const badge = el('mobFeedBadge');
      if (badge && data.hasNew) badge.hidden = false;
    } catch {}
  },

  openFeed() { this.switchView('feed', el('bnFeed')); },

  /* ══════════════════════════════════════════
     서재 뷰
  ══════════════════════════════════════════ */

  async _loadLibraryView(forceRefresh) {
    /* 날짜 인풋 초기화 (최초 1회) */
    const startEl = el('libAiStart');
    const endEl   = el('libAiEnd');
    if (startEl && !startEl.value) {
      const today = new Date();
      const week  = new Date(today); week.setDate(today.getDate() - 6);
      startEl.value = toLocalDateStr(week);
      endEl.value   = toLocalDateStr(today);
    }

    if (state.libraryLoaded && !forceRefresh) return;

    const timelineEl = el('libTimeline');
    if (timelineEl) {
      timelineEl.innerHTML = `<div class="mob-loading"><span class="mob-spin"></span> 서재 불러오는 중…</div>`;
    }

    try {
      const data  = await fetchJSON(`/api/items?limit=500&sort=desc&mode=${this._modeEnum()}`, {}, 20000);
      const items = parseFeedsArray(data.items ?? data);

      /* state.items 에 병합 (상세 모달용) */
      items.forEach(item => {
        const id = item._id || item.id;
        if (!state.items.find(i => (i._id || i.id) === id)) state.items.push(item);
      });

      state.libraryItems  = items;   // 검색/필터용 전체 보관
      state.libraryFilter = 'all';

      /* 검색창 초기화 */
      const si = el('libSearchInput');
      if (si) si.value = '';
      const sc = el('libSearchClear');
      if (sc) sc.hidden = true;

      /* 카테고리 필터 탭 초기화 + 빈 카테고리 비활성화 */
      document.querySelectorAll('#libFilterBar .mob-tab').forEach(c => {
        c.classList.toggle('active', c.dataset.cat === 'all');
      });
      this._updateLibraryFilterState();

      this._renderLibraryTimeline(items);
      state.libraryLoaded = true;
    } catch (e) {
      if (timelineEl) {
        timelineEl.innerHTML = `<div class="mvw-lib-empty">
          <i class="ti ti-alert-circle"></i> 서재를 불러오지 못했습니다.<br>
          <small style="color:var(--text-3)">${e.message}</small>
        </div>`;
      }
    }
  },

  _renderLibraryTimeline(items, searchQ) {
    const timelineEl = el('libTimeline');
    if (!timelineEl) return;

    if (!items || items.length === 0) {
      timelineEl.innerHTML = searchQ
        ? `<div class="mvw-lib-empty"><i class="ti ti-zoom-question"></i><br>"${searchQ}" 검색 결과 없음</div>`
        : `<div class="mvw-lib-empty">
            <i class="ti ti-books"></i><br>
            아직 서재에 저장된 지식이 없어요.<br>
            <small style="color:var(--text-3);margin-top:4px;display:block">
              배달탭이나 카드에서 💾 버튼을 눌러 저장해보세요!
            </small>
          </div>`;
      return;
    }

    /* 날짜별 그룹핑 */
    const groups = {};
    items.forEach(item => {
      const raw  = item.createdAt || item.savedAt || item.date || '';
      const dateKey = raw ? raw.slice(0, 10) : '날짜 없음';
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(item);
    });

    const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

    let html = '';
    /* 날짜 내림차순 정렬 — '날짜 없음' 그룹은 항상 맨 뒤로 */
    const sortedKeys = Object.keys(groups).sort((a, b) => {
      if (a === '날짜 없음') return 1;
      if (b === '날짜 없음') return -1;
      return b.localeCompare(a);
    });
    sortedKeys.forEach(dateKey => {
      /* 날짜 헤더 */
      let headerLabel = dateKey;
      if (dateKey !== '날짜 없음') {
        const d = new Date(dateKey + 'T00:00:00');
        if (!isNaN(d)) {
          const m   = d.getMonth() + 1;
          const day = d.getDate();
          const dow = DAY_KO[d.getDay()];
          headerLabel = `${m}월 ${day}일 (${dow})`;
        }
      }

      html += `<div class="mvw-lib-date-section">
        <div class="mvw-lib-date-header">
          <i class="ti ti-calendar-event"></i> ${headerLabel}
          <span class="mvw-lib-date-count">${groups[dateKey].length}개</span>
        </div>
        <div class="mvw-lib-cards">`;

      groups[dateKey].forEach(item => {
        const m       = item.analysis || {};
        /* 제목 없으면 본문 첫 줄로 대체 */
        const firstLine = (item.text || item.summary || '').split('\n').map(l => l.trim()).filter(Boolean)[0] || '';
        const title   = m.title || item.title || firstLine.slice(0, 40) || '제목 없음';
        const sub     = (m.summary || item.summary || item.text || '').slice(0, 80);
        const cat     = this._catLabel(item.category || item.shelf || 'inbox');
        const type    = item.type || 'text';
        const typeIcon = { youtube:'ti-brand-youtube', image_analysis:'ti-photo-ai', text:'ti-file-text' }[type] || 'ti-file-text';
        const id      = item._id || item.id;

        const starredMark = item.starred ? `<span class="mob-card-star-badge">★</span>` : '';
        html += `<div class="mvw-lib-card" data-id="${id}" onclick="Mob._toggleDetail(this,'${id}')">
          <div class="swipe-layer-delete"><i class="ti ti-trash"></i></div>
          <div class="swipe-layer-star"><i class="ti ti-star"></i></div>
          <div class="mvw-lib-card-icon"><i class="ti ${typeIcon}"></i></div>
          <div class="mvw-lib-card-body">
            <div class="mvw-lib-card-title">${starredMark}${title}</div>
            ${sub ? `<div class="mvw-lib-card-sub">${sub}${sub.length >= 80 ? '…' : ''}</div>` : ''}
          </div>
          <span class="mvw-lib-card-cat">${cat}</span>
          <i class="ti ti-chevron-down mvw-lib-card-chev"></i>
        </div>`;
      });

      html += `</div></div>`;
    });

    timelineEl.innerHTML = html;
    if (searchQ) {
      const cntEl = document.createElement('div');
      cntEl.className = 'mvw-lib-search-count';
      cntEl.textContent = `검색 결과 ${items.length}개`;
      timelineEl.prepend(cntEl);
    }
    /* Feature 2: 스와이프 제스처 초기화 */
    timelineEl.querySelectorAll('.mvw-lib-card').forEach(card => {
      this._initSwipe(card, card.dataset.id);
    });
  },

  /* ── Feature 2: 스와이프 제스처 ── */
  _initSwipe(card, id) {
    let startX = 0, deltaX = 0;
    const THRESHOLD = 60, MAX = 80;
    card.addEventListener('touchstart', e => {
      startX = e.touches[0].clientX;
      deltaX = 0;
      card.style.transition = '';
    }, { passive: true });
    card.addEventListener('touchmove', e => {
      deltaX = e.touches[0].clientX - startX;
      if (Math.abs(deltaX) < 5) return;
      const move = Math.max(-MAX, Math.min(MAX, deltaX));
      card.style.transform = `translateX(${move}px)`;
      const delLayer = card.querySelector('.swipe-layer-delete');
      const starLayer = card.querySelector('.swipe-layer-star');
      if (delLayer)  delLayer.style.opacity  = deltaX < -10 ? Math.min(1, (-deltaX - 10) / 50) : '0';
      if (starLayer) starLayer.style.opacity = deltaX > 10  ? Math.min(1, (deltaX - 10) / 50)  : '0';
    }, { passive: true });
    card.addEventListener('touchend', () => {
      card.style.transition = 'transform 0.25s ease';
      card.style.transform  = '';
      const delLayer = card.querySelector('.swipe-layer-delete');
      const starLayer = card.querySelector('.swipe-layer-star');
      if (delLayer)  delLayer.style.opacity  = '0';
      if (starLayer) starLayer.style.opacity = '0';
      if (deltaX < -THRESHOLD) this._deleteItem(id, card);
      else if (deltaX > THRESHOLD) this._toggleStar(id);
    });
  },

  /* AI 아코디언 토글 */
  _toggleLibraryAI() {
    state.libraryAIOpen = !state.libraryAIOpen;
    const panel   = el('libAiPanel');
    const chevron = el('libAiChevron');
    if (panel)   panel.classList.toggle('open', state.libraryAIOpen);
    if (chevron) chevron.style.transform = state.libraryAIOpen ? 'rotate(180deg)' : '';
  },

  /* 간편 기간 칩 클릭 */
  _libPeriodChip(days, chipEl) {
    document.querySelectorAll('.mvw-lib-qchip').forEach(c => c.classList.remove('active'));
    chipEl.classList.add('active');

    const today = new Date();
    const from  = new Date(today); from.setDate(today.getDate() - (days - 1));
    const startEl = el('libAiStart');
    const endEl   = el('libAiEnd');
    if (startEl) startEl.value = toLocalDateStr(from);
    if (endEl)   endEl.value   = toLocalDateStr(today);
  },

  /* 날짜 직접 변경 시 간편 칩 해제 */
  _libDateChanged() {
    document.querySelectorAll('.mvw-lib-qchip').forEach(c => c.classList.remove('active'));
  },

  /* AI 리포트 생성 */
  async generateLibrarySummary() {
    const btn      = el('libAiRunBtn');
    const resultEl = el('libAiResult');
    const startDate = el('libAiStart')?.value;
    const endDate   = el('libAiEnd')?.value;

    if (!startDate || !endDate) {
      toast('시작일과 종료일을 선택해주세요', 'err'); return;
    }
    if (startDate > endDate) {
      toast('시작일이 종료일보다 늦을 수 없어요', 'err'); return;
    }

    btn.disabled = true;
    btn.innerHTML = `<span class="mob-spin"></span> AI 분석 중…`;
    if (resultEl) resultEl.innerHTML = '';

    try {
      const data = await fetchJSON('/api/summarize-library', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ startDate, endDate })
      }, 90000);

      if (!data.success) throw new Error(data.error || '분석 실패');

      const { report, keywords = [], itemCount = 0 } = data;
      const kwHtml = keywords.length
        ? `<div class="mvw-lib-ai-kw-row">${keywords.map(k => `<span class="mvw-lib-ai-kw">${k}</span>`).join('')}</div>`
        : '';

      const reportHtml = report.replace(/\n/g, '<br>');

      resultEl.innerHTML = `
        <div class="mvw-lib-ai-result-card">
          <div class="mvw-lib-ai-result-header">
            <i class="ti ti-sparkles"></i>
            <span>AI 리포트</span>
            <span class="mvw-lib-ai-result-meta">${startDate} ~ ${endDate} · ${itemCount}개 항목</span>
          </div>
          <div class="mvw-lib-ai-result-body">${reportHtml}</div>
          ${kwHtml}
        </div>`;

    } catch (e) {
      toast('리포트 생성 실패: ' + (e.message || '다시 시도해주세요'), 'err');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<i class="ti ti-rocket"></i> AI 리포트 생성`;
    }
  },

  /* ── 서재 카테고리 필터 탭 ── */
  setLibraryFilter(cat, chip) {
    state.libraryFilter = cat;
    document.querySelectorAll('#libFilterBar .mob-tab').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    const si = el('libSearchInput');
    if (si) si.value = '';
    const sc = el('libSearchClear');
    if (sc) sc.hidden = true;
    this._applyLibraryFilters();
  },

  /* 빈 도메인 탭 자동 비활성화 */
  _updateLibraryFilterState() {
    const items = state.libraryItems || [];
    document.querySelectorAll('#libFilterBar .mob-tab[data-cat]').forEach(btn => {
      const cat = btn.dataset.cat;
      if (cat === 'all') { btn.disabled = false; return; }
      if (cat === 'starred') { btn.disabled = !items.some(i => i.starred); return; }
      btn.disabled = !items.some(item => getItemDomain(item) === cat);
    });
  },

  /* 카테고리 필터 + 검색어 동시 적용 */
  _applyLibraryFilters(searchQ) {
    let items = state.libraryItems || [];
    const f   = state.libraryFilter;

    if (f && f !== 'all') {
      if (f === 'starred') {
        items = items.filter(item => item.starred);
      } else {
        items = items.filter(item => getItemDomain(item) === f);
      }
    }
    if (searchQ) {
      const qLow = searchQ.toLowerCase();
      items = items.filter(item => {
        const m = item.analysis || {};
        return [
          m.title || item.title || '',
          m.summary || item.summary || '',
          item.text || '',
          (m.keywords || item.keywords || []).join(' '),
        ].some(field => field.toLowerCase().includes(qLow));
      });
    }
    this._renderLibraryTimeline(items, searchQ);
  },

  /* ── 서재 인라인 실시간 검색 ── */
  onLibrarySearch(val) {
    const sc = el('libSearchClear');
    if (sc) sc.hidden = !val;
    clearTimeout(state.searchDebounce);
    if (!val.trim()) { this._applyLibraryFilters(); return; }
    state.searchDebounce = setTimeout(() => this._applyLibraryFilters(val.trim()), 150);
  },

  clearLibrarySearch() {
    const si = el('libSearchInput');
    if (si) si.value = '';
    const sc = el('libSearchClear');
    if (sc) sc.hidden = true;
    this._applyLibraryFilters();
  },

  _filterLibrary(q) { this._applyLibraryFilters(q); },

  openSummary() { this.switchView('summary', el('bnSummary')); },

  /* ══════════════════════════════════════════
     관리 뷰 (통계 대시보드)
  ══════════════════════════════════════════ */
  async _loadManageView() {
    try {
      /* 설정 + 아이템 병렬 로드 (모드 격리) */
      const [settingsResp, itemsResp] = await Promise.all([
        fetchJSON('/api/user/settings', {}, 10000),
        fetchJSON(`/api/items?limit=500&mode=${this._modeEnum()}`, {}, 20000)
      ]);
      this._renderDeliverySettings(settingsResp);
      const items = parseFeedsArray(itemsResp.items ?? itemsResp);
      this._renderManageView(items);
    } catch {
      el('statTotal').textContent  = '—';
      el('statStreak').textContent = '—';
      toast('관리 데이터 로드 실패', 'err');
    }
  },

  /* ══════════════════════════════════════════
     배달 설정 패널 렌더링 v25
     — 영어·중국어·미국시황·한국시황 4종 아코디언
  ══════════════════════════════════════════ */
  _renderDeliverySettings(data) {
    const user    = data?.user  || {};
    const feeds   = data?.available_feeds || [];
    const enabled = new Set(user.enabled_feeds || []);
    const cfg     = user.feed_settings || {};   /* { en_expr:{}, zh_expr:{}, us_market:{}, kr_market:{} } */

    /* 배달 시간 */
    const timeInput = el('dpDeliveryTime');
    if (timeInput) timeInput.value = user.delivery_time || '07:30';

    /* 허용 피드: 7종 (언어 2 + 시황 2 + 인문학 3) */
    const ALLOWED_IDS = ['en_expr', 'zh_expr', 'us_market', 'kr_market', 'hist_daily', 'quote_daily', 'idiom_daily'];
    const filtered         = feeds.filter(f => ALLOWED_IDS.includes(f.id));
    const langFeeds        = filtered.filter(f => f.type === 'language'   || f.id.includes('expr'));
    const marketFeeds      = filtered.filter(f => f.type === 'market'     || f.id.includes('market'));
    const humanitiesFeeds  = filtered.filter(f => f.type === 'humanities' || ['hist_daily','quote_daily','idiom_daily'].includes(f.id));

    /* ── 공통: 아코디언 행 + 패널 래퍼 생성기 ── */
    const wrapPanel = (sub, badgeTxt, panelBody) => `
      <div class="mvw-dp-sub-item mvw-dp-sub-item--cfg" id="${sub.id}Row">
        <div class="mvw-dp-sub-info" style="cursor:pointer"
             onclick="Mob._toggleFeedDetail('${sub.id}')">
          <span class="mvw-dp-sub-icon">${sub.icon || '📌'}</span>
          <div class="mvw-dp-sub-text">
            <div class="mvw-dp-sub-name">${sub.label}
              <span class="mvw-en-cfg-badge" id="${sub.id}Badge">${badgeTxt}</span>
            </div>
            <div class="mvw-dp-sub-desc">${sub.desc || ''}</div>
          </div>
          <i class="ti ti-chevron-down mvw-en-detail-chevron" id="${sub.id}Chevron"></i>
        </div>
        <label class="mvw-dp-toggle" style="flex-shrink:0">
          <input type="checkbox" id="sub_${sub.id}" ${enabled.has(sub.id) ? 'checked' : ''}/>
          <span class="mvw-dp-toggle-track"><span class="mvw-dp-toggle-thumb"></span></span>
        </label>
      </div>
      <div class="mvw-en-panel" id="${sub.id}Panel">
        <div class="mvw-en-inner">
          ${panelBody}
          <button class="mvw-en-save-btn" id="${sub.id}SaveBtn"
                  onclick="Mob._saveFeedSettings('${sub.id}')">
            <i class="ti ti-device-floppy"></i> 상세 옵션 저장
          </button>
        </div>
      </div>`;

    /* ── 언어 피드(영어/중국어) 패널 본문 ── */
    const langPanelBody = (feedId, themeOpts, defCount) => {
      const c = cfg[feedId]?.count  || defCount;
      const l = cfg[feedId]?.level  || 'intermediate';
      const t = cfg[feedId]?.themes || [];
      return `
        <div class="mvw-en-section">
          <div class="mvw-en-section-title">📦 배달 개수</div>
          <div class="mvw-chip-group" id="${feedId}CountChips">
            ${[5,7,10].map(n => `
            <button class="mvw-chip-btn${c===n?' active':''}" data-val="${n}"
                    onclick="Mob._selectChip(this,'${feedId}CountChips')">${n}개</button>`).join('')}
          </div>
        </div>
        <div class="mvw-en-section">
          <div class="mvw-en-section-title">🎯 집중 테마
            <span class="mvw-en-note">중복 선택 가능</span></div>
          <div class="mvw-theme-list">
            ${themeOpts.map(o => `
            <label class="mvw-theme-item">
              <input type="checkbox" value="${o.val}" ${t.includes(o.val)?'checked':''}/>
              <span class="mvw-theme-item-txt">${o.label}</span>
            </label>`).join('')}
          </div>
        </div>
        <div class="mvw-en-section">
          <div class="mvw-en-section-title">📊 난이도</div>
          <div class="mvw-level-group">
            <label class="mvw-level-item${l==='intermediate'?' active':''}">
              <input type="radio" name="${feedId}Level" value="intermediate"
                     ${l==='intermediate'?'checked':''}
                     onchange="this.closest('.mvw-level-group').querySelectorAll('.mvw-level-item').forEach(x=>x.classList.remove('active'));this.closest('.mvw-level-item').classList.add('active')"/>
              <span>🌱 초중급 <small>(Intermediate)</small></span>
            </label>
            <label class="mvw-level-item${l==='advanced'?' active':''}">
              <input type="radio" name="${feedId}Level" value="advanced"
                     ${l==='advanced'?'checked':''}
                     onchange="this.closest('.mvw-level-group').querySelectorAll('.mvw-level-item').forEach(x=>x.classList.remove('active'));this.closest('.mvw-level-item').classList.add('active')"/>
              <span>🔥 고급 <small>(Advanced)</small></span>
            </label>
          </div>
        </div>`;
    };

    /* ── 시황 피드(미국/한국) 패널 본문 ── */
    const marketPanelBody = (feedId) => {
      const mc = cfg[feedId]?.is_market_centric !== false;  /* 기본 true */
      const ma = cfg[feedId]?.is_macro_centric  !== false;  /* 기본 true */
      return `
        <div class="mvw-en-section">
          <div class="mvw-en-section-title">🎯 분석 집중도
            <span class="mvw-en-note">중복 선택 가능</span></div>
          <div class="mvw-theme-list">
            <label class="mvw-theme-item">
              <input type="checkbox" value="market_centric" ${mc?'checked':''}/>
              <span class="mvw-theme-item-txt">📊 증시/데이터 중심</span>
            </label>
            <div class="mvw-theme-item-hint">주요 지수·등락률·주요 종목 움직임 위주 드라이한 데이터 요약</div>
            <label class="mvw-theme-item">
              <input type="checkbox" value="macro_centric" ${ma?'checked':''}/>
              <span class="mvw-theme-item-txt">🌐 거시경제(Macro) 중심</span>
            </label>
            <div class="mvw-theme-item-hint">연준 금리·환율·유가·채권·지정학적 리스크 등 경제 흐름 서사형 분석</div>
          </div>
        </div>`;
    };

    /* ── 배지 텍스트 계산 ── */
    const langBadge   = (id, def) => {
      const c = cfg[id]?.count || def;
      const l = cfg[id]?.level || 'intermediate';
      return `${c}개 · ${l === 'advanced' ? '고급' : '초중급'}`;
    };
    const marketBadge = (id) => {
      const mc = cfg[id]?.is_market_centric !== false;
      const ma = cfg[id]?.is_macro_centric  !== false;
      if (mc && ma) return '증시+Macro';
      if (mc)       return '증시 중심';
      if (ma)       return 'Macro 중심';
      return '테마 없음';
    };
    const histBadge   = () => cfg['hist_daily']?.era || '상관없음';

    /* ── 테마 옵션 상수 ── */
    const EN_THEMES = [
      { val:'business_meeting', label:'💼 비즈니스 미팅'   },
      { val:'office_email',     label:'📧 오피스 이메일'   },
      { val:'daily_travel',     label:'✈️ 일상/여행 회화'  },
      { val:'drama_spoken',     label:'🎬 미드 구어체'     }
    ];
    const ZH_THEMES = [
      { val:'biz_hsk',     label:'💼 비즈니스 HSK 실무'   },
      { val:'biz_trip',    label:'✈️ 출장/식사 접대'       },
      { val:'daily_shop',  label:'🛍️ 일상 회화 및 쇼핑'   },
      { val:'drama_slang', label:'🎬 중드/유행어'          }
    ];

    /* ── 역사 피드 패널 본문 ── */
    const histPanelBody = () => {
      const era = cfg['hist_daily']?.era || '상관없음';
      const opts = [
        { val: '한국사',  label: '🐯 한국사' },
        { val: '세계사',  label: '🌍 세계사'  },
        { val: '상관없음', label: '🔀 상관없음' }
      ];
      return `
        <div class="mvw-en-section">
          <div class="mvw-en-section-title">🗓️ 역사 시대 선호</div>
          <div class="mvw-level-group">
            ${opts.map(o => `
            <label class="mvw-level-item${era === o.val ? ' active' : ''}">
              <input type="radio" name="hist_dailyEra" value="${o.val}"
                     ${era === o.val ? 'checked' : ''}
                     onchange="this.closest('.mvw-level-group').querySelectorAll('.mvw-level-item').forEach(x=>x.classList.remove('active'));this.closest('.mvw-level-item').classList.add('active')"/>
              <span>${o.label}</span>
            </label>`).join('')}
          </div>
        </div>`;
    };

    /* ── 간단 구독 행 (설정 없는 피드용 — toggle 만) ── */
    const wrapSimpleSub = (sub) => `
      <div class="mvw-dp-sub-item" id="${sub.id}Row">
        <div class="mvw-dp-sub-info">
          <span class="mvw-dp-sub-icon">${sub.icon || '📌'}</span>
          <div class="mvw-dp-sub-text">
            <div class="mvw-dp-sub-name">${sub.label}</div>
            <div class="mvw-dp-sub-desc">${sub.desc || ''}</div>
          </div>
        </div>
        <label class="mvw-dp-toggle" style="flex-shrink:0">
          <input type="checkbox" id="sub_${sub.id}" ${enabled.has(sub.id) ? 'checked' : ''}/>
          <span class="mvw-dp-toggle-track"><span class="mvw-dp-toggle-thumb"></span></span>
        </label>
      </div>`;

    /* ── 렌더링 ── */
    const subsList = el('dpSubsList');
    if (!subsList) return;

    if (filtered.length) {
      const en   = langFeeds.find(f => f.id === 'en_expr');
      const zh   = langFeeds.find(f => f.id === 'zh_expr');
      const hist = humanitiesFeeds.find(f => f.id === 'hist_daily');
      const quot = humanitiesFeeds.find(f => f.id === 'quote_daily');
      const idio = humanitiesFeeds.find(f => f.id === 'idiom_daily');

      subsList.innerHTML = `
        <div class="mvw-dp-group-label">🎓 언어 학습</div>
        ${en ? wrapPanel(en, langBadge('en_expr', 7),  langPanelBody('en_expr', EN_THEMES, 7)) : ''}
        ${zh ? wrapPanel(zh, langBadge('zh_expr', 5),  langPanelBody('zh_expr', ZH_THEMES, 5)) : ''}
        <div class="mvw-dp-group-label">📊 시황 분석</div>
        ${marketFeeds.map(mf => wrapPanel(mf, marketBadge(mf.id), marketPanelBody(mf.id))).join('')}
        <div class="mvw-dp-group-label">🏛️ 인문학</div>
        ${hist ? wrapPanel(hist, histBadge(), histPanelBody()) : ''}
        ${quot ? wrapSimpleSub(quot) : ''}
        ${idio ? wrapSimpleSub(idio) : ''}`;
    } else {
      subsList.innerHTML = `<div style="padding:12px 0;font-size:13px;color:var(--text-3)">설정 로드 실패</div>`;
    }

    /* 상태 칩 */
    const chip = el('dpStatusChip');
    if (chip) chip.textContent = `배달: ${user.delivery_time || '07:30'}`;
  },

  /* ── 피드별 상세 패널 토글 (범용) ── */
  _toggleFeedDetail(feedId) {
    const panel   = el(`${feedId}Panel`);
    const chevron = el(`${feedId}Chevron`);
    if (!panel) return;
    const open = panel.classList.toggle('open');
    if (chevron) chevron.style.transform = open ? 'rotate(180deg)' : '';
  },

  /* ── 칩 단일 선택 (범용) ── */
  _selectChip(btn, groupId) {
    el(groupId)?.querySelectorAll('.mvw-chip-btn')
      .forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  },

  /* ── 피드 상세 설정 저장 (영어·중국어·미국시황·한국시황 통합) ── */
  async _saveFeedSettings(feedId) {
    let settings = {};

    if (feedId === 'en_expr' || feedId === 'zh_expr') {
      const countBtn = el(`${feedId}CountChips`)?.querySelector('.mvw-chip-btn.active');
      settings.count  = countBtn ? Number(countBtn.dataset.val) : (feedId === 'zh_expr' ? 5 : 7);
      settings.themes = [...document.querySelectorAll(
        `#${feedId}Panel .mvw-theme-list input[type="checkbox"]:checked`)].map(cb => cb.value);
      const lvl       = document.querySelector(`#${feedId}Panel input[name="${feedId}Level"]:checked`);
      settings.level  = lvl?.value || 'intermediate';
    } else if (feedId === 'us_market' || feedId === 'kr_market') {
      /* 시황 피드 */
      const checked = [...document.querySelectorAll(
        `#${feedId}Panel .mvw-theme-list input[type="checkbox"]:checked`)].map(cb => cb.value);
      settings.is_market_centric = checked.includes('market_centric');
      settings.is_macro_centric  = checked.includes('macro_centric');
    } else if (feedId === 'hist_daily') {
      /* 역사 피드 — 시대 선호 */
      const eraInput = document.querySelector(`#hist_dailyPanel input[name="hist_dailyEra"]:checked`);
      settings.era   = eraInput?.value || '상관없음';
    } else {
      /* quote_daily, idiom_daily — 상세 설정 없음 */
      settings = {};
    }

    const btn = el(`${feedId}SaveBtn`);
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="mob-spin"></span> 저장 중…'; }

    try {
      await fetchJSON('/api/delivery-settings/all', {
        method : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ feedId, settings })
      });

      /* 배지 실시간 업데이트 */
      const badge = el(`${feedId}Badge`);
      if (badge) {
        if (feedId === 'en_expr' || feedId === 'zh_expr') {
          badge.textContent = `${settings.count}개 · ${settings.level === 'advanced' ? '고급' : '초중급'}`;
        } else if (feedId === 'us_market' || feedId === 'kr_market') {
          const { is_market_centric: mc, is_macro_centric: ma } = settings;
          badge.textContent = (mc && ma) ? '증시+Macro' : mc ? '증시 중심' : ma ? 'Macro 중심' : '테마 없음';
        } else if (feedId === 'hist_daily') {
          badge.textContent = settings.era || '상관없음';
        }
      }
      state.feedLoaded = false;  /* 다음 배달탭 진입 시 최신 설정으로 강제 재생성 */
      toast('✅ 설정 저장! 배달탭에서 새 피드를 확인하세요.', 'ok', 4000);
    } catch {
      toast('설정 저장 실패', 'err');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-device-floppy"></i> 상세 옵션 저장'; }
    }
  },

  /* ── 배달 옵션 패널 슬라이드 토글 ── */
  _toggleDeliveryOptions() {
    const panel   = el('dpOptionsPanel');
    const chevron = el('dpOptionsChevron');
    if (!panel) return;
    const open = panel.classList.toggle('open');
    if (chevron) chevron.style.transform = open ? 'rotate(180deg)' : '';
  },

  /* 배달 설정 저장 */
  async _saveDeliverySettings() {
    const delivTime = el('dpDeliveryTime')?.value || '07:30';
    /* 구독 토글만 수집 — 상세 패널 안의 테마 체크박스(sub_ 접두사 없음)는 제외 */
    const cbs = document.querySelectorAll('#dpSubsList input[type="checkbox"][id^="sub_"]');
    const enabled_feeds = [...cbs].filter(c => c.checked).map(c => c.id.replace('sub_',''));

    const btn = el('dpSaveBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="mob-spin"></span> 저장 중…'; }

    try {
      await fetchJSON('/api/user/settings', {
        method : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ delivery_time: delivTime, enabled_feeds })
      });
      const chip = el('dpStatusChip');
      if (chip) chip.textContent = `배달: ${delivTime}`;
      toast('✅ 배달 설정이 저장됐습니다!', 'ok');
    } catch {
      toast('설정 저장 실패', 'err');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-device-floppy"></i> 설정 저장'; }
    }
  },

  /* 피드 지금 생성 (수동 트리거) */
  async _generateFeedNow() {
    const btn = el('dpGenBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="mob-spin"></span> AI 생성 중…'; }

    try {
      const data = await fetchJSON('/api/daily-feed/generate', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ force: true })
      }, 180000); /* Gemini + Claude 백업 최대 3분 */

      state.feedLoaded = false; /* 배달탭 진입 시 서버에서 새 데이터 로드 */
      toast(`✅ ${data.count || 0}개 피드 생성 완료! 배달탭으로 이동합니다 🚀`, 'ok', 3000);

      /* 1초 후 배달탭으로 자동 이동 */
      setTimeout(() => this.switchView('feed', el('bnFeed')), 1000);
    } catch {
      toast('피드 생성 실패 — API 키 또는 네트워크 확인', 'err');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-refresh"></i> 지금 생성'; }
    }
  },

  _renderManageView(items) {
    const today = new Date(); today.setHours(0,0,0,0);

    el('statTotal').textContent = items.length;

    const todayCount = items.filter(i => {
      const d = new Date(i.createdAt); d.setHours(0,0,0,0);
      return d.getTime() === today.getTime();
    }).length;
    el('statTodayCount').textContent = todayCount;
    el('statStreak').textContent     = this._computeStreak(items);

    this._renderHeatmap(items);
    this._renderReviewQueue(items);
    this._renderWeeklyBars(items);
    this._renderCatBars(items);
    this._renderRecentItems(items);
  },

  /* ── Feature 6: 학습 히트맵 ── */
  _renderHeatmap(items) {
    const container = el('statHeatmap');
    if (!container) return;

    const WEEKS = 26;
    const today = new Date(); today.setHours(0,0,0,0);
    const dailyMap = {};
    items.forEach(i => {
      const d = new Date(i.createdAt); d.setHours(0,0,0,0);
      const key = d.toISOString().slice(0,10);
      dailyMap[key] = (dailyMap[key] || 0) + 1;
    });

    const COLORS = ['var(--border)', '#c6e48b', '#40c463', '#216e39'];
    const W = 14, GAP = 2, LABEL_H = 18;
    const totalW = WEEKS * (W + GAP);
    const totalH = 7 * (W + GAP) + LABEL_H;

    let svgCells = '';
    const monthLabels = {};
    for (let w = 0; w < WEEKS; w++) {
      for (let d = 6; d >= 0; d--) {
        const offset = (WEEKS - 1 - w) * 7 + d;
        const date   = new Date(today.getTime() - offset * 86400000);
        const key    = date.toISOString().slice(0,10);
        const cnt    = dailyMap[key] || 0;
        const color  = cnt === 0 ? COLORS[0] : cnt === 1 ? COLORS[1] : cnt <= 3 ? COLORS[2] : COLORS[3];
        const x      = w * (W + GAP);
        const y      = (6 - d) * (W + GAP) + LABEL_H;
        if (d === 0 && date.getDate() <= 7) {
          monthLabels[w] = date.toLocaleDateString('ko-KR', { month: 'short' });
        }
        svgCells += `<rect x="${x}" y="${y}" width="${W}" height="${W}" rx="2" fill="${color}"
          data-date="${key}" data-count="${cnt}" style="cursor:${cnt>0?'pointer':'default'}"
          onclick="${cnt>0?`Mob._heatmapClick('${key}','${cnt}')`:''}"
          title="${key}: ${cnt}개"/>`;
      }
    }
    let svgLabels = '';
    Object.entries(monthLabels).forEach(([w, label]) => {
      svgLabels += `<text x="${w * (W + GAP)}" y="${LABEL_H - 4}" font-size="9" fill="var(--text-3)">${label}</text>`;
    });

    container.innerHTML = `<svg viewBox="0 0 ${totalW} ${totalH}" xmlns="http://www.w3.org/2000/svg"
      style="width:100%;min-width:${Math.min(totalW,360)}px;display:block">
      ${svgLabels}${svgCells}
    </svg>`;
  },

  _heatmapClick(date, count) {
    toast(`${date}: ${count}개 저장`, 'ok');
  },

  /* ── Feature 3: 복습 큐 렌더링 ── */
  async _renderReviewQueue(items) {
    const block   = el('reviewQueueBlock');
    const listEl  = el('reviewQueueList');
    if (!block || !listEl) return;

    const today = new Date(); today.setHours(23,59,59,999);
    const due   = items.filter(i => i.reviewAt && new Date(i.reviewAt) <= today);

    if (!due.length) { block.hidden = true; return; }
    block.hidden = false;

    listEl.innerHTML = due.slice(0,10).map(item => {
      const m     = item.analysis || {};
      const title = m.title || item.title || (item.text || '').slice(0,40) || '제목 없음';
      const id    = item._id || item.id;
      return `<div class="mvw-review-item" data-id="${id}" onclick="Mob._toggleDetail(this,'${id}')">
        <div class="mvw-review-item-title">${title}</div>
        <span class="mvw-review-item-cat">${this._catLabel(item.category)}</span>
        <i class="ti ti-chevron-down mvw-review-item-chev"></i>
      </div>`;
    }).join('');
  },

  _computeStreak(items) {
    if (!items.length) return 0;
    const today = new Date(); today.setHours(0,0,0,0);
    const stamps = new Set(items.map(i => {
      const d = new Date(i.createdAt); d.setHours(0,0,0,0); return d.getTime();
    }));
    let streak = 0, cursor = today.getTime();
    while (stamps.has(cursor)) { streak++; cursor -= 86400000; }
    return streak;
  },

  _renderWeeklyBars(items) {
    const container = el('statWeekly');
    if (!container) return;
    const today = new Date(); today.setHours(0,0,0,0);
    const days  = Array.from({ length: 7 }, (_, i) => ({
      date: new Date(today.getTime() - (6 - i) * 86400000), count: 0
    }));
    items.forEach(item => {
      const d = new Date(item.createdAt); d.setHours(0,0,0,0);
      const idx = days.findIndex(day => day.date.getTime() === d.getTime());
      if (idx !== -1) days[idx].count++;
    });
    const maxCount = Math.max(...days.map(d => d.count), 1);
    container.innerHTML = days.map((day, i) => {
      const isToday = i === 6;
      const barH    = Math.max(4, Math.round((day.count / maxCount) * 56));
      return `
      <div class="mvw-wk-col">
        <div class="mvw-wk-bar-wrap">
          <div class="mvw-wk-bar${isToday?' today':''}" style="height:${barH}px"></div>
        </div>
        <div class="mvw-wk-day${isToday?' today':''}">${dayLabel(day.date)}</div>
        <div class="mvw-wk-num">${day.count || ''}</div>
      </div>`;
    }).join('');
  },

  _renderCatBars(items) {
    const container = el('statCatBars');
    if (!container) return;
    const CAT_LABELS = { en:'English', history:'History', economy:'Economy', youtube:'YouTube', inbox:'서랍' };
    const counts = {};
    items.forEach(i => {
      const cat = i.category || i.shelf || '기타';
      counts[cat] = (counts[cat] || 0) + 1;
    });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const maxVal = sorted[0]?.[1] || 1;
    if (!sorted.length) {
      container.innerHTML = `<div class="mob-loading" style="padding:12px 0;font-size:13px">데이터 없음</div>`;
      return;
    }
    container.innerHTML = sorted.map(([cat, cnt]) => `
      <div class="mvw-cat-row">
        <div class="mvw-cat-name">${CAT_LABELS[cat] || cat}</div>
        <div class="mvw-cat-bar-wrap">
          <div class="mvw-cat-bar-fill" style="width:${Math.round((cnt/maxVal)*100)}%"></div>
        </div>
        <div class="mvw-cat-count">${cnt}</div>
      </div>`).join('');
  },

  _renderRecentItems(items) {
    const container = el('statRecentList');
    if (!container) return;
    const TYPE_ICON = { youtube:'ti-brand-youtube', image_analysis:'ti-photo-ai', text:'ti-file-text' };
    const recent = [...items]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 6);
    if (!recent.length) {
      container.innerHTML = `<div class="mob-loading" style="padding:12px 0;font-size:13px">최근 항목 없음</div>`;
      return;
    }
    container.innerHTML = recent.map(item => {
      const m     = item.analysis || {};
      const title = m.title || item.title
                 || (item.text || item.summary || '').split('\n').map(l => l.trim()).filter(Boolean)[0]?.slice(0, 40)
                 || '제목 없음';
      const icon  = TYPE_ICON[item.type || 'text'] || 'ti-file-text';
      const id    = item._id || item.id;
      return `
      <div class="mvw-recent-item" data-id="${id}" onclick="Mob._toggleDetail(this,'${id}')">
        <div class="mvw-recent-icon"><i class="ti ${icon}"></i></div>
        <div class="mvw-recent-body">
          <div class="mvw-recent-title">${title}</div>
          <div class="mvw-recent-sub">${fmt(item.createdAt)}</div>
        </div>
        <i class="ti ti-chevron-down mvw-recent-arrow"></i>
      </div>`;
    }).join('');
  },

  /* ══════════════════════════════════════════
     지식 추가 모달
  ══════════════════════════════════════════ */
  openAdd() {
    const modal = el('mobAddModal');
    if (!modal) return;
    modal.hidden = false;
    el('mobAddInput')?.focus();
  },

  closeAdd() {
    el('mobAddModal').hidden = true;
    el('mobAddInput').value  = '';
    el('mobAddStatus').hidden = true;
    this.switchAddTab('text', el('mobAddTabText'));
    this.resetImageInput();
  },

  switchAddTab(tab, btn) {
    document.querySelectorAll('.mob-add-mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    el('mobAddTextPane').hidden  = (tab !== 'text');
    el('mobAddImagePane').hidden = (tab !== 'image');
  },

  async submitAdd() {
    const input  = el('mobAddInput');
    const status = el('mobAddStatus');
    const btn    = document.querySelector('#mobAddTextPane .mob-add-submit');
    const text   = input?.value.trim();
    if (!text) { toast('내용을 입력하세요'); return; }

    btn.disabled = true;
    btn.innerHTML = `<span class="mob-spin"></span> AI 분석 중…`;
    status.textContent = '처리 중입니다…'; status.hidden = false;

    try {
      const data = await fetchJSON('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, createdAt: new Date().toISOString(), mode: this._modeEnum() })
      }, 60000);
      if (!data.success) throw new Error(data.error || '처리 실패');
      toast('✅ 서재에 저장됐어요!', 'ok');
      this.closeAdd();
      this._loadHomeItems();
    } catch (e) {
      status.textContent = '실패: ' + (e.message || '다시 시도해주세요');
      toast('저장 실패', 'err');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<i class="ti ti-sparkles"></i> AI 분석하여 서재에 저장`;
    }
  },

  /* ── 이미지 분석 ── */
  handleImageSelect(input) {
    const file = input.files?.[0];
    if (!file) return;
    state.selectedImageFile = file;
    const previewImg = el('mobImgPreviewImg');
    if (previewImg) previewImg.src = URL.createObjectURL(file);
    el('mobImgPickArea').hidden   = true;
    el('mobImgPreviewRow').hidden = false;
    el('mobImgSubmitBtn').hidden  = false;
  },

  resetImageInput() {
    state.selectedImageFile = null;
    const input = el('mobImageInput');
    if (input) input.value = '';
    const previewImg = el('mobImgPreviewImg');
    if (previewImg) previewImg.src = '';
    el('mobImgPickArea').hidden   = false;
    el('mobImgPreviewRow').hidden = true;
    el('mobImgSubmitBtn').hidden  = true;
    el('mobImgStatus').hidden     = true;
    el('mobImgMemo').value        = '';
  },

  async submitImageAnalysis() {
    if (!state.selectedImageFile) { toast('이미지를 선택하세요'); return; }
    const btn    = el('mobImgSubmitBtn');
    const status = el('mobImgStatus');
    const memo   = el('mobImgMemo')?.value.trim() || '';

    btn.disabled = true;
    btn.innerHTML = `<span class="mob-spin"></span> AI 분석 중…`;
    status.textContent = '이미지를 분석하고 있습니다…'; status.hidden = false;

    try {
      const isExam = localStorage.getItem('userMode') === 'exam';
      const formData = new FormData();
      formData.append('image', state.selectedImageFile);
      if (memo) formData.append('memo', memo);
      if (isExam) {
        formData.append('mode', 'exam');
        formData.append('subject', ExamMob.selectedSubject || 'math');
        status.textContent = '오답을 분석하고 있습니다…';
      } else {
        formData.append('mode', 'work');   // 직장인 모드 명시 적재
      }

      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 90000);
      const res   = await fetch('/api/analyze-image', { method:'POST', body:formData, signal:ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '분석 실패');

      toast('🔬 이미지 분석 완료!', 'ok');
      this.closeAdd();
      this._loadHomeItems();
    } catch (e) {
      status.textContent = '실패: ' + (e.message || '다시 시도해주세요');
      toast('분석 실패', 'err');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<i class="ti ti-eye-spark"></i> AI 비서에게 분석 요청`;
    }
  },

  /* ══════════════════════════════════════════
     상세 모달 (v36 — 전면 강화)
  ══════════════════════════════════════════ */
  _findItem(id) {
    return [...state.items, ...state.feedItems, ...(state.libraryItems || [])]
      .find(i => (i._id || i.id) === id);
  },

  /* ── 인라인 아코디언 토글 (모달/바텀시트 완전 대체) ──
     클릭 시 카드 객체 하단에 상세 콘텐츠를 지연 빌드하여 펼침/접힘.
     max-height transition으로 부드럽게 확장. */
  _toggleDetail(trigger, id) {
    const host = trigger.closest('[data-id]');
    if (!host) return;
    let body = host.querySelector(':scope > .mob-inline-detail');
    if (!body) {
      const item = this._findItem(id);
      if (!item) return;
      body = document.createElement('div');
      body.className = 'mob-inline-detail';
      body.innerHTML = this._buildExpandBody(item, id);
      host.appendChild(body);
    }
    const opening = !host.classList.contains('inline-open');
    if (opening) {
      host.classList.add('inline-open');
      body.style.maxHeight = body.scrollHeight + 'px';
      body.addEventListener('transitionend', function h() {
        body.removeEventListener('transitionend', h);
        if (host.classList.contains('inline-open')) body.style.maxHeight = 'none';
      });
    } else {
      /* maxHeight:none → 픽셀값으로 리셋 후 0으로 애니메이션 */
      body.style.maxHeight = body.scrollHeight + 'px';
      requestAnimationFrame(() => {
        host.classList.remove('inline-open');
        body.style.maxHeight = '0';
      });
    }
  },

  /** 인라인 확장 본문 HTML 빌더 — 타입별 콘텐츠 섹션만 (버튼/평가/인사이트 제거) */
  _buildExpandBody(item, id) {
    const m    = item.analysis || {};
    const type = item.type || 'text';
    const cat  = item.category || item.shelf || 'inbox';

    /* 제목 결정 */
    let titleStr = m.title || item.title || '';
    if (!titleStr && cat === 'en') {
      const p = this._parseEnglishText(item.text || '');
      titleStr = p.expression || '';
    }
    if (!titleStr) {
      titleStr = (item.text || item.summary || '').split('\n').map(l => l.trim()).filter(Boolean)[0]?.slice(0, 70) || '제목 없음';
    }

    /* 날짜 · 출처 */
    const dateStr = item.createdAt ? fmt(item.createdAt) : (item.savedAt ? fmt(item.savedAt) : '');
    let srcHost = '';
    try { srcHost = item.source ? new URL(item.source).hostname : ''; } catch {}

    /* ── 타입별 본문 섹션 ── */
    let body = '';

    if (type === 'daily_delivery') {
      /* 오늘의 지식 배달 카드 */
      const s3 = (item.summary3 || item.text || '').replace(/\\n/g, '\n')
        .split('\n').map(l => l.trim().replace(/^[•\-·]\s*/, '')).filter(Boolean);
      const concepts = (item.concepts || []).slice(0, 5);
      if (s3.length) {
        body += `<div class="mob-detail-section">
          <div class="mob-detail-sec-label">핵심 요약</div>
          ${s3.map(l => `<div class="mob-detail-bullet"><span class="mob-detail-bullet-dot"></span><span>${l}</span></div>`).join('')}
        </div>`;
      }
      if (concepts.length) {
        body += `<div class="mob-detail-section">
          <div class="mob-detail-sec-label">핵심 개념</div>
          ${concepts.map(c => `<div class="mob-detail-concept">
            <span class="mob-detail-concept-term">${c.term || ''}</span>
            <span class="mob-detail-concept-desc">${c.desc || ''}</span>
          </div>`).join('')}
        </div>`;
      }
      if (item.reminder) {
        body += `<div class="mob-detail-reminder">✨ ${item.reminder}</div>`;
      }

    } else if (cat === 'en') {
      /* 영어 표현 아이템 */
      const p = this._parseEnglishText(item.text || '');
      const fields = [
        { label: '뜻',    val: p.meaning  },
        { label: '뉘앙스', val: p.nuance   },
        { label: '예문',  val: p.example  },
        { label: '연습',  val: p.practice },
      ].filter(f => f.val);
      body += `<div class="mob-detail-en-expr">${p.expression || titleStr}</div>`;
      if (fields.length) {
        body += `<div class="mob-detail-section">
          ${fields.map(f => `<div class="mob-detail-field-row">
            <span class="mob-detail-field-label">${f.label}</span>
            <span class="mob-detail-field-val">${f.val}</span>
          </div>`).join('')}
        </div>`;
      }

    } else if (type === 'language' && (item.vocabEntries || []).length) {
      /* 서재에 저장된 언어 피드 (vocabEntries 보유) */
      body += `<div class="mob-detail-section">
        <div class="mob-detail-sec-label">표현 목록</div>
        ${(item.vocabEntries || []).map(e => {
          const dlgLines = (e.dialogue || '').replace(/\\n/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
          const dlgHTML  = dlgLines.map(l => {
            if (/^(A|B|甲|乙):/.test(l)) {
              const ci = l.indexOf(':');
              const sp = l.slice(0, ci).trim();
              const isA = sp === 'A' || sp === '甲';
              return `<div class="mob-dlg-line ${isA ? 'mob-dlg-a' : 'mob-dlg-b'}">
                <span class="mob-dlg-speaker">${sp}</span>
                <span class="mob-dlg-text">${l.slice(ci + 1).trim()}</span>
              </div>`;
            }
            return `<div class="mob-dlg-line"><span class="mob-dlg-text">${l}</span></div>`;
          }).join('');
          return `<div style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--border)">
            <div class="mob-detail-en-expr" style="font-size:18px;margin-bottom:8px">${e.expression || ''}</div>
            ${[
              { label:'뜻',   val: e.meaning },
              { label:'뉘앙스', val: e.nuance },
              { label:'예문',  val: e.sourceSentence },
              { label:'연습',  val: e.practiceSentence },
            ].filter(f => f.val).map(f => `<div class="mob-detail-field-row">
              <span class="mob-detail-field-label">${f.label}</span>
              <span class="mob-detail-field-val">${f.val}</span>
            </div>`).join('')}
            ${dlgHTML ? `<div class="mob-detail-dialogue-wrap">
              <div class="mob-detail-sec-label" style="margin-top:10px">대화문</div>
              <div class="mob-detail-dialogue">${dlgHTML}</div>
            </div>` : ''}
          </div>`;
        }).join('')}
      </div>`;

    } else if (type === 'humanities') {
      /* 서재에 저장된 인문학 피드 */
      const sub = item.subType || '';
      if (sub === 'history') {
        const s3 = (item.summary3 || '').replace(/\\n/g, '\n').split('\n').map(l => l.trim().replace(/^[•\-·]\s*/, '')).filter(Boolean);
        if (item.era || item.period) {
          body += `<div style="font-size:12px;font-weight:700;color:var(--accent);margin-bottom:10px">🏛️ ${[item.era, item.period].filter(Boolean).join(' · ')}</div>`;
        }
        if (s3.length) {
          body += `<div class="mob-detail-section">
            <div class="mob-detail-sec-label">3줄 핵심 요약</div>
            ${s3.map(l => `<div class="mob-detail-bullet"><span class="mob-detail-bullet-dot"></span><span>${l}</span></div>`).join('')}
          </div>`;
        }
        if (item.summary) {
          body += `<div class="mob-detail-section">
            <div class="mob-detail-sec-label">전체 내용</div>
            <div class="mob-detail-full-text">${item.summary}</div>
          </div>`;
        }
        if (item.lesson) {
          body += `<div class="mob-detail-section">
            <div class="mob-detail-sec-label">💡 교훈</div>
            <div class="mob-detail-full-text">${item.lesson}</div>
          </div>`;
        }
        if (item.behindStory) {
          body += `<div class="mob-detail-section">
            <div class="mob-detail-sec-label">🕵️ 비하인드 스토리</div>
            <div class="mob-detail-full-text">${item.behindStory}</div>
          </div>`;
        }
      } else if (sub === 'quote') {
        body += `<div class="mob-detail-section">
          <div class="mob-detail-full-text" style="font-size:17px;font-style:italic;color:var(--text-1);line-height:1.6">
            "${item.quoteKo || item.quote || ''}"
          </div>
          ${item.quote && item.quoteKo ? `<div style="font-size:13px;color:var(--text-3);margin-top:6px">${item.quote}</div>` : ''}
          <div style="font-size:12px;color:var(--text-3);margin-top:10px;font-weight:700">
            — ${item.author || ''}${item.authorInfo ? ' · ' + item.authorInfo : ''}
          </div>
        </div>`;
        if (item.meaning || item.context) {
          body += `<div class="mob-detail-section">
            ${item.meaning ? `<div class="mob-detail-sec-label">의미</div><div class="mob-detail-full-text">${item.meaning}</div>` : ''}
            ${item.context ? `<div class="mob-detail-sec-label" style="margin-top:10px">맥락</div><div class="mob-detail-full-text">${item.context}</div>` : ''}
          </div>`;
        }
        if (item.behindStory) {
          body += `<div class="mob-detail-section">
            <div class="mob-detail-sec-label">🕵️ 비하인드 스토리</div>
            <div class="mob-detail-full-text">${item.behindStory}</div>
          </div>`;
        }
        if (item.application) {
          body += `<div class="mob-detail-section">
            <div class="mob-detail-sec-label">✨ 적용</div>
            <div class="mob-detail-full-text">${item.application}</div>
          </div>`;
        }
      } else if (sub === 'idiom') {
        body += `<div class="mob-detail-section">
          <div class="mob-detail-en-expr" style="font-size:20px">${item.idiom || titleStr}</div>
          ${item.hanja ? `<div style="font-size:13px;color:var(--text-3);margin-bottom:8px">${item.hanja}</div>` : ''}
          ${item.meaning ? `<div class="mob-detail-full-text">${item.meaning}</div>` : ''}
        </div>`;
        if (item.origin || item.story) {
          body += `<div class="mob-detail-section">
            ${item.origin ? `<div class="mob-detail-sec-label">📖 유래</div><div class="mob-detail-full-text">${item.origin}</div>` : ''}
            ${item.story  ? `<div class="mob-detail-sec-label" style="margin-top:10px">이야기</div><div class="mob-detail-full-text">${item.story}</div>` : ''}
          </div>`;
        }
        if (item.behindStory) {
          body += `<div class="mob-detail-section">
            <div class="mob-detail-sec-label">🕵️ 비하인드 스토리</div>
            <div class="mob-detail-full-text">${item.behindStory}</div>
          </div>`;
        }
        if (item.application) {
          body += `<div class="mob-detail-section">
            <div class="mob-detail-sec-label">✨ 적용</div>
            <div class="mob-detail-full-text">${item.application}</div>
          </div>`;
        }
      }

    } else if (type === 'image_analysis') {
      if (item.imageUrl) {
        body += `<img src="${item.imageUrl}" alt="분석 이미지"
          style="width:100%;border-radius:12px;margin-bottom:0;object-fit:cover;max-height:220px;display:block"/>`;
      }
      const txt = m.summary || item.summary || item.text || '';
      if (txt) {
        body += `<div class="mob-detail-section">
          <div class="mob-detail-sec-label">분석 결과</div>
          <div class="mob-detail-full-text">${txt}</div>
        </div>`;
      }
      if (m.steps?.length) {
        body += `<div class="mob-detail-section">
          <div class="mob-detail-sec-label">단계별 분석</div>
          <ol style="padding-left:18px;font-size:14px;color:var(--text-2);line-height:1.8">
            ${m.steps.map(s => `<li>${s}</li>`).join('')}
          </ol>
        </div>`;
      }

    } else {
      /* 일반 텍스트 / YouTube / Economy / History 저장 항목 */
      const full = m.summary || item.summary || item.text || '';
      if (full) {
        body += `<div class="mob-detail-section">
          <div class="mob-detail-full-text">${full}</div>
        </div>`;
      }
      if (m.steps?.length) {
        body += `<div class="mob-detail-section">
          <div class="mob-detail-sec-label">핵심 단계</div>
          <ol style="padding-left:18px;font-size:14px;color:var(--text-2);line-height:1.8">
            ${m.steps.map(s => `<li>${s}</li>`).join('')}
          </ol>
        </div>`;
      }
    }

    /* 키워드 */
    const kws = (m.keywords || item.keywords || []).slice(0, 6);
    if (kws.length) {
      body += `<div class="mob-detail-section">
        <div class="mob-detail-sec-label">키워드</div>
        <div class="mob-detail-kw-row">${kws.map(k => `<span class="mob-detail-kw-chip" onclick="Mob._searchByKeyword('${k.replace(/'/g,"&#39;")}')" style="cursor:pointer">${k}</span>`).join('')}</div>
      </div>`;
    }

    /* 원문 링크 (있을 때만) */
    if (item.source) {
      let srcLabel = '원문 보기';
      try { srcLabel = new URL(item.source).hostname; } catch {}
      body += `<div class="mob-detail-section">
        <a class="mob-inline-src-link" href="${item.source}" target="_blank" onclick="event.stopPropagation()">
          <i class="ti ti-external-link"></i> ${srcLabel}
        </a>
      </div>`;
    }

    return body || `<div class="mob-detail-section"><div class="mob-detail-full-text" style="color:var(--text-3)">추가 상세 내용이 없습니다.</div></div>`;
  },

  /* ── Feature 1: 즐겨찾기 ── */
  async _toggleStar(id) {
    const item = [...state.items, ...state.libraryItems].find(i => (i._id || i.id) === id);
    if (!item) return;
    const newStarred = !item.starred;
    try {
      await fetchJSON(`/api/items/${id}`, {
        method : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ starred: newStarred })
      });
      [state.items, state.libraryItems].forEach(arr => {
        const found = arr.find(i => (i._id || i.id) === id);
        if (found) found.starred = newStarred;
      });
      const btn = el(`starBtn_${id}`);
      if (btn) {
        btn.className = `mob-detail-action-btn mob-star-btn ${newStarred ? 'starred' : ''}`;
        btn.innerHTML = `<i class="ti ${newStarred ? 'ti-star-filled' : 'ti-star'}"></i>`;
      }
      toast(newStarred ? '★ 즐겨찾기에 추가됐습니다' : '☆ 즐겨찾기 해제됐습니다', 'ok');
      if (state.currentView === 'summary') this._renderLibraryTimeline(this._applyLibraryFilters());
    } catch { toast('즐겨찾기 실패', 'err'); }
  },

  /* ── Feature 4: 키워드 → 서재 검색 ── */
  _searchByKeyword(keyword) {
    this.switchView('summary', el('bnSummary'));
    const inject = () => {
      const si = el('libSearchInput');
      if (si) { si.value = keyword; this.onLibrarySearch(keyword); }
    };
    state.libraryLoaded ? inject() : setTimeout(inject, 600);
  },

  /* ══════════════════════════════════════════
     전역 검색 오버레이
  ══════════════════════════════════════════ */
  openSearch() {
    el('mobSearchOverlay').setAttribute('aria-hidden', 'false');
    setTimeout(() => el('mobSearchInput')?.focus(), 200);
  },

  closeSearch() {
    el('mobSearchOverlay').setAttribute('aria-hidden', 'true');
    this.clearSearch();
  },

  clearSearch() {
    el('mobSearchInput').value = '';
    el('mobSearchClear').hidden = true;
    el('mobSearchResults').innerHTML = `
      <div class="mob-search-hint">
        <i class="ti ti-search" style="font-size:36px;color:#d1d5db"></i>
        <p>검색어를 입력하세요</p>
      </div>`;
  },

  onSearchInput(val) {
    el('mobSearchClear').hidden = !val;
    clearTimeout(state.searchDebounce);
    if (!val.trim()) { this.clearSearch(); return; }
    state.searchDebounce = setTimeout(() => this._doSearch(val.trim()), 300);
  },

  async _doSearch(q) {
    const res = el('mobSearchResults');
    res.innerHTML = `<div class="mob-loading"><span class="mob-spin"></span></div>`;
    try {
      const data  = await fetchJSON(`/api/items?search=${encodeURIComponent(q)}&mode=${this._modeEnum()}`, {}, 15000);
      const items = parseFeedsArray(data.items ?? data);
      if (!items.length) {
        res.innerHTML = `<div class="mob-search-hint">
          <i class="ti ti-zoom-question" style="font-size:36px;color:#d1d5db"></i>
          <p>"${q}" 검색 결과 없음</p>
        </div>`;
        return;
      }
      let html = '';
      items.forEach(item => { html += this.cardHTML(item); });
      res.innerHTML = html;
      res.onclick = e => {
        const card = e.target.closest('.mob-card');
        if (card?.dataset.id) {
          /* state.items에 없으면 추가 */
          const id = card.dataset.id;
          const found = items.find(i => (i._id || i.id) === id);
          if (found && !state.items.find(i => (i._id || i.id) === id)) {
            state.items.push(found);
          }
          this._toggleDetail(card, id);
        }
      };
    } catch {
      res.innerHTML = `<div class="mob-search-hint" style="color:#ef4444">검색 실패</div>`;
    }
  },

  /* ══════════════════════════════════════════
     모달 일괄 닫기 (추가 모달만 — 상세는 인라인 아코디언)
  ══════════════════════════════════════════ */
  _hideAllModals() {
    ['mobAddModal'].forEach(id => {
      const m = el(id); if (m) m.hidden = true;
    });
  },

  /* ═══════════════════════════════════════
     Feature 8: AI 퀴즈 모드
  ═══════════════════════════════════════ */
  _selectQuizCat(cat, btn) {
    state.quiz.cat = cat;
    document.querySelectorAll('.mvw-quiz-cat-chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
  },

  async _startQuiz() {
    const startBtn = document.querySelector('.mvw-quiz-start-btn');
    if (startBtn) { startBtn.disabled = true; startBtn.textContent = '생성 중…'; }
    try {
      const seen = JSON.parse(localStorage.getItem('quiz-seen') || '[]');
      const data = await fetchJSON('/api/quiz/generate', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ category: state.quiz.cat, count: 5, excludeIds: seen })
      }, 60000);
      if (!data.quiz?.length) throw new Error('퀴즈 없음');
      if (data.newRound) toast('🔄 모든 문제를 풀었어요! 처음부터 다시 시작합니다', '', 3000);
      state.quiz.items    = data.quiz;
      state.quiz.current  = 0;
      state.quiz.score    = 0;
      state.quiz.answered = [];
      el('quizStart').hidden  = true;
      el('quizResult').hidden = true;
      el('quizPlay').hidden   = false;
      this._renderQuizQuestion();
    } catch (e) {
      toast('퀴즈 생성 실패: ' + e.message, 'err');
    } finally {
      if (startBtn) { startBtn.disabled = false; startBtn.innerHTML = '<i class="ti ti-rocket"></i> 퀴즈 시작 (5문제)'; }
    }
  },

  _renderQuizQuestion() {
    const q   = state.quiz;
    const cur = q.items[q.current];
    if (!cur) return;
    const pct = Math.round((q.current / q.items.length) * 100);
    el('quizProgressBar').style.width = `${pct}%`;
    el('quizCount').textContent       = `${q.current + 1} / ${q.items.length}`;
    el('quizQuestion').textContent    = cur.question;
    el('quizNextBtn').hidden          = true;

    const labels = ['A', 'B', 'C', 'D'];
    el('quizOptions').innerHTML = cur.options.map((opt, i) =>
      `<button class="mvw-quiz-btn" data-idx="${i}" onclick="Mob._answerQuiz('${labels[i]}')">${opt}</button>`
    ).join('');
  },

  _answerQuiz(selected) {
    const q   = state.quiz;
    const cur = q.items[q.current];
    if (!cur) return;
    const correct = selected === cur.answer;
    if (correct) q.score++;
    q.answered.push({ question: cur.question, selected, correct, explanation: cur.explanation });

    const labels = ['A', 'B', 'C', 'D'];
    el('quizOptions').querySelectorAll('.mvw-quiz-btn').forEach((btn, i) => {
      btn.disabled = true;
      if (labels[i] === cur.answer) btn.classList.add('correct');
      else if (labels[i] === selected && !correct) btn.classList.add('wrong');
    });
    el('quizNextBtn').hidden = false;
    if (cur.explanation) {
      const exp = document.createElement('div');
      exp.className   = 'mvw-quiz-explanation';
      exp.textContent = '💡 ' + cur.explanation;
      el('quizOptions').after(exp);
    }
  },

  _quizNext() {
    const q = state.quiz;
    const expEl = el('quizOptions')?.nextElementSibling;
    if (expEl?.classList.contains('mvw-quiz-explanation')) expEl.remove();
    q.current++;
    if (q.current >= q.items.length) { this._showQuizResult(); return; }
    this._renderQuizQuestion();
  },

  _showQuizResult() {
    const q   = state.quiz;
    const pct = Math.round((q.score / q.items.length) * 100);

    // 완료한 문제 ID를 seen에 추가 (최대 500개 보관)
    const newIds = q.items.map(i => i.id).filter(Boolean);
    if (newIds.length) {
      const prev = JSON.parse(localStorage.getItem('quiz-seen') || '[]');
      const merged = [...new Set([...prev, ...newIds])];
      localStorage.setItem('quiz-seen', JSON.stringify(merged.slice(-500)));
    }
    el('quizPlay').hidden   = true;
    el('quizResult').hidden = false;
    el('quizProgressBar').style.width = '100%';
    el('quizScoreCircle').innerHTML = `
      <div class="mvw-quiz-score-num">${q.score}<span style="font-size:20px">/${q.items.length}</span></div>
      <div style="font-size:14px;color:var(--text-2);margin-top:4px">${pct}% 정답</div>`;
    const msgs = ['💪 다시 도전해보세요!', '🙂 조금 더 노력해봐요', '👍 꽤 잘했어요!', '🎉 훌륭합니다!', '🏆 완벽!'];
    el('quizResultMsg').textContent = msgs[Math.min(4, Math.floor(pct / 25))];
    const wrong = q.answered.filter(a => !a.correct);
    el('quizWrongList').innerHTML = wrong.length
      ? `<div style="font-size:13px;font-weight:700;color:var(--text-2);margin-bottom:8px">틀린 문제</div>` +
        wrong.map(a => `<div class="mvw-quiz-wrong-item">
          <div style="font-size:13px;color:var(--text-1);margin-bottom:3px">${a.question}</div>
          <div style="font-size:12px;color:var(--text-3)">정답: ${a.selected} → ${a.explanation || ''}</div>
        </div>`).join('')
      : '';
  },

  _resetQuiz() {
    el('quizStart').hidden  = false;
    el('quizPlay').hidden   = true;
    el('quizResult').hidden = true;
    el('quizProgressBar').style.width = '0%';
  },

};

/* ── 백드롭 클릭 모달 닫기 (클릭된 .mob-modal 직접 닫기 + 일괄) ── */
document.addEventListener('click', e => {
  if (e.target.classList.contains('mob-modal')) {
    e.target.hidden = true;
    Mob._hideAllModals();
  }
});

/* ── ESC 키 ── */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    Mob.closeSearch();
    Mob._hideAllModals();
    if (typeof ExamMob !== 'undefined' && ExamMob.closeWrongDetail) ExamMob.closeWrongDetail();
  }
});

/* ── 초기화 ── */
document.addEventListener('DOMContentLoaded', () => Mob.init());
