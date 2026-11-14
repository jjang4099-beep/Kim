/* ══════════════════════════════════════════════════
   지식 퀘스트 진행 기록 — 단계 보스전 결과(user_boss_clears)
   userId는 항상 첫 번째 인자. 테이블은 server.js 부팅 스키마에서 만든다.
══════════════════════════════════════════════════ */
const { getSQLiteDB, _persistDB, _sqlQuery, _sqlGet } = require('./connection');

/** 유저의 보스전 기록 { [stageId]: { best, tries, clearedAt } } */
function getBossRecords(userId) {
  if (!userId) return {};
  const out = {};
  _sqlQuery('SELECT stage_id, best, tries, cleared_at FROM user_boss_clears WHERE user_id = ?', [userId])
    .forEach(r => { out[r.stage_id] = { best: r.best || 0, tries: r.tries || 0, clearedAt: r.cleared_at || null }; });
  return out;
}

/** 도전 한 번 기록 — 이기면 처음 이긴 날을 남기고, 최고 점수는 늘 갱신 */
function recordBossTry(userId, stageId, score, won) {
  if (!userId || !stageId) return null;
  const now = new Date().toISOString();
  const cur = _sqlGet('SELECT best, tries, cleared_at FROM user_boss_clears WHERE user_id = ? AND stage_id = ?', [userId, stageId]);
  if (cur) {
    const stmt = getSQLiteDB().prepare('UPDATE user_boss_clears SET best = ?, tries = ?, cleared_at = ? WHERE user_id = ? AND stage_id = ?');
    stmt.run([Math.max(cur.best || 0, score), (cur.tries || 0) + 1, cur.cleared_at || (won ? now : null), userId, stageId]);
    stmt.free();
  } else {
    const stmt = getSQLiteDB().prepare('INSERT INTO user_boss_clears (user_id, stage_id, best, tries, cleared_at) VALUES (?,?,?,?,?)');
    stmt.run([userId, stageId, score, 1, won ? now : null]);
    stmt.free();
  }
  _persistDB();
  return getBossRecords(userId)[stageId];
}

module.exports = { getBossRecords, recordBossTry };
