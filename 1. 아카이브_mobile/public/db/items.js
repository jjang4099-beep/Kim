'use strict';
const { v4: uuidv4 } = require('uuid');
const { getSQLiteDB, _persistDB, _sqlGet } = require('./connection');
const { getDomain, normalizeMode, deriveItemMode } = require('../lib/domain');

/* ══════════════════════════════════════════════════
   items 테이블 CRUD — server.js에서 이관.
   readDB/readDBByMode/writeDB/dbInsert/dbUpdate/dbDelete는 관리자·마이그레이션용으로
   그대로 유지(무필터), 신규 userId 인지 래퍼가 라우트에서 쓰이는 기본 접근 경로다.
   userId는 항상 첫 번째 파라미터로 명시 전달한다(전역/req 깊은 곳에서 읽지 않음).
══════════════════════════════════════════════════ */

/** 전체 아이템 배열 반환 (createdAt DESC) — 무필터, 관리자/마이그레이션 전용 */
function readDB() {
  const db     = getSQLiteDB();
  const result = db.exec('SELECT data, mode FROM items ORDER BY created_at DESC');
  if (!result.length) return [];
  return result[0].values.map(([data, mode]) => {
    const item = JSON.parse(data);
    item.domain = getDomain(item);
    item.shelf  = item.domain;
    item.mode   = mode || deriveItemMode(item);
    return item;
  });
}

/** 모드별 조회 — 무필터(userId 없음), 관리자/마이그레이션 전용 */
function readDBByMode(mode) {
  const db   = getSQLiteDB();
  const norm = normalizeMode(mode);
  const stmt = db.prepare('SELECT data, mode FROM items WHERE mode = ? ORDER BY created_at DESC');
  stmt.bind([norm]);
  const out = [];
  while (stmt.step()) {
    const [data, m] = stmt.get();
    const item = JSON.parse(data);
    item.domain = getDomain(item);
    item.shelf  = item.domain;
    item.mode   = m || norm;
    out.push(item);
  }
  stmt.free();
  return out;
}

/** 전체 배열을 트랜잭션으로 교체 (배치 작업용) */
function writeDB(items) {
  const db   = getSQLiteDB();
  const stmt = db.prepare(
    'INSERT OR REPLACE INTO items (id, category, mode, date, created_at, data) VALUES (?, ?, ?, ?, ?, ?)'
  );
  db.run('DELETE FROM items');
  for (const item of items) {
    item.shelf = item.category || 'inbox';
    item.mode  = deriveItemMode(item);
    stmt.run([
      item.id        || uuidv4(),
      item.category  || 'inbox',
      item.mode,
      item.date      || '',
      item.createdAt || new Date().toISOString(),
      JSON.stringify(item)
    ]);
  }
  stmt.free();
  _persistDB();
}

/** 단일 아이템 삽입/교체 — 무필터, 관리자/마이그레이션 전용 */
function dbInsert(item) {
  const db     = getSQLiteDB();
  const domain = getDomain(item);
  item.domain  = domain;
  item.shelf   = domain;
  item.mode    = deriveItemMode(item);
  const stmt   = db.prepare(
    'INSERT OR REPLACE INTO items (id, category, mode, date, created_at, data) VALUES (?, ?, ?, ?, ?, ?)'
  );
  stmt.run([
    item.id        || uuidv4(),
    domain,
    item.mode,
    item.date      || '',
    item.createdAt || new Date().toISOString(),
    JSON.stringify(item)
  ]);
  stmt.free();
  _persistDB();
}

/** 단일 아이템 업데이트 — 무필터, 관리자/마이그레이션 전용 */
function dbUpdate(item) {
  const db     = getSQLiteDB();
  const domain = getDomain(item);
  item.domain  = domain;
  item.shelf   = domain;
  item.mode    = deriveItemMode(item);
  const stmt   = db.prepare(
    'UPDATE items SET category=?, mode=?, date=?, created_at=?, data=? WHERE id=?'
  );
  stmt.run([
    domain,
    item.mode,
    item.date      || '',
    item.createdAt || '',
    JSON.stringify(item),
    item.id
  ]);
  stmt.free();
  _persistDB();
}

