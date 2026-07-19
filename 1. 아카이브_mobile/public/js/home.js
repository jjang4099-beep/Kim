/**
 * home.js — 홈 화면 + 앱 진입 + 공통 카드·상세·검색
 * ────────────────────────────────────────────
 * 담당: 앱 초기화(init)·모드 전환(직장인/수험생)·테마·뷰 전환(switchView),
 *       홈 피드 렌더(renderFeed/_loadHomeItems), 공통 카드(cardHTML/_cardV/_cardH/
 *       _cardEnglishV/_parseEnglishText), 상세 모달(_toggleDetail/_buildExpandBody),
 *       서재 검색(openSearch/_doSearch), 공통 액션(_catLabel/_openSource/_deleteItem),
 *       전역 이벤트 리스너(click/keydown/DOMContentLoaded)
 * 의존: core.js(전역·유틸·state·Mob). 배달/서재/관리/추가 메서드는 feed/library/manage/add.js.
 * 로드 순서: core.js → home.js → feed/library/manage/add.js → app_exam.js → pwa.js
 */

'use strict';

Object.assign(Mob, {

  /* ────────────────────────────────────────────
     초기화
  ────────────────────────────────────────────── */
  async init() {
    const loginScreen = el('loginScreen');
    const ok = await this.checkAuth();
    if (!ok) {
      if (loginScreen) loginScreen.hidden = false;
      return;
    }
    this._enterAppEntrance();

    const mode = localStorage.getItem('userMode');
    if (!mode) return; // 앱 진입 화면이 모드 선택을 처리함
    this._applyMode(mode);
    this._loadHomeItems();
    this.checkFeedBadge();
    this._initTheme();
    this._checkNewUserOnboarding();
  },

  /** 로그인 확인 후 스플래시→모드선택 진입 화면을 보여준다 (appEntrance) */
  _enterAppEntrance() {
    const entrance = el('appEntrance');
    if (!entrance) return;
    const splash = el('aepSplash');
    const select = el('aepSelect');
    entrance.style.display = 'flex';

    // 모드가 이미 선택된 경우: 로고 스플래시만 잠깐 보여주고 곧바로 앱으로(모드 선택 건너뜀)
    if (localStorage.getItem('userMode')) {
      setTimeout(() => {
        entrance.style.transition = 'opacity 0.4s ease';
        entrance.style.opacity    = '0';
        setTimeout(() => { entrance.style.display = 'none'; }, 400);
      }, 1500);
      return;
    }
    // 최초 진입: Phase 1 → Phase 2 (1.8초 후 스플래시 → 모드 선택)
    setTimeout(() => {
      splash.style.transition = 'opacity 0.4s ease';
      splash.style.opacity    = '0';
      setTimeout(() => {
        splash.style.display = 'none';
        select.style.display = 'flex';
      }, 400);
    }, 1800);
  },

  /**
   * 콜드스타트 온보딩(Feature 3) — 직장인 모드 신규 유저 감지.
   * 수험생 모드는 /api/exam/daily-knowledge가 매 홈 로드마다 오늘 것을 항상 서빙하므로
   * 콜드스타트 공백이 없어 대상 아님.
   */
  async _checkNewUserOnboarding() {
    if (this._modeEnum() !== 'PROFESSIONAL') return;
    if (localStorage.getItem('onboarding-shown')) return;
    try {
      const status = await fetchJSON(`/api/user/status?mode=${this._modeEnum()}`, {}, 8000);
      if (status?.isNewUser) {
        localStorage.setItem('onboarding-shown', '1');
        this._showOnboardingModal();
      }
    } catch {}
  },

  _showOnboardingModal() {
    const modal = document.createElement('div');
    modal.className = 'mob-onboarding-overlay';
    modal.innerHTML = `
      <div class="mob-onboarding-card">
        <div class="mob-onboarding-icon">🏛️</div>
        <h2 class="mob-onboarding-title">환영해요!</h2>
        <p class="mob-onboarding-desc">
          서재가 아직 비어있어요.<br>
          먼저 오늘의 엄선된 지식을 보여드릴게요.
        </p>
        <button class="mob-onboarding-btn" onclick="Mob._startWelcomeFeed()">시작하기</button>
      </div>`;
    document.body.appendChild(modal);
  },

  /**
   * 여행 아카이브(Feature 5) — IP 기반 국가 감지(권한 요청 없음).
   * pwa.js 초기화 진입점에서 지연 호출됨. 하루 1회만, 한국(KR)이면 아무것도 안 함.
   */
  async _checkTravelCountry() {
    try {
      const geo = await fetchJSON('https://ipapi.co/json/', {}, 6000);
      const code = geo?.country_code;
      if (!code || code === 'KR') return;

      const today = toLocalDateStr(new Date());
      const lastShown = localStorage.getItem('travel-country-shown');
      if (lastShown === `${code}-${today}`) return;   /* 하루 1회만 */
      localStorage.setItem('travel-country-shown', `${code}-${today}`);

      await this._showTravelBanner(code);
    } catch (e) {
      console.warn('[Travel] 국가 감지 실패:', e.message);
    }
  },

  /* 국가 데이터가 준비돼 있으면(사전 생성 콘텐츠만) 홈 상단에 배너 표시 */
  async _showTravelBanner(countryCode) {
    try {
      const data = await fetchJSON(`/api/country/${countryCode}`, {}, 8000);
      state.currentTravelCountry = data;

      document.getElementById('travelBanner')?.remove();
      const banner = document.createElement('div');
      banner.className = 'mob-travel-banner';
      banner.id = 'travelBanner';
      banner.innerHTML = `
        <span class="mob-travel-banner-icon">✈️</span>
        <span class="mob-travel-banner-text">${data.name} 도착을 환영해요</span>
        <button onclick="Mob._openTravelArchive()">더 알아보기</button>
        <button class="mob-travel-banner-close" onclick="this.parentElement.remove()">
          <i class="ti ti-x"></i>
        </button>`;
      el('viewHome')?.prepend(banner);
      toast(`✈️ ${data.name} 도착! 여행 정보를 확인해보세요`, 'ok', 5000);
    } catch {
      /* 아직 생성 안 된 국가는 조용히 스킵 — 에러 노출 안 함 */
    }
  },

  _openTravelArchive() {
    const data = state.currentTravelCountry;
    if (!data) return;

    document.getElementById('travelFullscreen')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'mob-travel-fullscreen';
    overlay.id = 'travelFullscreen';
    overlay.innerHTML = `
      <div class="mob-travel-header">
        <button onclick="document.getElementById('travelFullscreen').remove()"><i class="ti ti-x"></i></button>
        <span>${data.name} 아카이브</span>
      </div>
      <div class="mob-travel-tabs">
        <button class="active" onclick="Mob._travelTab('overview',this)">개요</button>
        <button onclick="Mob._travelTab('history',this)">역사</button>
        <button onclick="Mob._travelTab('culture',this)">문화</button>
        <button onclick="Mob._travelTab('language',this)">언어</button>
        <button onclick="Mob._travelTab('practical',this)">실용정보</button>
      </div>
      <div class="mob-travel-content" id="travelContent"></div>`;
    document.body.appendChild(overlay);
    this._travelTab('overview', overlay.querySelector('.mob-travel-tabs button'));
  },

  _travelTab(tab, btn) {
    document.querySelectorAll('.mob-travel-tabs button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const data    = state.currentTravelCountry;
    const content = el('travelContent');
    if (!content || !data) return;

    const langLabel = { shopping: '쇼핑', restaurant: '식당', transport: '이동', emergency: '긴급' };

    const renderers = {
      overview: () => `
        <p class="mob-travel-summary">${data.overview.summary}</p>
        <div class="mob-travel-info-grid">
          <div>수도<b>${data.overview.capital}</b></div>
          <div>언어<b>${data.overview.language}</b></div>
          <div>통화<b>${data.overview.currency}</b></div>
          <div>시차<b>${data.overview.timezoneDiff}</b></div>
          <div>전압<b>${data.overview.voltage}</b></div>
        </div>`,
      history: () => data.history.map(h => `
        <div class="mob-travel-history-item">
          <span class="mob-travel-history-era">${h.era} · ${h.year}</span>
          <p>${h.event}</p>
        </div>`).join(''),
      culture: () => `
        <div class="mob-travel-culture-section">
          <h4>에티켓</h4>
          <ul>${data.culture.etiquette.map(e => `<li>${e}</li>`).join('')}</ul>
          <h4>음식</h4>
          <ul>${data.culture.food.map(f => `<li>${f}</li>`).join('')}</ul>
          <h4>알아두면 좋은 것</h4>
          <ul>${data.culture.funFacts.map(f => `<li>${f}</li>`).join('')}</ul>
        </div>`,
      language: () => Object.entries(data.language).map(([cat, phrases]) => `
        <div class="mob-travel-lang-section">
          <h4>${langLabel[cat] || cat}</h4>
          ${phrases.map(p => `
            <div class="mob-travel-phrase">
              <span>${p.ko}</span>
              <span class="mob-travel-phrase-local">${p.local} <i>(${p.pron})</i></span>
            </div>`).join('')}
        </div>`).join(''),
      practical: () => `
        <div class="mob-travel-practical">
          <div class="mob-travel-practical-item"><b>긴급전화</b> ${data.practical.emergencyPhone}</div>
          <div class="mob-travel-practical-item"><b>비자</b> ${data.practical.visa}</div>
          <h4>실용 팁</h4>
          <ul>${data.practical.tips.map(t => `<li>${t}</li>`).join('')}</ul>
        </div>`,
    };

    content.innerHTML = renderers[tab] ? renderers[tab]() : '';
  },

  /* 웰컴 피드 — AI 호출 없는 DB-first 구독 4종만 즉시 렌더(cardHTML 재사용) */
  async _startWelcomeFeed() {
    document.querySelector('.mob-onboarding-overlay')?.remove();
    this._welcomeFeedActive = true;
    try {
      const data  = await fetchJSON(`/api/daily-feed/welcome?mode=${this._modeEnum()}`, {}, 20000);
      const feeds = data?.feeds || [];
      if (!feeds.length) { toast('엄선 콘텐츠를 불러오지 못했어요', 'err'); return; }
      state.feedItems = feeds;
      this.switchView('feed', el('bnFeed'));
      const content = el('mobFeedViewContent');
      if (content) content.innerHTML = feeds.map(f => this.cardHTML(f)).join('');
      toast('엄선된 지식으로 시작해보세요', 'ok');
    } catch {
      toast('불러오기 실패', 'err');
    }
  },

  setMode(mode) {
    const prevMode = localStorage.getItem('userMode');
    localStorage.setItem('userMode', mode);
    const switching = prevMode && prevMode !== mode;
    /* 떠나는 모드의 표시 상태를 메모리 버킷에 보관(서버 데이터 아님, 순수 클라이언트 캐시) */
    if (switching) this._snapshotMode(prevMode);

    const enter = () => {
      this._applyMode(mode);
      /* 이번 세션에 이미 열었던 모드면 → 캐시 복원으로 깜빡임 없이 즉시 렌더 */
      const restored = switching && this._restoreMode(mode);
      if (restored) {
        this.renderFeed(state.items);
        this.checkFeedBadge();
        this._loadHomeItems(state.currentCat, true);   /* 조용히 최신화(스피너·빈화면 없음) */
        if (state.currentView === 'summary') this._loadLibraryView(true);
        if (state.currentView === 'feed')    this._loadFeedView(true);
        if (state.currentView === 'manage')  this._loadManageView();
      } else {
        /* 첫 진입(또는 첫 모드 선택) — 기존대로 격리 초기화 후 로드 */
        if (switching) this._resetModeState();
        this._loadHomeItems();
        this.checkFeedBadge();
        if (state.currentView === 'manage')  this._loadManageView();
        if (state.currentView === 'summary') this._loadLibraryView(true);
        if (state.currentView === 'feed')    this._loadFeedView(true);
      }
    };

    const entrance = el('appEntrance');
    const isVisible = entrance && entrance.style.display !== 'none';
    if (isVisible) {
      entrance.classList.add('app-entrance-out');
      setTimeout(() => { entrance.style.display = 'none'; enter(); }, 650);
    } else {
      enter();
    }
  },

  /* 모드별 표시 상태 버킷 — 전환해도 다시 안 받게 메모리에 보관 */
  _modeBuckets: { work: null, exam: null },

  /** 현재 화면 상태를 해당 모드 버킷에 스냅샷 */
  _snapshotMode(mode) {
    this._modeBuckets[mode] = {
      items:            state.items,
      feedItems:        state.feedItems,
      feedLoaded:       state.feedLoaded,
      examDaily:        state.examDaily,
      currentCat:       state.currentCat,
      activeFeedFilter: state.activeFeedFilter,
      examSavedIds:     this._examSavedIds,
    };
  },

  /** 모드 버킷이 있으면 화면 상태를 복원하고 true. 없으면 false */
  _restoreMode(mode) {
    const b = this._modeBuckets[mode];
    if (!b) return false;
    state.items            = b.items     || [];
    state.feedItems        = b.feedItems || [];
    state.feedLoaded       = b.feedLoaded;
    state.examDaily        = b.examDaily || null;
    state.currentCat       = b.currentCat || 'all';
    state.activeFeedFilter = b.activeFeedFilter || 'all';
    this._examSavedIds     = b.examSavedIds;
    /* 서재는 모드별 DOM 오염 방지 위해 방문 시 재조회하도록 무효화 */
    state.libraryItems  = [];
    state.libraryLoaded = false;
    /* 홈 탭 active 표시도 복원 */
    document.querySelectorAll('.mob-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.cat === state.currentCat));
    return true;
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
    /* 지식 순환 상태 — 이전 모드 태그/날짜 선택이 넘어오지 않도록 초기화 */
    state.libraryTag          = null;
    state.librarySelectedDate = null;
    state.libraryCalMonth     = null;
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
    /* 사진 첨부 버튼 세트는 선택 시점에 모드별로 토글되므로 여기선 항상 숨김 리셋 */
    el('examImgBtnRow')?.setAttribute('hidden', '');
    el('mobImgSubmitBtn')?.setAttribute('hidden', '');
  },

  /* ══════════════════════════════════════════
     테마 환경설정 (라이트 Papyrus / 다크 Midnight)
  ══════════════════════════════════════════ */
  _initTheme() {
    const saved = localStorage.getItem('app-theme') || 'light'; // 기본: Papyrus
    document.documentElement.setAttribute('data-theme', saved);
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
      this._loadLibraryView(true);   /* 탭 포커스마다 항상 fresh fetch */
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

    /* ② 수험생 모드 — 오늘의 영어단어 + 한국사 배달 (직장인 배달 원천은 배제) */
    if (this._modeEnum() === 'EXAM_PREP') {
      state.feedItems = [];
      try {
        const ex = await fetchJSON('/api/exam/daily-knowledge', {}, 10000);
        if (ex?.success) {
          state.examDaily = ex;
          this.renderFeed(state.items);
        }
      } catch {}
      return;
    }

    /* ③ 배달 피드 미리보기 — 직장인(전문직) 모드 전용 */
    if (state.feedItems.length > 0) return;
    try {
      const status = await fetchJSON('/api/daily-feed/status', {}, 5000);
      if (!status?.allReady) return;   /* 미생성 상태면 스킵 — 배달탭에서 생성 */
      if (this._welcomeFeedActive) return;
      const data = await fetchJSON(`/api/daily-feed?${modeParam}`, {}, 20000);
      /* await 사이 온보딩 웰컴 피드가 먼저 표시됐을 수 있음 — 할당 직전 재확인(Feature 3 — 레이스 방지) */
      if (this._welcomeFeedActive) return;
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

    /* ── 피드/수험 상태 먼저 확인 (빈 상태 판단에 필요) ── */
    const hasFeedPreview = state.feedItems && state.feedItems.length > 0;
    const ex = (this._modeEnum() === 'EXAM_PREP') ? state.examDaily : null;
    /* 저장된 수험 지식 id 동기화 — 단어/팩/한국사 토글 상태가 새로고침 후에도 유지 */
    if (ex) this._examSavedIds = new Set((state.items || []).map(i => i.id));
    const examCards = ex ? [ex.vocab ? 1 : 0, ex.history ? 1 : 0].reduce((a, b) => a + b, 0) : 0;
    const hasExamDaily = examCards > 0;

    /* ── 전체 빈 상태 — DB·배달·수험 모두 없을 때만 ── */
    if ((!items || items.length === 0) && !hasFeedPreview && !hasExamDaily) {
      feed.innerHTML = `<div class="mob-loading">
        <i class="ti ti-mood-empty"></i>&nbsp;아직 지식이 없어요.&nbsp;
        ➕ 버튼을 눌러 첫 번째를 저장해 보세요!
      </div>`;
      if (load) feed.prepend(load);
      return;
    }

    /* ── 최신순 정렬 ── */
    const sorted = [...(items || [])].sort((a, b) =>
      new Date(b.createdAt) - new Date(a.createdAt)
    );

    /* ── 오늘 / 지난 지식 분리 ── */
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);

    /* daily_delivery는 배달 미리보기/배달탭에서만 표시 — 홈 today/past에서 제외
       life 항목은 관리탭 토글 ON일 때만 홈에 표시 */
    const showLife = localStorage.getItem('showLifeOnHome') === 'true';
    const userItems = sorted.filter(i =>
      i.type !== 'daily_delivery' &&
      (showLife || i.category !== 'life')
    );

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
    html += `
      <div class="mob-section-hd today">
        <span>오늘 배달된 지식</span>
        <span class="mob-section-badge">${todayItems.length + (hasFeedPreview ? state.feedItems.length : 0) + examCards}개</span>
      </div>`;

    /* ── 수험생 모드 배달 카드 (영어단어 + 한국사) ── */
    if (hasExamDaily) {
      html += '<div class="mob-card-list">';
      if (ex.vocab)   html += this._cardExamVocab(ex.vocab, true);   /* 홈: 접힘(더 보기) */
      if (ex.history) html += this._cardExamHistory(ex.history);
      html += '</div>';
    }

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

    if (todayItems.length === 0 && !hasFeedPreview && !hasExamDaily) {
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

    /* ── [지난 지식] 섹션 — Fisher-Yates 셔플 후 평면 렌더링 ── */
    if (pastItems.length > 0) {
      /* Fisher-Yates 인플레이스 셔플 */
      const shuffled = [...pastItems];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      html += `
        <div class="mob-section-hd past" id="pastSection">
          <span>지난 지식 복습하기</span>
          <span class="mob-section-badge">${shuffled.length}개</span>
        </div>`;
      html += '<div class="mob-card-list">';
      shuffled.forEach(item => {
        html += item.type === 'daily_delivery'
          ? this._cardDlvSummary(item)
          : this.cardHTML(item);
      });
      html += '</div>';
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
    const arch    = FEED_ARCHIVE_MAP?.[subId] || { code: '◆', full: item.label || '지식' };
    const title   = item.title   || item.label || '오늘의 지식';
    const summary = item.summary || '';
    const extra   = item.vocabEntries?.length ? ` · ${item.vocabEntries.length} Entries` : '';
    const snippet = summary.length > 62 ? summary.slice(0, 60) + '…' : summary;

    return `
    <button class="mob-feed-preview-card"
            onclick="event.stopPropagation();Mob._goToFeedFiltered('${subId}')">
      <div class="mob-fpc-pillar arch-${(arch.code || '').toLowerCase()}">
        <span class="mob-fpc-code">${arch.code}</span>
        <span class="mob-fpc-rule"></span>
      </div>
      <div class="mob-fpc-content">
        <span class="mob-fpc-cat">${arch.full}${extra}</span>
        <div class="mob-fpc-title">${title}</div>
        ${snippet ? `<div class="mob-fpc-summary">${snippet}</div>` : ''}
      </div>
      <i class="ti ti-chevron-right mob-fpc-arrow"></i>
    </button>`;
  },

  /** 홈 미리보기 카드 클릭 → 배달탭으로 이동 + 해당 필터 활성화 */
  _goToFeedFiltered(subId) {
    state.pendingFeedFilter = subId || 'all';
    this.switchView('feed', el('bnFeed'));
  },

  /* ══════════════════════════════════════════
     수험생 모드 배달 카드 — 영어 단어 / 한국사
  ══════════════════════════════════════════ */

  /** 오늘의 수능 영어 단어 팩 카드 — 단어별 저장 토글 */
  _cardExamVocab(v, collapsed = false) {
    if (!v || !v.words?.length) return '';
    const saved = this._examSavedIds?.has(`exv_${v.packId}`);
    const PREVIEW = 3;   /* 홈에서는 앞 N개만 보이고 나머지는 '더 보기'로 펼침 */
    const words = v.words.map(w => {
      const wSaved = this._examSavedIds?.has(`exw_${v.packId}_${w.id}`);
      return `
      <li class="mob-exv-word${wSaved ? ' saved' : ''}">
        <div class="mob-exv-word-main">
          <div class="mob-exv-word-top">
            <span class="mob-exv-term">${w.word}</span>
            ${w.pos ? `<span class="mob-exv-pos">${w.pos}</span>` : ''}
          </div>
          <div class="mob-exv-mean"><span class="blind-inscription" onclick="Mob._revealBlind(this,event)">${w.meaning}</span></div>
          ${w.exampleEn ? `<div class="mob-exv-ex">${w.exampleEn}${w.exampleKo ? `<span class="mob-exv-ex-ko">${w.exampleKo}</span>` : ''}</div>` : ''}
          ${w.csatRef ? `<div class="mob-exv-ref"><i class="ti ti-bookmark"></i> ${w.csatRef}</div>` : ''}
        </div>
        <button class="mob-exv-save${wSaved ? ' saved' : ''}"
          onclick="event.stopPropagation();Mob._toggleExamWord('${v.packId}','${w.id}',this)"
          title="${wSaved ? '서재에서 빼기' : '서재에 저장'}" aria-pressed="${wSaved ? 'true' : 'false'}">
          <i class="ti ti-${wSaved ? 'bookmark-filled' : 'bookmark'}"></i>
        </button>
      </li>`;
    }).join('');
    const useCollapse = collapsed && v.words.length > PREVIEW;
    return `
    <article class="mob-exam-card mob-exam-vocab">
      <div class="mob-exam-card-hd">
        <span class="mob-exam-badge">수능 영단어</span>
        <button class="mob-hum-save-btn${saved ? ' saved' : ''}"
          onclick="event.stopPropagation();Mob._saveExamKnowledge('vocab','${v.packId}',this)"
          title="${saved ? '저장됨 (전체)' : '단어 전체 저장'}" ${saved ? 'disabled' : ''}>
          <i class="ti ti-${saved ? 'bookmark-filled' : 'bookmarks'}"></i>
        </button>
      </div>
      <h3 class="mob-exam-title">${v.themeTitle}</h3>
      ${v.tip ? `<p class="mob-exam-tip">${v.tip}</p>` : ''}
      <ul class="mob-exv-list${useCollapse ? ' collapsed' : ''}" data-preview="${PREVIEW}">${words}</ul>
      ${useCollapse ? `<button class="mob-exv-more-btn" data-more="${v.words.length - PREVIEW}"
        onclick="event.stopPropagation();Mob._toggleExamVocabMore(this)">
        <span class="mob-exv-more-txt">단어 ${v.words.length - PREVIEW}개 더 보기</span>
        <i class="ti ti-chevron-down"></i>
      </button>` : ''}
    </article>`;
  },

  /* 은밀한 음각 가리기 — 터치하면 정답 노출(딥 미드나잇 네이비), 다시 누르면 가림 */
  _revealBlind(elm, ev) {
    if (ev) ev.stopPropagation();
    elm.classList.toggle('revealed');
  },

  /* 홈 영단어 카드 '더 보기/접기' 토글 */
  _toggleExamVocabMore(btn) {
    const ul = btn.closest('.mob-exam-vocab')?.querySelector('.mob-exv-list');
    if (!ul) return;
    const stillCollapsed = ul.classList.toggle('collapsed');
    btn.classList.toggle('open', !stillCollapsed);
    const txt = btn.querySelector('.mob-exv-more-txt');
    if (txt) txt.textContent = stillCollapsed ? `단어 ${btn.dataset.more}개 더 보기` : '접기';
  },

  /** 오늘의 한국사 지식 카드 */
  _cardExamHistory(h) {
    if (!h) return '';
    const saved = this._examSavedIds?.has(`exh_${h.id}`);
    return `
    <article class="mob-exam-card mob-exam-history">
      <div class="mob-exam-card-hd">
        <span class="mob-exam-badge hist">한국사${h.eraLabel ? ` · ${h.eraLabel}` : ''}</span>
        <button class="mob-hum-save-btn${saved ? ' saved' : ''}"
          onclick="event.stopPropagation();Mob._saveExamKnowledge('history','${h.id}',this)"
          title="${saved ? '저장됨' : '서재에 저장'}" ${saved ? 'disabled' : ''}>
          <i class="ti ti-${saved ? 'bookmark-filled' : 'bookmark'}"></i>
        </button>
      </div>
      <h3 class="mob-exam-title">${h.title}</h3>
      ${h.summary ? `<p class="mob-exam-summary">${h.summary}</p>` : ''}
      ${h.keyPoint ? `<div class="mob-exam-keypoint"><b>핵심</b> ${h.keyPoint}</div>` : ''}
      ${h.examTip ? `<div class="mob-insight-zone">
        <span class="mob-insight-zone-label">출제자의 눈 · INSIGHT</span>
        <span class="mob-insight-zone-text">${h.examTip}</span>
      </div>` : ''}
    </article>`;
  },

  /** 수험생 배달 지식을 서재(EXAM_PREP)에 저장 */
  async _saveExamKnowledge(kind, id, btn) {
    if (btn?.classList.contains('saved')) return;
    try {
      if (btn) { btn.disabled = true; btn.innerHTML = '<span class="mob-spin"></span>'; }
      const data = await fetchJSON('/api/exam/daily-knowledge/save', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ kind, id })
      });
      if (data.success) {
        (this._examSavedIds ||= new Set()).add(data.id);
        if (btn) {
          btn.classList.add('saved');
          btn.innerHTML = '<i class="ti ti-bookmark-filled"></i>';
          btn.title = '저장됨';
        }
        state.libraryLoaded = false;
        toast(data.alreadySaved ? '이미 저장된 지식입니다' : '서재에 저장됐습니다!', 'ok');
      }
    } catch {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-bookmark"></i>'; }
      toast('저장 실패', 'err');
    }
  },

  /** 단어 1개 서재 저장/해제 토글 */
  async _toggleExamWord(packId, wordId, btn) {
    if (!btn || btn.dataset.busy === '1') return;
    const itemId   = `exw_${packId}_${wordId}`;
    const isSaved  = btn.classList.contains('saved');
    const li       = btn.closest('.mob-exv-word');
    btn.dataset.busy = '1';
    const original = btn.innerHTML;
    btn.innerHTML  = '<span class="mob-spin"></span>';
    try {
      if (isSaved) {
        /* 해제 — 서재에서 제거 */
        const data = await fetchJSON(`/api/items/${itemId}`, { method: 'DELETE' });
        if (data.success === false) throw new Error(data.error || '');
        this._examSavedIds?.delete(itemId);
        btn.classList.remove('saved');
        li?.classList.remove('saved');
        btn.innerHTML = '<i class="ti ti-bookmark"></i>';
        btn.title = '서재에 저장';
        btn.setAttribute('aria-pressed', 'false');
        toast('서재에서 뺐어요', 'ok');
      } else {
        /* 저장 */
        const data = await fetchJSON('/api/exam/daily-knowledge/save', {
          method : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body   : JSON.stringify({ kind: 'word', id: wordId, packId })
        });
        if (!data.success) throw new Error(data.error || '');
        (this._examSavedIds ||= new Set()).add(data.id || itemId);
        btn.classList.add('saved');
        li?.classList.add('saved');
        btn.innerHTML = '<i class="ti ti-bookmark-filled"></i>';
        btn.title = '서재에서 빼기';
        btn.setAttribute('aria-pressed', 'true');
        toast(data.alreadySaved ? '이미 저장된 단어예요' : '단어를 서재에 저장했어요', 'ok');
      }
      state.libraryLoaded = false;
    } catch {
      btn.innerHTML = original;
      toast('처리 실패', 'err');
    } finally {
      btn.dataset.busy = '';
    }
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

    return `
    <div class="mob-card mob-dlv-summary" data-id="${id}">
      <div class="mob-dls-top">
        <span class="mob-dls-badge">${this._catLabel(cat)}</span>
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
    if (cat === 'life')            return this._cardLife(item);
    if (type === 'language')       return this._cardFeedLanguage(item);
    if (type === 'market')         return this._cardFeedMarket(item);
    if (type === 'humanities')     return this._cardFeedHumanities(item);
    // 영어 표현 카드 → 프리미엄 English 카드 (v37)
    // category 'en' 뿐 아니라 옛 저장분(category:'language')의 영어 표현도 동일 카드로
    if (this._isEnglishExpr(item))  return this._cardEnglishV(item);
    // 유튜브·이미지·썸네일 보유 → 가로형 썸네일 카드 (기존 유지)
    if (type === 'youtube' || type === 'image_analysis' ||
        item.thumbnail || m.thumbnail || item.imageUrl) {
      return this._cardH(item, m);
    }
    // 텍스트 지식 (History · Economy · Inbox) → 전폭 세로형 카드 v21
    return this._cardV(item, m);
  },

  /** 라이프 기록 카드 — 사진 포함 */
  _cardLife(item) {
    const id    = item._id || item.id || '';
    const life  = item.life || {};
    const photos = life.photos || [];
    const mood  = life.mood || '';
    const loc   = life.location ? `📍 ${life.location}` : '';
    const rawD  = item.createdAt || item.date || '';
    const dateStr = rawD
      ? (() => { const d = new Date(rawD); return isNaN(d) ? '' : `${d.getMonth()+1}/${d.getDate()}`; })()
      : '';

    const MOOD_EMOJI = { great:'😄', good:'🙂', soso:'😐', bad:'😔', awful:'😞' };
    const moodIcon = MOOD_EMOJI[mood] || '📔';

    const photosHtml = photos.length
      ? `<div class="mob-life-card-photos">${
          photos.map(url => `<img class="mob-life-card-photo" src="${url}" loading="lazy" alt="사진">`).join('')
        }</div>`
      : '';

    return `
    <div class="mob-card mob-life-card" data-id="${id}">
      <div class="mob-life-card-header">
        <span class="mob-life-card-mood">${moodIcon}</span>
        <span class="mob-life-card-meta">${dateStr}${loc ? '  ' + loc : ''}</span>
        <button class="mob-life-card-del"
                onclick="event.stopPropagation();Mob._deleteItem('${id}',this.closest('.mob-card'))"
                title="삭제">
          <i class="ti ti-trash"></i>
        </button>
      </div>
      <div class="mob-life-card-text">${(item.text || '').replace(/</g,'&lt;')}</div>
      ${photosHtml}
    </div>`;
  },

  /** 영어 표현 아이템 판별 — category 'en' 또는 language 도메인의 영어 형식(중국어 'zh' 제외, "뜻:" 포함) */
  _isEnglishExpr(item) {
    const cat = item.category || '';
    if (cat === 'en') return true;
    if (cat === 'zh') return false;
    return getItemDomain(item) === 'language' && /(^|\n)\s*뜻\s*:/.test(item.text || '');
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

    const cat      = item.category || '';   /* exam 분기 판별용 — 미정의 버그 수정 */
    const domain   = getItemDomain(item);
    let   domMeta  = DOMAINS[domain] || { icon: '💡', label: '기타', color: '#6b7280' };
    /* 수험생 배달 저장분(exam_vocab/exam_history)은 8대 도메인 밖 — 전용 라벨로 보정 */
    if (cat === 'exam') {
      domMeta = item.type === 'exam_history'
        ? { icon: '🏛️', label: '한국사',     color: '#b45309' }
        : { icon: '🗽', label: '수능 영단어', color: '#2563eb' };
    }
    const catIcon  = domMeta.icon;
    const catLabel = domMeta.label;

    /* ── 제목 & 불릿 생성 (preview = 항상 보임 / detail = 접힐 때 숨김) ── */
    let title          = '';
    let previewBullets = [];   // 접혔을 때도 보임 (뜻 + 예문)
    let detailBullets  = [];   // 펼쳤을 때만 보임 (뉘앙스 + 연습 + 나머지)

    if (this._isEnglishExpr(item)) {
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
    const hasDetail   = detailBullets.length > 0 || allTagsHTML.length > 0;

    return `
    <div class="mob-card mob-card-v${hasDetail ? '' : ' no-detail'}" data-id="${id}" data-domain="${domain}">
      <div class="mob-card-v-top">
        <span class="mob-card-v-cat" style="--domain-color:${domMeta.color}">${catLabel} · ${dateStr}</span>
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

    // 우측 출처 아이콘 — 실제 http(s) URL일 때만 (내부 태그 'daily-feed' 등 제외)
    const srcIcon = (item.source && /^https?:\/\//i.test(item.source))
      ? `<a class="mob-card-h-src" href="${item.source}" target="_blank" rel="noopener"
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

  /* 배달 카드(언어/시황/인문학/데일리)는 feed.js ① 블록으로 분리 */

  _catLabel(catOrDomain) {
    if (!catOrDomain || catOrDomain === 'all') return '전체';
    const domain = DOMAINS[catOrDomain]
      ? catOrDomain
      : (CATEGORY_TO_DOMAIN[catOrDomain] || catOrDomain);
    return DOMAINS[domain]?.label || catOrDomain;
  },

  /* ──────────────────────────────────────────
     홈 카드 액션
  ────────────────────────────────────────── */
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

  /* 배달 뷰·배달 설정은 feed.js ② 블록으로 분리 */

  /* ══════════════════════════════════════════
     상세 모달 (v36 — 전면 강화)
     · 추가 모달은 add.js, 통계 대시보드·퀴즈는 manage.js로 분리
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

  /**
   * 배달 언어 entry → 원어민 비밀 노트 / Dialogue / Example 섹션 HTML (공유)
   * 지식배달 카드(feed.js)와 서재 상세(_buildExpandBody)가 동일 포맷을 쓰도록 한 곳에서 생성.
   */
  _fvEntrySections(e, isThemePack) {
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
    return [
      e.nuance         ? `<div class="mob-fv-sect"><div class="mob-fv-sect-lbl">${nuanceLbl}</div><div class="mob-fv-sect-txt">${e.nuance}</div></div>` : '',
      dlgHTML          ? `<div class="mob-fv-sect"><div class="mob-fv-sect-lbl">Dialogue</div><div class="mob-fv-dlg">${dlgHTML}</div></div>` : '',
      e.sourceSentence ? `<div class="mob-fv-sect"><div class="mob-fv-sect-lbl">Example</div><div class="mob-fv-sect-txt mob-fv-italic">"${e.sourceSentence}"</div>${e.practiceSentence ? `<div class="mob-fv-sect-txt mob-fv-practice">${e.practiceSentence}</div>` : ''}</div>` : ''
    ].filter(Boolean).join('');
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

    } else if ((type === 'language' || cat === 'en') &&
               ((item.vocabEntries || []).length || (item.feedData?.vocabEntries || []).length)) {
      /* 서재에 저장된 언어 피드 — 지식배달과 동일한 풍부한 포맷
         (원어민 비밀 노트 / Dialogue / Example). 데이터는 top-level 또는 feedData에서. */
      const fd          = item.feedData || {};
      const vEntries    = (item.vocabEntries && item.vocabEntries.length) ? item.vocabEntries : (fd.vocabEntries || []);
      const themeTitle  = item.themeTitle   || fd.themeTitle   || '';
      const themeTitleEn= item.themeTitleEn || fd.themeTitleEn || '';
      const isThemePack = !!themeTitle;
      const masterPara  = item.masterParagraph || fd.masterParagraph || null;

      if (isThemePack) {
        body += `<div class="mob-fv-theme-band">
          <div class="mob-fv-theme-kicker">테마 팩</div>
          <div class="mob-fv-theme-title">${themeTitle}</div>
          ${themeTitleEn ? `<div class="mob-fv-theme-title-en">${themeTitleEn}</div>` : ''}
        </div>`;
      }

      body += `<div class="mob-feed-vocab-list mob-lib-vocab-list">` + vEntries.map((e, i) => {
        const sects = this._fvEntrySections(e, isThemePack);
        return `
        <div class="mob-fv-item mob-lib-fv-item">
          <div class="mob-fv-front">
            <span class="mob-fv-num">${i + 1}</span>
            <div class="mob-fv-main">
              <div class="mob-fv-expr">${e.expression || ''}</div>
              <div class="mob-fv-meaning">${e.meaning || ''}</div>
            </div>
          </div>
          ${sects ? `<div class="mob-lib-fv-body">${sects}</div>` : ''}
        </div>`;
      }).join('') + `</div>`;

      if (masterPara && this._renderMasterParagraph) {
        body += this._renderMasterParagraph(masterPara);
      }

    } else if (cat === 'en') {
      /* 단건 영어 표현 아이템 (vocabEntries 없음) — 텍스트 파싱 폴백 */
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

    /* 원문 링크 — 실제 http(s) URL일 때만. ('daily-feed'·'image-upload' 등 내부 태그는 링크화 금지) */
    if (item.source && /^https?:\/\//i.test(item.source)) {
      let srcLabel = '원문 보기';
      try { srcLabel = new URL(item.source).hostname; } catch {}
      body += `<div class="mob-detail-section">
        <a class="mob-inline-src-link" href="${item.source}" target="_blank" rel="noopener" onclick="event.stopPropagation()">
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
    ['mobAddModal', 'categoryManagerModal'].forEach(id => {
      const m = el(id); if (m) m.hidden = true;
    });
    this._closeCategorySheet();
  },

  /* ══════════════════════════════════════════
     카테고리 확인 토스트 + 바텀시트
  ══════════════════════════════════════════ */
  _showCategoryConfirm(item) {
    if (!item) return;
    const catName = this._catLabel(item.category || item.domain) || '기타';
    const t = el('mobToast');
    if (!t) return;
    t.innerHTML = `<span>📁 <b>${catName}</b>로 분류됐어요</span>
      <button onclick="Mob._changeCategoryQuick('${item.id || item._id}')"
              style="margin-left:8px;text-decoration:underline;background:none;border:none;color:inherit;cursor:pointer;font-size:inherit">
        바꾸기
      </button>`;
    t.className = 'mob-toast ok';
    t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.hidden = true; t.textContent = ''; }, 6000);
  },

  async _changeCategoryQuick(itemId) {
    try {
      let cats = state.userCategories;
      if (!cats || !cats.length) {
        cats = await fetchJSON('/api/categories', {}, 10000);
        state.userCategories = cats;
      }
      this._showCategoryBottomSheet(itemId, cats);
    } catch { toast('카테고리 불러오기 실패', 'err'); }
  },

  _showCategoryBottomSheet(itemId, cats) {
    const overlay = el('categorySheetOverlay');
    const sheet   = el('categoryBottomSheet');
    const grid    = el('categoryGrid');
    if (!sheet || !grid) return;

    grid.innerHTML = cats.map(c => `
      <button class="mob-cat-chip"
              onclick="Mob._applyCategory('${itemId}',${c.id},'${c.name}',this)">
        <span>${c.emoji}</span>
        <span>${c.name}</span>
      </button>`).join('') + `
      <button class="mob-cat-chip add"
              onclick="Mob._createCategoryPrompt('${itemId}')">
        <span>➕</span><span>새 카테고리</span>
      </button>`;

    if (overlay) overlay.hidden = false;
    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add('open'));
  },

  _closeCategorySheet() {
    const overlay = el('categorySheetOverlay');
    const sheet   = el('categoryBottomSheet');
    if (sheet)   { sheet.classList.remove('open'); sheet.hidden = true; }
    if (overlay) overlay.hidden = true;
  },

  async _applyCategory(itemId, catId, catName) {
    try {
      await fetchJSON(`/api/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userCategoryId: catId, categoryConfirmed: true })
      });
      this._closeCategorySheet();
      toast(`✅ '${catName}'으로 변경됐어요`, 'ok');
      /* 로컬 state 반영 후 홈 피드 갱신 */
      const item = state.items.find(i => (i.id || i._id) === itemId);
      if (item) { item.userCategoryId = catId; item.categoryConfirmed = true; }
      this._loadHomeItems();
    } catch { toast('변경 실패', 'err'); }
  },

  async _createCategoryPrompt(itemId) {
    const name = prompt('새 카테고리 이름을 입력하세요:');
    if (!name?.trim()) return;
    try {
      const newCat = await fetchJSON('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() })
      });
      state.userCategories = [...(state.userCategories || []), newCat];
      toast(`'${name}' 카테고리 생성됐어요`, 'ok');
      this._applyCategory(itemId, newCat.id, newCat.name);
    } catch { toast('카테고리 생성 실패', 'err'); }
  },

});

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
