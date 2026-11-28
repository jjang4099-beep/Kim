'use strict';
/* 목표형 영어(11-28) — 유저별 영어 목표와 최근 14일 매일 묶음. userId는 항상 첫 인자(유저 격리). */
const path = require('path');
const { readJSON, writeJSON } = require('../lib/jsonStore');

const _DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(_DATA_DIR, 'english_goals.json');
const KEEP_DAYS = 14;

function _all() { return readJSON(FILE, {}); }

function getGoal(userId) {
  return _all()[userId]?.goal || null;
}
function setGoal(userId, goal) {
  const all = _all();
  all[userId] = { ...(all[userId] || {}), goal: { ...goal, updatedAt: new Date().toISOString() } };
  writeJSON(FILE, all);
  return all[userId].goal;
}
function getDaily(userId, date) {
  return _all()[userId]?.daily?.[date] || null;
}
function setDaily(userId, date, pkg) {
  const all = _all(), u = all[userId] || (all[userId] = {});
  u.daily = { ...(u.daily || {}), [date]: pkg };
  Object.keys(u.daily).sort().slice(0, -KEEP_DAYS).forEach(d => delete u.daily[d]);
  writeJSON(FILE, all);
}
/** 최근 묶음 제목(겹치지 않게 프롬프트에 넣는다) */
function recentTitles(userId, n = 7) {
  const d = _all()[userId]?.daily || {};
  return Object.keys(d).sort().slice(-n).map(k => d[k]?.title).filter(Boolean);
}

module.exports = { getGoal, setGoal, getDaily, setDaily, recentTitles };
