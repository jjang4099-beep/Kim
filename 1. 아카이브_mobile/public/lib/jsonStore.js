'use strict';
const fs   = require('fs');
const path = require('path');

/* 범용 JSON 헬퍼 (users, subscriptions, dailyFeeds, summaries 등 소형 파일용) — server.js에서 이관 */

function readJSON(filePath, fallback = []) {
  if (!fs.existsSync(filePath)) return fallback;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
  catch { return fallback; }
}

function writeJSON(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

module.exports = { readJSON, writeJSON };
