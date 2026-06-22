/**
 * add.js — 지식 추가 모달 (텍스트 입력 · 이미지 분석)
 * ────────────────────────────────────────────
 * 담당: 추가 모달 열기/닫기, 텍스트/이미지 탭 전환, AI 분석 저장(직장인/수험생 모드)
 * 의존: core.js(Mob·state·el·toast·fetchJSON), app_exam.js(ExamMob.selectedSubject)
 */

'use strict';

Object.assign(Mob, {

  openAdd() {
    const modal = el('mobAddModal');
    if (!modal) return;
    modal.hidden = false;
    el('mobAddInput')?.focus();
  },

  closeAdd() {
    el('mobAddModal').hidden    = true;
    el('mobAddInput').value     = '';
    el('mobAddStatus').hidden   = true;
    this.setAddType('knowledge', el('mobAddTabText'));
    this.resetImageInput();
    this._resetLifeForm();
  },

  /* 탭 전환 (지식 | 사진 분석 | 라이프) */
  setAddType(type, btn) {
    state.addType = type;
    document.querySelectorAll('.mob-add-mode-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    el('mobAddTextPane').hidden  = (type !== 'knowledge');
    el('mobAddImagePane').hidden = (type !== 'image');
    el('mobAddLifePane').hidden  = (type !== 'life');
  },

  /* 하위 호환: 기존 인라인 onclick="Mob.switchAddTab(...)" → setAddType 로 위임 */
  switchAddTab(tab, btn) {
    const typeMap = { text: 'knowledge', image: 'image' };
    this.setAddType(typeMap[tab] || tab, btn);
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
      this.closeAdd();
      this._loadHomeItems();
      if (data.item) this._showCategoryConfirm(data.item);
    } catch (e) {
      status.textContent = '실패: ' + (e.message || '다시 시도해주세요');
      toast('저장 실패', 'err');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<i class="ti ti-sparkles"></i> AI 분석하여 서재에 저장`;
    }
  },

  /* ── 이미지 분석 (다중 첨부) ── */
  handleImageSelect(input) {
    const files = Array.from(input.files || []);
    if (!files.length) return;
    state.selectedImageFiles = (state.selectedImageFiles || []).concat(files);
    input.value = '';   // 누적 선택 + 같은 파일 재선택 허용
    this._renderImageThumbs();
  },

  _renderImageThumbs() {
    const files  = state.selectedImageFiles || [];
    if (!files.length) { this.resetImageInput(); return; }
    const isExam = localStorage.getItem('userMode') === 'exam';
    const grid   = el('mobImgThumbGrid');
    el('mobImgPickArea').hidden   = true;
    el('mobImgPreviewRow').hidden = false;
    el('mobImgSubmitBtn').hidden  = isExam;     // 직장인 = 단일 버튼
    el('examImgBtnRow').hidden    = !isExam;    // 수험생 = 보관/분석
    if (grid) {
      grid.innerHTML = files.map((f, i) => `
        <div class="mob-img-thumb">
          <img src="${URL.createObjectURL(f)}" alt=""/>
          <button class="mob-img-thumb-x" onclick="Mob._removeImageAt(${i})" title="제거"><i class="ti ti-x"></i></button>
        </div>`).join('') +
        `<button class="mob-img-thumb-add" onclick="el('mobImageInput').click()" title="더 추가"><i class="ti ti-plus"></i></button>`;
    }
  },

  _removeImageAt(idx) {
    state.selectedImageFiles = (state.selectedImageFiles || []).filter((_, i) => i !== idx);
    this._renderImageThumbs();
  },

  resetImageInput() {
    state.selectedImageFiles = [];
    state.selectedImageFile  = null;
    const input = el('mobImageInput');
    if (input) input.value = '';
    const grid = el('mobImgThumbGrid');
    if (grid) grid.innerHTML = '';
    el('mobImgPickArea').hidden   = false;
    el('mobImgPreviewRow').hidden = true;
    el('mobImgSubmitBtn').hidden  = true;
    el('examImgBtnRow').hidden    = true;
    el('mobImgStatus').hidden     = true;
    el('mobImgMemo').value        = '';
  },

  /* 이미지 압축 헬퍼 — canvas 리사이즈 max 1200px, JPEG quality 0.82 */
  async _compressImage(file, maxPx = 1200, quality = 0.82) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const { naturalWidth: w, naturalHeight: h } = img;
        const scale = Math.min(1, maxPx / Math.max(w, h));
        const cw = Math.round(w * scale);
        const ch = Math.round(h * scale);
        const canvas = document.createElement('canvas');
        canvas.width  = cw;
        canvas.height = ch;
        canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
        canvas.toBlob(blob => {
          resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }));
        }, 'image/jpeg', quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  },

  /* action: 'analyze'(지금 분석) | 'store'(보관 후 백그라운드 분석) */
  async submitImageAnalysis(action = 'analyze') {
    const files = state.selectedImageFiles || [];
    if (!files.length) { toast('사진을 선택하세요'); return; }
    const isExam = localStorage.getItem('userMode') === 'exam';
    const store  = isExam && action === 'store';
    const status = el('mobImgStatus');
    const memo   = el('mobImgMemo')?.value.trim() || '';

    /* 눌린 버튼 스피너 + 전체 비활성화 */
    const allBtns = isExam
      ? [el('examImgBtnRow')?.querySelector('.mob-img-btn-store'),
         el('examImgBtnRow')?.querySelector('.mob-img-btn-analyze')]
      : [el('mobImgSubmitBtn')];
    const activeBtn = store ? allBtns[0] : allBtns[allBtns.length - 1];
    const activeOrig = activeBtn ? activeBtn.innerHTML : '';
    allBtns.forEach(b => { if (b) b.disabled = true; });
    if (activeBtn) activeBtn.innerHTML = `<span class="mob-spin"></span> ${store ? '보관 중…' : '분석 중…'}`;
    status.textContent = store ? '사진 압축 후 보관해요…' : '문제를 분석하고 있어요…';
    status.hidden = false;

    try {
      /* 업로드 전 사진 압축 (max 1200px, JPEG 0.82) — 전송량 대폭 감소 */
      const compressed = await Promise.all(files.map(f => this._compressImage(f)));
      const formData = new FormData();
      compressed.forEach(f => formData.append('image', f));   // 다중 첨부
      if (memo) formData.append('memo', memo);
      if (isExam) {
        formData.append('mode', 'exam');
        formData.append('subject', ExamMob.selectedSubject || 'math');
        formData.append('action', action);
      } else {
        formData.append('mode', 'work');
      }

      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), store ? 120000 : 90000);
      const res   = await fetch('/api/analyze-image', { method:'POST', body:formData, signal:ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '처리 실패');

      const n = data.count || 1;
      toast(store
        ? `${n}건 보관했어요 · 분석은 백그라운드에서 진행돼요`
        : `${n}건 분석 완료!`, 'ok');
      this.closeAdd();
      this._loadHomeItems();
    } catch (e) {
      status.textContent = '실패: ' + (e.message || '다시 시도해주세요');
      toast(store ? '보관 실패' : '분석 실패', 'err');
    } finally {
      allBtns.forEach(b => { if (b) b.disabled = false; });
      if (activeBtn) activeBtn.innerHTML = activeOrig;
    }
  },

  /* ── 라이프 폼 ── */
  async _submitLife() {
    const text     = el('lifeTextInput')?.value?.trim() || '';
    const location = el('lifeLocationInput')?.value?.trim() || '';
    const date     = el('lifeDateInput')?.value || '';
    const privacy  = el('lifePrivacySelect')?.value || 'private';
    const mood     = state.selectedMood || '';

    if (!text && (!state.lifePhotos || !state.lifePhotos.length)) {
      toast('사진이나 텍스트 중 하나는 입력해주세요', 'err'); return;
    }

    const btn = el('mobAddLifePane')?.querySelector('.mob-add-submit');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="mob-spin"></span> 저장 중…'; }

    try {
      const formData = new FormData();
      formData.append('text', text);
      formData.append('mood', mood);
      formData.append('location', location);
      formData.append('privacy', privacy);
      if (date) formData.append('date', date);
      (state.lifePhotos || []).forEach(f => formData.append('photos', f));

      const res = await fetch('/api/items/life', { method: 'POST', body: formData });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '저장 실패');
      toast('❤️ 라이프 기록 저장됐어요', 'ok');
      this.closeAdd();
      if (!el('lifeLibrary')?.hidden) this._loadLifeLibrary();
    } catch (e) {
      toast('저장 실패: ' + (e.message || '다시 시도해주세요'), 'err');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-heart"></i> 기록 저장'; }
    }
  },

  _resetLifeForm() {
    if (el('lifeTextInput'))     el('lifeTextInput').value     = '';
    if (el('lifeLocationInput')) el('lifeLocationInput').value = '';
    if (el('lifeDateInput'))     el('lifeDateInput').value     = '';
    if (el('lifePhotoPreview'))  el('lifePhotoPreview').innerHTML = '';
    state.lifePhotos   = [];
    state.selectedMood = '';
    document.querySelectorAll('.mob-mood-opt').forEach(b => b.classList.remove('active'));
  },

  _selectMood(mood, btn) {
    state.selectedMood = (state.selectedMood === mood) ? '' : mood;
    document.querySelectorAll('.mob-mood-opt').forEach(b => b.classList.remove('active'));
    if (state.selectedMood && btn) btn.classList.add('active');
  },

  _previewLifePhotos(input) {
    const files = Array.from(input.files || []).slice(0, 10);
    state.lifePhotos = files;
    const preview = el('lifePhotoPreview');
    if (!preview) return;
    preview.innerHTML = files.map((f, i) => `
      <div class="mob-life-preview-thumb">
        <img src="${URL.createObjectURL(f)}" alt=""/>
        <button onclick="Mob._removeLifePhoto(${i})" class="mob-life-thumb-remove">✕</button>
      </div>`).join('');
  },

  _removeLifePhoto(idx) {
    state.lifePhotos = state.lifePhotos.filter((_, i) => i !== idx);
    const input = el('lifePhotoInput');
    if (input) input.value = '';
    const preview = el('lifePhotoPreview');
    if (!preview) return;
    preview.innerHTML = state.lifePhotos.map((f, i) => `
      <div class="mob-life-preview-thumb">
        <img src="${URL.createObjectURL(f)}" alt=""/>
        <button onclick="Mob._removeLifePhoto(${i})" class="mob-life-thumb-remove">✕</button>
      </div>`).join('');
  },

});
