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

        html += `<article class="knowledge-magazine-card" data-id="${id}" onclick="Mob._toggleDetail(this,'${id}')">
          <div class="swipe-layer-delete"><i class="ti ti-trash"></i><span>삭제</span></div>
          <div class="kmc-content">
            <div class="kmc-top">
              <span class="kmc-badge">${cc.icon} ${cc.label}</span>
              <i class="ti ti-chevron-down kmc-chev"></i>
            </div>
            <h3 class="kmc-title">${title}</h3>
            ${sub ? `<p class="kmc-sub">${sub}${sub.length >= 120 ? '…' : ''}</p>` : ''}
          </div>
        </article>`;
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
    if (st === 'history') return { key: 'history', label: '역사',     icon: '🏛️' };
    if (st === 'quote')   return { key: 'quote',   label: '명언',     icon: '💡' };
    if (st === 'idiom')   return { key: 'idiom',   label: '고사성어', icon: '📜' };
    const dom = getItemDomain(item);
    if (item.category === 'en' || dom === 'language')
      return { key: 'english', label: 'English', icon: '🌐' };
    /* 그 외 도메인은 'all'에만 노출 — 뱃지는 도메인 라벨 사용 */
    return { key: 'other', label: (DOMAINS[dom] && DOMAINS[dom].label) || '지식',
             icon: (DOMAINS[dom] && DOMAINS[dom].icon) || '💡' };
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

  /* 카테고리 필터 + 검색어 동시 적용 */
  _applyLibraryFilters(searchQ) {
    let items = state.libraryItems || [];
    const f   = state.libraryFilter;

    if (f && f !== 'all') {
      items = items.filter(item => this._libCardCat(item).key === f);
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

  /* ── 라이프 서재 로드 ── */
  async _loadLifeLibrary(mood) {
    const tl = el('lifeTimeline');
    if (!tl) return;
    tl.innerHTML = '<div class="mob-loading"><span class="mob-spin"></span></div>';
    try {
      const filter = mood && mood !== 'all' ? mood : null;
      const url    = filter
        ? `/api/items/life?mood=${encodeURIComponent(filter)}`
        : '/api/items/life';
      const data   = await fetchJSON(url, {}, 20000);
      state.lifeItems = data.items || [];
      this._renderLifeTimeline(state.lifeItems);
    } catch {
      tl.innerHTML = '<div style="padding:16px;color:var(--text-2);font-size:13px">불러오기 실패</div>';
    }
  },

  filterLifeMood(mood, btn) {
    state.lifeFilter = mood;
    document.querySelectorAll('.mvw-mood-chip').forEach(c => c.classList.remove('active'));
    if (btn) btn.classList.add('active');
    this._loadLifeLibrary(mood === 'all' ? null : mood);
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

  /* 라이프 상세 — 현재는 토스트로 대체 (추후 모달) */
  openLifeDetail(id) {
    const item = state.lifeItems.find(i => i.id === id);
    if (!item) return;
    const life = item.life || {};
    toast(`${life.mood || ''} ${item.text?.slice(0, 30) || '라이프 기록'}`, '', 3000);
  },


});
