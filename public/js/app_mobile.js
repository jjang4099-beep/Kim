/**
 * SJ 서재 — app_mobile.js v11
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
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
  summaryChipBound : false,
};

/* ──────────────────────────────────────────────
   VIEW CONFIG
────────────────────────────────────────────── */
const VIEW_CONFIG = {
  home:    { el:'viewHome',    tabsVisible:true,  title:'아카이브',      showHeaderActions:true  },
  feed:    { el:'viewFeed',    tabsVisible:false, title:'지식 배달',     showHeaderActions:false },
  summary: { el:'viewSummary', tabsVisible:false, title:'AI 복습 요약', showHeaderActions:false },
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
    if (viewName === 'summary') {
      this._initSummaryChips();
      this._updateSummaryHint();
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

    try {
      const catParam = cat || state.currentCat;
      const data = await fetchJSON(
        `/api/items?category=${catParam}&limit=500`, {}, 25000
      );
      state.items = parseFeedsArray(data.items ?? data);
      this.renderFeed(state.items);
    } catch (e) {
      if (feed) feed.innerHTML = `<div class="mob-loading" style="color:#ef4444">
        <i class="ti ti-alert-circle"></i> 불러오기 실패 — 새로고침 해주세요
      </div>`;
    } finally {
      if (load) load.style.display = 'none';
    }
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
    html += `
      <div class="mob-section-hd today">
        <span>오늘 배달된 지식</span>
        <span class="mob-section-badge">${todayItems.length}개</span>
      </div>`;

    if (todayItems.length === 0) {
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
    } else {
      /* 오늘 아이템 그룹 컨테이너 */
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

  /* ──────────────────────────────────────────
     카드 HTML 생성
  ────────────────────────────────────────── */
  cardHTML(item) {
    const m    = item.analysis || {};
    const type = item.type || 'text';
    if (type === 'daily_delivery') return this._cardDailyDelivery(item);
    if (type === 'language')       return this._cardFeedLanguage(item);
    if (type === 'market')         return this._cardFeedMarket(item);
    // 유튜브·이미지·썸네일 보유 → 가로형 썸네일 카드 (기존 유지)
    if (type === 'youtube' || type === 'image_analysis' ||
        item.thumbnail || m.thumbnail || item.imageUrl) {
      return this._cardH(item, m);
    }
    // 영어 표현 → 세로형 가독성 카드 (표현 강조 + 불릿)
    const cat = item.category || item.shelf;
    if (cat === 'en') return this._cardEnglish(item);
    // 그 외 텍스트 → 가로형 카드
    return this._cardH(item, m);
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

  /** 홈 피드 — 영어 표현 가로형 카드 (유튜브 카드와 동일 높이) */
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

  /** 배달 피드 — 언어 표현 카드 (어휘 전체 + 개별 저장) */
  _cardFeedLanguage(item) {
    const entries = item.vocabEntries || [];
    const subId   = item.subId || '';
    const date    = item.date  || '';
    const langIcon = item.label?.includes('중국') ? '🇨🇳'
                   : item.label?.includes('일본') ? '🇯🇵' : '📚';

    const vocabHTML = entries.map((e, i) => `
      <div class="mob-feed-vocab-item">
        <div class="mob-feed-vocab-row1">
          <span class="mob-feed-vocab-expr">${e.expression || ''}</span>
          <button class="mob-feed-entry-save-btn"
                  data-sub="${subId}" data-idx="${i}"
                  onclick="event.stopPropagation();Mob._saveVocabEntry(this)"
                  title="이 표현만 서재에 저장">
            <i class="ti ti-bookmark"></i>
          </button>
        </div>
        <span class="mob-feed-vocab-meaning">${e.meaning || ''}</span>
        ${e.nuance ? `<span class="mob-feed-vocab-nuance">${e.nuance}</span>` : ''}
        ${e.sourceSentence ? `<div class="mob-feed-vocab-ex">"${e.sourceSentence}"</div>` : ''}
      </div>`).join('');

    return `
    <div class="mob-card mob-card-feed" data-id="">
      <div class="mob-feed-card-hd">
        <span class="mob-feed-badge mob-feed-badge-lang">${langIcon} ${item.label || '표현'}</span>
        <span class="mob-feed-card-date">${date}</span>
      </div>
      <div class="mob-card-title">${item.title || '오늘의 표현'}</div>
      <div class="mob-card-summary">${item.summary || ''}</div>
      <div class="mob-feed-vocab-list">${vocabHTML}</div>
      <div class="mob-feed-card-ft">
        <button class="mob-feed-save-btn" onclick="event.stopPropagation();Mob._saveFeedToArchive('${subId}','${date}',this)">
          <i class="ti ti-device-floppy"></i> 전체 저장
        </button>
        <span class="mob-feed-ai-tag">${item.aiGenerated ? '✨ AI 생성' : '📋 Mock'}</span>
      </div>
    </div>`;
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

  /** 오늘의 지식 배달 카드 (type: 'daily_delivery') */
  _cardDailyDelivery(item) {
    const id       = item._id || item.id || '';
    const title    = item.title   || '오늘의 지식';
    const summary3 = (item.summary3 || item.text || '').replace(/\\n/g, '\n');
    const concepts = item.concepts || [];
    const reminder = item.reminder || item.summary || '';
    const cat      = item.category || 'inbox';
    const catLabel = this._catLabel(cat);

    const conceptsHTML = concepts.slice(0, 3).map(c => `
      <div class="mob-delivery-concept">
        <span class="mob-delivery-concept-term">${c.term || ''}</span>
        <span class="mob-delivery-concept-desc">${c.desc || ''}</span>
      </div>`).join('');

    return `
    <div class="mob-card mob-card-delivery" data-id="${id}">
      <div class="mob-delivery-header">
        <div class="mob-delivery-ph">
          <span class="mob-delivery-ph-icon">🎁</span>
        </div>
        <div class="mob-delivery-header-body">
          <span class="mob-card-cat">${catLabel}</span>
          <div class="mob-delivery-title">${title}</div>
        </div>
      </div>
      <div class="mob-delivery-section-label">지식 핵심 요약</div>
      <div class="mob-delivery-summary3">${summary3.replace(/\n/g, '<br>')}</div>
      ${conceptsHTML ? `
      <div class="mob-delivery-section-label">필수 개념 및 용어</div>
      <div class="mob-delivery-concepts">${conceptsHTML}</div>` : ''}
      ${reminder ? `
      <div class="mob-delivery-reminder">
        <span class="mob-delivery-reminder-icon">✨</span>
        <span>${reminder}</span>
      </div>` : ''}
    </div>`;
  },

  /** 배달 피드 — 시황 리포트 카드 */
  _cardFeedMarket(item) {
    const terms = (item.aiEconomicKnowledge || []).slice(0, 2);
    const subId = item.subId || '';
    const date  = item.date  || '';

    const report = (item.report || '').replace(/#{1,3} /g, '').slice(0, 220);

    const termsHTML = terms.map(t => `
      <div class="mob-feed-econ-item">
        <span class="mob-feed-econ-term">${t.term || ''}</span>
        <span class="mob-feed-econ-importance">${t.importance || ''}</span>
      </div>`).join('');

    return `
    <div class="mob-card mob-card-feed" data-id="">
      <div class="mob-feed-card-hd">
        <span class="mob-feed-badge mob-feed-badge-market">📈 ${item.label || '시황'}</span>
        <span class="mob-feed-card-date">${date}</span>
      </div>
      <div class="mob-card-title">${item.title || '오늘의 시황'}</div>
      <div class="mob-card-summary">${item.summary || ''}</div>
      ${report ? `<div class="mob-feed-report">${report}…</div>` : ''}
      ${termsHTML ? `<div class="mob-feed-econ-list"><div class="mob-feed-econ-label">📌 핵심 용어</div>${termsHTML}</div>` : ''}
      <div class="mob-feed-card-ft">
        <button class="mob-feed-save-btn" onclick="event.stopPropagation();Mob._saveFeedToArchive('${subId}','${date}',this)">
          <i class="ti ti-device-floppy"></i> 서재에 저장
        </button>
        <span class="mob-feed-ai-tag">${item.aiGenerated ? '✨ AI 생성' : '📋 Mock'}</span>
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
    if (state.feedLoaded && !forceRefresh) return;

    const today = new Date();
    if (dateEl) dateEl.textContent = today.toLocaleDateString('ko-KR',
      { year:'numeric', month:'long', day:'numeric', weekday:'long' });

    content.innerHTML = `<div class="mob-loading"><span class="mob-spin"></span> 불러오는 중…</div>`;

    try {
      const data = await fetchJSON('/api/daily-feed', {}, 60000);
      state.feedItems = parseFeedsArray(data.items ?? data.feeds ?? data);
      this._renderFeedView();
      state.feedLoaded = true;
      const badge = el('mobFeedBadge');
      if (badge) badge.hidden = true;
    } catch {
      content.innerHTML = `<div class="mob-loading" style="color:#ef4444">
        <i class="ti ti-alert-circle"></i> 피드 불러오기 실패
      </div>`;
    }
  },

  _renderFeedView() {
    const content = el('mobFeedViewContent');
    if (!content) return;
    const items = state.feedItems;
    if (!items || items.length === 0) {
      content.innerHTML = `<div class="mob-loading">
        <i class="ti ti-mood-empty"></i> 오늘의 배달 피드가 없어요
      </div>`;
      return;
    }
    let html = '';
    items.forEach(item => { html += this.cardHTML(item); });
    content.innerHTML = html;
    content.onclick = e => {
      const card = e.target.closest('.mob-card');
      if (card?.dataset.id) this.openDetail(card.dataset.id);
    };
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
     요약 뷰
  ══════════════════════════════════════════ */
  _initSummaryChips() {
    if (state.summaryChipBound) return;
    state.summaryChipBound = true;

    const container = el('mobSumChips');
    if (!container) return;

    container.addEventListener('click', e => {
      const chip = e.target.closest('.mob-sum-chip');
      if (!chip) return;
      const cat = chip.dataset.cat;
      if (cat === 'all') {
        container.querySelectorAll('.mob-sum-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      } else {
        const allChip = container.querySelector('[data-cat="all"]');
        allChip?.classList.remove('active');
        chip.classList.toggle('active');
        const anyActive = container.querySelector('.mob-sum-chip.active:not([data-cat="all"])');
        if (!anyActive) allChip?.classList.add('active');
      }
      this._updateSummaryHint();
    });
  },

  _updateSummaryHint() {
    const periodEl = el('sumPeriod');
    const hintEl   = el('mobSumHint');
    if (!periodEl || !hintEl) return;

    const periodMap = { today:'오늘', '3days':'최근 3일', '1week':'지난 1주일', '1month':'이번 달 전체' };
    const period    = periodMap[periodEl.value] || periodEl.value;

    const activeChips = [...document.querySelectorAll('#mobSumChips .mob-sum-chip.active')];
    const catText = activeChips.some(c => c.dataset.cat === 'all')
      ? '전체 분야'
      : activeChips.map(c => c.textContent.trim()).join(', ') || '전체 분야';

    hintEl.textContent = `${period} · ${catText}`;
  },

  openSummary() { this.switchView('summary', el('bnSummary')); },

  async generateSummary() {
    const btn      = el('mobSumBtn');
    const resultEl = el('mobSumResult');
    const period   = el('sumPeriod')?.value || '1week';

    const activeChips = [...document.querySelectorAll('#mobSumChips .mob-sum-chip.active')];
    const categories  = activeChips.some(c => c.dataset.cat === 'all')
      ? [] : activeChips.map(c => c.dataset.cat);

    btn.disabled = true;
    btn.innerHTML = `<span class="mob-spin"></span> AI 분석 중…`;
    if (resultEl) resultEl.hidden = true;

    try {
      const data = await fetchJSON('/api/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period, categories })
      }, 90000);

      if (!data.success) throw new Error(data.error || '분석 실패');

      const { report, keywords = [], itemCount = 0 } = data;
      const kwHtml = keywords.map(k => `<span class="mob-sum-kw">${k}</span>`).join('');

      resultEl.innerHTML = `
        <div class="mob-sum-result-header">
          <i class="ti ti-sparkles" style="color:#6366f1;font-size:18px"></i>
          <span class="mob-sum-result-title">AI 복습 요약</span>
          <span class="mob-sum-result-meta">${itemCount}개 항목</span>
        </div>
        <div class="mob-sum-result-report">${report}</div>
        ${kwHtml ? `<div class="mob-sum-kw-row">${kwHtml}</div>` : ''}
      `;
      resultEl.hidden = false;

    } catch (e) {
      toast('요약 생성 실패: ' + (e.message || '다시 시도해주세요'), 'err');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<i class="ti ti-sparkles"></i><span>AI 요약 생성</span>`;
    }
  },

  /* ══════════════════════════════════════════
     ★ 요약 탭 — 서재 지식 검색
  ══════════════════════════════════════════ */
  _onSumSearchInput(val) {
    /* 입력값이 없으면 결과 영역 숨기기 */
    if (!val.trim()) {
      const res = el('sumSearchResults');
      if (res) res.hidden = true;
    }
  },

  async doSumSearch() {
    const input    = el('sumSearchInput');
    const resultEl = el('sumSearchResults');
    const q        = input?.value.trim();

    if (!q) {
      toast('검색어를 입력하세요');
      return;
    }

    /* 로딩 표시 */
    resultEl.hidden = false;
    resultEl.innerHTML = `
      <div class="mob-loading" style="padding:16px 0">
        <span class="mob-spin"></span> 검색 중…
      </div>`;

    try {
      const data  = await fetchJSON(
        `/api/items?search=${encodeURIComponent(q)}&limit=50`, {}, 15000
      );
      const items = parseFeedsArray(data.items ?? data);
      this._renderSumSearchResults(items, q);
    } catch {
      resultEl.innerHTML = `<div class="mvw-sum-no-result">
        <i class="ti ti-alert-circle"></i> 검색 실패. 다시 시도해주세요.
      </div>`;
    }
  },

  _renderSumSearchResults(items, q) {
    const resultEl = el('sumSearchResults');
    if (!resultEl) return;

    if (!items || items.length === 0) {
      resultEl.innerHTML = `
        <div class="mvw-sum-no-result">
          <i class="ti ti-zoom-question"></i>
          "<strong>${q}</strong>"에 해당하는 지식이 없어요
        </div>`;
      return;
    }

    const TYPE_ICON  = { youtube:'ti-brand-youtube', image_analysis:'ti-photo-ai', text:'ti-file-text' };
    const TYPE_CLASS = { youtube:'yt', image_analysis:'img' };

    const cardsHtml = items.map(item => {
      const m         = item.analysis || {};
      const title     = m.title   || item.title   || '제목 없음';
      const sub       = (m.summary || item.summary || item.text || '').slice(0, 65);
      const type      = item.type || 'text';
      const icon      = TYPE_ICON[type]  || 'ti-file-text';
      const iconClass = TYPE_CLASS[type] || '';
      const catLabel  = this._catLabel(item.category || item.shelf);
      const id        = item._id || item.id;

      /* 검색어 하이라이트 (제목에만) */
      const regex      = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
      const titleHl    = title.replace(regex, '<mark style="background:#fef08a;border-radius:2px">$1</mark>');

      /* 클릭 시 상세 모달 열기 위해 item 을 state에도 추가 */
      return `
      <div class="mvw-sum-result-card" data-id="${id}"
        onclick="Mob._sumResultClick('${id}')">
        <div class="mvw-sum-result-icon ${iconClass}">
          <i class="ti ${icon}"></i>
        </div>
        <div class="mvw-sum-result-body">
          <div class="mvw-sum-result-title">${titleHl}</div>
          <div class="mvw-sum-result-sub">${sub}${sub.length >= 65 ? '…' : ''}</div>
        </div>
        <span class="mvw-sum-result-cat">${catLabel}</span>
      </div>`;
    }).join('');

    resultEl.innerHTML = `
      <div class="mvw-sum-result-count">${items.length}개 결과 · "<strong>${q}</strong>"</div>
      ${cardsHtml}`;

    /* state.items 에 없는 결과 항목 추가 (상세 모달용) */
    items.forEach(item => {
      const id = item._id || item.id;
      if (!state.items.find(i => (i._id || i.id) === id)) {
        state.items.push(item);
      }
    });
  },

  _sumResultClick(id) {
    this.openDetail(id);
  },

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

  /* 배달 설정 패널 렌더링 */
  _renderDeliverySettings(data) {
    const user  = data?.user  || {};
    const feeds = data?.available_feeds || [];
    const enabled = new Set(user.enabled_feeds || []);

    /* 배달 시간 */
    const timeInput = el('dpDeliveryTime');
    if (timeInput) timeInput.value = user.delivery_time || '07:30';

    /* 구독 피드 토글 목록 */
    const subsList = el('dpSubsList');
    if (subsList && feeds.length) {
      subsList.innerHTML = feeds.map(sub => `
        <div class="mvw-dp-sub-item">
          <div class="mvw-dp-sub-info">
            <span class="mvw-dp-sub-icon">${sub.icon || '📌'}</span>
            <div class="mvw-dp-sub-text">
              <div class="mvw-dp-sub-name">${sub.label}</div>
              <div class="mvw-dp-sub-desc">${sub.desc || ''}</div>
            </div>
          </div>
          <label class="mvw-dp-toggle">
            <input type="checkbox" id="sub_${sub.id}"
                   ${enabled.has(sub.id) ? 'checked' : ''}/>
            <span class="mvw-dp-toggle-track">
              <span class="mvw-dp-toggle-thumb"></span>
            </span>
          </label>
        </div>`).join('');
    }

    /* 상태 칩 업데이트 */
    const chip = el('dpStatusChip');
    if (chip) chip.textContent = `배달: ${user.delivery_time || '07:30'}`;
  },

  /* 배달 설정 저장 */
  async _saveDeliverySettings() {
    const delivTime = el('dpDeliveryTime')?.value || '07:30';
    const cbs = document.querySelectorAll('#dpSubsList input[type="checkbox"]');
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
      }, 120000); /* Gemini 최대 2분 */

      toast(`✅ ${data.count || 0}개 피드 생성 완료!`, 'ok');
      state.feedLoaded = false; /* 다음 배달탭 진입 시 강제 리로드 */
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
      const title = m.title || item.title || '제목 없음';
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
     상세 모달
  ══════════════════════════════════════════ */
  openDetail(id) {
    const item = [...state.items, ...state.feedItems]
      .find(i => (i._id || i.id) === id);
    if (!item) return;

    const m       = item.analysis || {};
    const modal   = el('mobDetailModal');
    const badgeEl = el('mobDetailBadge');
    const bodyEl  = el('mobDetailBody');

    badgeEl.textContent = this._catLabel(item.category || item.shelf);

    const kws = (m.keywords || item.keywords || [])
      .map(k => `<span class="mob-detail-kw-chip">${k}</span>`).join('');

    const imgSection = (item.type === 'image_analysis' && item.imageUrl)
      ? `<img src="${item.imageUrl}" alt="분석 이미지"
          style="width:100%;border-radius:12px;margin-bottom:14px;object-fit:cover;max-height:200px"/>` : '';

    const stepsSection = (m.steps && m.steps.length)
      ? `<div class="mob-detail-section-title">핵심 단계</div>
         <ol style="padding-left:18px;font-size:14px;color:var(--text-2);line-height:1.8">
           ${m.steps.map(s => `<li>${s}</li>`).join('')}
         </ol>` : '';

    let sourceHostname = '';
    try { sourceHostname = item.source ? new URL(item.source).hostname : ''; } catch {}

    bodyEl.innerHTML = `
      ${imgSection}
      <div class="mob-detail-title">${m.title || item.title || '제목 없음'}</div>
      <div class="mob-detail-meta">
        <span class="mob-detail-meta-chip">${fmt(item.createdAt)}</span>
        ${sourceHostname ? `<span class="mob-detail-meta-chip">${sourceHostname}</span>` : ''}
      </div>
      <div class="mob-detail-summary">${m.summary || item.summary || ''}</div>
      ${kws ? `<div class="mob-detail-section-title">키워드</div>
               <div class="mob-detail-kw-row">${kws}</div>` : ''}
      ${stepsSection}
      <div class="mob-detail-section-title">나의 인사이트</div>
      <textarea class="mob-detail-insight-area" id="detailInsight"
        placeholder="이 지식에서 느낀 점, 적용 아이디어를 기록하세요…"
      >${item.myInsight || ''}</textarea>
      <div class="mob-detail-actions">
        <button class="mob-detail-action-btn primary" onclick="Mob._saveInsight('${id}')">
          <i class="ti ti-device-floppy"></i> 저장
        </button>
        ${item.source ? `<button class="mob-detail-action-btn"
          onclick="window.open('${item.source}','_blank')"
          style="background:var(--bg);color:var(--text-2)">
          <i class="ti ti-external-link"></i> 원문
        </button>` : ''}
        <button class="mob-detail-action-btn danger" onclick="Mob._deleteFromDetail('${id}')">
          <i class="ti ti-trash"></i>
        </button>
      </div>
    `;

    modal.hidden = false;
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
