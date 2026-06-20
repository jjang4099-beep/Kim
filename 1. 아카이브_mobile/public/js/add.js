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
      const isExam = localStorage.getItem('userMode') === 'exam';
      const formData = new FormData();
      formData.append('image', state.selectedImageFile);
      if (memo) formData.append('memo', memo);
      if (isExam) {
        formData.append('mode', 'exam');
        formData.append('subject', ExamMob.selectedSubject || 'math');
        status.textContent = '오답을 분석하고 있습니다…';
      } else {
        formData.append('mode', 'work');   // 직장인 모드 명시 적재
      }

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
