/**
 * library.js — 내 서재 (매거진 뷰)
 * ────────────────────────────────────────────
 * 담당: 서재 로드/렌더, 매거진 카드 분류, 좌측 스와이프 삭제,
 *       카테고리 필터·실시간 검색, AI 기간 리포트 생성
 * 의존: core.js(Mob·state·el·toast·fetchJSON·getItemDomain·DOMAINS·toLocalDateStr)
 *       _toggleDetail·_deleteItem 은 app_mobile.js(home/공통)에 정의됨 — 같은 Mob 객체라 호출 가능
 */

'use strict';

Object.assign(Mob, {

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
      state.libraryTag    = null;
      state.librarySelectedDate = null;

      /* 뷰 모드 복원 (localStorage 선호값) + 토글 버튼 동기화 */
      state.libraryViewMode = localStorage.getItem('lib-view-mode') || 'card';
      document.querySelectorAll('#libViewToggle .km-view-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.vm === state.libraryViewMode));

      /* 검색창 초기화 */
      const si = el('libSearchInput');
      if (si) si.value = '';
      const sc = el('libSearchClear');
      if (sc) sc.hidden = true;

      /* 카테고리 필터 탭 초기화 + 빈 카테고리 비활성화 */
      document.querySelectorAll('#libFilterBar .km-filter-tab').forEach(c => {
        c.classList.toggle('active', c.dataset.cat === 'all');
      });
      this._updateLibraryFilterState();

      this._renderReviewCarousel();
      this._renderTagBar();
      this._renderLibraryView(items);
      this._applyPublicSanctuary();
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

  /* 서재 카드 클릭 → 상세 팝업 모달 (인라인 펼침 대체) */
  openDetailModal(id) {
    const item = this._findItem(id);
    if (!item) return;
    const cc = this._libCardCat(item);
    const m  = item.analysis || {};

    /* 뱃지 — 음각 파스텔 코드 */
    const badge = el('libDetailBadge');
    if (badge) {
      badge.textContent = cc.code;
      badge.className   = `mob-modal-badge arch-badge arch-${cc.arch}`;
    }

    /* 제목 */
    let title = m.title || item.title || '';
    if (!title) title = (item.text || item.summary || '')
      .split('\n').map(l => l.trim()).filter(Boolean)[0]?.slice(0, 70) || '제목 없음';
    const dateStr = item.createdAt ? fmtFull(item.createdAt) : (item.savedAt ? fmtFull(item.savedAt) : '');

    const body = el('libDetailBody');
    if (body) {
      body.innerHTML = `
        <h2 class="mob-detail-title">${title}</h2>
        ${dateStr ? `<div class="mob-lib-modal-meta"><i class="ti ti-calendar-event"></i> ${dateStr}</div>` : ''}
        ${this._buildExpandBody(item, id)}`;
      body.scrollTop = 0;
    }
    const modal = el('libDetailModal');
    if (modal) modal.hidden = false;
  },

  closeDetailModal() {
    const modal = el('libDetailModal');
    if (modal) modal.hidden = true;
  },

  /* 전체공개 증명 배너 — localStorage.libraryPublic 플래그로 노출 제어 */
  _applyPublicSanctuary() {
    const banner = el('publicSanctuaryBanner');
    if (!banner) return;
    const isPublic = localStorage.getItem('libraryPublic') === 'true';
    banner.hidden = !isPublic;
  },

  /* 서재 전체공개 상태 토글 (외부 호출용) */
  setLibraryPublic(on) {
    localStorage.setItem('libraryPublic', on ? 'true' : 'false');
    this._applyPublicSanctuary();
    toast(on ? '서재가 전체공개되었습니다' : '서재를 비공개로 전환했습니다', 'ok');
  },

  _renderLibraryTimeline(items, searchQ) {
    const timelineEl = el('libTimeline');
    if (!timelineEl) return;

    /* 라이프 항목은 라이프 탭 전용 — 지식 탭에서 제외 (type 또는 category로 판별) */
    const knowledgeItems = (items || []).filter(i => i.type !== 'life' && i.category !== 'life');

    if (!knowledgeItems.length) {
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
    knowledgeItems.forEach(item => {
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
        const title   = m.title || item.title || firstLine.slice(0, 50) || '제목 없음';
        const sub     = (m.summary || item.summary || item.text || '').replace(/\n+/g, ' ').slice(0, 120);
        const id      = item._id || item.id;
        const cc      = this._libCardCat(item);   /* 프리미엄 카테고리 뱃지 */

        /* YouTube 영상 → 썸네일 + 우측 제목/요약 가로 카드 (홈과 동일 형식) */
        const isYt  = (item.type === 'youtube' || item.category === 'youtube');
        const thumb = item.thumbnail || m.thumbnail || '';
        if (isYt && thumb) {
          html += `<article class="knowledge-magazine-card kmc-yt" data-id="${id}" onclick="Mob.openDetailModal('${id}')">
            <div class="swipe-layer-delete"><i class="ti ti-trash"></i><span>삭제</span></div>
            <div class="kmc-yt-row">
              <div class="kmc-yt-thumb">
                <img src="${thumb}" alt="" loading="lazy"/>
                <span class="kmc-yt-play"><i class="ti ti-brand-youtube"></i></span>
              </div>
              <div class="kmc-content kmc-yt-body">
                <div class="kmc-top">
                  <span class="kmc-badge arch-badge arch-${cc.arch}" title="${cc.label}">${cc.code}</span>
                  <i class="ti ti-chevron-down kmc-chev"></i>
                </div>
                <h3 class="kmc-title">${title}</h3>
                ${sub ? `<p class="kmc-sub">${sub}${sub.length >= 120 ? '…' : ''}</p>` : ''}
              </div>
            </div>
          </article>`;
        } else {
          html += `<article class="knowledge-magazine-card" data-id="${id}" onclick="Mob.openDetailModal('${id}')">
            <div class="swipe-layer-delete"><i class="ti ti-trash"></i><span>삭제</span></div>
            <div class="kmc-content">
              <div class="kmc-top">
                <span class="kmc-badge arch-badge arch-${cc.arch}" title="${cc.label}">${cc.code}</span>
                <i class="ti ti-chevron-down kmc-chev"></i>
              </div>
              <h3 class="kmc-title">${title}</h3>
              ${sub ? `<p class="kmc-sub">${sub}${sub.length >= 120 ? '…' : ''}</p>` : ''}
            </div>
          </article>`;
        }
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
    /* 스와이프 제스처 초기화 (좌측 삭제만) */
    timelineEl.querySelectorAll('.knowledge-magazine-card').forEach(card => {
      this._initSwipe(card, card.dataset.id);
    });
  },

  /**
   * 서재 아이템을 매거진 카테고리로 분류 — 전체/English/역사/명언/고사성어
   * 인문학 피드는 subType(history/quote/idiom) 기준, 영어는 category/도메인 기준.
   */
  _libCardCat(item) {
    const st = (item.feedData && item.feedData.subType) || item.subType || '';
    /* code: Cinzel 음각 뱃지에 찍히는 영문 코드 / arch: 파스텔 색 모디파이어 */
    if (st === 'history') return { key: 'history', label: '역사',     code: 'HIS',  arch: 'his', icon: '🏛️' };
    if (st === 'quote')   return { key: 'quote',   label: '명언',     code: 'QUO',  arch: 'quo', icon: '💡' };
    if (st === 'idiom')   return { key: 'idiom',   label: '고사성어', code: 'IDM',  arch: 'idm', icon: '📜' };
    if (st === 'liber')   return { key: 'quote',   label: '고전',     code: 'LIB',  arch: 'quo', icon: '📖' };
    if (st === 'insight') return { key: 'other',   label: '인사이트', code: 'INS',  arch: 'other', icon: '💡' };
    if (st === 'market' || item.category === 'economy' || getItemDomain(item) === 'business' && (item.type||'').includes('market'))
      return { key: 'market', label: '시황', code: 'MKT', arch: 'mkt', icon: '📈' };
    /* YouTube — 영상은 별도 카테고리 */
    if (item.type === 'youtube' || item.category === 'youtube')
      return { key: 'youtube', label: 'YouTube', code: 'FILM', arch: 'yt', icon: '▶' };
    const dom = getItemDomain(item);
    if (item.category === 'en' || dom === 'language')
      return { key: 'english', label: 'English', code: 'EN', arch: 'en', icon: '🌐' };
    if (dom === 'humanities')
      return { key: 'history', label: '역사', code: 'HIS', arch: 'his', icon: '🏛️' };
    /* 그 외 도메인은 'all'에만 노출 — 뱃지는 도메인 라벨 사용 */
    return { key: 'other', label: (DOMAINS[dom] && DOMAINS[dom].label) || '지식',
             code: 'ARC', arch: 'other', icon: (DOMAINS[dom] && DOMAINS[dom].icon) || '💡' };
  },

  /* ── 스와이프 제스처 — 좌측(삭제)만. 우측(즐겨찾기)은 버그 유발로 완전 제거 ── */
  _initSwipe(card, id) {
    let startX = 0, startY = 0, deltaX = 0;
    let locked = null;                 /* null=미정 | 'h'=가로 스와이프 | 'v'=세로 스크롤 */
    const THRESHOLD = 120, MAX = 140;  /* 삭제까지 충분히 밀어야 함 — 오삭제 방지 */
    card.addEventListener('touchstart', e => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      deltaX = 0;
      locked = null;
      card.style.transition = '';
    }, { passive: true });
    card.addEventListener('touchmove', e => {
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      /* 첫 의미있는 움직임으로 가로/세로 방향을 결정 → 세로 스크롤 중 오삭제 차단 */
      if (locked === null) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        locked = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      }
      if (locked === 'v') return;      /* 세로 스크롤이면 스와이프 처리 안 함 */
      deltaX = dx;
      /* 좌측(음수)으로만 이동 허용 — 우측 스와이프 차단 */
      const move = Math.max(-MAX, Math.min(0, deltaX));
      card.style.transform = `translateX(${move}px)`;
      const delLayer = card.querySelector('.swipe-layer-delete');
      if (delLayer) delLayer.style.opacity = deltaX < -10 ? Math.min(1, (-deltaX) / THRESHOLD) : '0';
    }, { passive: true });
    card.addEventListener('touchend', () => {
      card.style.transition = 'transform 0.25s ease';
      card.style.transform  = '';
      const delLayer = card.querySelector('.swipe-layer-delete');
      if (delLayer) delLayer.style.opacity = '0';
      /* 가로 스와이프로 임계(120px)를 확실히 넘겼을 때만 삭제 확인 */
      if (locked === 'h' && deltaX < -THRESHOLD) this._deleteItem(id, card);
      deltaX = 0; locked = null;
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

  /* ── 서재 매거진 카테고리 필터 탭 ── */
  setLibraryFilter(cat, chip) {
    state.libraryFilter = cat;
    document.querySelectorAll('#libFilterBar .km-filter-tab').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    const si = el('libSearchInput');
    if (si) si.value = '';
    const sc = el('libSearchClear');
    if (sc) sc.hidden = true;
    this._applyLibraryFilters();
  },

  /* 빈 카테고리 탭 자동 비활성화 (전체는 항상 활성) */
  _updateLibraryFilterState() {
    const items = state.libraryItems || [];
    document.querySelectorAll('#libFilterBar .km-filter-tab[data-cat]').forEach(btn => {
      const cat = btn.dataset.cat;
      if (cat === 'all') { btn.disabled = false; return; }
      btn.disabled = !items.some(item => this._libCardCat(item).key === cat);
    });
  },

  /* 카테고리 필터 + 스마트 태그 + 검색어 동시 적용 → 현재 뷰 모드로 렌더 */
  _applyLibraryFilters(searchQ) {
    let items = state.libraryItems || [];
    const f   = state.libraryFilter;

    if (f && f !== 'all') {
      items = items.filter(item => this._libCardCat(item).key === f);
    }
    if (state.libraryTag) {
      const t = state.libraryTag.toLowerCase();
      items = items.filter(item => {
        const m = item.analysis || {};
        return [...(m.keywords || []), ...(item.keywords || []), ...(item.tags || [])]
          .some(k => String(k).toLowerCase() === t);
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
    this._renderLibraryView(items, searchQ);
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

  /* ══════════════════════════════════════════
     지식 순환 시스템 (v87)
     ① 오늘의 복습 배달(에빙하우스) ② 3뷰 토글 ③ 스마트 태그
  ══════════════════════════════════════════ */

  /** 현재 검색창 값 (필터 재적용 시 검색어 유지용) */
  _currentLibSearch() {
    const si = el('libSearchInput');
    const v  = si && si.value.trim();
    return v || undefined;
  },

  /** 뷰 모드 디스패처 — 카드(기존 격자)/리스트/캘린더 */
  _renderLibraryView(items, searchQ) {
    const vm = state.libraryViewMode || 'card';
    if (vm === 'list')     return this._renderLibraryList(items, searchQ);
    if (vm === 'calendar') return this._renderLibraryCalendar(items);
    this._renderLibraryTimeline(items, searchQ);
  },

  setLibraryViewMode(mode, btn) {
    state.libraryViewMode = mode;
    try { localStorage.setItem('lib-view-mode', mode); } catch {}
    document.querySelectorAll('#libViewToggle .km-view-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.vm === mode));
    this._applyLibraryFilters(this._currentLibSearch());
  },

  /* ── ① 오늘의 복습 배달 — 1·7·30일 전 + 날짜시드 랜덤으로 3~5개 큐레이션 ── */
  _renderReviewCarousel() {
    const sec  = el('libReviewSection');
    const rail = el('libReviewRail');
    if (!sec || !rail) return;

    const knowledge = (state.libraryItems || []).filter(i => i.type !== 'life' && i.category !== 'life');
    const now = Date.now();
    const age = i => Math.floor((now - new Date(i.createdAt || i.date)) / 86400000);
    const pool = knowledge.filter(i => age(i) >= 1);   /* 오늘 저장분은 복습 대상 아님 */
    if (pool.length < 2) { sec.hidden = true; return; }

    const picked = [], used = new Set();
    const take = it => { const id = it && (it._id || it.id); if (id && !used.has(id)) { used.add(id); picked.push(it); } };

    /* 에빙하우스 목표 간격 1·7·30일 — 각 목표에 가장 가까운 지식 1개씩 */
    [1, 7, 30].forEach(target => {
      const cand = pool
        .filter(i => !used.has(i._id || i.id))
        .sort((a, b) => Math.abs(age(a) - target) - Math.abs(age(b) - target))[0];
      /* 목표에서 너무 먼 후보(허용오차 초과)는 스킵 — 랜덤 채움에 맡김 */
      if (cand && Math.abs(age(cand) - target) <= Math.max(2, target)) take(cand);
    });

    /* 날짜 시드 셔플로 5개까지 채움 — 같은 날엔 같은 구성 유지(리렌더마다 안 바뀜) */
    let seed = 0;
    for (const ch of toLocalDateStr(new Date())) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const rest = pool.filter(i => !used.has(i._id || i.id));
    for (let n = 0; picked.length < 5 && rest.length > 0; n++) {
      const idx = (seed + n * 2654435761 % 4294967296) % rest.length;
      take(rest.splice(idx, 1)[0]);
    }
    if (!picked.length) { sec.hidden = true; return; }

    rail.innerHTML = picked.map(item => {
      const cc = this._libCardCat(item);
      const m  = item.analysis || {};
      const title = (m.title || item.title ||
        (item.text || '').split('\n').map(l => l.trim()).filter(Boolean)[0] || '지식').slice(0, 48);
      const d = age(item);
      const agoLabel = d >= 30 ? `${Math.floor(d / 30)}달 전` : d >= 7 ? `${Math.floor(d / 7)}주 전` : `${d}일 전`;
      return `
      <button class="km-review-card" onclick="Mob.openDetailModal('${item._id || item.id}')">
        <span class="kmc-badge arch-badge arch-${cc.arch}">${cc.code}</span>
        <span class="km-review-card-title">${title}</span>
        <span class="km-review-ago">${agoLabel}에 저장</span>
      </button>`;
    }).join('');
    sec.hidden = false;
  },

  /* ── ③ 스마트 태그 바 — 가장 많이 쓴 키워드 상위 8개 칩 ── */
  _renderTagBar() {
    const bar = el('libTagBar');
    if (!bar) return;
    const cnt = {};
    (state.libraryItems || []).forEach(i => {
      const m = i.analysis || {};
      [...(m.keywords || []), ...(i.keywords || []), ...(i.tags || [])].forEach(k => {
        k = String(k || '').trim();
        if (k.length > 1 && k.length <= 14) cnt[k] = (cnt[k] || 0) + 1;
      });
    });
    const top = Object.entries(cnt)
      .filter(([, c]) => c >= 2)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8);
    if (!top.length) { bar.innerHTML = ''; return; }
    bar.innerHTML = top.map(([tag, c]) => `
      <button class="km-tag-chip${state.libraryTag === tag ? ' active' : ''}"
              onclick="Mob.setLibraryTag('${tag.replace(/'/g, '&#39;')}')">
        #${tag}<span class="km-tag-cnt">${c}</span>
      </button>`).join('');
  },

  setLibraryTag(tag) {
    state.libraryTag = (state.libraryTag === tag) ? null : tag;   /* 재탭 = 해제 */
    this._renderTagBar();
    this._applyLibraryFilters(this._currentLibSearch());
  },

  /* ── ② 리스트(타임라인) 뷰 — 한 줄 압축 행, 스크롤 한 번에 수십 개 스캔 ── */
  _libListRow(item) {
    const cc = this._libCardCat(item);
    const m  = item.analysis || {};
    const title = m.title || item.title ||
      (item.text || item.summary || '').split('\n').map(l => l.trim()).filter(Boolean)[0]?.slice(0, 60) || '제목 없음';
    return `
    <button class="km-flat-row" onclick="Mob.openDetailModal('${item._id || item.id}')">
      <span class="kmc-badge arch-badge arch-${cc.arch}">${cc.code}</span>
      <span class="km-flat-title">${title}</span>
      <span class="km-flat-date">${fmt(item.createdAt || item.date)}</span>
    </button>`;
  },

  _renderLibraryList(items, searchQ) {
    const timelineEl = el('libTimeline');
    if (!timelineEl) return;
    const rows = (items || []).filter(i => i.type !== 'life' && i.category !== 'life');
    if (!rows.length) {
      timelineEl.innerHTML = `<div class="mvw-lib-empty"><i class="ti ti-books"></i><br>
        ${searchQ ? `"${searchQ}" 검색 결과 없음` : '표시할 지식이 없어요'}</div>`;
      return;
    }
    const sorted = [...rows].sort((a, b) =>
      new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));
    timelineEl.innerHTML =
      `<div class="km-flat-list">${sorted.map(i => this._libListRow(i)).join('')}</div>`;
  },

  /* ── ② 캘린더 뷰 — 날짜 터치 → 그날 저장한 지식으로 즉시 점프 ── */
  _renderLibraryCalendar(items) {
    const timelineEl = el('libTimeline');
    if (!timelineEl) return;
    const knowledge = (items || []).filter(i => i.type !== 'life' && i.category !== 'life');

    /* 날짜별 그룹핑 (로컬 타임존 키) */
    const byDate = {};
    knowledge.forEach(i => {
      const d = new Date(i.createdAt || i.date);
      if (isNaN(d)) return;
      const key = toLocalDateStr(d);
      (byDate[key] ||= []).push(i);
    });

    const ym = state.libraryCalMonth || toLocalDateStr(new Date()).slice(0, 7);
    const [y, mo] = ym.split('-').map(Number);
    const lead        = new Date(y, mo - 1, 1).getDay();   /* 0=일 */
    const daysInMonth = new Date(y, mo, 0).getDate();

    let cells = '';
    for (let i = 0; i < lead; i++) cells += `<span class="km-cal-cell empty"></span>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${ym}-${String(d).padStart(2, '0')}`;
      const n   = (byDate[key] || []).length;
      const sel = state.librarySelectedDate === key;
      cells += n
        ? `<button class="km-cal-cell has${sel ? ' sel' : ''}" onclick="Mob._selectLibraryDate('${key}')">
             <span class="km-cal-num">${d}</span><span class="km-cal-cnt">${n}</span>
           </button>`
        : `<span class="km-cal-cell mute"><span class="km-cal-num">${d}</span></span>`;
    }

    /* 선택 날짜의 지식 목록 */
    const selKey   = state.librarySelectedDate;
    const selItems = selKey ? (byDate[selKey] || []) : [];
    const dayList = selKey
      ? `<div class="km-cal-daylist">
           <div class="km-cal-daylist-hd">${fmtFull(selKey)} · ${selItems.length}개</div>
           ${selItems.map(i => this._libListRow(i)).join('')}
         </div>`
      : `<div class="km-cal-daylist-empty">골드 점이 있는 날짜를 누르면 그날의 지식이 열려요</div>`;

    timelineEl.innerHTML = `
      <div class="km-cal">
        <div class="km-cal-hd">
          <button class="km-cal-nav" onclick="Mob._moveLibraryCalMonth(-1)" aria-label="이전 달"><i class="ti ti-chevron-left"></i></button>
          <span class="km-cal-ym">${y}년 ${mo}월</span>
          <button class="km-cal-nav" onclick="Mob._moveLibraryCalMonth(1)" aria-label="다음 달"><i class="ti ti-chevron-right"></i></button>
        </div>
        <div class="km-cal-week">${['일','월','화','수','목','금','토'].map(w => `<span>${w}</span>`).join('')}</div>
        <div class="km-cal-grid">${cells}</div>
        ${dayList}
      </div>`;
  },

  _moveLibraryCalMonth(delta) {
    const ym = state.libraryCalMonth || toLocalDateStr(new Date()).slice(0, 7);
    const [y, mo] = ym.split('-').map(Number);
    const d = new Date(y, mo - 1 + delta, 1);
    state.libraryCalMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    state.librarySelectedDate = null;
    this._applyLibraryFilters(this._currentLibSearch());
  },

  _selectLibraryDate(key) {
    state.librarySelectedDate = (state.librarySelectedDate === key) ? null : key;   /* 재탭 = 해제 */
    this._applyLibraryFilters(this._currentLibSearch());
  },

  /* ══════════════════════════════════════════
     지식 / 라이프 서재 타입 탭 전환
  ══════════════════════════════════════════ */
  setLibType(type, btn) {
    document.querySelectorAll('.mvw-lib-main-type-tab').forEach(t => t.classList.remove('active'));
    if (btn) btn.classList.add('active');
    const lifePanel      = el('lifeLibrary');
    const knowledgePanel = el('knowledgeLibraryPanel');
    if (lifePanel)      lifePanel.hidden      = (type !== 'life');
    if (knowledgePanel) knowledgePanel.hidden = (type === 'life');
    if (type === 'life') this._loadLifeLibrary();
  },

  /* ── 라이프 서재 로드 (연도 필터 반영을 위해 항상 state.lifeFilter/lifeYear 기준) ── */
  async _loadLifeLibrary() {
    const tl = el('lifeTimeline');
    if (!tl) return;
    tl.innerHTML = '<div class="mob-loading"><span class="mob-spin"></span></div>';
    try {
      const params = new URLSearchParams();
      if (state.lifeFilter && state.lifeFilter !== 'all') params.set('mood', state.lifeFilter);
      if (state.lifeYear   && state.lifeYear   !== 'all') params.set('year', state.lifeYear);
      const qs   = params.toString();
      const data = await fetchJSON(`/api/items/life${qs ? '?' + qs : ''}`, {}, 20000);
      state.lifeItems = data.items || [];
      this._renderLifeYearBar(state.lifeItems);
      this._renderLifeTimeline(state.lifeItems);
    } catch {
      tl.innerHTML = '<div style="padding:16px;color:var(--text-2);font-size:13px">불러오기 실패</div>';
    }
  },

  filterLifeMood(mood, btn) {
    state.lifeFilter = mood;
    document.querySelectorAll('.mvw-mood-chip').forEach(c => c.classList.remove('active'));
    if (btn) btn.classList.add('active');
    this._loadLifeLibrary();
  },

  /* 연도 필터 바 — 현재 로드된 아이템에서 존재하는 연도만 추출해 칩으로 렌더 */
  _renderLifeYearBar(items) {
    const bar = el('lifeYearBar');
    if (!bar) return;
    if (!state.lifeYear) state.lifeYear = 'all';

    const years = [...new Set((items || []).map(i => {
      const d = new Date(i.life?.date || i.createdAt);
      return d.getFullYear();
    }).filter(y => !isNaN(y)))].sort((a, b) => b - a);

    /* 연도가 1개 이하면 필터 무의미 — 바 자체를 숨김 */
    if (years.length <= 1 && state.lifeYear === 'all') {
      bar.innerHTML = '';
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    bar.innerHTML = ['all', ...years].map(y => `
      <button class="mvw-life-year-chip${String(state.lifeYear) === String(y) ? ' active' : ''}"
              onclick="Mob._filterLifeYear('${y}',this)">
        ${y === 'all' ? '전체' : y + '년'}
      </button>`).join('');
  },

  _filterLifeYear(year, btn) {
    state.lifeYear = String(year);
    document.querySelectorAll('.mvw-life-year-chip').forEach(c => c.classList.remove('active'));
    if (btn) btn.classList.add('active');
    this._loadLifeLibrary();
  },

  _renderLifeTimeline(items) {
    const tl = el('lifeTimeline');
    if (!tl) return;
    if (!items.length) {
      tl.innerHTML = `
        <div class="mvw-life-empty">
          <i class="ti ti-camera-heart"></i>
          <p>아직 라이프 기록이 없어요<br>소중한 순간을 저장해보세요</p>
          <button class="mvw-life-empty-btn" onclick="Mob.openAdd();Mob.setAddType('life',el('mobAddTabLife'))">
            <i class="ti ti-plus"></i> 첫 기록 남기기
          </button>
        </div>`;
      return;
    }

    /* 날짜별 그룹핑 */
    const groups = {};
    items.forEach(item => {
      const d   = new Date(item.life?.date || item.createdAt);
      const key = toLocalDateStr(d);
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });

    let html = '';
    Object.entries(groups)
      .sort(([a], [b]) => b.localeCompare(a))
      .forEach(([dateKey, dayItems]) => {
        html += `<div class="mvw-life-date-header">${fmtFull(dateKey)}</div>`;
        dayItems.forEach(item => {
          const life      = item.life || {};
          const hasPhotos = life.photos?.length > 0;
          const cnt       = life.photos?.length || 0;

          html += `<div class="mvw-life-card${hasPhotos ? ' has-photo' : ''}"
                        data-id="${item.id}"
                        onclick="Mob.openLifeDetail('${item.id}')">`;

          if (hasPhotos) {
            const gridCnt = Math.min(cnt, 4);
            html += `<div class="mvw-life-photo-grid count-${gridCnt}">`;
            life.photos.slice(0, 4).forEach((url, i) => {
              const isMain = (i === 0 && cnt >= 3);
              html += `<div class="mvw-life-photo-cell${isMain ? ' main' : ''}">
                <img src="${url}" alt="" loading="lazy"/>
                ${i === 3 && cnt > 4 ? `<div class="mvw-life-photo-more">+${cnt - 4}</div>` : ''}
              </div>`;
            });
            html += `</div>`;
          }

          html += `<div class="mvw-life-card-body">
            ${life.mood     ? `<span class="mvw-life-mood">${life.mood}</span>` : ''}
            ${item.text     ? `<p class="mvw-life-text">${item.text}</p>` : ''}
            <div class="mvw-life-meta">
              ${life.location ? `<span><i class="ti ti-map-pin"></i> ${life.location}</span>` : ''}
              ${life.weather  ? `<span>${life.weather}</span>` : ''}
            </div>
          </div></div>`;
        });
      });

    tl.innerHTML = html;
  },

  /* 라이프 상세 팝업 — 기존 libDetailModal(지식 상세와 공유) 재활용 */
  openLifeDetail(id) {
    const item = state.lifeItems.find(i => i.id === id);
    if (!item) return;
    const life = item.life || {};

    const badge = el('libDetailBadge');
    if (badge) {
      badge.textContent = 'LIFE';
      badge.className   = 'mob-modal-badge arch-badge arch-life';
    }

    const body = el('libDetailBody');
    if (body) {
      body.innerHTML = this._buildLifeDetailBody(item, life);
      body.scrollTop = 0;
    }
    const modal = el('libDetailModal');
    if (modal) modal.hidden = false;

    if ((life.photos || []).length > 1) this._initLifeSliderSwipe();
  },

  _buildLifeDetailBody(item, life) {
    const photos    = life.photos || [];
    const hasPhotos = photos.length > 0;
    const dateStr   = fmtFull(life.date || item.createdAt);
    const privacyMap = { private: '나만 보기', friends: '친구 공개', group: '지식방 공개' };

    return `
      ${hasPhotos ? `
      <div class="mob-life-detail-photos">
        <div class="mob-life-photo-slider" id="lifePhotoSlider">
          ${photos.map((url, i) => `
            <div class="mob-life-slide${i === 0 ? ' active' : ''}">
              <img src="${url}" alt="" loading="lazy"/>
            </div>`).join('')}
        </div>
        ${photos.length > 1 ? `
        <div class="mob-life-photo-dots">
          ${photos.map((_, i) =>
            `<span class="mob-life-dot${i === 0 ? ' active' : ''}" onclick="Mob._goLifeSlide(${i})"></span>`
          ).join('')}
        </div>` : ''}
      </div>` : ''}

      <div class="mob-life-detail-meta">
        ${life.mood ? `<span class="mob-life-detail-mood">${life.mood}</span>` : ''}
        <div class="mob-life-detail-date"><i class="ti ti-calendar-event"></i> ${dateStr}</div>
        ${life.location ? `<div class="mob-life-detail-location"><i class="ti ti-map-pin"></i> ${life.location}</div>` : ''}
        ${life.weather ? `<div class="mob-life-detail-location">${life.weather}</div>` : ''}
      </div>

      ${item.text ? `<div class="mob-life-detail-text">${item.text}</div>` : ''}

      <div class="mob-life-detail-privacy">
        <i class="ti ti-lock"></i> ${privacyMap[life.privacy || 'private']}
      </div>

      <div class="mob-life-detail-actions">
        <button class="mob-life-action-btn delete" onclick="Mob._deleteLifeItem('${item.id}')">
          <i class="ti ti-trash"></i> 삭제
        </button>
      </div>`;
  },

  _goLifeSlide(idx) {
    document.querySelectorAll('#lifePhotoSlider .mob-life-slide').forEach((s, i) => s.classList.toggle('active', i === idx));
    document.querySelectorAll('.mob-life-photo-dots .mob-life-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
    this._lifeCurrentSlide = idx;
  },

  _initLifeSliderSwipe() {
    const slider = el('lifePhotoSlider');
    if (!slider) return;
    const total = slider.querySelectorAll('.mob-life-slide').length;
    let startX = 0;
    this._lifeCurrentSlide = 0;

    slider.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
    slider.addEventListener('touchend', e => {
      const diff = startX - e.changedTouches[0].clientX;
      if (Math.abs(diff) < 50) return;
      let cur = this._lifeCurrentSlide || 0;
      if (diff > 0 && cur < total - 1) cur++;
      if (diff < 0 && cur > 0) cur--;
      this._goLifeSlide(cur);
    }, { passive: true });
  },

  /* 라이프 기록 삭제 — 범용 DELETE /api/items/:id 재사용(전용 API 불필요) */
  async _deleteLifeItem(id) {
    if (!confirm('이 기록을 삭제할까요?')) return;
    try {
      await fetchJSON(`/api/items/${id}`, { method: 'DELETE' });
      this.closeDetailModal();
      state.lifeItems = state.lifeItems.filter(i => i.id !== id);
      this._renderLifeTimeline(state.lifeItems);
      toast('삭제됐어요', 'ok');
    } catch { toast('삭제 실패', 'err'); }
  },

});
