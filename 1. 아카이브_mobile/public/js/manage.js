/**
 * manage.js — 학습 관리 (통계 대시보드 · 복습 큐 · AI 퀴즈)
 * ────────────────────────────────────────────
 * 담당: 관리뷰 로드, 통계(총계·스트릭·히트맵·주간·카테고리·최근), 복습 큐, AI 퀴즈 플로우
 * 의존: core.js(Mob·state·el·toast·fetchJSON·fmt·dayLabel)
 *       배달설정 렌더(_renderDeliverySettings)는 feed.js, 상세 토글(_toggleDetail)·_catLabel은
 *       app_mobile.js/feed.js에 정의됨 — 같은 Mob 객체라 호출 가능
 */

'use strict';

Object.assign(Mob, {

  /* ══════════════════════════════════════════
     관리 뷰 로드 (배달설정 + 통계 병렬)
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
      this._initLifeOnHomeToggle();
      /* 카테고리 칩 + 결산 초기 로드 (병렬, 실패해도 무시) */
      this._renderCategoryChips().catch(() => {});
      this.loadSummary('monthly', el('summaryBlock')?.querySelector('.mvw-summary-tab')).catch(() => {});
    } catch {
      el('statTotal').textContent  = '—';
      el('statStreak').textContent = '—';
      toast('관리 데이터 로드 실패', 'err');
    }
  },

  /* ══════════════════════════════════════════
     통계 대시보드
  ══════════════════════════════════════════ */
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

  /* ══════════════════════════════════════════
     카테고리 관리
  ══════════════════════════════════════════ */
  async _renderCategoryChips() {
    const wrap = el('categoryChipList');
    if (!wrap) return;
    try {
      const cats = await fetchJSON('/api/categories', {}, 10000);
      state.userCategories = cats;
      if (!cats.length) { wrap.innerHTML = '<div style="font-size:13px;color:var(--text-2)">카테고리 없음</div>'; return; }
      wrap.innerHTML = cats.map(c =>
        `<span class="mvw-cat-chip-sm" style="border-color:${c.color};color:${c.color}">
           ${c.emoji} ${c.name}
         </span>`
      ).join('');
    } catch { wrap.innerHTML = '<div style="font-size:12px;color:var(--text-2)">불러오기 실패</div>'; }
  },

  async openCategoryManager() {
    el('categoryManagerModal').hidden = false;
    const body = el('categoryManagerBody');
    body.innerHTML = '<div class="mob-loading"><span class="mob-spin"></span></div>';
    try {
      const cats = await fetchJSON('/api/categories', {}, 10000);
      state.userCategories = cats;
      this._renderCategoryManager(cats);
    } catch { body.innerHTML = '<div style="padding:16px;color:var(--text-2)">불러오기 실패</div>'; }
  },

  _closeCategoryManager() {
    el('categoryManagerModal').hidden = true;
    this._renderCategoryChips();
  },

  _renderCategoryManager(cats) {
    const body = el('categoryManagerBody');
    const customCats = cats.filter(c => !c.is_default);
    body.innerHTML = `
      <div class="mvw-catmgr-section-title">기본 카테고리</div>
      <div class="mvw-catmgr-list">
        ${cats.filter(c => c.is_default).map(c => `
          <div class="mvw-catmgr-item">
            <span class="mvw-catmgr-emoji">${c.emoji}</span>
            <span class="mvw-catmgr-name">${c.name}</span>
            <span class="mvw-catmgr-modes">${
              c.modes === 'work' ? '<span class="mvw-catmgr-badge work">직장인</span>' :
              c.modes === 'exam' ? '<span class="mvw-catmgr-badge exam">수험생</span>' :
              '<span class="mvw-catmgr-badge both">공통</span>'
            }</span>
          </div>`).join('')}
      </div>

      <div class="mvw-catmgr-section-title" style="margin-top:20px">내 카테고리</div>
      <div class="mvw-catmgr-list" id="customCatList">
        ${customCats.length ? customCats.map(c => `
          <div class="mvw-catmgr-item">
            <span class="mvw-catmgr-emoji">${c.emoji}</span>
            <span class="mvw-catmgr-name">${c.name}</span>
            <button class="mvw-catmgr-del-btn" onclick="Mob._deleteCategory(${c.id},'${c.name}')">
              <i class="ti ti-trash"></i>
            </button>
          </div>`).join('')
        : '<div style="font-size:13px;color:var(--text-2);padding:8px 0">아직 없어요</div>'}
      </div>

      <div class="mvw-catmgr-add-row">
        <input type="text" id="newCatName"    class="mvw-catmgr-input" placeholder="카테고리 이름"/>
        <input type="text" id="newCatEmoji"   class="mvw-catmgr-input mvw-catmgr-emoji-input" placeholder="😊" maxlength="2"/>
        <button class="mvw-catmgr-add-btn" onclick="Mob._saveNewCategory()">
          <i class="ti ti-plus"></i> 추가
        </button>
      </div>`;
  },

  async _saveNewCategory() {
    const name  = el('newCatName')?.value.trim();
    const emoji = el('newCatEmoji')?.value.trim() || '📁';
    if (!name) { toast('이름을 입력해주세요', 'err'); return; }
    try {
      await fetchJSON('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, emoji })
      });
      toast(`'${name}' 카테고리 추가됐어요`, 'ok');
      this.openCategoryManager();
    } catch { toast('추가 실패', 'err'); }
  },

  async _deleteCategory(id, name) {
    if (!confirm(`'${name}' 카테고리를 삭제할까요?\n포함 아이템은 '기타'로 이동합니다.`)) return;
    try {
      await fetchJSON(`/api/categories/${id}`, { method: 'DELETE' });
      toast(`'${name}' 삭제됐어요`, 'ok');
      this.openCategoryManager();
    } catch { toast('삭제 실패', 'err'); }
  },

  /* ══════════════════════════════════════════
     결산
  ══════════════════════════════════════════ */
  async loadSummary(type, btn) {
    document.querySelectorAll('.mvw-summary-tab').forEach(t => t.classList.remove('active'));
    if (btn) btn.classList.add('active');
    state.summaryType = type;

    const now   = new Date();
    const y     = now.getFullYear();
    const m     = String(now.getMonth() + 1).padStart(2, '0');
    const half  = now.getMonth() < 6 ? 'H1' : 'H2';
    const period = type === 'monthly'   ? `${y}-${m}`
                 : type === 'half-year' ? `${y}-${half}`
                 :                        `${y}`;

    const wrap = el('summaryContent');
    wrap.innerHTML = '<div class="mob-loading" style="padding:24px 0"><span class="mob-spin"></span></div>';
    try {
      const data = await fetchJSON(`/api/summary/${type}/${period}`, {}, 60000);
      this._renderSummary(data, type);
    } catch { wrap.innerHTML = '<div style="padding:16px;color:var(--text-2);font-size:13px">결산 불러오기 실패</div>'; }
  },

  _renderSummary(data, type) {
    const s = data.stats || {};
    const isYearly = (type === 'yearly');
    const wrap = el('summaryContent');
    if (!wrap) return;

    const topCats = (s.topCategories || []).slice(0, 5);
    const topKws  = (s.topKeywords  || []).slice(0, 10);
    const total   = s.totalItems || 0;

    wrap.innerHTML = `
      <!-- 숫자 요약 -->
      <div class="mvw-summary-stats">
        <div class="mvw-summary-stat">
          <div class="mvw-summary-num">${s.totalItems || 0}</div>
          <div class="mvw-summary-label">지식</div>
        </div>
        <div class="mvw-summary-stat">
          <div class="mvw-summary-num">${s.totalLife || 0}</div>
          <div class="mvw-summary-label">라이프</div>
        </div>
      </div>

      <!-- AI 총평 -->
      ${data.aiReview ? `
      <div class="mvw-summary-ai-review">
        <i class="ti ti-sparkles"></i>
        <p>${data.aiReview}</p>
      </div>` : total === 0 ? `
      <div class="mvw-summary-empty">
        <i class="ti ti-books"></i>
        <p>이 기간에 저장된 지식이 없어요</p>
      </div>` : ''}

      <!-- 많이 배운 분야 -->
      ${topCats.length ? `
      <div class="mvw-summary-section-title">많이 배운 분야</div>
      <div class="mvw-summary-categories">
        ${topCats.map(c => `
          <div class="mvw-summary-cat-bar">
            <span class="mvw-summary-cat-name">${c.name}</span>
            <div class="mvw-summary-bar-wrap">
              <div class="mvw-summary-bar-fill"
                   style="width:${total ? Math.round(c.count / total * 100) : 0}%"></div>
            </div>
            <span class="mvw-summary-cat-count">${c.count}개</span>
          </div>`).join('')}
      </div>` : ''}

      <!-- 주요 키워드 -->
      ${topKws.length ? `
      <div class="mvw-summary-section-title">주요 키워드</div>
      <div class="mvw-summary-keywords">
        ${topKws.map(k => `
          <span class="mvw-summary-kw-chip"
                style="font-size:${Math.min(11 + k.count, 18)}px">
            ${k.word}
          </span>`).join('')}
      </div>` : ''}

      ${isYearly ? `
      <button class="mvw-summary-refresh-btn"
              onclick="Mob._refreshSummary('${type}')">
        <i class="ti ti-refresh"></i> 결산 새로 생성
      </button>` : `
      <button class="mvw-summary-refresh-btn"
              onclick="Mob._refreshSummary('${type}')">
        <i class="ti ti-refresh"></i> 새로 생성
      </button>`}`;
  },

  async _refreshSummary(type) {
    const now   = new Date();
    const y     = now.getFullYear();
    const m     = String(now.getMonth() + 1).padStart(2, '0');
    const half  = now.getMonth() < 6 ? 'H1' : 'H2';
    const period = type === 'monthly'   ? `${y}-${m}`
                 : type === 'half-year' ? `${y}-${half}`
                 :                        `${y}`;
    try {
      await fetchJSON(`/api/summary/${type}/${period}?force=1`, {}, 60000);
      toast('결산 새로 생성됐어요', 'ok');
      this.loadSummary(type, null);
    } catch { toast('결산 생성 실패', 'err'); }
  },

  /* ══════════════════════════════════════════
     라이프 홈 표시 토글
  ══════════════════════════════════════════ */
  _initLifeOnHomeToggle() {
    const btn = el('lifeOnHomeToggle');
    if (!btn) return;
    const enabled = localStorage.getItem('showLifeOnHome') === 'true';
    btn.classList.toggle('active', enabled);
  },

  _toggleLifeOnHome(btn) {
    const next = !(localStorage.getItem('showLifeOnHome') === 'true');
    localStorage.setItem('showLifeOnHome', String(next));
    btn.classList.toggle('active', next);
    this.renderFeed(state.items);
    toast(next ? '라이프 기록이 홈에 표시됩니다' : '라이프 기록을 홈에서 숨겼습니다', 'ok');
  },

});
