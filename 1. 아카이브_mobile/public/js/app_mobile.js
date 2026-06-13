/**
 * SJ 서재 — app_mobile.js v26
 * 5-button SPA Bottom Nav
 * + 홈 날짜 섹션 분리 (오늘 / 지난 지식)
 * + Smart Empty View
 * + [요약] 탭 내 서재 지식 검색
 */

'use strict';

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
  libraryItems     : [],   // 서재 전체 아이템 (검색/필터용)
  libraryFilter    : 'all', // 서재 카테고리 필터
};

/* ──────────────────────────────────────────────
   VIEW CONFIG
────────────────────────────────────────────── */
const VIEW_CONFIG = {
  home:    { el:'viewHome',    tabsVisible:true,  title:'아카이브',      showHeaderActions:true  },
  feed:    { el:'viewFeed',    tabsVisible:false, title:'지식 배달',     showHeaderActions:false },
  summary: { el:'viewSummary', tabsVisible:false, title:'내 서재',     showHeaderActions:false },
  manage:  { el:'viewManage',  tabsVisible:false, title:'학습 관리',    showHeaderActions:false },
};

/* ══════════════════════════════════════════════
   Mob 네임스페이스
══════════════════════════════════════════════ */
const Mob = {

  /* ────────────────────────────────────────────
     초기화
  ────────────────────────────────────────────── */
  init() {
    this._loadHomeItems();
    this.checkFeedBadge();
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

    if (viewName === 'feed')    this._loadFeedView();
    if (viewName === 'manage')  this._loadManageView();
    if (viewName === 'summary') this._loadLibraryView();

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

    /* ① 아카이브 먼저 — 로딩 스피너 즉시 해제 */
    try {
      const data = await fetchJSON(`/api/items?category=${catParam}&limit=500`, {}, 20000);
      state.items = parseFeedsArray(data?.items ?? data);
      this.renderFeed(state.items);
    } catch (e) {
      if (feed) feed.innerHTML = `<div class="mob-loading" style="color:#ef4444">
        <i class="ti ti-alert-circle"></i> 불러오기 실패 — 새로고침 해주세요
      </div>`;
    } finally {
      if (load) load.style.display = 'none';
    }

    /* ② 배달 피드 미리보기 — 백그라운드 비동기 (이미 있으면 스킵) */
    if (state.feedItems.length > 0) return;
    try {
      const status = await fetchJSON('/api/daily-feed/status', {}, 5000);
      if (!status?.allReady) return;   /* 미생성 상태면 스킵 — 배달탭에서 생성 */
      const data = await fetchJSON('/api/daily-feed', {}, 20000);
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

    const todayItems = sorted.filter(i => {
      const d = new Date(i.createdAt); d.setHours(0,0,0,0);
      return d.getTime() === todayMidnight.getTime();
    });
    const pastItems = sorted.filter(i => {
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
      /* 오늘 아카이브 아이템 (daily_delivery 등) */
      html += '<div class="mob-card-list">';
      todayItems.forEach(item => { html += this.cardHTML(item); });
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
        /* 각 날짜 그룹도 리스트 컨테이너로 감쌈 */
        html += '<div class="mob-card-list">';
        group.forEach(item => { html += this.cardHTML(item); });
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
      const id = card.dataset.id;
      if (id) this.openDetail(id);
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

  /** 홈 영어 카드 (v37) — 표현/뜻/예문 항상 가시, 클릭 → 상세 모달 */
  /**
   * 홈 영어 카드 v38 — 미니멀 3단 (표현 → 뜻 → 예문)
   * 클릭 → 상세 모달 / 내부 아코디언 없음
   */
  _cardEnglishV(item) {
    const id      = item._id || item.id || '';
    const p       = this._parseEnglishText(item.text);
    const expr    = p.expression || item.title || '영어 표현';
    const rawD    = item.createdAt || item.savedAt || '';
    const dateStr = rawD
      ? (() => { const d = new Date(rawD); return isNaN(d) ? '오늘' : `${d.getMonth()+1}/${d.getDate()}`; })()
      : '오늘';

    return `
    <div class="mob-card mob-card-en-v" data-id="${id}">
      <div class="mob-env-hd">
        <span class="mob-env-chip">EN · ${dateStr}</span>
        <button class="mob-env-x"
                onclick="event.stopPropagation();Mob._deleteItem('${id}',this.closest('.mob-card'))"
                title="삭제"><i class="ti ti-x"></i></button>
      </div>
      <div class="mob-env-expr">${expr}</div>
      ${p.meaning ? `<div class="mob-env-meaning">${p.meaning}</div>` : ''}
      ${(p.example || p.practice) ? `<div class="mob-env-example">"${p.example || p.practice}"</div>` : ''}
    </div>`;
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
    const cat    = item.category || item.shelf || 'inbox';
    const id     = item._id || item.id || '';
    const rawD   = item.createdAt || item.savedAt || '';
    const dateStr = rawD
      ? (() => { const d = new Date(rawD); return isNaN(d) ? '오늘' : `${d.getMonth()+1}/${d.getDate()}`; })()
      : '오늘';

    const catIconMap = { en:'🌐', history:'🏛️', economy:'📈', inbox:'📌', youtube:'▶️' };
    const catIcon  = catIconMap[cat] || '💡';
    const catLabel = this._catLabel(cat);

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

    /* ── 해시태그 ── */
    const kws = (m.keywords || item.keywords || []).slice(0, 3);
    const defaultTagMap = { en:'#영어표현', history:'#역사', economy:'#경제', inbox:'#메모' };
    const tags = kws.length
      ? kws.map(k => '#' + k)
      : [defaultTagMap[cat] || '#지식', '#서재저장'];

    /* ── HTML 조합 ── */
    const mkUL = (arr) =>
      `<ul class="mob-card-v-body">${arr.map(b => `<li>${b}</li>`).join('')}</ul>`;

    const previewHTML = previewBullets.length ? mkUL(previewBullets) : '';
    const tagsHTML    = tags.length
      ? `<div class="mob-card-v-tags">${tags.map(t => `<span class="mob-card-v-tag">${t}</span>`).join('')}</div>`
      : '';
    /* detail: 나머지 불릿 + 해시태그 (내용 없으면 빈 div → 셰브론 숨김) */
    const detailInner = (detailBullets.length ? mkUL(detailBullets) : '') + tagsHTML;
    const hasDetail   = detailBullets.length > 0 || tags.length > 0;

    return `
    <div class="mob-card mob-card-v${hasDetail ? '' : ' no-detail'}" data-id="${id}">
      <div class="mob-card-v-top">
        <span class="mob-card-v-cat">${catIcon} ${catLabel} · ${dateStr}</span>
        <div class="mob-card-v-acts">
          <button class="mob-card-v-copy"
                  onclick="event.stopPropagation();Mob._copyItemText('${id}')" title="복사">
            <i class="ti ti-copy"></i>
          </button>
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
    const cat      = item.category || item.shelf || 'inbox';
    const catLabel = this._catLabel(cat);
    const id       = item._id || item.id || '';
    const title    = m.title || item.title || (item.text || '').slice(0, 60) || '제목 없음';
    const summary  = m.summary || item.summary || (item.text || '').slice(0, 120) || '';
    const thumb    = item.thumbnail || m.thumbnail || item.imageUrl || '';
    const dur      = item.duration  || m.duration  || '';

    // 카테고리별 이모지·그라데이션 키 매핑
    const emojiMap = { en:'📚', economy:'📈', history:'🏛️', youtube:'▶️', inbox:'📌' };
    const emoji    = emojiMap[cat] || '💡';

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
      </div>
    </div>`;
  },

  /** 배달 피드 — 언어 표현 카드 (요일 테마 + 개별 저장 + 대화문 아코디언) */
  _cardFeedLanguage(item) {
    const entries  = item.vocabEntries || [];
    const subId    = item.subId || '';
    const date     = item.date  || '';
    const theme    = item.theme || item.subCategory || '';
    const dayOfWeek = item.dayOfWeek || '';
    const langIcon = item.label?.includes('중국') ? '🐉' : '🗽';

    const vocabHTML = entries.map((e, i) => {
      const uid = `dlg_${subId}_${i}_${Date.now()}`;
      const dialogueLines = (e.dialogue || '').replace(/\\n/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
      const dialogueHTML = dialogueLines.map(l => {
        if (/^(A|B|甲|乙):/.test(l)) {
          const colonIdx = l.indexOf(':');
          const speaker  = l.slice(0, colonIdx).trim();
          const txt      = l.slice(colonIdx + 1).trim();
          const isA      = speaker === 'A' || speaker === '甲';
          return `<div class="mob-dlg-line ${isA ? 'mob-dlg-a' : 'mob-dlg-b'}">
            <span class="mob-dlg-speaker">${speaker}</span>
            <span class="mob-dlg-text">${txt}</span>
          </div>`;
        }
        if (l.startsWith('[해석:') || l.startsWith('[解:')) {
          return `<div class="mob-dlg-translation">${l.replace(/^\[해석:|^\[解:/, '').replace(/\]$/, '').trim()}</div>`;
        }
        return `<div class="mob-dlg-line"><span class="mob-dlg-text">${l}</span></div>`;
      }).join('');

      return `
      <div class="mob-feed-vocab-item">
        <div class="mob-feed-vocab-row1">
          <span class="mob-feed-vocab-num">${i + 1}</span>
          <span class="mob-feed-vocab-expr">${e.expression || ''}</span>
          <button class="mob-feed-entry-save-btn"
                  data-sub="${subId}" data-idx="${i}"
                  onclick="event.stopPropagation();Mob._saveVocabEntry(this)"
                  title="💾 내 서재에 저장">
            <i class="ti ti-bookmark"></i>
          </button>
        </div>
        <div class="mob-feed-vocab-body-rows">
          <div class="mob-feed-vocab-badge-row">
            <span class="mob-feed-vocab-badge mob-feed-vocab-badge-mean">뜻</span>
            <span class="mob-feed-vocab-meaning">${e.meaning || ''}</span>
          </div>
          ${e.nuance ? `<div class="mob-feed-vocab-nuance-line">${e.nuance}</div>` : ''}
          ${e.sourceSentence ? `
          <div class="mob-feed-vocab-badge-row">
            <span class="mob-feed-vocab-badge mob-feed-vocab-badge-ex">예문</span>
            <span class="mob-feed-vocab-ex-txt">${e.sourceSentence}</span>
          </div>` : ''}
          ${e.practiceSentence ? `
          <div class="mob-feed-vocab-practice-line">
            <i class="ti ti-pencil-plus"></i>
            <span>${e.practiceSentence}</span>
          </div>` : ''}
        </div>
        ${dialogueHTML ? `
        <button class="mob-feed-dlg-toggle" onclick="event.stopPropagation();Mob._toggleDialogue(this)" data-uid="${uid}">
          실전 대화문 보기 👇 <i class="ti ti-chevron-down"></i>
        </button>
        <div class="mob-feed-dialogue" id="${uid}" hidden>
          ${dialogueHTML}
        </div>` : ''}
      </div>`;
    }).join('');

    return `
    <div class="mob-card mob-card-feed" data-id="">
      <div class="mob-feed-card-hd">
        <span class="mob-feed-badge mob-feed-badge-lang">${langIcon} ${item.label || '표현'}</span>
        ${dayOfWeek ? `<span class="mob-feed-day-theme">${dayOfWeek}요일 · ${theme}</span>` : ''}
        <span class="mob-feed-card-date">${date}</span>
      </div>
      <div class="mob-card-title">${item.title || '오늘의 표현'}</div>
      <div class="mob-card-summary">${item.summary || ''}</div>
      <div class="mob-feed-vocab-list">${vocabHTML}</div>
      <div class="mob-feed-card-ft">
        <button class="mob-feed-save-btn" onclick="event.stopPropagation();Mob._saveFeedToArchive('${subId}','${date}',this)">
          <i class="ti ti-device-floppy"></i> 전체 저장
        </button>
        <span class="mob-feed-ai-tag">${item.aiGenerated ? '✨ AI 생성' : '📋 샘플'}</span>
      </div>
    </div>`;
  },

  /** 대화문 아코디언 토글 */
  _toggleDialogue(btn) {
    const uid = btn.dataset.uid;
    const dlgEl = uid ? document.getElementById(uid) : btn.nextElementSibling;
    if (!dlgEl) return;
    const isHidden = dlgEl.hidden;
    dlgEl.hidden = !isHidden;
    const icon = btn.querySelector('i');
    if (icon) {
      icon.className = isHidden ? 'ti ti-chevron-up' : 'ti ti-chevron-down';
    }
    btn.classList.toggle('open', isHidden);
    btn.innerHTML = btn.innerHTML.replace(
      isHidden ? '대화문 보기' : '대화문 닫기',
      isHidden ? '대화문 닫기' : '대화문 보기'
    );
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
        body   : JSON.stringify({ text, category: cat, source: 'daily-feed-entry' })
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

  /** 역사 지식 한줌 카드 */
  _cardHumHistory(item) {
    /* 3줄 요약 파싱 */
    const s3Lines = (item.summary3 || '').replace(/\\n/g, '\n')
      .split('\n').map(l => l.trim().replace(/^[•\-·]\s*/, '')).filter(Boolean);
    const s3HTML = s3Lines.map(l => `
      <div class="mob-hum-s3-line">
        <span class="mob-hum-s3-dot"></span>
        <span>${l}</span>
      </div>`).join('');

    const behindBlock = item.behindStory ? `
      <button class="mob-hum-behind-btn"
              onclick="event.stopPropagation();Mob._toggleBehindStory(this)">
        비하인드 스토리 보기 🕵️ <i class="ti ti-chevron-down"></i>
      </button>
      <div class="mob-hum-behind-panel">
        <div class="mob-hum-behind-txt">${item.behindStory}</div>
      </div>` : '';

    return `
    <div class="mob-card mob-hum-card">
      <div class="mob-hum-badge-row">
        <span class="mob-hum-badge">🏛️ 역사 · ${item.era || '역사'}</span>
        <span class="mob-hum-period">${item.period || ''}</span>
      </div>
      <div class="mob-hum-content">
        <div class="mob-hum-title">${item.title || '오늘의 역사'}</div>
        ${s3HTML ? `<div class="mob-hum-s3-block">${s3HTML}</div>` : ''}
        ${item.lesson ? `
        <div class="mob-hum-lesson">
          <i class="ti ti-bulb" style="flex-shrink:0;font-size:15px;margin-top:1px;color:#d97706"></i>
          <span>${item.lesson}</span>
        </div>` : ''}
      </div>
      ${behindBlock}
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

  /** 오늘의 고사성어 카드 */
  _cardHumIdiom(item) {
    const behindBlock = item.behindStory ? `
      <button class="mob-hum-behind-btn"
              onclick="event.stopPropagation();Mob._toggleBehindStory(this)">
        비하인드 스토리 보기 🕵️ <i class="ti ti-chevron-down"></i>
      </button>
      <div class="mob-hum-behind-panel">
        <div class="mob-hum-behind-txt">${item.behindStory}</div>
      </div>` : '';

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
        ${item.story ? `
        <div class="mob-hum-s3-block">
          <div class="mob-hum-idiom-story">${item.story}</div>
        </div>` : ''}
        ${item.application ? `
        <div class="mob-hum-application">
          <i class="ti ti-sparkles" style="flex-shrink:0;font-size:14px;margin-top:1px"></i>
          <span>${item.application}</span>
        </div>` : ''}
      </div>
      ${behindBlock}
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
        body   : JSON.stringify({ text, category: item.category || 'inbox', source: 'daily-delivery' })
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

  /** 배달 피드 — 시황 리포트 카드 (증시 지표 배너 + 3줄 요약 + 체크포인트) */
  _cardFeedMarket(item) {
    const terms      = (item.aiEconomicKnowledge || []).slice(0, 3);
    const indicators = item.indicators || [];
    const subId      = item.subId || '';
    const date       = item.date  || '';
    const isUS       = (item.label || '').includes('미국') || (item.subId || '').includes('us');

    // 증시 지표 배너
    const indHTML = indicators.length ? `
    <div class="mob-feed-indicators">
      ${indicators.map(ind => `
        <div class="mob-feed-ind-item ${ind.dir || ''}">
          <div class="mob-feed-ind-name">${ind.name}</div>
          <div class="mob-feed-ind-value">${ind.value}</div>
          <div class="mob-feed-ind-change">${ind.dir === 'up' ? '▲' : '▼'} ${ind.change}</div>
        </div>`).join('')}
    </div>` : '';

    // 3줄 요약
    const summary3Lines = (item.summary3 || '').replace(/\\n/g, '\n').split('\n').filter(l => l.trim());
    const summary3HTML = summary3Lines.length ? `
    <div class="mob-feed-summary3">
      ${summary3Lines.map(l => `<div class="mob-feed-s3-line">${l.trim()}</div>`).join('')}
    </div>` : '';

    // 오늘 장 체크포인트
    const checkpoints = item.checkpoints || [];
    const checkHTML = checkpoints.length ? `
    <div class="mob-feed-checkpoints">
      <div class="mob-feed-check-label"><i class="ti ti-checkbox"></i> 오늘 장 필수 체크</div>
      ${checkpoints.map((c, i) => `
        <div class="mob-feed-check-item">
          <span class="mob-feed-check-num">${i + 1}</span>
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

    return `
    <div class="mob-card mob-card-feed mob-card-feed-market" data-id="">
      <div class="mob-feed-card-hd">
        <span class="mob-feed-badge mob-feed-badge-market">${isUS ? '🗽' : '🐯'} ${item.label || '시황'}</span>
        <span class="mob-feed-card-date">${date}</span>
      </div>
      <div class="mob-card-title">${item.title || '오늘의 시황'}</div>
      <div class="mob-card-summary">${item.summary || ''}</div>

      ${indHTML}
      ${summary3HTML}
      ${checkHTML}

      ${termsHTML ? `<div class="mob-feed-econ-list">
        <div class="mob-feed-econ-label"><i class="ti ti-bookmark"></i> 오늘의 핵심 용어</div>
        ${termsHTML}
      </div>` : ''}

      <div class="mob-feed-card-ft">
        <button class="mob-feed-save-btn" onclick="event.stopPropagation();Mob._saveFeedToArchive('${subId}','${date}',this)">
          <i class="ti ti-device-floppy"></i> 서재에 저장
        </button>
        <span class="mob-feed-ai-tag">${item.aiGenerated ? '✨ AI 생성' : '📋 샘플'}</span>
      </div>
    </div>`;
  },

  /** 배달 피드 아이템 → 서재 저장 */
  async _saveFeedToArchive(subId, date, btn) {
    if (!subId || !date) return;
    try {
      btn.disabled  = true;
      btn.innerHTML = '<span class="mob-spin"></span> 저장 중…';
      const data = await fetchJSON(`/api/daily-feed/${date}/${subId}/save`, { method: 'POST' });
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

  _catLabel(cat) {
    const map = { en:'English', history:'History', economy:'Economy', youtube:'YouTube', inbox:'서랍', all:'전체' };
    return map[cat] || (cat || '기타');
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
      const data = await fetchJSON('/api/daily-feed', {}, timeoutMs);
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
      /* 기타 archive 카드 → 상세 모달 */
      const id = card.dataset.id;
      if (id) this.openDetail(id);
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
      const data  = await fetchJSON('/api/items?limit=500&sort=desc', {}, 20000);
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

      /* 카테고리 필터 칩 초기화 */
      document.querySelectorAll('.mvw-lib-filter-chip').forEach(c => {
        c.classList.toggle('active', c.dataset.cat === 'all');
      });

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

        html += `<div class="mvw-lib-card" data-id="${id}" onclick="Mob.openDetail('${id}')">
          <div class="mvw-lib-card-icon"><i class="ti ${typeIcon}"></i></div>
          <div class="mvw-lib-card-body">
            <div class="mvw-lib-card-title">${title}</div>
            ${sub ? `<div class="mvw-lib-card-sub">${sub}${sub.length >= 80 ? '…' : ''}</div>` : ''}
          </div>
          <span class="mvw-lib-card-cat">${cat}</span>
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

  /* ── 서재 카테고리 필터 칩 ── */
  setLibraryFilter(cat, chip) {
    state.libraryFilter = cat;
    document.querySelectorAll('.mvw-lib-filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    const si = el('libSearchInput');
    if (si) si.value = '';
    const sc = el('libSearchClear');
    if (sc) sc.hidden = true;
    this._applyLibraryFilters();
  },

  /* 카테고리 필터 + 검색어 동시 적용 */
  _applyLibraryFilters(searchQ) {
    let items = state.libraryItems || [];
    const f   = state.libraryFilter;

    if (f && f !== 'all') {
      items = items.filter(item => {
        const cat  = item.category || item.shelf || '';
        const type = item.type || '';
        const subId = item.subId || '';
        if (f === 'zh')      return cat === 'zh' || cat === 'zh_expr' || subId.includes('zh');
        if (f === 'history') return cat === 'history' || type === 'humanities';
        return cat === f;
      });
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
      /* 설정 + 아이템 병렬 로드 */
      const [settingsResp, itemsResp] = await Promise.all([
        fetchJSON('/api/user/settings', {}, 10000),
        fetchJSON('/api/items?limit=500', {}, 20000)
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

    this._renderWeeklyBars(items);
    this._renderCatBars(items);
    this._renderRecentItems(items);
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
      <div class="mvw-recent-item" onclick="Mob.openDetail('${id}')">
        <div class="mvw-recent-icon"><i class="ti ${icon}"></i></div>
        <div class="mvw-recent-body">
          <div class="mvw-recent-title">${title}</div>
          <div class="mvw-recent-sub">${fmt(item.createdAt)}</div>
        </div>
        <i class="ti ti-chevron-right mvw-recent-arrow"></i>
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
        body: JSON.stringify({ text })
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
      const formData = new FormData();
      formData.append('image', state.selectedImageFile);
      if (memo) formData.append('memo', memo);

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
  openDetail(id) {
    const item = [...state.items, ...state.feedItems, ...(state.libraryItems || [])]
      .find(i => (i._id || i.id) === id);
    if (!item) return;

    const modal   = el('mobDetailModal');
    const badgeEl = el('mobDetailBadge');
    const bodyEl  = el('mobDetailBody');

    badgeEl.textContent = this._catLabel(item.category || item.shelf || 'inbox');
    bodyEl.innerHTML    = this._buildDetailBody(item, id);
    modal.hidden        = false;
    /* 시트 최상단으로 스크롤 */
    el('mobDetailSheet')?.scrollTo({ top: 0, behavior: 'instant' });
  },

  /** 상세 모달 본문 HTML 빌더 — 타입별 풍부한 콘텐츠 */
  _buildDetailBody(item, id) {
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
        <div class="mob-detail-kw-row">${kws.map(k => `<span class="mob-detail-kw-chip">${k}</span>`).join('')}</div>
      </div>`;
    }

    /* 나의 인사이트 */
    body += `<div class="mob-detail-section">
      <div class="mob-detail-sec-label">나의 인사이트</div>
      <textarea class="mob-detail-insight-area" id="detailInsight"
        placeholder="이 지식에서 느낀 점, 적용 아이디어를 기록하세요…"
      >${item.myInsight || ''}</textarea>
    </div>`;

    /* 카테고리 이동 (숨김, 토글 방식) */
    const CATS = [
      { val:'en',      label:'English', icon:'🌐' },
      { val:'history', label:'History', icon:'🏛️' },
      { val:'economy', label:'Economy', icon:'📈' },
      { val:'youtube', label:'YouTube', icon:'▶️' },
      { val:'inbox',   label:'서랍',    icon:'📌' },
    ];
    const moveChips = CATS
      .filter(c => c.val !== cat)
      .map(c => `<button class="mob-detail-move-chip" onclick="Mob._moveCategory('${id}','${c.val}')">${c.icon} ${c.label}</button>`)
      .join('');

    /* 액션 버튼 */
    const srcBtn = item.source
      ? `<button class="mob-detail-action-btn" onclick="window.open('${item.source}','_blank')"
           style="background:var(--bg);color:var(--text-2)">
           <i class="ti ti-external-link"></i>
         </button>` : '';

    return `
      <div class="mob-detail-meta-row">
        ${dateStr ? `<span class="mob-detail-meta-chip">${dateStr}</span>` : ''}
        ${srcHost  ? `<span class="mob-detail-meta-chip">${srcHost}</span>` : ''}
      </div>
      <div class="mob-detail-title">${titleStr}</div>
      ${body}
      <div class="mob-detail-move-section" id="detailMoveCat" hidden>
        <div class="mob-detail-sec-label">카테고리 이동</div>
        <div class="mob-detail-move-chips">${moveChips}</div>
      </div>
      <div class="mob-detail-actions">
        <button class="mob-detail-action-btn primary" onclick="Mob._saveInsight('${id}')">
          <i class="ti ti-device-floppy"></i> 저장
        </button>
        ${srcBtn}
        <button class="mob-detail-action-btn" style="background:var(--bg);color:var(--text-2)"
                onclick="Mob._toggleMoveCat('detailMoveCat')" title="카테고리 이동">
          <i class="ti ti-folder-symlink"></i> 이동
        </button>
        <button class="mob-detail-action-btn danger" onclick="Mob._deleteFromDetail('${id}')">
          <i class="ti ti-trash"></i>
        </button>
      </div>
    `;
  },

  _toggleMoveCat(panelId) {
    const p = el(panelId);
    if (p) p.hidden = !p.hidden;
  },

  async _moveCategory(id, newCat) {
    try {
      await fetchJSON(`/api/items/${id}`, {
        method : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ category: newCat, shelf: newCat })
      });
      /* 로컬 상태 반영 */
      [state.items, state.libraryItems].forEach(arr => {
        const found = (arr || []).find(i => (i._id || i.id) === id);
        if (found) { found.category = newCat; found.shelf = newCat; }
      });
      toast(`✅ ${this._catLabel(newCat)}으로 이동됐습니다`, 'ok');
      this.closeDetail();
      if (state.currentView === 'home') this.renderFeed(state.items);
      if (state.currentView === 'summary') { state.libraryLoaded = false; this._loadLibraryView(true); }
    } catch { toast('이동 실패', 'err'); }
  },

  closeDetail() { el('mobDetailModal').hidden = true; },

  async _saveInsight(id) {
    const insight = el('detailInsight')?.value.trim();
    try {
      await fetchJSON(`/api/items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ myInsight: insight })
      });
      toast('💡 인사이트 저장됨', 'ok');
      const item = state.items.find(i => (i._id || i.id) === id);
      if (item) item.myInsight = insight;
    } catch { toast('저장 실패', 'err'); }
  },

  async _deleteFromDetail(id) {
    if (!confirm('이 지식을 삭제할까요?')) return;
    try {
      await fetchJSON(`/api/items/${id}`, { method: 'DELETE' });
      this.closeDetail();
      state.items = state.items.filter(i => (i._id || i.id) !== id);
      this.renderFeed(state.items);
      toast('삭제됨', 'ok');
    } catch { toast('삭제 실패', 'err'); }
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
      const data  = await fetchJSON(`/api/items?search=${encodeURIComponent(q)}`, {}, 15000);
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
          this.openDetail(id);
        }
      };
    } catch {
      res.innerHTML = `<div class="mob-search-hint" style="color:#ef4444">검색 실패</div>`;
    }
  },

  /* ══════════════════════════════════════════
     모달 일괄 닫기
  ══════════════════════════════════════════ */
  _hideAllModals() {
    ['mobDetailModal','mobAddModal'].forEach(id => {
      const m = el(id); if (m) m.hidden = true;
    });
  },

};

/* ── 백드롭 클릭 모달 닫기 ── */
document.addEventListener('click', e => {
  if (e.target.classList.contains('mob-modal')) Mob._hideAllModals();
});

/* ── ESC 키 ── */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { Mob.closeSearch(); Mob._hideAllModals(); }
});

/* ── 초기화 ── */
document.addEventListener('DOMContentLoaded', () => Mob.init());
