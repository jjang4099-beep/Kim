'use strict';
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getSQLiteDB, _persistDB, _sqlGet, _sqlQuery } = require('./connection');

/* ══════════════════════════════════════════════════
   인증용 users 테이블 CRUD.
   ⚠️ readUsers()/writeUsers()/getDefaultUser()(server.js)와는 이름·개념이 다르다 —
   그것들은 배달 설정 프로필(data/users.json)이고, 이 파일은 이메일 로그인 계정이다.
══════════════════════════════════════════════════ */

function createUser({ email, password, name }) {
  const id            = 'usr_' + uuidv4();
  const password_hash = bcrypt.hashSync(password, 10);
  const createdAt     = new Date().toISOString();
  const stmt = getSQLiteDB().prepare(
    'INSERT INTO users (id, email, password_hash, name, created_at, current_mode) VALUES (?,?,?,?,?,?)'
  );
  stmt.run([id, email.toLowerCase().trim(), password_hash, name || '', createdAt, 'PROFESSIONAL']);
  stmt.free();
  _persistDB();
  return findUserById(id);
}

function findUserByEmail(email) {
  if (!email) return null;
  return _sqlGet('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
}

function findUserById(id) {
  if (!id) return null;
  return _sqlGet('SELECT * FROM users WHERE id = ?', [id]);
}

function updateLastLogin(id) {
  const stmt = getSQLiteDB().prepare('UPDATE users SET last_login_at=? WHERE id=?');
  stmt.run([new Date().toISOString(), id]);
  stmt.free();
  _persistDB();
}

function updateCurrentMode(id, mode) {
  const stmt = getSQLiteDB().prepare('UPDATE users SET current_mode=? WHERE id=?');
  stmt.run([mode, id]);
  stmt.free();
  _persistDB();
}

/* ══════════════════════════════════════════════════
   모드 '시기'(user_mode_periods)

   "언제부터 언제까지 수험생이었나"를 구간으로 기록한다.
   이벤트 로그가 아니라 구간 모델인 이유: 연대기에서 필요한 건
   "3월 12일에 바꿨다"가 아니라 "2024.03 ~ 2027.02 수험생"이라는 띠이기 때문.

   ⚠️ 이건 소급이 불가능하다. 지금 기록을 시작하지 않으면
      나중에 어떤 방법으로도 복원할 수 없다.
══════════════════════════════════════════════════ */

/** 유저의 모드 시기 목록 (오래된 순). ended_at이 null이면 진행 중인 구간 */
function getModePeriods(userId) {
  if (!userId) return [];
  return _sqlQuery(
    'SELECT mode, started_at, ended_at FROM user_mode_periods WHERE user_id = ? ORDER BY started_at ASC',
    [userId]
  );
}

/**
 * 모드 변경 기록 (멱등).
 * 열린 구간이 이미 같은 모드면 아무것도 하지 않는다 — 앱을 열 때마다
 * setMode가 불리므로, 여기서 막지 않으면 같은 구간이 수십 개로 쪼개진다.
 * @returns {boolean} 실제로 새 구간이 열렸으면 true
 */
function recordModeChange(userId, mode, at = new Date().toISOString()) {
  if (!userId || !mode) return false;
  const open = _sqlGet(
    'SELECT id, mode FROM user_mode_periods WHERE user_id = ? AND ended_at IS NULL ORDER BY started_at DESC',
    [userId]
  );
  if (open && open.mode === mode) return false;   /* 같은 모드 — 기록할 것 없음 */

  if (open) {
    const close = getSQLiteDB().prepare('UPDATE user_mode_periods SET ended_at=? WHERE id=?');
    close.run([at, open.id]);
    close.free();
  }
  const stmt = getSQLiteDB().prepare(
    'INSERT INTO user_mode_periods (user_id, mode, started_at, ended_at) VALUES (?,?,?,NULL)'
  );
  stmt.run([userId, mode, at]);
  stmt.free();
  _persistDB();
  return true;
}

module.exports = {
  createUser, findUserByEmail, findUserById, updateLastLogin, updateCurrentMode,
  getModePeriods, recordModeChange,
};