/** 단일 아이템 삭제 — 무필터, 관리자/마이그레이션 전용 */
function dbDelete(id) {
  const db   = getSQLiteDB();
  const stmt = db.prepare('DELETE FROM items WHERE id=?');
  stmt.run([id]);
  stmt.free();
  _persistDB();
}

/* ══════════════════════════════════════════════════
   userId 인지 래퍼 — 라우트는 이 함수들만 사용
══════════════════════════════════════════════════ */

/** 유저 소유 아이템 목록 (mode 생략 시 해당 유저 전체) */
function getItemsByUser(userId, mode) {
  const db = getSQLiteDB();
  let sql = 'SELECT data, mode FROM items WHERE user_id = ?';
  const params = [userId];
  if (mode) {
    sql += ' AND mode = ?';
    params.push(normalizeMode(mode));
  }
  sql += ' ORDER BY created_at DESC';
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const out = [];
  while (stmt.step()) {
    const [data, m] = stmt.get();
    const item = JSON.parse(data);
    item.domain = getDomain(item);
    item.shelf  = item.domain;
    item.mode   = m || (mode ? normalizeMode(mode) : deriveItemMode(item));
    out.push(item);
  }
  stmt.free();
  return out;
}

/** id + 소유자 일치 확인 후 단건 반환 — 없거나 남의 것이면 null (IDOR 방지) */
function getItemByIdForUser(userId, id) {
  const row = _sqlGet('SELECT data, mode FROM items WHERE id = ? AND user_id = ?', [id, userId]);
  if (!row) return null;
  const item = JSON.parse(row.data);
  item.domain = getDomain(item);
  item.shelf  = item.domain;
  item.mode   = row.mode || deriveItemMode(item);
  return item;
}

/** 유저 소유로 아이템 삽입/교체 */
function insertItem(userId, item) {
  const domain = getDomain(item);
  item.domain  = domain;
  item.shelf   = domain;
  item.mode    = deriveItemMode(item);
  item.userId  = userId;
  const id = item.id || uuidv4();
  item.id  = id;
  const stmt = getSQLiteDB().prepare(
    'INSERT OR REPLACE INTO items (id, category, mode, date, created_at, data, user_id) VALUES (?,?,?,?,?,?,?)'
  );
  stmt.run([id, domain, item.mode, item.date || '', item.createdAt || new Date().toISOString(), JSON.stringify(item), userId]);
  stmt.free();
  _persistDB();
  return item;
}

/** 소유자 확인 후 업데이트 — 없거나 남의 것이면 null 반환(호출부는 404 처리) */
function updateItemForUser(userId, item) {
  const existing = getItemByIdForUser(userId, item.id);
  if (!existing) return null;
  const domain = getDomain(item);
  item.domain  = domain;
  item.shelf   = domain;
  item.mode    = deriveItemMode(item);
  item.userId  = userId;
  const stmt = getSQLiteDB().prepare(
    'UPDATE items SET category=?, mode=?, date=?, created_at=?, data=? WHERE id=? AND user_id=?'
  );
  stmt.run([domain, item.mode, item.date || '', item.createdAt || '', JSON.stringify(item), item.id, userId]);
  stmt.free();
  _persistDB();
  return item;
}

/** 소유자 확인 후 삭제 — 삭제됐으면 true, 없거나 남의 것이면 false */
function deleteItemForUser(userId, id) {
  const db   = getSQLiteDB();
  const stmt = db.prepare('DELETE FROM items WHERE id=? AND user_id=?');
  stmt.run([id, userId]);
  const changed = db.getRowsModified();
  stmt.free();
  _persistDB();
  return changed > 0;
}

module.exports = {
  readDB, readDBByMode, writeDB, dbInsert, dbUpdate, dbDelete,
  getItemsByUser, getItemByIdForUser, insertItem, updateItemForUser, deleteItemForUser,
};
