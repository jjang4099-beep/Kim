/**
 * auth.js — 이메일 로그인/회원가입 + 세션 상태 관리
 * ────────────────────────────────────────────
 * 담당: 인증 확인(checkAuth)·로그인/회원가입 폼 제출·로그아웃 (Mob 확장)
 * 의존: core.js(전역·유틸·state·Mob). 구글/카카오 소셜 로그인은 앱스토어 출시 시점에 별도 구현.
 * 로드 순서: core.js → auth.js → home.js → …
 */

'use strict';

Object.assign(Mob, {

  /** 서버 세션 확인 — 성공 시 state.currentUser 세팅 + 유저의 currentMode를 로컬 캐시에 동기화 */
  async checkAuth() {
    try {
      const data = await fetchJSON('/api/auth/me', {}, 8000);
      if (data?.success) {
        state.currentUser = data.user;
        if (data.user.currentMode) {
          localStorage.setItem('userMode', data.user.currentMode === 'EXAM_PREP' ? 'exam' : 'work');
        }
        return true;
      }
    } catch {}
    return false;
  },

  async _loginWithEmail(email, password) {
    const data = await fetchJSON('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }, 10000);
    state.currentUser = data.user;
    return data.user;
  },

  async _registerWithEmail(email, password, name) {
    const data = await fetchJSON('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    }, 10000);
    state.currentUser = data.user;
    return data.user;
  },

  async logout() {
    try { await fetchJSON('/api/auth/logout', { method: 'POST' }, 5000); } catch {}
    state.currentUser = null;
    location.reload();
  },

  _showLoginForm() {
    document.querySelectorAll('.mob-login-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'login'));
    el('authName').hidden = true;
    el('authPassword').setAttribute('autocomplete', 'current-password');
    el('authSubmitBtn').textContent = '로그인';
    el('authError').hidden = true;
  },

  _showRegisterForm() {
    document.querySelectorAll('.mob-login-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'register'));
    el('authName').hidden = false;
    el('authPassword').setAttribute('autocomplete', 'new-password');
    el('authSubmitBtn').textContent = '회원가입';
    el('authError').hidden = true;
  },

  async _handleAuthSubmit(evt) {
    evt.preventDefault();
    const email    = el('authEmail').value.trim();
    const password = el('authPassword').value;
    const isRegister = document.querySelector('.mob-login-tab.active')?.dataset.tab === 'register';
    const errEl = el('authError');
    errEl.hidden = true;

    try {
      if (isRegister) {
        await this._registerWithEmail(email, password, el('authName').value.trim());
      } else {
        await this._loginWithEmail(email, password);
      }
      el('loginScreen').hidden = true;
      location.reload(); // 부트 스크립트가 처음부터 다시 checkAuth()→앱 진입 흐름을 타도록
    } catch (e) {
      errEl.textContent = e.message || '요청에 실패했어요';
      errEl.hidden = false;
    }
    return false;
  },

});
