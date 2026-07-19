'use strict';
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getSQLiteDB, _persistDB, _sqlGet } = require('./connection');

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

module.exports = { createUser, findUserByEmail, findUserById, updateLastLogin, updateCurrentMode };
