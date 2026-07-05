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
      const data  = await fetchJSON('/api/exam/settings');
      const label = el('examDdayLabel');
      const num   = el('examDdayNum');
      const block = el('examDdayBlock') || document.querySelector('.exam-dday-block');
      if (!data?.examDate) {
        if (label) label.textContent = '시험까지';
        if (num)   num.textContent   = 'D-?';
        if (block) block.dataset.ddayTier = 'far';
        return;
      }
      const diff = Math.ceil((new Date(data.examDate) - new Date()) / 86400000);
      if (label) label.textContent = data.examName || '시험까지';
      if (num)   num.textContent   = diff > 0 ? `D-${diff}` : (diff === 0 ? 'D-DAY' : `D+${Math.abs(diff)}`);
      /* 점증형 D-day — 멀면 잔잔, 임박할수록 또렷 */
      if (block) block.dataset.ddayTier = this._ddayTier(diff);
    } catch {}
  },

  /* ── D-day 임박도 단계 (CSS에서 강조 강도 결정) ── */
  _ddayTier(diff) {
    if (diff < 0)   return 'past';   // 시험 지남
    if (diff === 0) return 'dday';   // 당일
    if (diff <= 7)  return 'close';  // 1주 이내 — 가장 또렷
    if (diff <= 30) return 'near';   // 한 달 이내 — 살짝 긴장
    return 'far';                    // 그 이상 — 차분
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
      el('libFilterBar')?.setAttribute('hidden', '');   /* 매거진 카테고리 필터는 오답뷰에서 숨김 */
      el('libAiToggle')?.setAttribute('hidden', '');
      el('libSearchWrap')?.setAttribute('hidden', '');
      el('libReviewSection')?.setAttribute('hidden', '');   /* 지식 순환 UI도 오답뷰에선 숨김 */
      el('libViewToolbar')?.setAttribute('hidden', '');
      this._loadWrongAnswerLibrary();
    } else {
      el('wrongAnswerTimeline')?.setAttribute('hidden', '');
      el('libTimeline')?.removeAttribute('hidden');
      el('libFilterBar')?.removeAttribute('hidden');
      el('libAiToggle')?.removeAttribute('hidden');
      el('libSearchWrap')?.removeAttribute('hidden');
      el('libViewToolbar')?.removeAttribute('hidden');
      Mob._renderReviewCarousel?.();   /* 복습 섹션은 데이터 있으면 스스로 재노출 */
    }
  },

  /* ══════════════════════════════════════════
     오답 서재 로드
  ══════════════════════════════════════════ */
  async _loadWrongAnswerLibrary(subject) {
    const container = el('wrongAnswerTimeline');
    if (!container) return;
    if (subject) state.wrongFilter = subject;   /* 하위호환: 인자로 과목 지정 시 필터 세팅 */
    container.innerHTML = '<div class="mob-loading"><span class="mob-spin"></span> 오답 불러오는 중…</div>';
    try {
      const data = await fetchJSON('/api/items?limit=500');
      state.wrongItems = (data?.items ?? data ?? []).filter(i => i.type === 'wrong_answer');
      this._renderWrongLibrary();
    } catch { container.innerHTML = '<div class="mvw-empty">불러오기 실패</div>'; }
  },

  /* ── 오답 서재 렌더 — 과목 칩(상단) + 기간(월) 그룹 ── */
  _renderWrongLibrary() {
    const container = el('wrongAnswerTimeline');
    if (!container) return;
    const all = state.wrongItems || [];

    if (!all.length) {
      container.innerHTML = '<div class="mvw-empty"><i class="ti ti-clipboard-x" style="font-size:36px;display:block;margin-bottom:8px;opacity:.35"></i>아직 오답이 없어요!<br>추가 탭에서 사진을 찍어 분석해 보세요.</div>';
      return;
    }

    /* 과목별 카운트 (미정의 과목은 etc로) */
    const counts = {};
    all.forEach(i => {
      const s = i.wrongAnswer?.subject;
      const key = EXAM_SUBJECTS_CLIENT[s] ? s : 'etc';
      counts[key] = (counts[key] || 0) + 1;
    });

    const filter = state.wrongFilter || 'all';

    /* 과목 칩 바 — 전체 + 보유한 과목만 (정의 순서) + 기타 */
    let chips = `<button class="mvw-wrong-subjchip${filter === 'all' ? ' active' : ''}"
      onclick="ExamMob._filterWrong('all')">전체 <span class="mvw-wrong-subjchip-n">${all.length}</span></button>`;
    Object.keys(EXAM_SUBJECTS_CLIENT).filter(s => counts[s]).forEach(s => {
      chips += `<button class="mvw-wrong-subjchip${filter === s ? ' active' : ''}"
        onclick="ExamMob._filterWrong('${s}')">${EXAM_SUBJECTS_CLIENT[s].label} <span class="mvw-wrong-subjchip-n">${counts[s]}</span></button>`;
    });
    if (counts.etc) {
      chips += `<button class="mvw-wrong-subjchip${filter === 'etc' ? ' active' : ''}"
        onclick="ExamMob._filterWrong('etc')">기타 <span class="mvw-wrong-subjchip-n">${counts.etc}</span></button>`;
    }
    const chipBar = `<div class="mvw-wrong-subjbar">${chips}</div>`;

    /* 문제집 PDF 내보내기 툴바 */
    const toolbar = `
      <div class="mvw-wrong-toolbar">
        <span class="mvw-wrong-toolbar-title">오답 문제집</span>
        <button class="mvw-wrong-export" onclick="ExamMob.exportWrongPdf()">
          <i class="ti ti-file-export"></i> PDF 내보내기
        </button>
      </div>`;

    /* 필터 적용 */
    const filtered = filter === 'all' ? all
      : filter === 'etc' ? all.filter(i => !EXAM_SUBJECTS_CLIENT[i.wrongAnswer?.subject])
      : all.filter(i => i.wrongAnswer?.subject === filter);

    if (!filtered.length) {
      container.innerHTML = toolbar + chipBar + '<div class="mvw-empty">이 과목에는 아직 오답이 없어요.</div>';
      return;
    }

    /* 기간(월) 그룹핑 */
    const groups = {};
    filtered.forEach(i => {
      const key = (i.date || i.createdAt || '').slice(0, 7) || '날짜 없음';   /* YYYY-MM */
      (groups[key] = groups[key] || []).push(i);
    });
    const keys = Object.keys(groups).sort((a, b) =>
      a === '날짜 없음' ? 1 : b === '날짜 없음' ? -1 : b.localeCompare(a));

    let html = toolbar + chipBar;
    keys.forEach(key => {
      html += `<div class="mob-section-hd" style="margin-top:14px">
        <span>${this._periodLabel(key)}</span>
        <span class="mob-section-badge">${groups[key].length}개</span>
      </div>`;
      groups[key]
        .sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date))
        .forEach(i => { html += this._renderWrongCard(i); });
    });
    container.innerHTML = html;
  },

  /* YYYY-MM → "2026년 6월" */
  _periodLabel(key) {
    if (key === '날짜 없음') return '날짜 없음';
    const [y, m] = key.split('-');
    return `${y}년 ${parseInt(m, 10)}월`;
  },

  /* 과목 칩 클릭 → 필터 변경 후 재렌더 (재요청 없음) */
  _filterWrong(subject) {
    state.wrongFilter = subject;
    this._renderWrongLibrary();
  },

  /* 현재 필터의 오답 문제들을 깨끗한 문제집 PDF로 내보내기 (4문제/페이지) */
  async exportWrongPdf() {
    const subject = state.wrongFilter || 'all';
    const all     = state.wrongItems || [];
    const KNOWN   = Object.keys(EXAM_SUBJECTS_CLIENT);
    const filtered = subject === 'all' ? all
      : subject === 'etc' ? all.filter(i => !KNOWN.includes(i.wrongAnswer?.subject))
      : all.filter(i => i.wrongAnswer?.subject === subject);
    if (!filtered.length) { toast('내보낼 오답이 없어요', 'err'); return; }

    toast('문제집 PDF 만드는 중…');
    try {
      /* 바이너리 응답이라 fetchJSON 대신 raw fetch (다운로드 전용) */
      const res = await fetch(`/api/exam/wrong/export-pdf?subject=${encodeURIComponent(subject)}`);
      if (!res.ok) {
        let msg = 'PDF 생성 실패';
        try { msg = (await res.json()).error || msg; } catch {}
        throw new Error(msg);
      }
      const blob  = await res.blob();
      const url   = URL.createObjectURL(blob);
      const label = subject === 'all' ? '전체' : (EXAM_SUBJECTS_CLIENT[subject]?.label || subject);
      const a = document.createElement('a');
      a.href = url;
      a.download = `오답문제집_${label}_${toLocalDateStr()}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast('PDF 저장 완료!', 'ok');
    } catch (e) {
      toast(e.message || 'PDF 생성 실패', 'err');
    }
  },

  /* ── 오답 카드 HTML (Archive Row · 학구적) ── */
  _renderWrongCard(item) {
    const w        = item.wrongAnswer || {};
    const subj     = EXAM_SUBJECTS_CLIENT[w.subject] || { label: w.subject || '기타', code: 'ETC' };
    const aStatus  = item.analysisStatus;
    const analyzed = !aStatus || aStatus === 'done';   // 필드 없는 레거시 = 완료로 간주
    const photoCnt = item.imageUrls?.length || (item.imageUrl ? 1 : 0);

    /* 상태 배지: 분석 전이면 분석 상태, 완료면 복습 상태 */
    let statusHtml;
    if (aStatus === 'analyzing')      statusHtml = '<span class="mvw-wrong-status analyzing"><span class="mob-spin"></span> 분석 중</span>';
    else if (aStatus === 'pending')   statusHtml = '<span class="mvw-wrong-status waiting">분석 대기</span>';
    else if (aStatus === 'failed')    statusHtml = '<span class="mvw-wrong-status failed">분석 실패</span>';
    else {
      const sm = { pending:{label:'미복습',cls:'pending'}, reviewing:{label:'복습중',cls:'reviewing'}, done:{label:'완료',cls:'done'} };
      const s  = sm[w.reviewStatus || 'pending'];
      statusHtml = `<span class="mvw-wrong-status ${s.cls}">${s.label}</span>`;
    }

    const concept = (w.requiredConcepts?.[0]?.term) || w.keyConceptName || '';
    const unitTxt = analyzed
      ? (w.unit || '단원 미분류')
      : (aStatus === 'failed' ? '분석하지 못했어요' : '분석 대기 중');
    const subTxt  = analyzed
      ? (concept ? `<div class="mvw-wrong-concept">${this._esc(concept)}</div>` : '')
      : `<div class="mvw-wrong-concept">사진 ${photoCnt}장 · ${aStatus === 'analyzing' ? '분석 중…' : '탭하면 지금 분석'}</div>`;
    const nextReview = (analyzed && w.reviewAt)
      ? `<div class="mvw-wrong-next-review">다음 복습 · ${fmt(w.reviewAt)}</div>` : '';

    return `
    <button class="mvw-wrong-card" onclick="ExamMob.openWrongDetail('${item.id}')">
      <div class="mvw-wrong-pillar">
        <span class="mvw-wrong-code">${subj.code}</span>
        <span class="mvw-wrong-rule"></span>
      </div>
      <div class="mvw-wrong-content">
        <div class="mvw-wrong-card-top">
          <span class="mvw-wrong-subj">${subj.label}</span>
          ${statusHtml}
        </div>
        <div class="mvw-wrong-unit">${this._esc(unitTxt)}</div>
        ${subTxt}
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

    const modal = el('examWrongModal');
    if (modal) modal.hidden = false;
  },

  /* ── HTML 이스케이프 (수식의 <, >, & 가 태그로 먹혀 깨지는 것 방지) ── */
  _esc(t) {
    return String(t ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },
  /* 작은따옴표 onclick 인자용 — JS 문자열 안전 + HTML 안전 */
  _jsArg(t) {
    return String(t ?? '')
      .replace(/\\/g, '\\\\').replace(/'/g, "\\'")
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  /* ── 보관된 오답 지금 분석 ── */
  async analyzeNow(id, btn) {
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="mob-spin"></span> 분석 중…'; }
    try {
      const data = await fetchJSON(`/api/exam/wrong/${id}/analyze`, { method: 'POST' }, 90000);
      if (!data.success) throw new Error(data.error || '');
      toast('분석 완료!', 'ok');
      this.openWrongDetail(id);          // 상세 새로 그림
      this._loadWrongAnswerLibrary();    // 목록 상태 갱신
    } catch (e) {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-sparkles"></i> 지금 분석하기'; }
      toast('분석 실패 — 다시 시도해 주세요', 'err');
    }
  },

  /* ── 과외 선생님 분석 리포트 렌더 (정답→풀이→개념 / 신규+레거시 폴백) ── */
  _renderTutorReport(item, w, id) {
    const esc = (t) => this._esc(t);

    /* 1) 문제 사진 (다중) */
    const urls = item.imageUrls?.length ? item.imageUrls : (item.imageUrl ? [item.imageUrl] : []);
    const imgHtml = urls.map(u => `<img class="mvw-tutor-photo" src="${this._esc(u)}" alt="문제 사진"/>`).join('');

    /* 분석 전(보관·분석중·실패) → 사진 + 안내 + 지금 분석 버튼 */
    const aStatus  = item.analysisStatus;
    const analyzed = !aStatus || aStatus === 'done';
    if (!analyzed) {
      const analyzing = aStatus === 'analyzing';
      const failed    = aStatus === 'failed';
      const memoHtml = `
        <section class="mvw-tutor-sec">
          <div class="mvw-tutor-sec-hd">나의 메모</div>
          <textarea class="mvw-wrong-memo-textarea" id="wrongMemoInput"
            placeholder="이 문제에 대한 메모를 남겨보세요…">${esc(w.memo)}</textarea>
          <button class="mvw-tutor-memo-save" onclick="ExamMob._saveMemo('${id}')">메모 저장</button>
        </section>`;
      return imgHtml + `
        <section class="mvw-tutor-pending">
          <div class="mvw-tutor-pending-title">${analyzing ? '분석 중이에요…' : (failed ? '분석하지 못했어요' : '아직 분석 전이에요')}</div>
          <div class="mvw-tutor-pending-sub">${analyzing
            ? '잠시 후 다시 열어보면 정답·풀이가 준비돼 있어요.'
            : (failed ? '사진이 흐리거나 형식을 못 읽었을 수 있어요. 다시 분석해 볼까요?' : '지금 분석하거나, 백그라운드 분석을 기다려도 돼요.')}</div>
          ${analyzing ? '<div class="mob-loading"><span class="mob-spin"></span> 분석 중</div>'
            : `<button class="mvw-tutor-analyze-now" onclick="ExamMob.analyzeNow('${id}', this)"><i class="ti ti-sparkles"></i> 지금 분석하기</button>`}
        </section>` + memoHtml;
    }

    /* 2) 단원 + 문제 요약 */
    const headerHtml = `
      <div class="mvw-tutor-head">
        <div class="mvw-tutor-unit">${esc(w.unit) || '단원 미분류'}</div>
        ${w.problemSummary ? `<div class="mvw-tutor-problem">${esc(w.problemSummary)}</div>` : ''}
      </div>`;

    /* 3) 정답 — 가장 먼저, 또렷하게 */
    const answerHtml = w.answer ? `
      <section class="mvw-tutor-answer">
        <span class="mvw-tutor-answer-label">정답</span>
        <span class="mvw-tutor-answer-val">${esc(w.answer)}</span>
      </section>` : '';

    /* 4) 풀이 과정 — 단계별 */
    const steps = Array.isArray(w.modelSteps) ? w.modelSteps : [];
    const stepsHtml = steps.length ? `
      <section class="mvw-tutor-sec">
        <div class="mvw-tutor-sec-hd">풀이 과정</div>
        <ol class="mvw-tutor-steps">
          ${steps.map(s => `<li>${esc(String(s).replace(/^\s*\d+[.)]\s*/, ''))}</li>`).join('')}
        </ol>
      </section>` : '';

    /* 5) 개념 설명 — 자세히 (신규: requiredConcepts / 레거시: keyConcept) */
    const reqConcepts = Array.isArray(w.requiredConcepts) ? w.requiredConcepts : [];
    let conceptsHtml = '';
    if (reqConcepts.length) {
      conceptsHtml = `
      <section class="mvw-tutor-sec">
        <div class="mvw-tutor-sec-hd">개념 설명</div>
        ${reqConcepts.map(c => `
          <div class="mvw-tutor-concept">
            <div class="mvw-tutor-concept-term">${esc(c.term)}</div>
            <div class="mvw-tutor-concept-desc">${esc(c.desc)}</div>
          </div>`).join('')}
      </section>`;
    } else if (w.keyConceptName) {
      conceptsHtml = `
      <section class="mvw-tutor-sec">
        <div class="mvw-tutor-sec-hd">개념 설명</div>
        <div class="mvw-tutor-concept">
          <div class="mvw-tutor-concept-term">${esc(w.keyConceptName)}</div>
          <div class="mvw-tutor-concept-desc">${esc(w.keyConceptExplain)}</div>
        </div>
      </section>`;
    }

    /* 6) 내 풀이 첨삭 — 풀이가 사진에 있을 때만 */
    const rv = w.solutionReview || {};
    const hasReview = w.hasSolution && (rv.errorStep || rv.diagnosis || rv.fix);
    const reviewHtml = hasReview ? `
      <section class="mvw-tutor-sec mvw-tutor-review">
        <div class="mvw-tutor-sec-hd accent">내 풀이 첨삭</div>
        ${rv.errorStep ? `<div class="mvw-tutor-review-row"><span class="mvw-tutor-review-k">어긋난 지점</span><div class="mvw-tutor-review-v">${esc(rv.errorStep)}</div></div>` : ''}
        ${rv.diagnosis ? `<div class="mvw-tutor-review-row"><span class="mvw-tutor-review-k">원인</span><div class="mvw-tutor-review-v">${esc(rv.diagnosis)}</div></div>` : ''}
        ${rv.fix ? `<div class="mvw-tutor-review-row"><span class="mvw-tutor-review-k">고치는 법</span><div class="mvw-tutor-review-v">${esc(rv.fix)}</div></div>` : ''}
      </section>` : '';

    /* 7) 과외쌤 첨언 — 보완점 */
    const reinforce = w.whatToReinforce || (reqConcepts.length ? '' : w.solvingTip);
    const reinforceHtml = reinforce ? `
      <section class="mvw-tutor-coach">
        <div class="mvw-tutor-coach-label">선생님 한마디</div>
        <div class="mvw-tutor-coach-text">${esc(reinforce)}</div>
      </section>` : '';

    /* 8) 연관 개념 태그 */
    const related = (Array.isArray(w.relatedConcepts) && w.relatedConcepts.length)
      ? w.relatedConcepts : (w.concepts || []);
    const tagsHtml = related.length ? `
      <section class="mvw-tutor-sec">
        <div class="mvw-tutor-sec-hd">연관 개념</div>
        <div class="mvw-wrong-concept-tags">
          ${related.map(c => `<button class="mvw-wrong-concept-tag" onclick="ExamMob._searchConcept('${this._jsArg(c)}')">${esc(c)}</button>`).join('')}
        </div>
      </section>` : '';

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

    /* 순서: 사진 → 단원/문제 → 정답 → 풀이 과정 → 개념 설명 → 첨삭 → 보완점 → 연관개념 → 메모 → 평가 */
    return imgHtml + headerHtml + answerHtml + stepsHtml + conceptsHtml
         + reviewHtml + reinforceHtml + tagsHtml + memoHtml + evalHtml;
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
