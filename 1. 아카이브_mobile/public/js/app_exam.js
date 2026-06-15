/**
 * app_exam.js — 수험생 모드 (ExamMob namespace)
 * Depends on: app_mobile.js (Mob, el, toast, fmt, fetchJSON)
 */
'use strict';

/* ── 과목 레이블 맵 ── */
const EXAM_SUBJECTS_CLIENT = {
  math:    { label: '수학',   icon: '📐', color: '#4f46e5' },
  korean:  { label: '국어',   icon: '📖', color: '#dc2626' },
  english: { label: '영어',   icon: '🗽', color: '#2563eb' },
  history: { label: '한국사', icon: '🏛️', color: '#92400e' },
  science: { label: '탐구',   icon: '🔬', color: '#06b6d4' },
  cert:    { label: '자격증', icon: '📋', color: '#7c3aed' },
};

const ExamMob = {

  /* ── 현재 선택된 과목 ── */
  selectedSubject: 'math',

  /* ══════════════════════════════════════════
     초기화
  ══════════════════════════════════════════ */
  init() {
    el('examHomeHeader')?.removeAttribute('hidden');
    this._loadDday();
    this._loadTodaySummary();
  },

  /* ══════════════════════════════════════════
     D-day 로드
  ══════════════════════════════════════════ */
  async _loadDday() {
    try {
      const data = await fetchJSON('/api/exam/settings');
      const label = el('examDdayLabel');
      const num   = el('examDdayNum');
      if (!data?.examDate) {
        if (label) label.textContent = '시험까지';
        if (num)   num.textContent   = 'D-?';
        return;
      }
      const diff = Math.ceil((new Date(data.examDate) - new Date()) / 86400000);
      if (label) label.textContent = data.examName || '시험까지';
      if (num)   num.textContent   = diff > 0 ? `D-${diff}` : (diff === 0 ? 'D-DAY' : `D+${Math.abs(diff)}`);
    } catch {}
  },

  /* ══════════════════════════════════════════
     오늘 요약 (복습 대기 + 연속 일수)
  ══════════════════════════════════════════ */
  async _loadTodaySummary() {
    try {
      const data = await fetchJSON('/api/exam/today-summary');
      const review = el('examReviewDue');
      const streak = el('examStreak');
      if (review) review.textContent = data?.reviewDue ?? 0;
      if (streak) streak.textContent = data?.streak    ?? 0;
    } catch {}
  },

  /* ══════════════════════════════════════════
     시험 설정 모달 열기
  ══════════════════════════════════════════ */
  openExamSettings() {
    el('examDashboard')?.removeAttribute('hidden');
    Mob.switchView('manage', el('bnManage'));
    /* 관리탭으로 이동 후 설정 영역으로 스크롤 */
    setTimeout(() => {
      el('examDashboard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
  },

  /* ══════════════════════════════════════════
     시험 설정 저장
  ══════════════════════════════════════════ */
  async saveExamSettings() {
    const name = (el('examNameInput')?.value || '').trim();
    const date = el('examDateInput')?.value || '';
    if (!date) { toast('시험 날짜를 선택해 주세요', 'err'); return; }
    try {
      await fetchJSON('/api/exam/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ examName: name, examDate: date })
      });
      toast('✅ 시험 설정 저장!', 'ok');
      this._loadDday();
    } catch { toast('저장 실패', 'err'); }
  },

  /* ══════════════════════════════════════════
     과목 선택 (추가 모달 내)
  ══════════════════════════════════════════ */
  setSubject(subj, btn) {
    this.selectedSubject = subj;
    document.querySelectorAll('.mob-subj-chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
  },

  /* ══════════════════════════════════════════
     서재 내 오답/개념 탭 전환
  ══════════════════════════════════════════ */
  setLibType(type, btn) {
    document.querySelectorAll('.mvw-lib-type-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    if (type === 'wrong') {
      el('wrongAnswerTimeline')?.removeAttribute('hidden');
      el('libTimeline')?.setAttribute('hidden', '');
      el('libAiToggle')?.setAttribute('hidden', '');
      el('libSearchWrap')?.setAttribute('hidden', '');
      this._loadWrongAnswerLibrary();
    } else {
      el('wrongAnswerTimeline')?.setAttribute('hidden', '');
      el('libTimeline')?.removeAttribute('hidden');
      el('libAiToggle')?.removeAttribute('hidden');
      el('libSearchWrap')?.removeAttribute('hidden');
    }
  },

  /* ══════════════════════════════════════════
     오답 서재 로드
  ══════════════════════════════════════════ */
  async _loadWrongAnswerLibrary(subject) {
    const container = el('wrongAnswerTimeline');
    if (!container) return;
    container.innerHTML = '<div class="mob-loading"><span class="mob-spin"></span> 오답 불러오는 중…</div>';
    try {
      const data  = await fetchJSON('/api/items?limit=500');
      const items = (data?.items ?? data ?? []).filter(i => i.type === 'wrong_answer');
      const filtered = subject && subject !== 'all'
        ? items.filter(i => i.wrongAnswer?.subject === subject)
        : items;
      if (!filtered.length) {
        container.innerHTML = '<div class="mvw-empty"><i class="ti ti-clipboard-x" style="font-size:36px;display:block;margin-bottom:8px;opacity:.35"></i>아직 오답이 없어요!<br>추가 탭에서 사진을 찍어 분석해 보세요.</div>';
        return;
      }
      /* 날짜 그룹핑 */
      const groups = {};
      filtered.forEach(i => {
        const d = i.date || '날짜 없음';
        if (!groups[d]) groups[d] = [];
        groups[d].push(i);
      });
      let html = '';
      Object.entries(groups).sort(([a],[b]) => b > a ? 1 : -1).forEach(([date, items]) => {
        html += `<div class="mob-section-hd" style="margin-top:12px">
          <span>${date}</span>
          <span class="mob-section-badge">${items.length}개</span>
        </div>`;
        items.forEach(i => { html += this._renderWrongCard(i); });
      });
      container.innerHTML = html;
    } catch { container.innerHTML = '<div class="mvw-empty">불러오기 실패</div>'; }
  },

  /* ── 오답 카드 HTML ── */
  _renderWrongCard(item) {
    const w = item.wrongAnswer || {};
    const statusMap = {
      pending:   { label: '미복습', color: '#ef4444' },
      reviewing: { label: '복습중', color: '#f59e0b' },
      done:      { label: '완료',   color: '#22c55e' },
    };
    const s    = statusMap[w.reviewStatus || 'pending'];
    const subj = EXAM_SUBJECTS_CLIENT[w.subject] || { label: w.subject || '기타', icon: '📝', color: '#6b7280' };
    const nextReview = w.reviewAt
      ? `<div class="mvw-wrong-next-review"><i class="ti ti-calendar"></i> 다음 복습: ${fmt(w.reviewAt)}</div>`
      : '';
    return `
    <div class="mvw-wrong-card" onclick="ExamMob.openWrongDetail('${item.id}')">
      <div class="mvw-wrong-card-top">
        <span class="mvw-wrong-subj-badge">${subj.icon} ${subj.label}</span>
        <span class="mvw-wrong-status" style="color:${s.color}">${s.label}</span>
      </div>
      <div class="mvw-wrong-unit">${w.unit || '단원 미분류'}</div>
      ${w.keyConceptName ? `<div class="mvw-wrong-concept">${w.keyConceptName}</div>` : ''}
      ${nextReview}
    </div>`;
  },

  /* ══════════════════════════════════════════
     오답 상세 모달 열기
  ══════════════════════════════════════════ */
  async openWrongDetail(id) {
    const data  = await fetchJSON('/api/items?limit=500').catch(() => ({}));
    const items = (data?.items ?? data ?? []);
    const item  = items.find(i => i.id === id);
    if (!item) return;
    const w    = item.wrongAnswer || {};
    const subj = EXAM_SUBJECTS_CLIENT[w.subject] || { label: w.subject || '기타', icon: '📝' };

    const conceptTags = (w.concepts || [])
      .map(c => `<button class="mvw-wrong-concept-tag" onclick="ExamMob._searchConcept('${c}')">${c}</button>`)
      .join('');

    const imgHtml = item.imageUrl
      ? `<img src="${item.imageUrl}" style="width:100%;border-radius:10px;margin-bottom:8px" alt="문제 사진"/>`
      : '';

    const body = el('examWrongBody');
    const badge = el('examWrongBadge');
    if (badge) badge.textContent = `${subj.icon} ${subj.label}`;

    if (body) body.innerHTML = `
      ${imgHtml}

      <div class="mvw-wrong-detail-section">
        <div class="mvw-wrong-detail-section-title">📌 단원</div>
        <div class="mvw-wrong-detail-unit">${w.unit || '단원 미분류'}</div>
      </div>

      ${w.whyWrong ? `<div class="mvw-wrong-detail-section">
        <div class="mvw-wrong-detail-section-title">❌ 틀린 이유</div>
        <div class="mvw-wrong-detail-text">${w.whyWrong}</div>
      </div>` : ''}

      ${w.keyConceptName ? `<div class="mvw-wrong-detail-section">
        <div class="mvw-wrong-detail-section-title">💡 핵심 개념 — ${w.keyConceptName}</div>
        <div class="mvw-wrong-detail-text">${w.keyConceptExplain || ''}</div>
      </div>` : ''}

      ${conceptTags ? `<div class="mvw-wrong-detail-section">
        <div class="mvw-wrong-detail-section-title">🔗 연관 개념</div>
        <div class="mvw-wrong-concept-tags">${conceptTags}</div>
      </div>` : ''}

      ${w.solvingTip ? `<div class="mvw-wrong-detail-section">
        <div class="mvw-wrong-detail-section-title">📝 풀이 팁</div>
        <div class="mvw-wrong-detail-text">${w.solvingTip}</div>
      </div>` : ''}

      <div class="mvw-wrong-detail-section" id="wrongDetailLecture">
        <div class="mvw-wrong-detail-section-title">🎥 추천 강의</div>
        <div id="wrongLectureLinks"><div class="mob-loading"><span class="mob-spin"></span></div></div>
      </div>

      <div class="mvw-wrong-detail-section">
        <div class="mvw-wrong-detail-section-title">📓 나의 메모</div>
        <textarea class="mvw-wrong-memo-textarea" id="wrongMemoInput"
          placeholder="이 문제에 대한 메모를 남겨보세요…">${w.memo || ''}</textarea>
        <button onclick="ExamMob._saveMemo('${id}')"
          style="margin-top:8px;padding:8px 16px;border-radius:8px;border:none;background:#4f46e5;color:#fff;font-size:13px;font-weight:700;cursor:pointer">
          메모 저장
        </button>
      </div>

      <div class="mvw-wrong-detail-section">
        <div class="mvw-wrong-detail-section-title">오늘 이 개념, 어때요?</div>
        <div class="mvw-review-eval-row">
          <button class="mvw-review-eval-btn" onclick="ExamMob._reviewWrong('${id}',1)">
            <span style="font-size:22px">😰</span> 몰라요
          </button>
          <button class="mvw-review-eval-btn" onclick="ExamMob._reviewWrong('${id}',3)">
            <span style="font-size:22px">🙂</span> 헷갈려요
          </button>
          <button class="mvw-review-eval-btn" onclick="ExamMob._reviewWrong('${id}',5)">
            <span style="font-size:22px">😎</span> 알아요
          </button>
        </div>
      </div>
    `;

    /* 강의 추천 비동기 로드 */
    if (w.keyConceptName) this._loadLectureRecommend(w.keyConceptName, w.subject);

    const modal = el('examWrongModal');
    if (modal) modal.hidden = false;
  },

  /* 오답 상세 모달 닫기 */
  closeWrongDetail() {
    const modal = el('examWrongModal');
    if (modal) modal.hidden = true;
  },

  /* ── 강의 추천 로드 ── */
  async _loadLectureRecommend(concept, subject) {
    const container = el('wrongLectureLinks');
    if (!container) return;
    try {
      const data = await fetchJSON(`/api/lecture-recommend?concept=${encodeURIComponent(concept)}&subject=${subject}`);
      if (!data?.links?.length) { container.innerHTML = '<div style="font-size:13px;color:#9ca3af">추천 강의 없음</div>'; return; }
      container.innerHTML = data.links.map(link => `
        <a class="mvw-lecture-card" href="${link.url}" target="_blank" rel="noopener"
           onclick="ExamMob._logLectureClick('${concept}','${subject}','${link.platform}','${link.url}')">
          <span class="mvw-lecture-card-icon">${link.platform === 'YouTube' ? '📹' : '📚'}</span>
          <div class="mvw-lecture-card-body">
            <div class="mvw-lecture-card-title">${link.title}</div>
            <div class="mvw-lecture-card-platform">${link.platform}</div>
          </div>
          ${link.isFree ? '<span class="mvw-lecture-free">무료</span>' : ''}
        </a>
      `).join('');
    } catch { container.innerHTML = ''; }
  },

  /* ── 강의 클릭 로그 (Phase 2 CPA 준비) ── */
  _logLectureClick(concept, subject, platform, url) {
    fetchJSON('/api/log/lecture-click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ concept, subject, platform, url })
    }).catch(() => {});
  },

  /* ── 연관 개념 유튜브 검색 ── */
  _searchConcept(concept) {
    window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(concept + ' 개념 강의')}`, '_blank');
  },

  /* ── 메모 저장 ── */
  async _saveMemo(id) {
    const memo = el('wrongMemoInput')?.value || '';
    try {
      await fetchJSON(`/api/items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wrongAnswerMemo: memo })
      });
      toast('메모 저장됨', 'ok');
    } catch { toast('저장 실패', 'err'); }
  },

  /* ══════════════════════════════════════════
     복습 평가 제출 (SM-2)
  ══════════════════════════════════════════ */
  async _reviewWrong(id, quality) {
    try {
      const data = await fetchJSON(`/api/items/${id}/wrong-review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quality })
      });
      const label = quality >= 4 ? '😎 완벽해요!' : quality >= 3 ? '🙂 좋아요!' : '😰 다시 볼게요';
      toast(`${label} 다음 복습: ${fmt(data.nextReviewAt)}`, 'ok');
      this.closeWrongDetail();
      this._loadWrongAnswerLibrary();
      this._loadTodaySummary();
    } catch { toast('저장 실패', 'err'); }
  },

  /* ══════════════════════════════════════════
     약점 분석 대시보드 로드
  ══════════════════════════════════════════ */
  async _loadWeaknessAnalysis() {
    try {
      const data = await fetchJSON('/api/exam/weakness-analysis');
      this._renderWeaknessTop3(data);
      this._renderSubjectBars(data);
    } catch {}
  },

  _renderWeaknessTop3(data) {
    const container = el('examWeaknessTop3');
    if (!container) return;
    if (!data?.topWeakness?.length) {
      container.innerHTML = '<div class="mvw-empty">오답을 쌓으면 약점이 분석돼요!</div>';
      return;
    }
    container.innerHTML = data.topWeakness.map((w, i) => `
      <div class="mvw-weakness-item">
        <span class="mvw-weakness-rank">${['🥇','🥈','🥉'][i]}</span>
        <div class="mvw-weakness-body">
          <div class="mvw-weakness-name">${w.subjectName} · ${w.unit}</div>
          <div class="mvw-weakness-bar">
            <div class="mvw-weakness-fill" style="width:${Math.min(w.count * 12, 100)}%"></div>
          </div>
          <div class="mvw-weakness-count">오답 ${w.count}회</div>
        </div>
        ${w.concepts?.[0] ? `
        <button class="mvw-weakness-lecture-btn"
          onclick="ExamMob._searchConcept('${w.concepts[0]}')">
          <i class="ti ti-player-play"></i> 강의
        </button>` : ''}
      </div>
    `).join('');
  },

  _renderSubjectBars(data) {
    const container = el('examSubjectBars');
    if (!container) return;
    const counts = data?.subjectCounts || {};
    const total  = Object.values(counts).reduce((s, v) => s + v, 0) || 1;
    if (!Object.keys(counts).length) {
      container.innerHTML = '<div class="mvw-empty">과목별 오답 데이터가 없습니다</div>';
      return;
    }
    container.innerHTML = Object.entries(counts)
      .sort(([,a],[,b]) => b - a)
      .map(([subj, count]) => {
        const info = EXAM_SUBJECTS_CLIENT[subj] || { label: subj, icon: '📝' };
        const pct  = Math.round((count / total) * 100);
        return `<div class="mvw-exam-subject-bar-row">
          <span class="mvw-exam-subject-bar-label">${info.icon} ${info.label}</span>
          <div class="mvw-exam-subject-bar-track">
            <div class="mvw-exam-subject-bar-fill" style="width:${pct}%"></div>
          </div>
          <span class="mvw-exam-subject-bar-count">${count}</span>
        </div>`;
      }).join('');
  },

  /* ── 시험 설정 폼 복원 ── */
  async _restoreExamSettings() {
    try {
      const data = await fetchJSON('/api/exam/settings');
      const nameEl = el('examNameInput');
      const dateEl = el('examDateInput');
      if (nameEl && data.examName) nameEl.value = data.examName;
      if (dateEl && data.examDate) dateEl.value = data.examDate.slice(0, 10);
    } catch {}
  },

};
