/**
 * app_exam.js — 수험생 모드 (ExamMob namespace)
 * Depends on: app_mobile.js (Mob, el, toast, fmt, fetchJSON)
 */
'use strict';

/* ── 과목 레이블 맵 (이모지 없음 · 학구적 톤) ── */
const EXAM_SUBJECTS_CLIENT = {
  math:    { label: '수학',   code: 'MATH' },
  korean:  { label: '국어',   code: 'KOR'  },
  english: { label: '영어',   code: 'ENG'  },
  history: { label: '한국사', code: 'HIST' },
  science: { label: '탐구',   code: 'SCI'  },
  cert:    { label: '자격증', code: 'CERT' },
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

  /* ── 오답 카드 HTML (Archive Row · 학구적) ── */
  _renderWrongCard(item) {
    const w = item.wrongAnswer || {};
    const statusMap = {
      pending:   { label: '미복습', cls: 'pending'   },
      reviewing: { label: '복습중', cls: 'reviewing' },
      done:      { label: '완료',   cls: 'done'      },
    };
    const s       = statusMap[w.reviewStatus || 'pending'];
    const subj    = EXAM_SUBJECTS_CLIENT[w.subject] || { label: w.subject || '기타', code: 'ETC' };
    const concept = (w.requiredConcepts?.[0]?.term) || w.keyConceptName || '';
    const nextReview = w.reviewAt
      ? `<div class="mvw-wrong-next-review">다음 복습 · ${fmt(w.reviewAt)}</div>`
      : '';
    return `
    <button class="mvw-wrong-card" onclick="ExamMob.openWrongDetail('${item.id}')">
      <div class="mvw-wrong-pillar">
        <span class="mvw-wrong-code">${subj.code}</span>
        <span class="mvw-wrong-rule"></span>
      </div>
      <div class="mvw-wrong-content">
        <div class="mvw-wrong-card-top">
          <span class="mvw-wrong-subj">${subj.label}</span>
          <span class="mvw-wrong-status ${s.cls}">${s.label}</span>
        </div>
        <div class="mvw-wrong-unit">${w.unit || '단원 미분류'}</div>
        ${concept ? `<div class="mvw-wrong-concept">${concept}</div>` : ''}
        ${nextReview}
      </div>
    </button>`;
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
    const subj = EXAM_SUBJECTS_CLIENT[w.subject] || { label: w.subject || '기타', code: 'ETC' };

    const body  = el('examWrongBody');
    const badge = el('examWrongBadge');
    if (badge) badge.textContent = subj.label;

    if (body) body.innerHTML = this._renderTutorReport(item, w, id);

    /* 강의 추천 비동기 로드 — 핵심 개념 기준 */
    const lectureKey = (w.requiredConcepts?.[0]?.term) || w.keyConceptName;
    if (lectureKey) this._loadLectureRecommend(lectureKey, w.subject);

    const modal = el('examWrongModal');
    if (modal) modal.hidden = false;
  },

  /* ── 과외 선생님 분석 리포트 렌더 (신규 구조 + 레거시 폴백) ── */
  _renderTutorReport(item, w, id) {
    const esc = (t) => String(t ?? '');

    /* 1) 문제 사진 */
    const imgHtml = item.imageUrl
      ? `<img class="mvw-tutor-photo" src="${item.imageUrl}" alt="문제 사진"/>`
      : '';

    /* 2) 단원 + 문제 요약 */
    const headerHtml = `
      <div class="mvw-tutor-head">
        <div class="mvw-tutor-unit">${esc(w.unit) || '단원 미분류'}</div>
        ${w.problemSummary ? `<div class="mvw-tutor-problem">${esc(w.problemSummary)}</div>` : ''}
      </div>`;

    /* 3) 필수 개념 — 자세한 설명 (신규: requiredConcepts / 레거시: keyConcept) */
    const reqConcepts = Array.isArray(w.requiredConcepts) ? w.requiredConcepts : [];
    let conceptsHtml = '';
    if (reqConcepts.length) {
      conceptsHtml = `
      <section class="mvw-tutor-sec">
        <div class="mvw-tutor-sec-hd">이 문제를 풀려면</div>
        ${reqConcepts.map(c => `
          <div class="mvw-tutor-concept">
            <div class="mvw-tutor-concept-term">${esc(c.term)}</div>
            <div class="mvw-tutor-concept-desc">${esc(c.desc)}</div>
          </div>`).join('')}
      </section>`;
    } else if (w.keyConceptName) {
      conceptsHtml = `
      <section class="mvw-tutor-sec">
        <div class="mvw-tutor-sec-hd">핵심 개념</div>
        <div class="mvw-tutor-concept">
          <div class="mvw-tutor-concept-term">${esc(w.keyConceptName)}</div>
          <div class="mvw-tutor-concept-desc">${esc(w.keyConceptExplain)}</div>
        </div>
      </section>`;
    }

    /* 4) 내 풀이 첨삭 — 풀이가 사진에 있을 때만 */
    const rv = w.solutionReview || {};
    const hasReview = w.hasSolution && (rv.errorStep || rv.diagnosis || rv.fix);
    const reviewHtml = hasReview ? `
      <section class="mvw-tutor-sec mvw-tutor-review">
        <div class="mvw-tutor-sec-hd accent">내 풀이 첨삭</div>
        ${rv.errorStep ? `<div class="mvw-tutor-review-row"><span class="mvw-tutor-review-k">어긋난 지점</span><div class="mvw-tutor-review-v">${esc(rv.errorStep)}</div></div>` : ''}
        ${rv.diagnosis ? `<div class="mvw-tutor-review-row"><span class="mvw-tutor-review-k">원인</span><div class="mvw-tutor-review-v">${esc(rv.diagnosis)}</div></div>` : ''}
        ${rv.fix ? `<div class="mvw-tutor-review-row"><span class="mvw-tutor-review-k">고치는 법</span><div class="mvw-tutor-review-v">${esc(rv.fix)}</div></div>` : ''}
      </section>` : '';

    /* 5) 모범 풀이 단계 */
    const steps = Array.isArray(w.modelSteps) ? w.modelSteps : [];
    const stepsHtml = steps.length ? `
      <section class="mvw-tutor-sec">
        <div class="mvw-tutor-sec-hd">모범 풀이</div>
        <ol class="mvw-tutor-steps">
          ${steps.map(s => `<li>${esc(String(s).replace(/^\s*\d+[.)]\s*/, ''))}</li>`).join('')}
        </ol>
      </section>` : '';

    /* 6) 과외쌤 첨언 — 보완점 */
    const reinforce = w.whatToReinforce || (reqConcepts.length ? '' : w.solvingTip);
    const reinforceHtml = reinforce ? `
      <section class="mvw-tutor-coach">
        <div class="mvw-tutor-coach-label">선생님 한마디</div>
        <div class="mvw-tutor-coach-text">${esc(reinforce)}</div>
      </section>` : '';

    /* 7) 연관 개념 태그 */
    const related = (Array.isArray(w.relatedConcepts) && w.relatedConcepts.length)
      ? w.relatedConcepts : (w.concepts || []);
    const tagsHtml = related.length ? `
      <section class="mvw-tutor-sec">
        <div class="mvw-tutor-sec-hd">연관 개념</div>
        <div class="mvw-wrong-concept-tags">
          ${related.map(c => `<button class="mvw-wrong-concept-tag" onclick="ExamMob._searchConcept('${esc(c)}')">${esc(c)}</button>`).join('')}
        </div>
      </section>` : '';

    /* 8) 추천 강의 (비동기) */
    const lectureHtml = `
      <section class="mvw-tutor-sec" id="wrongDetailLecture">
        <div class="mvw-tutor-sec-hd">추천 강의</div>
        <div id="wrongLectureLinks"><div class="mob-loading"><span class="mob-spin"></span></div></div>
      </section>`;

    /* 9) 메모 */
    const memoHtml = `
      <section class="mvw-tutor-sec">
        <div class="mvw-tutor-sec-hd">나의 메모</div>
        <textarea class="mvw-wrong-memo-textarea" id="wrongMemoInput"
          placeholder="이 문제에 대한 메모를 남겨보세요…">${esc(w.memo)}</textarea>
        <button class="mvw-tutor-memo-save" onclick="ExamMob._saveMemo('${id}')">메모 저장</button>
      </section>`;

    /* 10) 복습 평가 */
    const evalHtml = `
      <section class="mvw-tutor-sec mvw-tutor-eval">
        <div class="mvw-tutor-sec-hd">오늘 이 개념, 어때요?</div>
        <div class="mvw-review-eval-row">
          <button class="mvw-review-eval-btn" onclick="ExamMob._reviewWrong('${id}',1)">몰라요</button>
          <button class="mvw-review-eval-btn" onclick="ExamMob._reviewWrong('${id}',3)">헷갈려요</button>
          <button class="mvw-review-eval-btn" onclick="ExamMob._reviewWrong('${id}',5)">알아요</button>
        </div>
      </section>`;

    return imgHtml + headerHtml + conceptsHtml + reviewHtml + stepsHtml
         + reinforceHtml + tagsHtml + lectureHtml + memoHtml + evalHtml;
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
          <span class="mvw-lecture-card-icon"><i class="ti ti-player-play"></i></span>
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
        <span class="mvw-weakness-rank">${i + 1}</span>
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
        const info = EXAM_SUBJECTS_CLIENT[subj] || { label: subj };
        const pct  = Math.round((count / total) * 100);
        return `<div class="mvw-exam-subject-bar-row">
          <span class="mvw-exam-subject-bar-label">${info.label}</span>
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
