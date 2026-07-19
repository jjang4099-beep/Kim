'use strict';
const { getSQLiteDB, _persistDB, _sqlQuery, _sqlGet } = require('./connection');

/* user_categories 테이블 CRUD — 전부 user_id로 스코핑 */

function getCategoriesForUser(userId) {
  return _sqlQuery(
    'SELECT * FROM user_categories WHERE user_id = ? ORDER BY is_default DESC, sort_order ASC, id ASC',
    [userId]
  );
}

/** 삽입 후 방금 만든 행을 그대로 반환 */
function insertCategory(userId, { name, emoji, color, sortOrder, modes }) {
  const stmt = getSQLiteDB().prepare(
    'INSERT INTO user_categories (name, emoji, color, sort_order, is_default, modes, user_id) VALUES (?,?,?,?,0,?,?)'
  );
  stmt.run([name, emoji || '📁', color || '#6b7280', sortOrder || 0, modes || 'both', userId]);
  stmt.free();
  const created = _sqlGet('SELECT * FROM user_categories WHERE rowid = last_insert_rowid()');
  _persistDB();
  return created;
}

function updateCategoryForUser(userId, id, fields) {
  const sets = [];
  const params = [];
  for (const [col, val] of Object.entries(fields)) {
    sets.push(`${col}=?`);
    params.push(val);
  }
  if (!sets.length) return false;
  params.push(id, userId);
  const stmt = getSQLiteDB().prepare(`UPDATE user_categories SET ${sets.join(', ')} WHERE id=? AND user_id=?`);
  stmt.run(params);
  const changed = getSQLiteDB().getRowsModified();
  stmt.free();
  _persistDB();
  return changed > 0;
}

function deleteCategoryForUser(userId, id) {
  const stmt = getSQLiteDB().prepare('DELETE FROM user_categories WHERE id=? AND user_id=?');
  stmt.run([id, userId]);
  const changed = getSQLiteDB().getRowsModified();
  stmt.free();
  _persistDB();
  return changed > 0;
}

module.exports = { getCategoriesForUser, insertCategory, updateCategoryForUser, deleteCategoryForUser };
