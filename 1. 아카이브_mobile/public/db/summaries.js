'use strict';
const path = require('path');
const { readJSON, writeJSON } = require('../lib/jsonStore');

const _DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const SUMMARIES_PATH = path.join(_DATA_DIR, 'summaries.json');

/* 결산 캐시 — 캐시 키에 userId를 포함해 유저별로 격리한다.
   기존 키 포맷 `${mode}:${type}:${period}` → `${userId}:${mode}:${type}:${period}` */

function _key(userId, mode, type, period) {
  return `${userId}:${mode}:${type}:${period}`;
}

function getCachedSummary(userId, mode, type, period) {
  const cache = readJSON(SUMMARIES_PATH, {});
  return cache[_key(userId, mode, type, period)] || null;
}

function setCachedSummary(userId, mode, type, period, result) {
  const cache = readJSON(SUMMARIES_PATH, {});
  cache[_key(userId, mode, type, period)] = result;
  writeJSON(SUMMARIES_PATH, cache);
}

module.exports = { getCachedSummary, setCachedSummary };
