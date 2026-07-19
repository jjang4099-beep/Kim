'use strict';
const fs   = require('fs');
const path = require('path');

/* sql.js(WASM SQLite) 커넥션 싱글턴 — server.js에서 이관.
   테이블 생성 DDL / 마이그레이션 / 시드 함수는 부트 순서에 강하게 묶여 있어 server.js에 남아있고,
   여기서는 그것들이 공통으로 쓰는 연결·저장·쿼리 프리미티브만 소유한다. */

let _sqliteDb   = null;
let _sqlitePath = null;

async function initConnection(sqlitePath) {
  if (_sqliteDb) return _sqliteDb;
  _sqlitePath = sqlitePath;
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
  const initSqlJs = require('sql.js');
  const SQL       = await initSqlJs();
  if (fs.existsSync(sqlitePath)) {
    _sqliteDb = new SQL.Database(fs.readFileSync(sqlitePath));
  } else {
    _sqliteDb = new SQL.Database();
  }
  return _sqliteDb;
}

function getSQLiteDB() {
  if (!_sqliteDb) throw new Error('[SQLite] DB가 아직 초기화되지 않았습니다 (initConnection() 대기 중)');
  return _sqliteDb;
}

/** sql.js 인스턴스를 디스크에 저장 (write마다 호출) */
function _persistDB() {
  if (!_sqliteDb) return;
  try {
    const data = _sqliteDb.export();
    fs.writeFileSync(_sqlitePath, Buffer.from(data));
  } catch (e) {
    console.warn('[SQLite] 디스크 저장 실패:', e.message);
  }
}

/** SELECT → 여러 행 반환. params는 positional 배열 */
function _sqlQuery(sql, params) {
  const stmt = getSQLiteDB().prepare(sql);
  stmt.bind(params || []);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

/** SELECT → 첫 번째 행 반환 (없으면 null) */
function _sqlGet(sql, params) {
  const stmt = getSQLiteDB().prepare(sql);
  stmt.bind(params || []);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

module.exports = { initConnection, getSQLiteDB, _persistDB, _sqlQuery, _sqlGet };
