/**
 * SJ 지식 서재 (Knowledge Library) — server.js v5
 *
 * 실행:  node server.js  |  npm run dev (nodemon)
 * 환경변수:
 *   PORT=3000
 *   ANTHROPIC_API_KEY=sk-ant-...       (없으면 규칙 기반 동작)
 *   GEMINI_API_KEY=AIza...              (데일리 피드 생성용)
 *   PUBLIC_VAPID_KEY=B...               (Web Push 공개키)
 *   PRIVATE_VAPID_KEY=_...              (Web Push 비밀키)
 *   VAPID_EMAIL=mailto:you@example.com  (VAPID 연락처)
 *
 * ▶ v5 추가사항
 *   - Web Push 알림: 피드 생성 완료 시 스마트폰 즉시 알림
 *   - VAPID 기반 구독 관리 (data/push_subscriptions.json)
 *   - Share Target API: /share-handler, /api/inbox
 *   - POST /api/push/subscribe   → 구독 등록
 *   - DELETE /api/push/subscribe → 구독 해제
 *   - GET /api/push/vapid-key    → 공개키 반환
 *   - GET /share-handler         → 공유 시트 수신 경량 페이지
 *   - POST /api/inbox            → 공유된 콘텐츠 인박스 저장
 */

'use strict';
require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const fs       = require('fs');
const path     = require('path');
const cron     = require('node-cron');
const webpush  = require('web-push');
const multer   = require('multer');
const { v4: uuidv4 } = require('uuid');

const PORT                   = process.env.PORT || 3000;
/* DATA_DIR: Fly.io 볼륨 경로(/data)를 env로 주입, 로컬은 기존 경로 유지 */
const _DATA_DIR              = process.env.DATA_DIR || path.join(__dirname, 'data');
const _SEED_DIR              = path.join(__dirname, 'data'); // 시드 파일은 항상 컨테이너 내부
const SQLITE_PATH            = path.join(_DATA_DIR, 'archive.db');
const ARCHIVE_JSON_PATH      = path.join(_SEED_DIR, 'archive.json');  // 마이그레이션 소스용 (읽기전용 시드)
const DAILY_FEEDS_PATH       = path.join(_DATA_DIR, 'dailyFeeds.json');
const SUBSCRIPTIONS_PATH     = path.join(_SEED_DIR, 'subscriptions.json'); // 읽기전용 카탈로그 — 컨테이너 내장
const USERS_PATH             = path.join(_DATA_DIR, 'users.json');
const PUSH_SUBS_PATH         = path.join(_DATA_DIR, 'push_subscriptions.json');
const EXAM_SETTINGS_PATH     = path.join(_DATA_DIR, 'exam_settings.json');
const SUMMARIES_PATH         = path.join(_DATA_DIR, 'summaries.json');

// ══════════════════════════════════════════════════
//  Layer 1: 8대 지식 도메인 온톨로지
// ══════════════════════════════════════════════════
const DOMAINS = {
  business:   { label: '비즈니스·경제', icon: '📈' },
  language:   { label: '언어·표현',     icon: '🌐' },
  humanities: { label: '역사·문명',     icon: '📜' },
  psychology: { label: '심리·철학',     icon: '🧠' },
  science:    { label: '과학·기술',     icon: '🔬' },
  arts:       { label: '문화·예술',     icon: '🎨' },
  life:       { label: '건강·라이프',   icon: '⚕️' },
  society:    { label: '사회·정치',     icon: '🌍' },
};

// 구형 category → domain 매핑 (마이그레이션 + 호환성)
const CATEGORY_TO_DOMAIN = {
  en:        'language',
  zh:        'language',
  history:   'humanities',
  economy:   'business',
  youtube:   'business',
  inbox:     'business',
  psychology:'psychology',
  science:   'science',
  arts:      'arts',
  life:      'life',
  society:   'society',
};

function getDomain(item) {
  if (item.domain && DOMAINS[item.domain]) return item.domain;
  return CATEGORY_TO_DOMAIN[item.category] || 'business';
}

/* ══════════════════════════════════════════════════════════
   모드 격리(Isolation) — 'EXAM_PREP'(수험생) | 'PROFESSIONAL'(직장인)
   클라이언트는 'exam'/'work'로 보냄 → 정규화하여 DB에 적재/조회
══════════════════════════════════════════════════════════ */
const MODE_EXAM = 'EXAM_PREP';
const MODE_PRO  = 'PROFESSIONAL';

/** 클라이언트 모드값('exam'/'work'/'EXAM_PREP'/'PROFESSIONAL')을 표준 ENUM으로 정규화 */
function normalizeMode(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'exam' || v === 'exam_prep' || v === 'student') return MODE_EXAM;
  return MODE_PRO;   // 기본/직장인
}

/** 아이템 콘텐츠로 모드를 추론 (기존 데이터 백필·fallback용) */
function deriveItemMode(item) {
  if (item && item.mode) return normalizeMode(item.mode);
  const isExam = item && (
    item.domain === 'exam' ||
    item.category === 'exam' ||
    item.type === 'wrong_answer' ||
    !!item.wrongAnswer
  );
  return isExam ? MODE_EXAM : MODE_PRO;
}

// ── 이미지 업로드 디렉토리 + multer 설정 ──
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 10 * 1024 * 1024 },   // 10 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('이미지 파일만 업로드 가능합니다.'));
  }
});

// ── Web Push VAPID 설정 ──
(function initVapid() {
  const pub   = process.env.PUBLIC_VAPID_KEY;
  const priv  = process.env.PRIVATE_VAPID_KEY;
  const email = process.env.VAPID_EMAIL || 'mailto:admin@sj-library.app';
  if (pub && priv) {
    webpush.setVapidDetails(email, pub, priv);
    console.log('[Push] VAPID 설정 완료');
  } else {
    console.warn('[Push] VAPID 키 미설정 — 웹 푸시 비활성화');
  }
})();

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));  // server.js가 public/ 안에 있으므로 __dirname이 곧 public 폴더
// 업로드된 이미지 정적 서빙 (URL: /uploads/파일명)
app.use('/uploads', express.static(UPLOADS_DIR));

// ══════════════════════════════════════════════════
//  범용 JSON 헬퍼 (users, subscriptions, dailyFeeds 등 소형 파일용)
// ══════════════════════════════════════════════════

function readJSON(filePath, fallback = []) {
  if (!fs.existsSync(filePath)) return fallback;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
  catch { return fallback; }
}

function writeJSON(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ══════════════════════════════════════════════════
//  SQLite — 메인 아카이브 DB (archive.db)
//  sql.js 사용 — 순수 JavaScript WASM, 네이티브 컴파일 불필요
//  • items 테이블: id PK + 검색용 컬럼 + data(JSON 전문)
//  • 서버 기동 시 archive.json이 있으면 원타임 마이그레이션
//  • WAL 대신 직접 파일 저장 방식 (sql.js 특성상)
// ══════════════════════════════════════════════════

let _sqliteDb  = null;   // sql.js Database 인스턴스
let _sqliteDir = path.dirname(SQLITE_PATH);

async function initSQLiteDB() {
  if (_sqliteDb) return;
  fs.mkdirSync(_sqliteDir, { recursive: true });
  const initSqlJs = require('sql.js');
  const SQL       = await initSqlJs();
  if (fs.existsSync(SQLITE_PATH)) {
    const buf  = fs.readFileSync(SQLITE_PATH);
    _sqliteDb  = new SQL.Database(buf);
  } else {
    _sqliteDb  = new SQL.Database();
  }
  _sqliteDb.run(`
    /* ── 유저 아카이브 아이템 ──
       mode: 저장 당시 활성 모드 — 'EXAM_PREP'(수험생) | 'PROFESSIONAL'(직장인)
             모드별 서재/홈 피드 완전 격리(Isolation)의 기준 컬럼 */
    CREATE TABLE IF NOT EXISTS items (
      id         TEXT PRIMARY KEY,
      category   TEXT NOT NULL DEFAULT 'inbox',
      mode       TEXT NOT NULL DEFAULT 'PROFESSIONAL',
      date       TEXT,
      created_at TEXT,
      data       TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_items_category   ON items(category);
    CREATE INDEX IF NOT EXISTS idx_items_date       ON items(date);
    CREATE INDEX IF NOT EXISTS idx_items_created_at ON items(created_at);
    /* mode 인덱스는 _migrateItemModes()에서 생성 — 기존 테이블의 컬럼 추가(ALTER) 이후 */

    /* ══════════════════════════════════════════════════
       영어 테마 팩 스키마 — 어드민 선행 생성, 런타임 AI 호출 없음
    ══════════════════════════════════════════════════ */

    /* 상위 테마 테이블 */
    CREATE TABLE IF NOT EXISTS english_themes (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      pack_id              TEXT UNIQUE NOT NULL,
      theme_title          TEXT NOT NULL,
      theme_title_en       TEXT    DEFAULT '',
      theme_key            TEXT    DEFAULT '',
      level                TEXT    DEFAULT 'intermediate',
      delivery_date        TEXT,                       -- YYYY-MM-DD, NULL=미지정
      master_paragraph_en  TEXT    NOT NULL DEFAULT '',
      master_paragraph_ko  TEXT    NOT NULL DEFAULT '',
      highlights_json      TEXT    DEFAULT '[]',       -- JSON 배열
      created_at           TEXT    DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_et_pack_id  ON english_themes(pack_id);
    CREATE INDEX IF NOT EXISTS idx_et_date     ON english_themes(delivery_date);

    /* 하위 개별 표현 테이블 (theme_id FK) */
    CREATE TABLE IF NOT EXISTS english_expressions (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      theme_id         INTEGER NOT NULL REFERENCES english_themes(id) ON DELETE CASCADE,
      expression_order INTEGER NOT NULL,
      expr_id          TEXT UNIQUE,
      expression       TEXT NOT NULL,
      meaning          TEXT NOT NULL,
      nuance_story     TEXT DEFAULT '',
      dialogue_en      TEXT DEFAULT '',
      dialogue_ko      TEXT DEFAULT '',
      example_en       TEXT DEFAULT '',
      practice_en      TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_ee_theme_id ON english_expressions(theme_id);
    CREATE INDEX IF NOT EXISTS idx_ee_order    ON english_expressions(theme_id, expression_order);

    /* ══════════════════════════════════════════════════
       수험생 모드 지식 배달 — 영어 단어 / 한국사
       (직장인 english_themes와 완전 독립. data/exam_db/*.json에서 시드)
    ══════════════════════════════════════════════════ */

    /* 수능 영어 단어 — 상위 테마팩 */
    CREATE TABLE IF NOT EXISTS exam_vocab_themes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      pack_id       TEXT UNIQUE NOT NULL,
      theme_title   TEXT NOT NULL,
      level         TEXT    DEFAULT 'high',
      tip           TEXT    DEFAULT '',
      delivery_date TEXT,
      created_at    TEXT    DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_evt_pack_id ON exam_vocab_themes(pack_id);

    /* 수능 영어 단어 — 하위 개별 단어 (theme_id FK) */
    CREATE TABLE IF NOT EXISTS exam_vocab_words (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      theme_id    INTEGER NOT NULL REFERENCES exam_vocab_themes(id) ON DELETE CASCADE,
      word_order  INTEGER NOT NULL,
      word_id     TEXT UNIQUE,
      word        TEXT NOT NULL,
      pos         TEXT DEFAULT '',
      meaning     TEXT NOT NULL,
      example_en  TEXT DEFAULT '',
      example_ko  TEXT DEFAULT '',
      csat_ref    TEXT DEFAULT '',
      synonyms    TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_evw_theme_id ON exam_vocab_words(theme_id);
    CREATE INDEX IF NOT EXISTS idx_evw_order    ON exam_vocab_words(theme_id, word_order);

    /* 한국사 핵심 지식 */
    CREATE TABLE IF NOT EXISTS exam_history_items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id       TEXT UNIQUE NOT NULL,
      era           TEXT DEFAULT '',
      era_label     TEXT DEFAULT '',
      title         TEXT NOT NULL,
      summary       TEXT DEFAULT '',
      key_point     TEXT DEFAULT '',
      exam_tip      TEXT DEFAULT '',
      delivery_date TEXT,
      created_at    TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_ehi_item_id ON exam_history_items(item_id);
    CREATE INDEX IF NOT EXISTS idx_ehi_era     ON exam_history_items(era);

    /* ══════════════════════════════════════════════════
       유저 커스텀 카테고리
    ══════════════════════════════════════════════════ */
    CREATE TABLE IF NOT EXISTS user_categories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      emoji      TEXT    DEFAULT '📁',
      color      TEXT    DEFAULT '#6b7280',
      sort_order INTEGER DEFAULT 0,
      is_default INTEGER DEFAULT 0,
      modes      TEXT    DEFAULT 'both',
      created_at TEXT    DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_uc_sort ON user_categories(sort_order);
  `);
  _migrateFromJSON();
  _migrateLegacyDomains();
  _migrateItemModes();
  _seedEnglishThemes();
  _seedExamKnowledge();
  _seedDefaultCategories();
  _persistDB();
  console.log('[SQLite] DB 초기화 완료 →', SQLITE_PATH);
}

/**
 * 기존 items 테이블에 mode 컬럼이 없으면 추가하고, 기존 행을 콘텐츠 기반으로 백필.
 * - exam 아이템(domain/category==='exam' || type==='wrong_answer' || wrongAnswer) → EXAM_PREP
 * - 그 외 → PROFESSIONAL
 * 멱등: mode가 이미 채워진 행은 건너뜀.
 */
function _migrateItemModes() {
  try {
    /* 1) 컬럼 존재 여부 확인 (CREATE TABLE IF NOT EXISTS는 컬럼 추가 안 함) */
    const cols = _sqliteDb.exec('PRAGMA table_info(items)');
    const hasMode = cols.length && cols[0].values.some(row => row[1] === 'mode');
    if (!hasMode) {
      _sqliteDb.run(`ALTER TABLE items ADD COLUMN mode TEXT NOT NULL DEFAULT '${MODE_PRO}'`);
      console.log('[SQLite] items.mode 컬럼 추가 완료');
    }
    /* mode 인덱스 — 컬럼 보장 후 항상 생성 (신규/기존 DB 공통) */
    _sqliteDb.run('CREATE INDEX IF NOT EXISTS idx_items_mode ON items(mode)');
    _sqliteDb.run('CREATE INDEX IF NOT EXISTS idx_items_mode_created ON items(mode, created_at)');

    /* 2) 백필 — 데이터 JSON으로 모드 추론하여 컬럼 + JSON 동기화 */
    const rows = _sqliteDb.exec('SELECT id, data, mode FROM items');
    if (!rows.length) return;
    const upd = _sqliteDb.prepare('UPDATE items SET mode=?, data=? WHERE id=?');
    let migrated = 0;
    for (const [id, data, mode] of rows[0].values) {
      let item;
      try { item = JSON.parse(data); } catch { continue; }
      const already = item.mode && (mode === MODE_EXAM || mode === MODE_PRO) && mode === normalizeMode(item.mode);
      if (already) continue;
      const resolved = deriveItemMode(item);
      item.mode = resolved;
      upd.run([resolved, JSON.stringify(item), id]);
      migrated++;
    }
    upd.free();
    if (migrated) console.log(`[SQLite] items.mode 백필 완료 (${migrated}개)`);
  } catch (e) {
    console.warn('[SQLite] mode 마이그레이션 실패 (무시):', e.message);
  }
}

/** sql.js 인스턴스를 디스크에 저장 (write마다 호출) */
function _persistDB() {
  if (!_sqliteDb) return;
  try {
    const data = _sqliteDb.export();
    fs.writeFileSync(SQLITE_PATH, Buffer.from(data));
  } catch (e) {
    console.warn('[SQLite] 디스크 저장 실패:', e.message);
  }
}

function getSQLiteDB() {
  if (!_sqliteDb) throw new Error('[SQLite] DB가 아직 초기화되지 않았습니다 (initSQLiteDB() 대기 중)');
  return _sqliteDb;
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

function _migrateFromJSON() {
  const result = _sqliteDb.exec('SELECT COUNT(*) AS c FROM items');
  const count  = result[0]?.values[0][0] ?? 0;
  if (count > 0) return;
  if (!fs.existsSync(ARCHIVE_JSON_PATH)) return;
  try {
    const rows = JSON.parse(fs.readFileSync(ARCHIVE_JSON_PATH, 'utf-8'));
    if (!Array.isArray(rows) || !rows.length) return;
    const stmt = _sqliteDb.prepare(
      'INSERT OR IGNORE INTO items (id, category, mode, date, created_at, data) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const item of rows) {
      item.mode = deriveItemMode(item);
      stmt.run([
        item.id        || uuidv4(),
        item.category  || 'inbox',
        item.mode,
        item.date      || '',
        item.createdAt || '',
        JSON.stringify(item)
      ]);
    }
    stmt.free();
    console.log(`[SQLite] archive.json 마이그레이션 완료 (${rows.length}개)`);
  } catch (e) {
    console.warn('[SQLite] 마이그레이션 실패 (무시):', e.message);
  }
}

/* ══════════════════════════════════════════════════════════
   영어 테마 팩 — 시드 / 쿼리 유틸리티
   knowledge_db/*.json → english_themes / english_expressions
   (INSERT OR IGNORE → 멱등, 재시작마다 안전 실행)
══════════════════════════════════════════════════════════ */

/** 서버 시작 시 knowledge_db 배치 파일에서 테마팩을 SQLite로 시드 */
function _seedEnglishThemes() {
  const kdbDir = path.join(__dirname, 'data', 'knowledge_db');
  if (!fs.existsSync(kdbDir)) return;
  const files = fs.readdirSync(kdbDir).filter(f => f.endsWith('.json')).sort();
  let seeded = 0;
  for (const file of files) {
    try {
      const batch = JSON.parse(fs.readFileSync(path.join(kdbDir, file), 'utf8'));
      const packs = batch.english_theme_packs;
      if (!Array.isArray(packs) || !packs.length) continue;
      for (const pack of packs) {
        const highlights = JSON.stringify(pack.master_paragraph?.highlights || []);
        /* 테마 INSERT OR IGNORE (pack_id UNIQUE) */
        const tStmt = _sqliteDb.prepare(
          `INSERT OR IGNORE INTO english_themes
           (pack_id, theme_title, theme_title_en, theme_key, level, delivery_date,
            master_paragraph_en, master_paragraph_ko, highlights_json)
           VALUES (?,?,?,?,?,?,?,?,?)`
        );
        tStmt.run([
          pack.id,
          pack.theme_title          || '',
          pack.theme_title_en       || '',
          pack.theme_key            || '',
          pack.level                || 'intermediate',
          pack.delivery_date        || null,
          pack.master_paragraph?.text        || '',
          pack.master_paragraph?.translation || '',
          highlights
        ]);
        tStmt.free();
        /* theme_id 조회 */
        const themeRow = _sqlGet('SELECT id FROM english_themes WHERE pack_id = ?', [pack.id]);
        if (!themeRow) continue;
        /* 표현 INSERT OR IGNORE (expr_id UNIQUE) */
        for (const expr of (pack.expressions || [])) {
          const eStmt = _sqliteDb.prepare(
            `INSERT OR IGNORE INTO english_expressions
             (theme_id, expression_order, expr_id, expression, meaning,
              nuance_story, dialogue_en, dialogue_ko, example_en, practice_en)
             VALUES (?,?,?,?,?,?,?,?,?,?)`
          );
          eStmt.run([
            themeRow.id,
            expr.order            || 0,
            expr.id               || null,
            expr.expression,
            expr.meaning,
            expr.nuance           || '',
            expr.dialogue         || '',
            expr.dialogue_ko      || '',
            expr.example          || '',
            expr.practice         || ''
          ]);
          eStmt.free();
          seeded++;
        }
      }
    } catch (e) {
      console.warn(`[EnTheme Seed] ${file} 실패:`, e.message);
    }
  }
  if (seeded > 0) console.log(`[EnTheme Seed] ${seeded}개 표현 시드 완료`);
}

/**
 * 오늘 배달할 영어 테마팩 1개를 SQLite에서 선택 (AI 호출 없음)
 * 우선순위: ① today 날짜 지정 팩 ② 최근 미배달 랜덤 ③ 전체 랜덤 fallback
 */
function _queryEnThemePack(subId) {
  try {
    const recentPackIds = getRecentDeliveredIDs(subId, 30);
    const today = toDateStr(new Date());
    let themeRow = null;

    if (recentPackIds.length > 0) {
      const notIn = recentPackIds.map(() => '?').join(',');
      /* ① 오늘 지정 날짜 + 미배달 */
      themeRow = _sqlGet(
        `SELECT * FROM english_themes WHERE delivery_date = ? AND pack_id NOT IN (${notIn}) LIMIT 1`,
        [today, ...recentPackIds]
      );
      /* ② 날짜 무관 미배달 랜덤 */
      if (!themeRow) {
        themeRow = _sqlGet(
          `SELECT * FROM english_themes WHERE pack_id NOT IN (${notIn}) ORDER BY RANDOM() LIMIT 1`,
          recentPackIds
        );
      }
    } else {
      /* ① 오늘 지정 날짜 */
      themeRow = _sqlGet(
        `SELECT * FROM english_themes WHERE delivery_date = ? LIMIT 1`, [today]
      );
      /* ② 전체 랜덤 */
      if (!themeRow) themeRow = _sqlGet(`SELECT * FROM english_themes ORDER BY RANDOM() LIMIT 1`, []);
    }
    /* ③ 완전 fallback */
    if (!themeRow) themeRow = _sqlGet(`SELECT * FROM english_themes ORDER BY RANDOM() LIMIT 1`, []);
    if (!themeRow) return null;

    const expressions = _sqlQuery(
      `SELECT * FROM english_expressions WHERE theme_id = ? ORDER BY expression_order ASC`,
      [themeRow.id]
    );
    if (!expressions.length) return null;
    return { theme: themeRow, expressions };
  } catch (e) {
    console.warn('[EnTheme Query] 실패:', e.message);
    return null;
  }
}

/* ══════════════════════════════════════════════════════════
   수험생 지식 배달 — 시드 / 쿼리 유틸리티
   data/exam_db/*.json → exam_vocab_themes / exam_vocab_words / exam_history_items
   (INSERT OR IGNORE → 멱등, 재시작마다 안전 실행. 직장인 knowledge_db와 완전 독립)
══════════════════════════════════════════════════════════ */

/** 서버 시작 시 exam_db 배치 파일에서 영어단어/한국사를 SQLite로 시드 */
function _seedExamKnowledge() {
  const dir = path.join(__dirname, 'data', 'exam_db');
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  let vSeeded = 0, hSeeded = 0;
  for (const file of files) {
    try {
      const batch = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));

      /* ── 영어 단어 팩 ── */
      for (const pack of (batch.exam_vocab_themes || [])) {
        const tStmt = _sqliteDb.prepare(
          `INSERT OR IGNORE INTO exam_vocab_themes (pack_id, theme_title, level, tip, delivery_date)
           VALUES (?,?,?,?,?)`
        );
        tStmt.run([pack.id, pack.theme_title || '', pack.level || 'high', pack.tip || '', pack.delivery_date || null]);
        tStmt.free();
        const themeRow = _sqlGet('SELECT id FROM exam_vocab_themes WHERE pack_id = ?', [pack.id]);
        if (!themeRow) continue;
        let order = 0;
        for (const w of (pack.words || [])) {
          order++;
          const wStmt = _sqliteDb.prepare(
            `INSERT OR IGNORE INTO exam_vocab_words
             (theme_id, word_order, word_id, word, pos, meaning, example_en, example_ko, csat_ref, synonyms)
             VALUES (?,?,?,?,?,?,?,?,?,?)`
          );
          wStmt.run([
            themeRow.id, w.order || order, w.id || null,
            w.word, w.pos || '', w.meaning || '',
            w.example_en || '', w.example_ko || '', w.csat_ref || '', w.synonyms || ''
          ]);
          wStmt.free();
          vSeeded++;
        }
      }

      /* ── 한국사 ── */
      for (const h of (batch.exam_history_items || [])) {
        const hStmt = _sqliteDb.prepare(
          `INSERT OR IGNORE INTO exam_history_items
           (item_id, era, era_label, title, summary, key_point, exam_tip, delivery_date)
           VALUES (?,?,?,?,?,?,?,?)`
        );
        hStmt.run([
          h.id, h.era || '', h.era_label || '', h.title,
          h.summary || '', h.key_point || '', h.exam_tip || '', h.delivery_date || null
        ]);
        hStmt.free();
        hSeeded++;
      }
    } catch (e) {
      console.warn(`[ExamKnowledge Seed] ${file} 실패:`, e.message);
    }
  }
  if (vSeeded || hSeeded) console.log(`[ExamKnowledge Seed] 단어 ${vSeeded}개 / 한국사 ${hSeeded}개 시드 완료`);
}

/**
 * 수험생 오늘의 배달 — 영어 단어 팩 1개(5단어) + 한국사 1개 (AI 호출 없음)
 * 날짜 기반 결정적(deterministic) 로테이션:
 *   같은 날엔 항상 같은 내용(일관성), 날짜가 바뀌면 다음 팩/항목으로 순환.
 *   데이터가 늘수록 더 다양해짐.
 */
function _queryExamDaily(dateStr) {
  try {
    const base = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
    const epochDay = Math.floor(base.getTime() / 86400000);

    /* 영어 단어 팩 */
    let vocab = null;
    const packs = _sqlQuery('SELECT * FROM exam_vocab_themes ORDER BY id ASC', []);
    if (packs.length) {
      const pack = packs[epochDay % packs.length];
      const words = _sqlQuery(
        'SELECT * FROM exam_vocab_words WHERE theme_id = ? ORDER BY word_order ASC', [pack.id]
      );
      vocab = { pack, words };
    }

    /* 한국사 — 영어와 다른 오프셋으로 조합 다양화 */
    let history = null;
    const histItems = _sqlQuery('SELECT * FROM exam_history_items ORDER BY id ASC', []);
    if (histItems.length) {
      history = histItems[epochDay % histItems.length];
    }

    return { vocab, history };
  } catch (e) {
    console.warn('[ExamDaily Query] 실패:', e.message);
    return { vocab: null, history: null };
  }
}

/* ══════════════════════════════════════════════════════════
   기본 카테고리 시드 — user_categories 테이블이 비어있을 때만 실행
══════════════════════════════════════════════════════════ */
function _seedDefaultCategories() {
  try {
    const existing = _sqlGet('SELECT COUNT(*) AS c FROM user_categories');
    if (existing && Number(existing.c) > 0) return;
    const defaults = [
      { name:'영어',     emoji:'🗽', color:'#4f46e5', modes:'both', is_default:1, order:1 },
      { name:'경제/시황', emoji:'📈', color:'#059669', modes:'work', is_default:1, order:2 },
      { name:'역사',     emoji:'🏛️', color:'#92400e', modes:'both', is_default:1, order:3 },
      { name:'명언',     emoji:'💡', color:'#7c3aed', modes:'both', is_default:1, order:4 },
      { name:'고사성어', emoji:'📜', color:'#c2410c', modes:'work', is_default:1, order:5 },
      { name:'수학',     emoji:'📐', color:'#2563eb', modes:'exam', is_default:1, order:6 },
      { name:'국어',     emoji:'📖', color:'#dc2626', modes:'exam', is_default:1, order:7 },
      { name:'한국사',   emoji:'🇰🇷', color:'#92400e', modes:'exam', is_default:1, order:8 },
      { name:'탐구',     emoji:'🔬', color:'#059669', modes:'exam', is_default:1, order:9 },
      { name:'자격증',   emoji:'📋', color:'#7c3aed', modes:'exam', is_default:1, order:10 },
      { name:'기타',     emoji:'📌', color:'#6b7280', modes:'both', is_default:1, order:99 },
    ];
    const stmt = _sqliteDb.prepare(
      'INSERT INTO user_categories (name, emoji, color, sort_order, is_default, modes) VALUES (?,?,?,?,?,?)'
    );
    for (const d of defaults) stmt.run([d.name, d.emoji, d.color, d.order, d.is_default, d.modes]);
    stmt.free();
    console.log('[Categories] 기본 카테고리 시드 완료');
  } catch (e) {
    console.warn('[Categories] 시드 실패 (무시):', e.message);
  }
}

/** 기존 항목의 domain 필드 백필 (서버 시작 시 1회) */
function _migrateLegacyDomains() {
  const result = _sqliteDb.exec("SELECT id, data FROM items WHERE category IN ('en','zh','history','economy','youtube','inbox') OR category IS NULL");
  if (!result.length) return;
  let migrated = 0;
  const stmt = _sqliteDb.prepare('UPDATE items SET category=?, data=? WHERE id=?');
  for (const [id, dataStr] of result[0].values) {
    try {
      const item = JSON.parse(dataStr);
      if (item.domain && DOMAINS[item.domain]) continue;  // 이미 마이그레이션됨
      item.domain = CATEGORY_TO_DOMAIN[item.category] || 'business';
      item.shelf  = item.domain;
      stmt.run([item.domain, JSON.stringify(item), id]);
      migrated++;
    } catch {}
  }
  stmt.free();
  if (migrated > 0) console.log(`[Migration] domain 백필 완료: ${migrated}개`);
}

/**
 * 전체 아이템 배열 반환 (createdAt DESC)
 * 기존 코드와 인터페이스 동일
 */
function readDB() {
  const db     = getSQLiteDB();
  const result = db.exec('SELECT data, mode FROM items ORDER BY created_at DESC');
  if (!result.length) return [];
  return result[0].values.map(([data, mode]) => {
    const item = JSON.parse(data);
    item.domain = getDomain(item);           // domain 자동 주입 (구형 항목 호환)
    item.shelf  = item.domain;               // shelf → domain 기반으로 통일
    item.mode   = mode || deriveItemMode(item); // 모드 컬럼 우선, 없으면 추론
    return item;
  });
}

/**
 * 모드별 격리 조회 — 인덱스(idx_items_mode_created) 활용.
 * WHERE mode = ? ORDER BY created_at DESC 로 DB 단계에서 원천 분리.
 */
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

/**
 * 전체 배열을 트랜잭션으로 교체 (배치 작업용)
 * 개별 수정에는 dbInsert / dbUpdate / dbDelete 사용 권장
 */
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

/** 단일 아이템 삽입/교체 */
function dbInsert(item) {
  const db     = getSQLiteDB();
  const domain = getDomain(item);
  item.domain  = domain;
  item.shelf   = domain;
  item.mode    = deriveItemMode(item);   // 모드 강제 적재 (격리 기준)
  const stmt   = db.prepare(
    'INSERT OR REPLACE INTO items (id, category, mode, date, created_at, data) VALUES (?, ?, ?, ?, ?, ?)'
  );
  stmt.run([
    item.id        || uuidv4(),
    domain,                          // category 컬럼을 domain 인덱스로 재활용
    item.mode,
    item.date      || '',
    item.createdAt || new Date().toISOString(),
    JSON.stringify(item)
  ]);
  stmt.free();
  _persistDB();
}

/** 단일 아이템 업데이트 */
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

/** 단일 아이템 삭제 */
function dbDelete(id) {
  const db   = getSQLiteDB();
  const stmt = db.prepare('DELETE FROM items WHERE id=?');
  stmt.run([id]);
  stmt.free();
  _persistDB();
}

// ──────────────────────────────────────────────────
//  Summaries DB (data/summaries.json) — 결산 캐시
//  구조: { "monthly:2026-06": { type, period, stats, aiReview, ... } }
// ──────────────────────────────────────────────────

function readSummaries()       { return readJSON(SUMMARIES_PATH, {}); }
function writeSummaries(data)  { writeJSON(SUMMARIES_PATH, data); }

// ──────────────────────────────────────────────────
//  Daily Feeds DB (data/dailyFeeds.json)
//  구조: { "YYYY-MM-DD": { "subId": { ...feedObject } } }
// ──────────────────────────────────────────────────

function readDailyFeeds() {
  return readJSON(DAILY_FEEDS_PATH, {});
}

function writeDailyFeeds(data) {
  writeJSON(DAILY_FEEDS_PATH, data);
}

function getTodayFeeds(dateStr) {
  const all = readDailyFeeds();
  return all[dateStr] || null;
}

function saveTodayFeed(dateStr, subId, feedObj) {
  const all = readDailyFeeds();
  if (!all[dateStr]) all[dateStr] = {};
  all[dateStr][subId] = feedObj;
  writeDailyFeeds(all);
}

// ──────────────────────────────────────────────────
//  Push 구독 DB (data/push_subscriptions.json)
//  구조: [{ userId, subscription: {endpoint,keys:{p256dh,auth}}, createdAt }]
// ──────────────────────────────────────────────────

function readPushSubs() {
  return readJSON(PUSH_SUBS_PATH, []);
}

function writePushSubs(data) {
  writeJSON(PUSH_SUBS_PATH, data);
}

/**
 * 등록된 모든 구독자에게 Web Push 발송
 * @param {object} payload  { title, body, url, tag }
 */
async function sendPushToAll(payload) {
  const pub  = process.env.PUBLIC_VAPID_KEY;
  const priv = process.env.PRIVATE_VAPID_KEY;
  if (!pub || !priv) {
    console.log('[Push] VAPID 키 없음 — 발송 스킵');
    return { sent: 0, failed: 0 };
  }

  const subs     = readPushSubs();
  if (!subs.length) {
    console.log('[Push] 등록된 구독자 없음');
    return { sent: 0, failed: 0 };
  }

  const message  = JSON.stringify(payload);
  let sent = 0, failed = 0;
  const invalid  = [];

  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub.subscription, message);
      sent++;
      console.log(`[Push] ✅ 발송 성공 → ${sub.subscription.endpoint.slice(-20)}`);
    } catch (e) {
      failed++;
      console.error(`[Push] ✗ 발송 실패 (${e.statusCode}):`, e.message);
      // 410 Gone = 구독 만료 → 삭제 대상
      if (e.statusCode === 410 || e.statusCode === 404) {
        invalid.push(sub.subscription.endpoint);
      }
    }
  }

  // 만료 구독 자동 정리
  if (invalid.length) {
    const cleaned = subs.filter(s => !invalid.includes(s.subscription.endpoint));
    writePushSubs(cleaned);
    console.log(`[Push] 만료 구독 ${invalid.length}개 정리`);
  }

  return { sent, failed };
}

/**
 * 오늘의 피드에서 푸시 알림 카피 추출
 * 가장 임팩트 있는 영어 표현 or 시황 제목을 동적으로 매핑
 */
function buildPushPayload(feeds) {
  const feedArr = Object.values(feeds);

  // 영어 피드에서 첫 번째 표현 추출
  const langFeed = feedArr.find(f => f.type === 'language');
  if (langFeed) {
    const firstExpr = langFeed.vocabEntries?.[0];
    return {
      title: `📚 오늘의 영어: "${firstExpr?.expression || langFeed.title}"`,
      body:  firstExpr
        ? `${firstExpr.meaning} — ${firstExpr.nuance || ''}`
        : langFeed.summary || '영어 표현 배달이 도착했습니다!',
      url:   '/?view=mobile&action=feed',
      tag:   'sj-daily-feed'
    };
  }

  // 시황 피드에서 제목 추출
  const marketFeed = feedArr.find(f => f.type === 'market');
  if (marketFeed) {
    return {
      title: `📈 ${marketFeed.title || '오늘의 시황 배달'}`,
      body:  marketFeed.summary || '오늘의 시황 리포트가 준비됐습니다!',
      url:   '/?view=mobile&action=feed',
      tag:   'sj-daily-feed'
    };
  }

  // 폴백
  return {
    title: '📚 SJ 서재 — 오늘의 지식 배달',
    body:  '아침 지식 배달이 준비됐습니다. 지금 확인해보세요!',
    url:   '/?view=mobile&action=feed',
    tag:   'sj-daily-feed'
  };
}

// ──────────────────────────────────────────────────
//  Users DB (data/users.json)
// ──────────────────────────────────────────────────

const DEFAULT_USER = {
  id: 'sj', name: 'SJ', delivery_time: '07:30',
  timezone: 'Asia/Seoul',
  enabled_feeds: ['en_expr', 'us_market', 'hist_daily', 'idiom_daily', 'liber_classic', 'insight_daily'],
  feed_settings: {
    en_expr:   { count: 10, themes: ['business_meeting', 'office_email'], level: 'advanced' },
    zh_expr:   { count: 7,  themes: ['biz_hsk', 'biz_trip'],             level: 'advanced' },
    us_market: { is_market_centric: false, is_macro_centric: true },
    kr_market: { is_market_centric: true,  is_macro_centric: true }
  }
};

function readUsers() {
  const users = readJSON(USERS_PATH, [DEFAULT_USER]);
  if (!users?.length) return [DEFAULT_USER];
  /* 구버전 users.json 로드 시 빠진 필드 보충 (Render.com 재시작 대비) */
  const u = users[0];
  if (!u.feed_settings) u.feed_settings = { ...DEFAULT_USER.feed_settings };
  if (!u.enabled_feeds?.length || u.enabled_feeds.length < 3) {
    u.enabled_feeds = DEFAULT_USER.enabled_feeds;
  }
  return users;
}

function writeUsers(data) {
  writeJSON(USERS_PATH, data);
}

function getDefaultUser() {
  const users = readUsers();
  return users[0] || null;
}

// ──────────────────────────────────────────────────
//  Subscriptions (data/subscriptions.json)
// ──────────────────────────────────────────────────

function getEnabledSubscriptions(user) {
  const subs      = readJSON(SUBSCRIPTIONS_PATH, []);
  const enabled   = new Set(user.enabled_feeds || []);
  // user.enabled_feeds 가 없으면 subscriptions.json의 enabled 플래그를 따름
  if (!user.enabled_feeds || user.enabled_feeds.length === 0) {
    return subs.filter(s => s.enabled);
  }
  return subs.filter(s => enabled.has(s.id));
}

// ══════════════════════════════════════════════════
//  날짜 헬퍼
// ══════════════════════════════════════════════════

const pad = n => String(n).padStart(2, '0');

function toDateStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function toTimeStr(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function isOlderThanOneDay(createdAt) {
  return Date.now() - new Date(createdAt).getTime() > 24 * 60 * 60 * 1000;
}

/**
 * "HH:MM" 문자열을 분(minutes) 단위로 변환
 */
function timeToMinutes(timeStr) {
  const [h, m] = (timeStr || '07:30').split(':').map(Number);
  return h * 60 + m;
}

/**
 * 현재 시각이 배달 시간 기준 [triggerBefore ~ triggerBefore+30] 분 이전인지 확인
 * @param {string} deliveryTime  "HH:MM"
 * @param {number} triggerBefore 사전 생성할 분 단위 (기본 60분 전)
 */
function isPreGenerationWindow(deliveryTime, triggerBefore = 60) {
  const now       = new Date();
  const nowMins   = now.getHours() * 60 + now.getMinutes();
  const delivMins = timeToMinutes(deliveryTime);
  const windowStart = delivMins - triggerBefore;
  const windowEnd   = windowStart + 30;         // 30분 슬롯 내에 한 번만 생성
  return nowMins >= windowStart && nowMins < windowEnd;
}

// ══════════════════════════════════════════════════
//  Gemini API 래퍼
// ══════════════════════════════════════════════════

/* Gemini 일일 쿼터 소진 시 일정 시간 호출 자체를 스킵 (Claude 직행) */
let geminiCooldownUntil = 0;
const GEMINI_COOLDOWN_MS = 10 * 60 * 1000;  // 10분

async function callGemini(prompt, maxOutputTokens = 4096, retryCount = 0) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[Gemini] GEMINI_API_KEY 미설정 — Mock 데이터로 대체');
    return null;
  }
  if (Date.now() < geminiCooldownUntil) {
    const remainMin = Math.ceil((geminiCooldownUntil - Date.now()) / 60000);
    console.warn(`[Gemini] 쿼터 쿨다운 중 (약 ${remainMin}분 남음) — Claude 직행`);
    return null;
  }

  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const model = genAI.getGenerativeModel({ model: modelName });
    /* 25초 타임아웃 — SDK 자체 타임아웃 없으므로 race 처리 */
    const timeoutP = new Promise((_, rej) =>
      setTimeout(() => rej(new Error('Gemini 응답 타임아웃 (25s)')), 25000)
    );
    const result = await Promise.race([
      model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens, temperature: 0.7 }
      }),
      timeoutP
    ]);
    const finishReason = result.response.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== 'STOP') {
      console.warn('[Gemini] finishReason:', finishReason);
    }
    return result.response.text();
  } catch (e) {
    const msg   = e.message || '';
    const is429 = msg.includes('429') || msg.includes('Too Many Requests');

    /* ★ 일일 쿼터 소진은 기다려도 안 풀림 → 재시도 없이 즉시 Claude 직행 + 10분 쿨다운 */
    const isDailyQuota = is429 && (msg.includes('Quota exceeded') || msg.includes('free_tier') || msg.includes('quota'));
    if (isDailyQuota) {
      geminiCooldownUntil = Date.now() + GEMINI_COOLDOWN_MS;
      console.warn('[Gemini] 일일 쿼터 소진 감지 — 10분간 Gemini 스킵, Claude 백업 직행');
      return null;
    }

    // 분당 Rate limit: 잠시 대기 후 재시도 (최대 2회)
    if (is429 && retryCount < 2) {
      const waitSec = (retryCount + 1) * 15; // 15s, 30s
      console.warn(`[Gemini] 429 Rate limit — ${waitSec}초 대기 후 재시도 (${retryCount + 1}/2)`);
      await new Promise(r => setTimeout(r, waitSec * 1000));
      return callGemini(prompt, maxOutputTokens, retryCount + 1);
    }
    console.error('[Gemini] API 오류:', msg.slice(0, 500));
    return null;
  }
}

// ══════════════════════════════════════════════════
//  Claude API — 피드 생성 전용 래퍼 (Gemini 실패 시 자동 백업)
// ══════════════════════════════════════════════════

/**
 * Claude API를 callGemini와 동일한 인터페이스로 호출한다.
 * 외부 SDK 없이 Node.js 내장 https 모듈만 사용 (추가 의존성 없음).
 * @param {string} prompt
 * @param {number} maxOutputTokens
 * @returns {Promise<string|null>}
 */
async function callClaudeForFeed(prompt, maxOutputTokens = 4096) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[Claude백업] ANTHROPIC_API_KEY 미설정 — 스킵');
    return null;
  }

  const https    = require('https');
  const model    = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';
  const bodyObj  = {
    model,
    max_tokens: Math.min(maxOutputTokens, 8192),
    messages: [{ role: 'user', content: prompt }]
  };
  const body = JSON.stringify(bodyObj);

  console.log(`[Claude백업] 호출 시작 — model: ${model}, maxTokens: ${maxOutputTokens}`);

  return new Promise(resolve => {
    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path:     '/v1/messages',
        method:   'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length':    Buffer.byteLength(body)
        }
      },
      res => {
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(raw);
            // API 오류 응답 처리 (예: 401, 429, 500)
            if (json.error) {
              console.error(`[Claude백업] API 오류 (${json.error.type}): ${json.error.message?.slice(0, 200)}`);
              resolve(null);
              return;
            }
            const text = json.content?.[0]?.text || null;
            if (text) {
              console.log('[Claude백업] ✅ 응답 수신 완료');
            } else {
              console.warn('[Claude백업] 응답 본문 없음:', raw.slice(0, 200));
            }
            resolve(text);
          } catch (e) {
            console.error('[Claude백업] JSON 파싱 오류:', e.message);
            resolve(null);
          }
        });
      }
    );
    req.on('error', e => {
      console.error('[Claude백업] 네트워크 오류:', e.message);
      resolve(null);
    });
    req.setTimeout(60000, () => {
      console.error('[Claude백업] 요청 타임아웃 (60s)');
      req.destroy();
      resolve(null);
    });
    req.write(body);
    req.end();
  });
}

/**
 * ★ AI 통합 호출 함수 — 3단계 자동 전환
 *
 *  [1순위] Google Gemini API
 *    → 실패(null 반환) 시
 *  [2순위] Anthropic Claude API (자동 스위칭)
 *    → 실패(null 반환) 시
 *  [3순위] 각 생성 함수의 Mock 폴백 (기존 로직 유지)
 *
 * callGemini와 동일한 인터페이스: (prompt, maxOutputTokens) → string | null
 */
async function callAI(prompt, maxOutputTokens = 4096) {
  // ── 1순위: Gemini ──
  const geminiResult = await callGemini(prompt, maxOutputTokens);
  if (geminiResult !== null) return geminiResult;

  // ── 2순위: Claude 백업 ──
  console.log('[AI엔진] ⚡ Gemini 실패 → Claude API 백업 전환 🔄');
  const claudeResult = await callClaudeForFeed(prompt, maxOutputTokens);
  if (claudeResult !== null) return claudeResult;

  // ── 3순위: Mock (null 반환 → 각 생성 함수에서 Mock 처리) ──
  console.warn('[AI엔진] ❌ Gemini & Claude 모두 실패 → Mock 데이터로 폴백');
  return null;
}

function fixJsonControlChars(str) {
  // JSON 문자열 내부의 실제 제어 문자(개행·탭 등)를 JSON 이스케이프로 변환
  let result = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const code = str.charCodeAt(i);
    if (escaped) {
      result += ch; escaped = false;
    } else if (ch === '\\' && inString) {
      result += ch; escaped = true;
    } else if (ch === '"') {
      result += ch; inString = !inString;
    } else if (inString && code < 0x20) {
      if      (code === 0x0A) result += '\\n';
      else if (code === 0x0D) result += '\\r';
      else if (code === 0x09) result += '\\t';
      // 그 외 제어문자는 제거
    } else {
      result += ch;
    }
  }
  return result;
}

function safeParseJSON(text) {
  if (!text) return null;
  try {
    // 마크다운 코드블록 제거 (```json, ```text, ``` 등 모두)
    const cleaned = text.replace(/```[a-z]*\s*/gi, '').trim();
    const m = cleaned.match(/[\[{][\s\S]*[\]}]/);
    if (!m) return null;
    const block = m[0];
    // 1차 시도: 그대로 파싱
    try { return JSON.parse(block); } catch {}
    // 2차 시도: 문자열 내 제어문자 이스케이프 후 파싱
    try { return JSON.parse(fixJsonControlChars(block)); } catch {}
    // 3차 시도: 잘못된 역슬래시(LaTeX 등) 정리 후 파싱 — \frac, \sqrt 같은 무효 이스케이프 방어
    return JSON.parse(fixJsonControlChars(sanitizeJsonBackslashes(block)));
  } catch { return null; }
}

/** JSON 문자열 안의 유효하지 않은 역슬래시를 제거/정규화 (모델이 LaTeX를 뱉을 때 파싱 깨짐 방지) */
function sanitizeJsonBackslashes(str) {
  // 유효한 JSON 이스케이프(\" \\ \/ \b \f \n \r \t \uXXXX)가 아닌 역슬래시는 한 칸 띄워 제거
  return str.replace(/\\(?!["\\/bfnrtu])/g, '');
}

// ══════════════════════════════════════════════════
//  피드 콘텐츠 생성 엔진 (구독 타입별)
// ══════════════════════════════════════════════════

// ──────────────────────────────────────────────────
//  요일별 테마 매핑
// ──────────────────────────────────────────────────
const WEEKDAY_THEMES = {
  en: {
    0: '비즈니스 소통 & 피드백',
    1: '비즈니스 미팅 & 회의 진행',
    2: '협상 & 제안 스킬',
    3: '네트워킹 & 관계 구축',
    4: '이메일 & 보고서 작성',
    5: '마케팅 & 프레젠테이션',
    6: '비즈니스 전략 & 리더십'
  },
  zh: {
    0: '비즈니스 관계 & 접대',
    1: '비즈니스 기초 인사 & 소개',
    2: '협상 & 가격 협의',
    3: '회의 진행 & 의견 표현',
    4: '이메일 & 커뮤니케이션',
    5: '비즈니스 성과 & 결론',
    6: '중국 비즈니스 문화 & 에티켓'
  }
};

/**
 * 영어/언어 표현 피드 생성 — 요일별 테마 + 실전 대화문 포함
 */
/* 영어 테마 ID → 한국어 레이블 매핑 */
const EN_THEME_LABELS = {
  business_meeting : '비즈니스 미팅 & 회의 진행',
  office_email     : '이메일 & 보고서 작성',
  daily_travel     : '일상/여행 회화',
  drama_spoken     : '미드 구어체 & 슬랭'
};

/* 중국어 테마 ID → 한국어 레이블 매핑 */
const ZH_THEME_LABELS = {
  biz_hsk     : '비즈니스 HSK 실무 어휘',
  biz_trip    : '중국 출장 & 식사 접대',
  daily_shop  : '일상 회화 & 쇼핑',
  drama_slang : '중드 & 유행어'
};

/**
 * ★ 최근 N일간 배달된 표현/제목 수집 — AI 프롬프트 중복 방지용
 * @param {string} subId      구독 ID (en_expr, hist_daily 등)
 * @param {number} days       조회 기간 (기본 14일)
 * @param {string} field      수집 필드: 'expressions' | 'titles'
 * @returns {string[]}
 */
function getRecentDelivered(subId, days = 14, field = 'expressions') {
  const all     = readDailyFeeds();
  const cutoff  = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = toDateStr(cutoff);

  const collected = [];
  for (const [date, feeds] of Object.entries(all)) {
    if (date < cutoffStr) continue;
    const feed = feeds?.[subId];
    if (!feed) continue;
    if (field === 'expressions' && Array.isArray(feed.vocabEntries)) {
      feed.vocabEntries.forEach(e => { if (e.expression) collected.push(e.expression); });
    } else if (field === 'titles' && feed.title) {
      collected.push(feed.title);
    }
  }
  return [...new Set(collected)];
}

/* ─────────────────────────────────────────────────────────────
 *  Knowledge DB — 사전 생성 JSON 피드 로더 (언어·인문학 비용 0원)
 * ───────────────────────────────────────────────────────────── */
let _kdb = null;

function loadKnowledgeDB() {
  if (_kdb) return _kdb;
  const dbDir = path.join(__dirname, 'data', 'knowledge_db');
  const db = { english_expressions: [], chinese_expressions: [], idioms_and_quotes: [], history_facts: [], english_theme_packs: [] };
  try {
    if (!fs.existsSync(dbDir)) { _kdb = db; return db; }
    const files = fs.readdirSync(dbDir).filter(f => f.endsWith('.json')).sort();
    for (const file of files) {
      try {
        const batch = JSON.parse(fs.readFileSync(path.join(dbDir, file), 'utf8'));
        for (const key of Object.keys(db)) {
          if (Array.isArray(batch[key])) db[key].push(...batch[key]);
        }
      } catch (e) { console.warn(`[KnowledgeDB] ${file} 파싱 실패:`, e.message); }
    }
    console.log(`[KnowledgeDB] 로드 완료 EN:${db.english_expressions.length} ZH:${db.chinese_expressions.length} IQ:${db.idioms_and_quotes.length} HI:${db.history_facts.length}`);
  } catch (e) { console.warn('[KnowledgeDB] 로드 실패:', e.message); }
  _kdb = db;
  return db;
}

function pickUnseenItems(pool, recentIds, count) {
  const unseen = pool.filter(item => !recentIds.includes(item.id));
  const src = unseen.length >= count ? unseen : pool;
  const result = [], available = [...src];
  for (let i = 0; i < Math.min(count, available.length); i++) {
    const idx = Math.floor(Math.random() * available.length);
    result.push(available.splice(idx, 1)[0]);
  }
  return result;
}

function getRecentDeliveredIDs(subId, days = 60) {
  const all = readDailyFeeds();
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = toDateStr(cutoff);
  const ids = [];
  for (const [date, feeds] of Object.entries(all)) {
    if (date < cutoffStr) continue;
    const feed = feeds?.[subId];
    if (!feed) continue;
    if (Array.isArray(feed.vocabEntries)) feed.vocabEntries.forEach(e => { if (e.item_id) ids.push(e.item_id); });
    if (feed.item_id)  ids.push(feed.item_id);
    if (feed.pack_id)  ids.push(feed.pack_id);
  }
  return [...new Set(ids)];
}

/** 오늘 요일 한글 표기 — generateLanguageFeed의 3단계 모두에서 동일하게 사용 */
function _todayDayKr() {
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  return dayNames[new Date().getDay()];
}

/** 언어 피드 Tier 1 — SQLite 영어 테마팩(DB-first, AI 호출 없음, 영어 전용). 없으면 null */
function _tryEnThemePackFeed(sub) {
  const pack = _queryEnThemePack(sub.id);
  if (!pack) return null;
  const { theme, expressions } = pack;
  const dayKr = _todayDayKr();
  const highlights   = JSON.parse(theme.highlights_json || '[]');
  const vocabEntries = expressions.map(e => ({
    item_id:          e.expr_id || String(e.id),
    expression:       e.expression,
    meaning:          e.meaning,
    nuance:           e.nuance_story   || '',
    dialogue:         e.dialogue_en    || '',
    dialogueKo:       e.dialogue_ko    || '',
    sourceSentence:   e.example_en     || '',
    practiceSentence: e.practice_en    || ''
  }));
  console.log(`[SQLite EnTheme] 서빙: ${theme.pack_id} (${theme.theme_title})`);
  return {
    type:          'language',
    category:      'en',
    subCategory:   theme.theme_key   || '',
    label:         sub.label,
    title:         `[${dayKr}] ${theme.theme_title}: ${vocabEntries[0]?.expression} 외 ${vocabEntries.length - 1}개`,
    summary:       `${dayKr}요일 — ${theme.theme_title}`,
    theme:         theme.theme_key   || '',
    themeTitle:    theme.theme_title,
    themeTitleEn:  theme.theme_title_en || '',
    dayOfWeek:     dayKr,
    vocabEntries,
    masterParagraph: {
      text:        theme.master_paragraph_en,
      translation: theme.master_paragraph_ko,
      highlights
    },
    pack_id:       theme.pack_id,
    aiGenerated:   false
  };
}

/* DB 항목 theme(영문) → 사용자 노출용 한글 라벨 (Tier 2 전용) */
const _KNOWLEDGE_DB_THEME_KR = {
  'meeting':'회의·미팅','communication':'커뮤니케이션','workload':'업무·일정','performance':'성과','kickoff':'프로젝트 시작',
  'strategy':'전략','planning':'기획','negotiation':'협상','reporting':'보고','standards':'기준·품질','creativity':'창의력',
  'decision-making':'의사결정','daily-life':'일상 회화','social':'사교·관계','formal':'격식 표현','life-advice':'삶의 지혜',
  'efficiency':'효율','project-management':'프로젝트 관리','critical-thinking':'비판적 사고','analysis':'분석','teamwork':'팀워크',
  'emotion':'감정 표현','praise':'칭찬','relationships':'인간관계','exploration':'탐구','gratitude':'감사','productivity':'생산성',
  'self-reflection':'자기성찰','leadership':'리더십','motivation':'동기부여','self-improvement':'자기계발','progress':'진척'
};

/** 언어 피드 Tier 2 — knowledge_db 시드 풀(DB-first, AI 호출 없음). 미배달분 부족하면 null */
function _tryKnowledgeDbLanguageFeed(sub, langKey, lang, count, level) {
  const kdb  = loadKnowledgeDB();
  const pool = langKey === 'en' ? kdb.english_expressions : kdb.chinese_expressions;
  const lvlPool = level ? pool.filter(i => i.level === level) : pool;
  const srcPool = lvlPool.length >= count ? lvlPool : pool;
  if (srcPool.length < count) return null;

  const recentIds = getRecentDeliveredIDs(sub.id, 14);
  const unseen = srcPool.filter(item => !recentIds.includes(item.id));
  if (unseen.length < count) {
    // 미배달 표현 부족 → AI 생성으로 fallback (반복 방지)
    console.log(`[KnowledgeDB] 미배달 EN 부족(${unseen.length}/${count}) → AI 생성 fallback`);
    return null;
  }

  const items = unseen.sort(() => Math.random() - 0.5).slice(0, count);
  const dayKr = _todayDayKr();
  const theme = items[0]?.theme || (langKey === 'en' ? '비즈니스 영어' : '비즈니스 중국어');
  const themeKr = _KNOWLEDGE_DB_THEME_KR[theme] || (langKey === 'en' ? '실전 영어 표현' : '실전 중국어 표현');
  const vocabEntries = items.map(item => ({
    item_id:          item.id,
    expression:       item.expression,
    meaning:          item.meaning,
    nuance:           item.nuance            || '',
    sourceSentence:   item.source_sentence   || item.sourceSentence   || '',
    practiceSentence: item.practice_sentence || item.practiceSentence || '',
    dialogue:         item.dialogue           || ''
  }));
  console.log(`[KnowledgeDB] 언어피드 DB 서빙 (${sub.id}) ${items.length}개`);
  return {
    type:        'language',
    category:    sub.category || langKey,
    subCategory: theme,
    label:       sub.label,
    title:       `[${dayKr}] ${themeKr}: ${vocabEntries[0]?.expression || '핵심 표현'} 외 ${vocabEntries.length - 1}개`,
    summary:     `${dayKr}요일 — ${themeKr} 핵심 ${lang} 표현 ${vocabEntries.length}선`,
    report:      '',
    theme,
    dayOfWeek:   dayKr,
    vocabEntries,
    aiGenerated: false
  };
}

/** 언어 피드 Tier 3 — AI 생성(Gemini/Claude, 실패 시 mock 폴백). 항상 결과 반환 */
async function _generateAiLanguageFeed(sub, langKey, lang, count, level, feedCfg) {
  const dayKr = _todayDayKr();
  const dow   = new Date().getDay();

  /* 사용자 집중 테마 → 요일 순환, 없으면 기본 요일 테마 */
  const themeLabels = langKey === 'en' ? EN_THEME_LABELS : ZH_THEME_LABELS;
  let theme;
  if (feedCfg.themes && feedCfg.themes.length > 0) {
    const labels = feedCfg.themes.map(t => themeLabels[t]).filter(Boolean);
    theme = labels[dow % labels.length];
  } else {
    theme = WEEKDAY_THEMES[langKey][dow] || sub.topic || `비즈니스 ${lang}`;
  }

  /* 난이도 설명 */
  const levelDesc = level === 'advanced'
    ? '원어민 수준의 고급(Advanced) 뉘앙스 표현 — 관용구·비유적 표현·고급 어휘 중심'
    : '직장인 필수 비즈니스 초중급(Intermediate) 표현 — 실전에서 바로 쓸 수 있는 핵심 어휘';

  const dialogueInstruction = lang === '영어'
    ? `"dialogue": "A: (상황 세팅 1줄)\\nB: (표현 사용 1줄)\\nA: (자연스러운 반응 1줄)"`
    : `"dialogue": "甲: (상황 세팅 1줄)\\n乙: (표현 사용 중국어 1줄)\\n甲: (반응 1줄)\\n[해석: 전체 대화 한국어 번역]"`;

  const prompt = `당신은 성재님의 개인 학습 수석 비서입니다. 바쁜 직장인인 성재님이 아침 5분 안에 오늘의 ${lang} 표현을 완벽히 소화할 수 있도록 엄선합니다.

오늘(${dayKr}요일) 집중 테마: "${theme}"
난이도: ${levelDesc}

다음 JSON 배열만 반환하세요 (마크다운 코드블록 없이):
[
  {
    "expression": "${lang} 표현 원문",
    "meaning": "한국어 뜻 (간결, 10자 이내)",
    "nuance": "뉘앙스 — 한국인이 실수하기 쉬운 포인트 또는 사용 맥락 (1~2문장)",
    "sourceSentence": "실제 비즈니스 현장 예문 (원어, 자연스러운 문장)",
    "practiceSentence": "성재님이 내일 회의/이메일에서 바로 쓸 수 있는 연습 문장",
    ${dialogueInstruction}
  }
]

조건:
- 정확히 ${count}개 표현 생성
- 집중 테마 "${theme}" + 난이도(${level === 'advanced' ? '고급' : '초중급'})에 딱 맞는 실전 표현만 선별
- dialogue는 실제 비즈니스 현장에서 바로 쓸 수 있는 짧은 대화문 (3~4줄)
- practiceSentence는 실제 직장 상황(회의·이메일·보고·협상)에 맞게 구체적으로${(() => {
    /* ★ 최근 14일 배달 표현 중복 금지 */
    const recent = getRecentDelivered(sub.id, 14, 'expressions');
    return recent.length
      ? `\n- ★★ 절대 중복 금지: 아래 표현들은 최근 14일 내 이미 배달되었습니다. 이것들과 같거나 사실상 동일한 표현은 절대 포함하지 마세요. 덜 알려졌지만 실전에서 유용한 새로운 표현을 발굴하세요.\n  [최근 배달됨: ${recent.slice(0, 60).join(', ')}]`
      : '';
  })()}`;

  const raw    = await callAI(prompt, 4000);
  let entries  = safeParseJSON(raw);
  /* AI가 {entries:[...]} 형태로 감싸 반환하는 경우까지 흡수 */
  if (entries && !Array.isArray(entries)) {
    entries = Array.isArray(entries.entries) ? entries.entries
            : Array.isArray(entries.expressions) ? entries.expressions
            : null;
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    entries = generateMockLanguageEntries(theme, count, lang);
  }

  return {
    type:        'language',
    category:    sub.category || 'en',
    subCategory: theme,
    label:       sub.label,
    title:       `[${dayKr}] ${theme}: ${entries[0]?.expression || '핵심 표현'} 외 ${entries.length - 1}개`,
    summary:     `${dayKr}요일 테마 — ${theme} 핵심 ${lang} 표현 ${entries.length}선`,
    report:      '',
    theme,
    dayOfWeek:   dayKr,
    vocabEntries: entries,
    aiGenerated: !!(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY)
  };
}

/**
 * 언어(영어/중국어) 배달 피드 생성 — 3단계 폴백:
 * ① SQLite 테마팩(영어 전용) → ② knowledge_db 시드 풀 → ③ AI 생성(mock 폴백 포함)
 * 앞 단계에서 결과가 나오면 뒤 단계는 실행하지 않음(비용 절감).
 */
async function generateLanguageFeed(sub, user) {
  const lang    = sub.lang || '영어';
  const langKey = lang.includes('중국') ? 'zh' : 'en';

  /* ── 사용자 상세 설정 우선 적용 (영어/중국어 공통) ── */
  const feedSettingKey = langKey === 'en' ? 'en_expr' : 'zh_expr';
  const feedCfg        = user?.feed_settings?.[feedSettingKey] || {};
  const defCount       = langKey === 'zh' ? 5 : 3;
  const count          = feedCfg.count || sub.options?.count || defCount;
  const level          = feedCfg.level || '';

  if (langKey === 'en') {
    const packFeed = _tryEnThemePackFeed(sub);
    if (packFeed) return packFeed;
  }

  const dbFeed = _tryKnowledgeDbLanguageFeed(sub, langKey, lang, count, level);
  if (dbFeed) return dbFeed;

  return _generateAiLanguageFeed(sub, langKey, lang, count, level, feedCfg);
}

// ══════════════════════════════════════════════════
//  실시간 시장 지표 — Yahoo Finance 비공식 chart API (키 불필요, 무료)
//  마감 전이면 현재가(장중 실시간), 마감 후면 종가를 그대로 반환.
//  regularMarketTime(마지막 갱신 시각)이 정규장 종료(regular.end) 이후면 "마감"으로 판정.
// ══════════════════════════════════════════════════
const YAHOO_SYMBOLS = {
  us: [
    { sym: '^GSPC', name: 'S&P 500' },
    { sym: '^IXIC', name: '나스닥' },
    { sym: '^DJI',  name: '다우 지수' },
    { sym: '^TNX',  name: '미 국채 10년물', isYield: true },
    { sym: '^VIX',  name: 'VIX 공포지수' },
  ],
  kr: [
    { sym: '^KS11', name: '코스피' },
    { sym: '^KQ11', name: '코스닥' },
    { sym: 'KRW=X', name: '원/달러', isKrw: true },
  ],
};

async function fetchYahooQuote(symbol, timeoutMs = 8000) {
  /* range=1d일 때 meta.chartPreviousClose가 당일가와 거의 같은 값으로 나오는
     경우가 있어(관찰됨) range=5d로 받아 종가 배열에서 직접 전일 종가를 계산 */
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data   = await res.json();
    const result = data?.chart?.result?.[0];
    const meta   = result?.meta;
    if (!meta || meta.regularMarketPrice == null) throw new Error('데이터 없음');

    const price = meta.regularMarketPrice;
    /* 전일 종가 — 종가 배열의 마지막(오늘/최근 세션) 바로 이전 유효값을 직접 사용
       (meta.chartPreviousClose는 range 값에 따라 신뢰도가 떨어지는 경우가 있어 배제) */
    const closes    = (result?.indicators?.quote?.[0]?.close || []).filter(c => c != null);
    const prev      = closes.length >= 2 ? closes[closes.length - 2] : (meta.chartPreviousClose ?? null);
    const asOf      = meta.regularMarketTime || null;
    const closeAt   = meta.currentTradingPeriod?.regular?.end || null;
    const isClosed  = (asOf && closeAt) ? asOf >= closeAt : null;
    const changeAbs = prev != null ? price - prev : null;
    const changePct = prev ? (changeAbs / prev) * 100 : null;
    return { symbol, price, prev, asOf, isClosed, changeAbs, changePct };
  } finally {
    clearTimeout(timer);
  }
}

/** isUS 시장의 실시간 지표 스냅샷. 전부 실패하면 null(호출부가 LLM 추정치로 폴백). */
async function fetchMarketSnapshot(isUS) {
  const list    = isUS ? YAHOO_SYMBOLS.us : YAHOO_SYMBOLS.kr;
  const results = await Promise.allSettled(list.map(s => fetchYahooQuote(s.sym)));

  const indicators = [];
  let asOfTime = null, isClosed = null, failCount = 0;

  results.forEach((r, i) => {
    const meta = list[i];
    if (r.status !== 'fulfilled') { failCount++; console.warn(`[시황] ${meta.sym} 조회 실패:`, r.reason?.message); return; }
    const q   = r.value;
    const dir = (q.changeAbs ?? 0) >= 0 ? 'up' : 'down';
    let value, change;
    if (meta.isYield) {
      value  = `${q.price.toFixed(2)}%`;
      change = `${q.changeAbs >= 0 ? '+' : ''}${Math.round((q.changeAbs || 0) * 100)}bp`;
    } else if (meta.isKrw) {
      value  = `${Math.round(q.price)}`;
      change = `${q.changeAbs >= 0 ? '+' : ''}${Math.round(q.changeAbs || 0)}원`;
    } else {
      value  = q.price.toLocaleString('en-US', { maximumFractionDigits: 2 });
      change = `${q.changePct >= 0 ? '+' : ''}${(q.changePct || 0).toFixed(2)}%`;
    }
    indicators.push({ name: meta.name, value, change, dir });
    if (q.asOf && (!asOfTime || q.asOf > asOfTime)) asOfTime = q.asOf;
    if (isClosed === null) isClosed = q.isClosed;
  });

  if (!indicators.length) return null;
  return { indicators, asOfTime, isClosed, partial: failCount > 0 };
}

/**
 * 시황/경제 리포트 피드 생성 — 증시 지표 배너 + 3줄 요약 + 체크포인트 포함
 */
async function generateMarketFeed(sub, user) {
  const topic = sub.topic || '증시 전반';
  const isUS  = sub.id === 'us_market';

  /* 실시간 지표 스냅샷 우선 조회(Yahoo Finance, 키 불필요) — 실패 시 아래에서 LLM 추정치로 폴백 */
  let snapshot = null;
  try { snapshot = await fetchMarketSnapshot(isUS); }
  catch (e) { console.warn('[시황] 실시간 지표 조회 예외:', e.message); }

  /* 실시간 데이터가 있으면 프롬프트에 "이 숫자 그대로 써라"로 주입, 없으면 기존 placeholder 폴백 */
  const indicatorSpec = snapshot
    ? `"indicators": ${JSON.stringify(snapshot.indicators)}`
    : isUS
    ? `"indicators": [
        {"name":"S&P 500","value":"XXXX.XX","change":"+X.XX%","dir":"up|down"},
        {"name":"나스닥","value":"XXXXX.XX","change":"+X.XX%","dir":"up|down"},
        {"name":"다우 지수","value":"XXXXX","change":"+X.XX%","dir":"up|down"},
        {"name":"미 국채 10년물","value":"X.XX%","change":"+X bp","dir":"up|down"},
        {"name":"VIX 공포지수","value":"XX.X","change":"-X.X","dir":"up|down"}
      ]`
    : `"indicators": [
        {"name":"코스피","value":"XXXX.XX","change":"+X.XX%","dir":"up|down"},
        {"name":"코스닥","value":"XXX.XX","change":"+X.XX%","dir":"up|down"},
        {"name":"원/달러","value":"XXXX","change":"+XX원","dir":"up|down"}
      ]`;

  const realDataNote = snapshot
    ? `\n[실제 시장 데이터 — 아래 수치는 방금 조회한 실제 값입니다. indicators 항목은 절대 다른 숫자로 바꾸지 말고 그대로 사용하세요]\n` +
      snapshot.indicators.map(i => `- ${i.name}: ${i.value} (${i.dir === 'up' ? '+' : ''}${i.change})`).join('\n') +
      (snapshot.isClosed === true ? '\n(정규장 마감 기준 종가입니다)'
        : snapshot.isClosed === false ? '\n(정규장 진행 중 — 마감 전 실시간 값입니다. "마감가"라고 표현하지 말고 "현재까지"로 서술하세요)'
        : '')
    : '';

  /* ── 사용자 시황 분석 집중도 설정 ── */
  const marketCfg       = user?.feed_settings?.[sub.id] || {};
  const isMarketCentric = marketCfg.is_market_centric !== false;  /* 기본 true */
  const isMacroCentric  = marketCfg.is_macro_centric  !== false;  /* 기본 true */

  /* 분석 방향 지시문 생성 */
  let focusInstruction;
  if (isMarketCentric && isMacroCentric) {
    focusInstruction =
      `분석 방향: 주요 지수·종목 데이터(증시 중심)와 연준 금리·환율·지정학적 리스크 등 ` +
      `거시경제(Macro) 흐름을 결합한 종합 리포트를 작성하세요.`;
  } else if (isMarketCentric) {
    focusInstruction =
      `분석 방향: 증시 애널리스트 관점에서 주요 지수(${isUS ? 'S&P500, 나스닥, 다우' : '코스피, 코스닥'}), ` +
      `등락률, 주요 섹터·종목 움직임 위주의 드라이한 데이터 중심 요약을 작성하세요. ` +
      `거시경제 서사보다 숫자와 지표에 집중하세요.`;
  } else if (isMacroCentric) {
    focusInstruction =
      `분석 방향: 거시경제 이코노미스트 관점에서 ${isUS ? '미 연준(Fed) 금리 전망, 달러 인덱스' : '한국은행 기준금리, 원/달러 환율'}, ` +
      `유가, 채권 수익률 곡선, 지정학적 리스크 등 글로벌 경제 흐름을 깊이 있는 서사형으로 분석하세요. ` +
      `지수 숫자보다 경제 흐름의 이야기에 집중하세요.`;
  } else {
    focusInstruction = `분석 방향: 시장 전반의 핵심 흐름을 균형 있게 요약하세요.`;
  }

  // ※ 날짜를 넣지 않음 — 미래 날짜를 감지한 Gemini가 거부 JSON을 생성하는 현상 방지
  const prompt = `당신은 성재님의 개인 경제·투자 학습 비서입니다.
바쁜 직장인인 성재님이 2분 안에 ${isUS ? '미국' : '한국'} 시장 핵심을 파악하고 경제 공부를 할 수 있는 학습 리포트를 만들어 주세요.

[맥락] 분석 주제: ${topic} / 교육용 콘텐츠 (실제 투자 조언 아님)
[${focusInstruction}]
${realDataNote}

다음 JSON 형식으로만 응답하세요 (순수 JSON, 마크다운 코드블록 없이):
{
  "title": "${isUS ? '미국' : '한국'} 시황 분석 제목 (20자 이내, 핵심 흐름 키워드)",
  "summary": "한 줄 시장 흐름 요약 (직장인이 1문장으로 파악 가능하게)",
  ${indicatorSpec},
  "summary3": "• 최근 시장 핵심 흐름 1줄\\n• 주목할 섹터 또는 이슈 1줄\\n• 투자자 포지셔닝 인사이트 1줄",
  "checkpoints": [
    "체크포인트 1: 확인해야 할 지표나 이벤트 (구체적)",
    "체크포인트 2",
    "체크포인트 3"
  ],
  "report": "## 시장 흐름\\n상세 분석 (150자)\\n\\n## 투자 인사이트\\n실전 포인트 (150자)",
  "aiEconomicKnowledge": [
    {"term": "핵심 경제 용어 1", "importance": "이 용어의 중요성 (2문장, 구체적 수치 포함)", "connection": "실생활 연결 고리"},
    {"term": "핵심 경제 용어 2", "importance": "이 용어의 중요성 (2문장)", "connection": "실생활 연결 고리"},
    {"term": "핵심 경제 용어 3", "importance": "이 용어의 중요성 (2문장)", "connection": "실생활 연결 고리"}
  ]
}

규칙:
${snapshot ? '- indicators는 위 [실제 시장 데이터]를 절대 변경하지 말고 그대로 옮기세요' : '- indicators 값은 학습 데이터 기준 대표적 수치 사용 (교육 목적 추정치, 실시간 아님)'}
- dir은 반드시 "up" 또는 "down"만 사용
- aiEconomicKnowledge는 반드시 3개
- summary3 각 줄은 반드시 "• "로 시작
- checkpoints는 반드시 3개
- 거부 메시지, 설명 텍스트, 마크다운 블록 없이 순수 JSON만 응답`;

  const raw    = await callAI(prompt, 4096);
  // ── 거부/오류성 응답 감지 → mock으로 강제 전환 ──
  const rawParsed = safeParseJSON(raw);
  const isRefusalResponse = rawParsed && (
    !rawParsed.indicators ||
    (rawParsed.title || '').match(/API|설정|미설정|오류|불가|없음|접근|제공/i) ||
    (rawParsed.summary || '').match(/API|GEMINI_API_KEY|설정하면|실시간.*불가/i)
  );
  const parsed = (!rawParsed || isRefusalResponse)
    ? generateMockMarketReport(sub, topic, isUS)
    : rawParsed;

  /* 실시간 데이터가 있으면 LLM이 숫자를 바꿔 적었더라도 실제 조회값으로 강제 덮어씀
     — 정확도가 LLM 순응 여부에 좌우되지 않게 함 */
  const finalIndicators = snapshot ? snapshot.indicators : (parsed.indicators || []);

  return {
    type:               'market',
    category:           sub.category || 'economy',
    subCategory:        topic,
    label:              sub.label,
    title:              parsed.title       || `${isUS ? '미국' : '한국'} 시황`,
    summary:            parsed.summary     || '',
    indicators:         finalIndicators,
    summary3:           parsed.summary3    || '',
    checkpoints:        parsed.checkpoints || [],
    report:             parsed.report      || '',
    aiEconomicKnowledge: parsed.aiEconomicKnowledge || [],
    aiGenerated:        !!(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY),
    /* 실시간 데이터 메타 — 클라이언트가 "장중/마감" 배지 표시에 사용 */
    isLive:             !!snapshot,
    marketClosed:       snapshot ? snapshot.isClosed : null,
    dataAsOf:           snapshot?.asOfTime ? new Date(snapshot.asOfTime * 1000).toISOString() : null
  };
}

// ══════════════════════════════════════════════════
//  ★ 인문학 피드 생성 엔진 (역사 / 명언 / 고사성어) — v27
// ══════════════════════════════════════════════════

/**
 * 역사 지식 한줌 피드 생성
 * user.feed_settings.hist_daily.era: '한국사' | '세계사' | '상관없음'
 */
/* 역사: 주제 영역 회전 풀 */
const HISTORY_ANGLES = [
  '경제·화폐·무역의 역사',
  '의학·전염병·과학 발견의 순간',
  '외교·협상·동맹의 뒷이야기',
  '발명·기술이 바꾼 일상',
  '실패한 개혁·반면교사의 역사',
  '무명의 영웅·재평가된 인물',
  '음식·기호품이 움직인 역사',
  '정보전·첩보·암호의 역사',
  '법·제도·재판의 결정적 장면',
  '예술·문화가 정치를 바꾼 순간'
];

async function generateHistoryFeed(sub, user) {
  const cfg = user?.feed_settings?.['hist_daily'] || {};
  const era = cfg.era || '상관없음';

  const eraInstruction = era === '한국사'
    ? '반드시 한반도·한국사(고조선부터 현대까지) 사건·인물·흐름에서 주제를 선택하세요.'
    : era === '세계사'
    ? '반드시 세계사(한국 제외 전세계) 사건·인물·흐름에서 주제를 선택하세요.'
    : '한국사와 세계사 중 오늘에 가장 흥미롭고 임팩트 있는 주제를 자유롭게 선택하세요.';

  const angle = HISTORY_ANGLES[dayOfYearIndex() % HISTORY_ANGLES.length];

  const prompt = `당신은 성재님의 역사 학습 수석 비서입니다. 바쁜 직장인인 성재님이 아침 2분 만에 흥미로운 역사 사실을 소화할 수 있도록 엄선합니다.

${eraInstruction}
★ 오늘의 관점 (반드시 이 각도에서 주제 선택): ${angle}
★ 교과서 단골(세종대왕 한글 창제, 이순신 명량, 링컨 암살 등 누구나 아는 이야기)은 피하고, 역사 애호가도 "처음 듣는다"고 할 이야기를 발굴하세요.

다음 JSON 형식으로만 응답하세요 (순수 JSON, 마크다운 코드블록 없이):
{
  "title": "역사 사건·인물·흐름 제목 (20자 이내, 임팩트 있게)",
  "era": "한국사 또는 세계사 (두 단어 중 하나)",
  "period": "구체적 시대 (예: 조선 중기, 1차 세계대전, 르네상스)",
  "summary": "핵심 한 줄 요약 (30자 이내)",
  "summary3": "• 핵심 사실 1줄\\n• 핵심 사실 2줄\\n• 핵심 사실 3줄",
  "behindStory": "교과서에 없는 뒷이야기 또는 의외의 반전 사실 (2~3문장, 구체적으로)",
  "lesson": "이 역사에서 오늘날 직장인 성재님이 배울 수 있는 현대적 교훈 (1문장)"
}

규칙:
- summary3 각 줄은 반드시 "• "로 시작
- behindStory는 교과서에 없는 흥미로운 뒷이야기 — 구체적 숫자·이름·일화 포함
- lesson은 현대 직장 생활·비즈니스에 연결되는 실용적 교훈
- 거부 메시지, 설명 텍스트, 마크다운 블록 없이 순수 JSON만 응답${(() => {
    const recent = getRecentDelivered(sub.id, 14, 'titles');
    return recent.length
      ? `\n- ★★ 절대 중복 금지: 최근 14일 내 이미 다룬 주제 [${recent.slice(0, 20).join(' / ')}] 와 같거나 비슷한 주제는 피하고 완전히 새로운 주제를 선택하세요.`
      : '';
  })()}`;

  const raw    = await callAI(prompt, 2000);
  const parsed = safeParseJSON(raw);

  if (!parsed || !parsed.title) {
    console.warn('[인문학/역사] AI 파싱 실패 — Mock 대체');
    return generateMockHistoryFeed(era);
  }

  return {
    type:        'humanities',
    subType:     'history',
    subId:       sub.id,
    label:       sub.label,
    category:    'history',
    era:         parsed.era    || era,
    period:      parsed.period || '',
    title:       parsed.title  || '오늘의 역사',
    summary:     parsed.summary   || '',
    summary3:    parsed.summary3  || '',
    behindStory: parsed.behindStory || '',
    lesson:      parsed.lesson     || '',
    aiGenerated: !!(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY)
  };
}

/* ── 날짜 기반 결정적 회전 인덱스 (이력이 없어도 날마다 다른 영역 보장) ── */
function dayOfYearIndex() {
  const now   = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now - start) / 86400000);
}

/* 명언: 명사 분야 회전 풀 */
const QUOTE_DOMAINS = [
  '고대 그리스·로마 철학자 (소크라테스·마르쿠스 아우렐리우스·에픽테토스 등)',
  '동양 사상가 (공자·노자·장자·맹자·순자 등)',
  '20세기 과학자 (아인슈타인·파인만·퀴리·보어·튜링 등)',
  '예술가·음악가 (화가, 작곡가, 건축가)',
  '문학가·소설가 (한국·일본·유럽·남미 작가 골고루)',
  '기업가·혁신가 (잡스·머스크·게이츠·베조스 등 포함)',
  '역사 속 정치가·장군 (처칠·링컨·나폴레옹·간디·만델라 등)',
  '심리학자·사회학자 (프로이트·아들러·융·프랭클·매슬로 등)',
  '탐험가·모험가·스포츠인',
  '여성 선구자 (과학·예술·인권 분야)',
  'SNS·자기계발 명언 단골 (니체·에디슨·처칠 등 가장 유명한 명언 중 핵심 한 편)'
];

/**
 * 오늘의 명언 피드 생성
 */
async function generateQuoteFeed(sub) {
  const domain = QUOTE_DOMAINS[dayOfYearIndex() % QUOTE_DOMAINS.length];

  const prompt = `당신은 성재님의 인문학 학습 수석 비서입니다. 오늘 성재님의 하루를 풍요롭게 만들 명언을 엄선합니다.

★ 오늘의 명사 분야 (반드시 이 분야에서 선택): ${domain}

다음 JSON 형식으로만 응답하세요 (순수 JSON, 마크다운 코드블록 없이):
{
  "quote": "원문 명언 (영어·독일어·프랑스어·라틴어 등 원어 그대로)",
  "quoteKo": "자연스러운 한국어 번역",
  "author": "명사 이름 (한국어 표기)",
  "authorInfo": "소개 1문장 (생몰 연도 + 직업/분야 포함)",
  "context": "이 명언이 나온 맥락·상황 (1~2문장)",
  "behindStory": "일반인이 잘 모르는 이 명언의 탄생 배경 또는 명사의 삶에서 나온 흥미로운 에피소드 (2~3문장)",
  "application": "오늘 성재님이 직장 생활이나 자기계발에 바로 적용할 수 있는 방법 (1문장)"
}

규칙:
- 오늘의 분야에 딱 맞는 명언을 선별 — 진부해도 좋으니 분야를 지켜주세요
- behindStory는 교과서에 없는 흥미로운 배경 이야기 (구체적 에피소드 포함)
- application은 직장/자기계발에 연결되는 실용적 방법
- 거부 메시지, 마크다운 없이 순수 JSON만 응답${(() => {
    const recent = getRecentDelivered(sub.id, 14, 'titles');
    return recent.length
      ? `\n- ★★ 최근 배달분 중복 금지: [${recent.slice(0, 20).join(' / ')}] 과 같은 명언·같은 명사의 유사 명언은 피하세요.`
      : '';
  })()}`;

  const raw    = await callAI(prompt, 1500);
  const parsed = safeParseJSON(raw);

  if (!parsed || !parsed.quote) {
    console.warn('[인문학/명언] AI 파싱 실패 — Mock 대체');
    return generateMockQuoteFeed(sub);
  }

  const titlePreview = (parsed.quoteKo || parsed.quote).slice(0, 28);
  return {
    type:        'humanities',
    subType:     'quote',
    subId:       sub.id,
    label:       sub.label,
    category:    'inbox',
    title:       `"${titlePreview}…" — ${parsed.author || ''}`,
    quote:       parsed.quote       || '',
    quoteKo:     parsed.quoteKo     || '',
    author:      parsed.author      || '',
    authorInfo:  parsed.authorInfo  || '',
    context:     parsed.context     || '',
    behindStory: parsed.behindStory || '',
    application: parsed.application || '',
    aiGenerated: !!(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY)
  };
}

/* 고사성어: 주제 영역 회전 풀 */
const IDIOM_THEMES = [
  '처세·인간관계의 지혜',
  '리더십·통솔의 도',
  '인내·끈기·역경 극복',
  '전략·승부·판단력',
  '배움·성장·자기수양',
  '말과 신뢰·약속',
  '겸손·자만 경계',
  '우정·의리·사람 보는 눈',
  '변화·혁신·시대 읽기',
  '부귀·욕심·만족의 철학',
  '교과서 단골 고사성어 (새옹지마·온고지신·대기만성·청출어람 등 가장 유명한 것 중 하나)'
];

/**
 * 오늘의 고사성어 피드 생성
 */
async function generateIdiomFeed(sub) {
  const theme = IDIOM_THEMES[dayOfYearIndex() % IDIOM_THEMES.length];

  const prompt = `당신은 성재님의 인문학 학습 수석 비서입니다. 오늘 성재님이 마음에 새길 고사성어 한 편을 엄선합니다.

★ 오늘의 주제 영역 (반드시 이 주제에 맞는 고사성어 선택): ${theme}

다음 JSON 형식으로만 응답하세요 (순수 JSON, 마크다운 코드블록 없이):
{
  "idiom": "고사성어 한글 독음 (예: 새옹지마)",
  "hanja": "한자 표기 (예: 塞翁之馬)",
  "meaning": "뜻 풀이 한 문장 (쉽고 명확하게)",
  "origin": "출처: 어느 고전(사기, 논어, 맹자 등)에서 비롯됐는지",
  "story": "유래 설화 또는 원전 맥락 요약 (2~3문장, 구체적 인물·상황 포함)",
  "behindStory": "교과서에 없는 이 고사성어의 탄생 배경 또는 원전의 흥미로운 맥락 (2~3문장)",
  "application": "오늘 성재님의 직장·인간관계에서 쓸 수 있는 상황 (1문장, '예: ～할 때 …' 형식)"
}

규칙:
- 오늘의 주제에 딱 맞는 고사성어 선별 (단, 한자 독음이 명확한 것)
- story는 구체적인 인물·국가·시대 묘사 포함
- behindStory는 원전에서 잘 드러나지 않는 흥미로운 뒷이야기
- 거부 메시지, 마크다운 없이 순수 JSON만 응답${(() => {
    const recent = getRecentDelivered(sub.id, 14, 'titles');
    return recent.length
      ? `\n- ★★ 최근 배달분 중복 금지: [${recent.slice(0, 20).join(' / ')}] 와 같은 것은 절대 선택하지 마세요.`
      : '';
  })()}`;

  const raw    = await callAI(prompt, 1500);
  const parsed = safeParseJSON(raw);

  if (!parsed || !parsed.idiom) {
    console.warn('[인문학/고사성어] AI 파싱 실패 — Mock 대체');
    return generateMockIdiomFeed(sub);
  }

  return {
    type:        'humanities',
    subType:     'idiom',
    subId:       sub.id,
    label:       sub.label,
    category:    'history',
    title:       `${parsed.idiom || ''} (${parsed.hanja || ''})`,
    idiom:       parsed.idiom       || '',
    hanja:       parsed.hanja       || '',
    meaning:     parsed.meaning     || '',
    origin:      parsed.origin      || '',
    story:       parsed.story       || '',
    behindStory: parsed.behindStory || '',
    application: parsed.application || '',
    aiGenerated: !!(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY)
  };
}

/* ══════════════════════════════════════════════════════════
   직장인 전용 콘텐츠 (work_db) — 고전 LIBER / 인사이트 / 고사성어
   public/data/work_db/*.json → 메모리 캐시 → 배달 회전 서빙 (AI 호출 0원)
   ⚠️ 직장인(PROFESSIONAL) 전용. 수험생(exam_db) 경로와 완전 분리.
══════════════════════════════════════════════════════════ */
let _wdb = null;
function loadWorkDB() {
  if (_wdb) return _wdb;
  const dir = path.join(__dirname, 'data', 'work_db');
  const db  = { classic_quotes: [], idiom_cards: [], daily_insights: [] };
  try {
    if (fs.existsSync(dir)) {
      for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
        try {
          const batch = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
          for (const key of Object.keys(db)) if (Array.isArray(batch[key])) db[key].push(...batch[key]);
        } catch (e) { console.warn(`[WorkDB] ${file} 파싱 실패:`, e.message); }
      }
    }
    console.log(`[WorkDB] 로드 CLQ:${db.classic_quotes.length} IDC:${db.idiom_cards.length} INS:${db.daily_insights.length}`);
  } catch (e) { console.warn('[WorkDB] 로드 실패:', e.message); }
  _wdb = db;
  return db;
}

/* 고전 구절(LIBER) 피드 — 미배달 우선 회전 */
function generateLiberFeed(sub) {
  const pool = loadWorkDB().classic_quotes;
  if (!pool.length) return null;
  const [q] = pickUnseenItems(pool, getRecentDeliveredIDs(sub.id, 90), 1);
  if (!q) return null;
  console.log(`[WorkDB] LIBER 서빙 (${q.id} · ${q.book})`);
  return {
    type: 'humanities', subType: 'liber', subId: sub.id, label: sub.label, category: 'inbox',
    item_id: q.id, title: `${q.book} — ${q.author}`,
    book: q.book, author: q.author, era: q.era || '', quote: q.quote || '',
    source: q.source || '', theme: q.theme || '', context: q.context || '',
    tags: q.tags || [], aiGenerated: false,
  };
}

/* 오늘의 인사이트 피드 — 요일 카테고리 우선, 없으면 전체에서 미배달 회전 */
function generateInsightFeed(sub) {
  const all = loadWorkDB().daily_insights;
  if (!all.length) return null;
  const dow  = new Date().getDay();
  const seen = getRecentDeliveredIDs(sub.id, 60);
  let pool = all.filter(i => i.dayOfWeek === dow);
  if (!pool.length) pool = all;
  let [it] = pickUnseenItems(pool, seen, 1);
  if (!it) [it] = pickUnseenItems(all, seen, 1);
  if (!it) return null;
  console.log(`[WorkDB] 인사이트 서빙 (${it.id} · ${it.topic})`);
  return {
    type: 'humanities', subType: 'insight', subId: sub.id, label: sub.label, category: 'inbox',
    item_id: it.id, title: `${it.label} — ${it.topic}`,
    topic: it.topic, headline: it.headline || '', body: it.body || '', realLife: it.realLife || '',
    question: it.question || '', tags: it.tags || [], icon: it.icon || '💡', color: it.color || '#7c3aed',
    subCategory: it.subCategory || '', aiGenerated: false,
  };
}

/* 고사성어 피드 (work_db DB-first) — 기존 프론트 idiom 카드 필드로 매핑 */
function generateIdiomFeedDB(sub) {
  const pool = loadWorkDB().idiom_cards;
  if (!pool.length) return null;
  const [c] = pickUnseenItems(pool, getRecentDeliveredIDs(sub.id, 90), 1);
  if (!c) return null;
  console.log(`[WorkDB] 고사성어 서빙 (${c.id} · ${c.idiom})`);
  return {
    type: 'humanities', subType: 'idiom', subId: sub.id, label: sub.label, category: 'history',
    item_id: c.id, title: `${c.idiom || ''} (${c.hanja || ''})`,
    idiom: c.idiom || '', hanja: c.hanja || '', meaning: c.meaning || '',
    origin: c.origin || '', story: c.example || '', behindStory: '',
    application: c.modernUse || '', aiGenerated: false,
  };
}

/**
 * 인문학 피드 타입 디스패처 (역사 / 명언 / 고사성어 / 고전 / 인사이트)
 * DB-First: knowledge_db·work_db에 항목이 있으면 AI 호출 없이 즉시 반환 (비용 0원)
 * DB 항목 부족 시 기존 AI 생성 함수로 폴백
 */
async function generateHumanitiesFeed(sub, user) {
  const subType = sub.subType || '';
  const kdb     = loadKnowledgeDB();

  /* ── 고전 LIBER (work_db) ── */
  if (subType === 'liber' || sub.id === 'liber_classic') {
    const feed = generateLiberFeed(sub);
    if (feed) return feed;
  }
  /* ── 오늘의 인사이트 (work_db) ── */
  if (subType === 'insight' || sub.id === 'insight_daily') {
    const feed = generateInsightFeed(sub);
    if (feed) return feed;
  }
  /* ── 고사성어 work_db DB-first (없으면 아래 기존 AI 경로로 폴백) ── */
  if (subType === 'idiom' || sub.id === 'idiom_daily') {
    const feed = generateIdiomFeedDB(sub);
    if (feed) return feed;
  }

  /* ── 역사 피드 ── */
  if (subType === 'history' || sub.id === 'hist_daily') {
    const cfg       = user?.feed_settings?.['hist_daily'] || {};
    const eraFilter = cfg.era || '상관없음';
    let pool = kdb.history_facts;
    if (eraFilter !== '상관없음') {
      const filtered = pool.filter(i => i.era === eraFilter);
      if (filtered.length > 0) pool = filtered;
    }
    if (pool.length > 0) {
      const recentIds = getRecentDeliveredIDs(sub.id, 60);
      const [item]    = pickUnseenItems(pool, recentIds, 1);
      if (item) {
        console.log(`[KnowledgeDB] 역사피드 DB 서빙 (${item.id})`);
        return {
          type:        'humanities',
          subType:     'history',
          subId:       sub.id,
          label:       sub.label,
          category:    'history',
          item_id:     item.id,
          era:         item.era          || '세계사',
          period:      item.period       || '',
          title:       item.title        || '오늘의 역사',
          summary:     item.summary      || '',
          summary3:    item.summary3     || '',
          behindStory: item.behind_story || '',
          lesson:      item.lesson       || '',
          aiGenerated: false
        };
      }
    }
    return generateHistoryFeed(sub, user);
  }

  /* ── 명언 피드 ── */
  if (subType === 'quote' || sub.id === 'quote_daily') {
    const pool = kdb.idioms_and_quotes.filter(i => i.type === 'quote');
    if (pool.length > 0) {
      const recentIds = getRecentDeliveredIDs(sub.id, 60);
      const [item]    = pickUnseenItems(pool, recentIds, 1);
      if (item) {
        console.log(`[KnowledgeDB] 명언피드 DB 서빙 (${item.id})`);
        const titlePreview = (item.quote_ko || item.quote || '').slice(0, 28);
        return {
          type:        'humanities',
          subType:     'quote',
          subId:       sub.id,
          label:       sub.label,
          category:    'inbox',
          item_id:     item.id,
          title:       `"${titlePreview}…" — ${item.author || ''}`,
          quote:       item.quote        || '',
          quoteKo:     item.quote_ko     || '',
          author:      item.author       || '',
          authorInfo:  item.author_info  || '',
          context:     item.context      || '',
          behindStory: item.behind_story || '',
          application: item.application  || '',
          aiGenerated: false
        };
      }
    }
    return generateQuoteFeed(sub);
  }

  /* ── 고사성어 피드 ── */
  if (subType === 'idiom' || sub.id === 'idiom_daily') {
    const pool = kdb.idioms_and_quotes.filter(i => i.type === 'idiom');
    if (pool.length > 0) {
      const recentIds = getRecentDeliveredIDs(sub.id, 60);
      const [item]    = pickUnseenItems(pool, recentIds, 1);
      if (item) {
        console.log(`[KnowledgeDB] 고사성어피드 DB 서빙 (${item.id})`);
        return {
          type:        'humanities',
          subType:     'idiom',
          subId:       sub.id,
          label:       sub.label,
          category:    'history',
          item_id:     item.id,
          title:       `${item.idiom || ''} (${item.hanja || ''})`,
          idiom:       item.idiom        || '',
          hanja:       item.hanja        || '',
          meaning:     item.meaning      || '',
          origin:      item.origin       || '',
          story:       item.story        || '',
          behindStory: item.behind_story || '',
          application: item.application  || '',
          aiGenerated: false
        };
      }
    }
    return generateIdiomFeed(sub);
  }

  // 알 수 없는 인문학 서브타입 → 기본 반환
  return {
    type: 'humanities', subType: 'unknown', subId: sub.id,
    label: sub.label, title: sub.label,
    summary: '준비 중입니다.', aiGenerated: false
  };
}

// ──────────────────────────────────────────────────
//  인문학 Mock 폴백 (Gemini API 키 없을 때)
// ──────────────────────────────────────────────────

function generateMockHistoryFeed(era) {
  return {
    type: 'humanities', subType: 'history', subId: 'hist_daily',
    label: '역사 지식 한줌', category: 'history',
    era: (era === '세계사') ? '세계사' : '한국사',
    period: '조선 중기',
    title: '이순신의 백의종군과 명량 대첩',
    summary: '역경을 딛고 피어난 불굴의 리더십',
    summary3: '• 1597년 정유재란 당시 이순신은 백의종군 중에도 전략을 멈추지 않았다\n• 단 12척의 배로 133척의 왜선을 격퇴한 명량대첩은 세계 해전 역사의 기적\n• 죽기를 각오하면 반드시 살 길이 있다(必死卽生)는 철학이 승리의 원동력',
    behindStory: '이순신이 명량대첩 전날 밤 선조에게 "신에게는 아직 12척의 배가 있습니다"라고 장계를 올렸지만, 실제로 선조는 이순신에게 육군 합류를 명했습니다. 이순신이 이를 정중히 거부하고 해전을 선택한 배경에는, 제해권을 잃으면 보급선이 끊겨 전쟁 자체가 불가능하다는 냉철한 전략적 판단이 있었습니다. 당시 조정에서 이순신을 반역죄로 또다시 몰려던 세력도 있었다는 기록이 남아 있습니다.',
    lesson: '최악의 조건에서도 주어진 자원으로 최선의 결과를 만드는 것이 진정한 리더십입니다.',
    aiGenerated: false
  };
}

function generateMockQuoteFeed(sub) {
  return {
    type: 'humanities', subType: 'quote', subId: 'quote_daily',
    label: '오늘의 명언', category: 'inbox',
    title: '"할 수 있다고 생각하든 없다고 생각하든, 둘 다 옳다" — 헨리 포드',
    quote: "Whether you think you can, or you think you can't — you're right.",
    quoteKo: '당신이 할 수 있다고 생각하든, 할 수 없다고 생각하든 — 둘 다 맞다.',
    author: '헨리 포드',
    authorInfo: '헨리 포드 (1863–1947), 포드 자동차 창업자이자 대량생산 시스템의 아버지.',
    context: '포드는 자동차 왕이 되기 전 수차례 사업에 실패했으며, 이 말은 자서전 인터뷰에서 나왔습니다.',
    behindStory: '포드가 이 명언을 남기게 된 배경에는 자신의 세 번의 파산 경험이 있습니다. 포드는 실패할 때마다 "해낼 수 있다"는 믿음만으로 재기했고, 반대로 자신을 의심하는 직원들이 실제로 성과를 내지 못하는 것을 반복해 목격했습니다. 이 경험에서 나온 실용적 통찰이 세계에서 가장 유명한 동기부여 명언이 됐습니다.',
    application: '오늘 어려운 과제 앞에서 "못 할 것 같다"는 생각이 든다면, 그 생각 자체가 실패의 절반임을 기억하세요.',
    aiGenerated: false
  };
}

function generateMockIdiomFeed(sub) {
  return {
    type: 'humanities', subType: 'idiom', subId: 'idiom_daily',
    label: '오늘의 고사성어', category: 'history',
    title: '와신상담 (臥薪嘗膽)',
    idiom: '와신상담',
    hanja: '臥薪嘗膽',
    meaning: '원수를 갚거나 목적 달성을 위해 온갖 고난을 견디며 분발함',
    origin: '사마천의 《사기》 월왕구천세가(越王勾踐世家)에서 유래',
    story: '춘추시대 오나라 왕 부차는 패배의 굴욕을 잊지 않기 위해 매일 가시 방석(薪) 위에서 잠을 잤습니다. 월나라 왕 구천은 부차에게 항복 후 3년간 노예처럼 살다 귀국해, 쓸개(膽)를 핥으며 복수의 불씨를 키웠습니다. 결국 구천은 22년 후 오나라를 멸망시켰습니다.',
    behindStory: '와신상담의 주인공 구천은 항복 후 오나라에서 부차의 말을 돌보는 마부 일까지 했습니다. 흥미로운 점은 부차가 구천을 귀국시킨 이유가, 구천의 신하 범려가 절세미녀 서시(西施)를 바쳐 부차의 눈을 멀게 했기 때문이라는 설도 있다는 것입니다. 이 와신상담의 고사는 훗날 일본의 무사도에도 영향을 줬다는 역사적 기록이 있습니다.',
    application: '예: 장기 프로젝트가 번번이 실패해도 포기하지 마세요 — 와신상담의 자세로 실력을 쌓다 보면 반드시 기회가 옵니다.',
    aiGenerated: false
  };
}

/**
 * 구독 타입을 보고 적합한 생성 함수 호출
 */
async function generateFeedForSubscription(sub, user) {
  const now = new Date();
  const base = {
    id:        `${toDateStr()}::${sub.id}`,
    date:      toDateStr(),
    subId:     sub.id,
    createdAt: now.toISOString(),
    saved:     false,
    savedEntries: {}
  };

  let content;
  if (sub.type === 'language') {
    content = await generateLanguageFeed(sub, user);
  } else if (sub.type === 'market') {
    content = await generateMarketFeed(sub, user);
  } else if (sub.type === 'humanities') {
    content = await generateHumanitiesFeed(sub, user);
  } else {
    // 알 수 없는 타입 → 기본 텍스트 리포트
    content = {
      type: 'general', category: sub.category || 'inbox',
      label: sub.label, title: sub.label,
      summary: '오늘의 지식 배달', report: ''
    };
  }

  return { ...base, ...content };
}

// ──────────────────────────────────────────────────
//  Mock 폴백 (Gemini API 키 없을 때)
// ──────────────────────────────────────────────────

function generateMockLanguageEntries(topic, count, lang) {
  const isZh = (lang || '').includes('중국');
  const samples = isZh ? [
    { expression: '您好', meaning: '안녕하세요', nuance: '공식적인 비즈니스 인사', sourceSentence: '您好，我是金成在。', practiceSentence: '您好，很高兴认识您。', dialogue: '甲: 您好！\n乙: 您好，很高兴认识您。\n甲: 我是韩国公司的代表。\n[해석: 안녕하세요! / 안녕하세요, 만나서 반갑습니다. / 저는 한국 회사 대표입니다.]' },
    { expression: '请多关照', meaning: '잘 부탁드립니다', nuance: '처음 만났을 때 관용적으로 사용', sourceSentence: '以后请多关照。', practiceSentence: '这次合作请多关照。', dialogue: '甲: 这次由我负责。\n乙: 请多关照！\n甲: 我们一起努力。\n[해석: 이번에 제가 담당합니다. / 잘 부탁드립니다! / 함께 노력합시다.]' },
    { expression: '没问题', meaning: '문제없습니다', nuance: '승낙·확인할 때 가장 많이 쓰임', sourceSentence: '这个要求没问题。', practiceSentence: '交货期三天，没问题吗？', dialogue: '甲: 能在周五前完成吗？\n乙: 没问题，我来安排。\n甲: 太好了，谢谢。\n[해석: 금요일 전에 완료 가능한가요? / 문제없습니다, 제가 준비할게요. / 좋습니다, 감사합니다.]' }
  ] : [
    { expression: 'touch base', meaning: '연락하다', nuance: '짧게 상황을 확인할 때 사용. "contact"보다 가볍고 친근한 뉘앙스', sourceSentence: "Let's touch base tomorrow morning.", practiceSentence: "I'll touch base with the client before the meeting.", dialogue: "A: Do you have an update on the proposal?\nB: Not yet, let me touch base with Sarah.\nA: Great, let me know what you find out." },
    { expression: 'get the ball rolling', meaning: '시작하다', nuance: '첫 발을 내딛을 때. "start"보다 더 역동적인 느낌', sourceSentence: "Let's get the ball rolling on the Q3 campaign.", practiceSentence: "We should get the ball rolling on this project now.", dialogue: "A: The deadline is approaching.\nB: You're right. Let's get the ball rolling.\nA: I'll schedule a kickoff meeting." },
    { expression: 'on the same page', meaning: '의견 일치', nuance: '팀 내 공통 이해 확인. 회의 시작/끝에 자주 사용', sourceSentence: "Are we all on the same page about the launch date?", practiceSentence: "Before we proceed, let's make sure we're on the same page.", dialogue: "A: So we're aiming for a July launch?\nB: I thought it was August.\nA: Let's make sure we're on the same page — I'll send a summary." },
    { expression: 'circle back', meaning: '재논의하다', nuance: '나중에 다시 돌아올 것임을 시사. 현안을 잠시 미룰 때', sourceSentence: "Let's circle back on the budget after lunch.", practiceSentence: "Can we circle back to this point at the end of the meeting?", dialogue: "A: Should we address the pricing issue now?\nB: We don't have all the data yet. Let's circle back on that.\nA: Agreed. I'll add it to next week's agenda." },
    { expression: 'take this offline', meaning: '별도로 논의하다', nuance: '회의 중 특정 이슈를 개별적으로 처리하자고 제안할 때', sourceSentence: "This is getting complex — let's take this offline.", practiceSentence: "Can we take this offline and set up a separate call?", dialogue: "A: This technical issue needs more time.\nB: Agreed. Let's take this offline.\nA: I'll send you a calendar invite." }
  ];
  return samples.slice(0, Math.min(count, samples.length));
}

function generateMockMarketReport(sub, topic, isUS) {
  const indicators = isUS ? [
    { name: 'S&P 500',     value: '5,234.18', change: '+0.87%', dir: 'up'   },
    { name: '나스닥',       value: '16,428.82', change: '+1.24%', dir: 'up'   },
    { name: '다우 지수',    value: '39,112.16', change: '+0.43%', dir: 'up'   },
    { name: '미 국채 10년물', value: '4.31%',  change: '+3 bp',  dir: 'up'   },
    { name: 'VIX 공포지수', value: '14.2',    change: '-0.8',   dir: 'down' }
  ] : [
    { name: '코스피',   value: '2,634.70', change: '+0.52%', dir: 'up'   },
    { name: '코스닥',   value: '872.45',   change: '+0.34%', dir: 'up'   },
    { name: '원/달러', value: '1,352',    change: '+3원',   dir: 'up'   }
  ];
  const usSample = {
    title: '뉴욕 증시, 기술주 중심 완만한 상승',
    summary: 'AI·반도체 섹터 수요 기대감에 나스닥이 상대적 강세, 금리 불확실성은 지속',
    summary3: '• 나스닥 중심 기술주 상승 — AI 인프라 투자 기대감 반영\n• 연준 금리 동결 기조 유지, 채권시장은 소폭 약세\n• 에너지·유틸리티는 차익실현으로 상대적 약세',
    checkpoints: [
      'FOMC 위원 발언 일정 확인 (매파/비둘기파 스탠스)',
      '빅테크 실적 발표 예정 여부 체크',
      'VIX 15 이하 유지 시 위험자산 선호 지속 가능성'
    ],
    report: `## ${topic} — 오늘의 흐름\n\n기술주 중심의 완만한 상승세. AI·반도체 업황 기대감이 나스닥을 지지하고 있으며, 연준의 금리 동결 기조가 단기적으로 긍정적 환경을 제공합니다.\n\n## 오늘의 투자 인사이트\n빅테크 실적 시즌 앞두고 관망세와 매수세가 혼재. 단기 변동성보다는 중장기 AI 인프라 사이클에 집중하는 전략이 유효합니다.`,
    aiEconomicKnowledge: [
      { term: 'VIX (공포지수)', importance: '시장 참가자들의 단기 변동성 기대를 수치화한 지표. VIX 20 이하는 안정, 30 이상은 공포 구간으로 해석합니다.', connection: '날씨로 비유하면 VIX는 "기상 불안 지수" — 숫자가 높을수록 폭풍 예보, 낮을수록 맑은 날씨.' },
      { term: '매파 vs 비둘기파', importance: '중앙은행 내 금리 인상 선호(매파)와 금리 동결/인하 선호(비둘기파) 성향의 구분. FOMC 회의록과 위원 발언에서 읽어냄.', connection: '매파 발언이 많을수록 금리 인상 가능성 ↑ → 채권 약세 / 성장주 약세 패턴.' },
      { term: '섹터 로테이션', importance: '경기 사이클에 따라 투자 자금이 성장주 → 방어주 → 경기민감주 순으로 이동하는 현상.', connection: '"다 오른 종목 팔고 안 오른 종목 산다"는 투자자들의 행동 패턴.' }
    ]
  };
  const krSample = {
    title: '코스피, 외국인 매수세에 소폭 강보합',
    summary: '원/달러 환율 안정과 반도체 업황 회복 기대에 코스피 완만한 반등',
    summary3: '• 외국인 순매수 지속 — 반도체·2차전지 중심\n• 원/달러 환율 1,350원대 안착, 수출 기업 수혜\n• 코스닥은 바이오 업종 약세로 상대적 언더퍼폼',
    checkpoints: [
      '삼성전자·SK하이닉스 외국인 순매수 규모 확인',
      '원/달러 1,360원 돌파 시 수입물가 상승 우려',
      '코스닥 바이오 임상 결과 발표 일정 체크'
    ],
    report: `## ${topic} — 오늘의 흐름\n\n외국인 매수세가 대형 반도체주를 중심으로 유입되며 코스피를 지지. 원화 강세 흐름은 수출 기업에 긍정적이나 단기 차익실현 물량이 상단을 제한합니다.\n\n## 오늘의 투자 인사이트\n반도체 사이클 회복 기대와 AI 수요 증가가 국내 대형주에 유리한 환경. 단, 중국 경기 불확실성은 중단기 리스크 요인.`,
    aiEconomicKnowledge: [
      { term: '외국인 순매수', importance: '해외 기관·개인이 국내 증시에서 매수한 금액에서 매도한 금액을 뺀 값. 지속적 순매수는 강세 신호.', connection: '"외국인이 산다"는 건 한국 주식이 글로벌 자금에게 매력적이라는 신호등.' },
      { term: '원/달러 환율', importance: '환율 상승(원화 약세)은 수출기업 수익 증가 → 코스피 호재, 수입물가 상승 → 인플레 우려의 양면이 있음.', connection: '1달러에 원화가 많이 필요할수록 → 삼성·현대차 해외 이익 원화 환산시 증가.' },
      { term: '언더퍼폼', importance: '시장 평균 수익률보다 낮은 성과를 의미. 코스닥이 코스피 대비 언더퍼폼하면 중소형·성장주보다 대형주가 강하다는 신호.', connection: '"남들보다 덜 오른다"는 뜻 — 벤치마크 대비 상대적 성과 비교 용어.' }
    ]
  };
  return {
    ...(isUS ? usSample : krSample),
    indicators,
  };
}

// ══════════════════════════════════════════════════
//  핵심 생성 함수: 오늘의 전체 피드 빌드
// ══════════════════════════════════════════════════

/**
 * 유저의 활성화된 구독 피드를 모두 생성하여 dailyFeeds.json에 저장
 * @param {object} user
 * @param {boolean} force  이미 오늘 데이터가 있어도 강제 재생성
 * @returns {object}  생성된 feeds { subId: feedObj }
 */
async function buildDailyFeeds(user, force = false) {
  const today    = toDateStr();
  const existing = getTodayFeeds(today);

  if (existing && !force) {
    console.log(`[스케줄러] ${today} 피드 이미 존재 — 스킵 (force=false)`);
    return existing;
  }

  const subs = getEnabledSubscriptions(user);
  if (!subs.length) {
    console.log('[스케줄러] 활성화된 구독 없음 — 생성 스킵');
    return {};
  }

  console.log(`[스케줄러] 유저 "${user.name}" 피드 병렬 생성 시작: ${subs.map(s=>s.id).join(', ')}`);
  const startedAt = Date.now();
  const results   = {};

  /* 병렬 생성 — 순차(O(n×t)) → 병렬(O(t)) */
  await Promise.allSettled(subs.map(async sub => {
    try {
      console.log(`  → [${sub.id}] 생성 중…`);
      const feed = await generateFeedForSubscription(sub, user);
      results[sub.id] = feed;
      saveTodayFeed(today, sub.id, feed);
      console.log(`  ✓ [${sub.id}] 생성 완료 (${feed.vocabEntries?.length || 0}개 항목)`);
    } catch (e) {
      console.error(`  ✗ [${sub.id}] 생성 실패:`, e.message);
    }
  }));

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[스케줄러] 피드 생성 완료 — ${Object.keys(results).length}개, ${elapsed}초 소요`);

  // ── 오늘의 지식 배달 카드 생성 ──
  try {
    await generateDailyDelivery(user, force);
  } catch (e) {
    console.error('[스케줄러] 지식 배달 카드 생성 실패:', e.message);
  }

  /* Web Push는 여기서 보내지 않음 — 생성은 배달시간보다 미리(사전생성) 끝날 수 있어
     "생성 완료 즉시 발송"이면 유저가 설정한 배달시간보다 일찍 알림이 온다.
     실제 발송은 runScheduler()가 배달시간 도달 시점에 별도로 트리거한다. */

  return results;
}

// ══════════════════════════════════════════════════
//  ★ 오늘의 지식 배달 카드 생성 (type: 'daily_delivery')
// ══════════════════════════════════════════════════

/**
 * 최근 7일 아카이브 아이템을 분석해 3~5개 지식 카드를 생성,
 * archive.json에 type:'daily_delivery' 로 저장한다.
 * @param {object} user
 * @param {boolean} force  이미 오늘 생성됐어도 재생성
 */
async function generateDailyDelivery(user, force = false) {
  const today = toDateStr();

  // 이미 오늘 생성됐으면 스킵 (force 아닐 때)
  if (!force) {
    const existing = _sqlQuery(
      "SELECT data FROM items WHERE json_extract(data,'$.type')='daily_delivery' AND date=?",
      [today]
    ).map(r => JSON.parse(r.data));
    if (existing.length > 0) {
      console.log(`[배달생성] 오늘(${today}) 이미 생성된 지식 카드 ${existing.length}개 — 스킵`);
      return existing;
    }
  }

  // 최근 7일 아카이브 (daily_delivery 제외, 직장인 모드만, 최대 20개)
  const weekAgo    = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoStr = toDateStr(weekAgo);
  const recentItems = _sqlQuery(
    "SELECT data FROM items WHERE date >= ? AND mode = ? AND json_extract(data,'$.type') != 'daily_delivery' ORDER BY created_at DESC LIMIT 20",
    [weekAgoStr, MODE_PRO]
  ).map(r => JSON.parse(r.data));

  if (!recentItems.length) {
    console.log('[배달생성] 최근 7일 아카이브 없음 — 배달 카드 생성 스킵');
    return [];
  }

  // 코퍼스 구성
  const corpus = recentItems.map((item, i) => {
    const m       = item.analysis || {};
    const title   = m.title   || item.title   || (item.text || '').slice(0, 60);
    const summary = m.summary || item.summary || (item.text || '').slice(0, 120);
    return `[${i + 1}] [${item.category || 'inbox'}] ${title}${summary ? ' — ' + summary : ''}`;
  }).join('\n');

  const prompt = `당신은 성재님의 개인 학습 수석 비서입니다. 제공된 지식 소스를 바탕으로 바쁜 직장인인 성재님이 1분 만에 핵심을 소화할 수 있도록 다음 3가지 양식을 '엄격히' 지켜 오늘의 지식 카드 3~5개를 생성하세요:
1. [지식 핵심 요약]: 전체 맥락을 관통하는 깔끔한 3줄 요약 리포트
2. [필수 개념 및 용어]: 이 지식을 내 것으로 만들기 위해 반드시 기억해야 할 핵심 키워드나 영어 표현 2~3개 정리
3. [한 줄 리마인드]: 성재님이 오늘 하루 동안 가슴에 새겨야 할 실전 적용 포인트 한 줄

최근 성재님의 수집 지식:
${corpus}

JSON 배열로만 응답 (마크다운 코드블록 없이):
[{"title":"카드 제목(20자 이내)","category":"en|economy|history|youtube|inbox","summary3":"• 요약1\\n• 요약2\\n• 요약3","concepts":[{"term":"개념 또는 영어 표현","desc":"설명 1~2문장"},{"term":"개념2","desc":"설명"}],"reminder":"오늘 하루 실전 적용 한 줄"}]`;

  console.log('[배달생성] AI 호출 시작 (Gemini → Claude 자동 전환 대기)...');
  const raw   = await callAI(prompt, 3000);
  const cards = safeParseJSON(raw);

  if (!Array.isArray(cards) || !cards.length) {
    console.warn('[배달생성] Gemini 응답 파싱 실패 — 배달 카드 생성 중단');
    return [];
  }

  const now  = new Date();
  const items = readDB();
  // force 모드: 기존 오늘 배달 카드 삭제
  const filtered = force
    ? items.filter(i => !(i.type === 'daily_delivery' && i.date === today))
    : items;

  const newCards = cards.slice(0, 5).map(card => ({
    id         : uuidv4(),
    type       : 'daily_delivery',
    mode       : MODE_PRO,
    category   : card.category || 'inbox',
    title      : card.title    || '오늘의 지식',
    text       : card.summary3 || '',
    summary    : card.reminder || '',
    summary3   : card.summary3 || '',
    concepts   : card.concepts || [],
    reminder   : card.reminder || '',
    keywords   : (card.concepts || []).map(c => c.term).filter(Boolean).slice(0, 3),
    classifier : 'daily-delivery',
    source     : 'daily-delivery',
    aiGenerated: true,
    date       : today,
    time       : toTimeStr(now),
    createdAt  : now.toISOString(),
    updatedAt  : now.toISOString(),
    insights   : []
  }));

  // force 모드: 기존 오늘 배달 카드 먼저 삭제
  if (force) {
    getSQLiteDB().run("DELETE FROM items WHERE json_extract(data,'$.type')='daily_delivery' AND date=?", [today]);
    _persistDB();
  }
  // 각 카드를 개별 삽입
  for (const card of newCards) dbInsert(card);
  console.log(`[배달생성] ✅ ${newCards.length}개 지식 카드 저장 완료 (${today})`);
  return newCards;
}

// ══════════════════════════════════════════════════
//  ★ node-cron 스케줄러 (30분마다)
// ══════════════════════════════════════════════════

/**
 * 스케줄러 메인 로직 — 두 가지 관심사를 분리해서 처리한다.
 * ① 콘텐츠 사전 생성: 배달 시간 60~30분 전 구간에 미리 만들어 둠(AI 실패 대비 여유시간).
 * ② 알림 발송: 배달 시간이 실제로 된 시점(그 시간이 속한 30분 슬롯)에 유저당 하루 1회만.
 *    ①의 완료 시점과 무관하게 ②가 트리거하므로, 유저가 설정한 시간과 알림이 항상 일치한다.
 */
async function runScheduler() {
  const now   = toTimeStr();
  const today = toDateStr();
  console.log(`\n[스케줄러] ⏰ 실행 — ${today} ${now}`);

  const users = readUsers();
  let usersChanged = false;

  for (const user of users) {
    const delivTime = user.delivery_time || '07:30';

    // ① 사전 생성 — 배달 시간 1시간 전 ~ 30분 전 구간
    if (isPreGenerationWindow(delivTime, 60)) {
      const existingFeeds = getTodayFeeds(today);
      const subs          = getEnabledSubscriptions(user);
      const allDone       = subs.every(s => existingFeeds?.[s.id]);

      if (!allDone) {
        console.log(`[스케줄러] "${user.name}" 사전 생성 시작 (배달: ${delivTime}, 현재: ${now})`);
        try {
          await buildDailyFeeds(user, false);
        } catch (e) {
          console.error(`[스케줄러] "${user.name}" 생성 실패:`, e.message);
        }
      } else {
        console.log(`[스케줄러] "${user.name}" 오늘 피드 이미 완료 — 생성 스킵`);
      }
    }

    // ② 알림 발송 — 배달 시간이 포함된 30분 슬롯, 유저당 하루 1회
    if (isPreGenerationWindow(delivTime, 0) && user._lastPushDate !== today) {
      const feedsForPush = getTodayFeeds(today);
      if (feedsForPush && Object.keys(feedsForPush).length > 0) {
        const payload = buildPushPayload(feedsForPush);
        console.log(`[Push] "${user.name}" 배달시간(${delivTime}) 도달 — 발송: "${payload.title}"`);
        try {
          const r = await sendPushToAll(payload);
          console.log(`[Push] 발송 결과: 성공 ${r.sent}개 / 실패 ${r.failed}개`);
        } catch (e) {
          console.error('[Push] 발송 오류:', e.message);
        }
        user._lastPushDate = today;   // 같은 날 재발송 방지
        usersChanged = true;
      } else {
        console.log(`[Push] "${user.name}" 배달시간 도달했지만 생성된 피드 없음 — 발송 스킵`);
      }
    }
  }

  if (usersChanged) writeUsers(users);
}

// 30분마다 실행 (매시 0분, 30분)
cron.schedule('0,30 * * * *', () => {
  runScheduler().catch(e => console.error('[스케줄러] 치명적 오류:', e.message));
});

console.log('[스케줄러] node-cron 등록 완료 — 30분마다 실행 (매시 :00, :30)');

// ══════════════════════════════════════════════════
//  Claude API 래퍼 (분류·인사이트용)
// ══════════════════════════════════════════════════

async function callClaude({ model = 'claude-haiku-4-5-20251001', maxTokens = 600, messages, system }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const https   = require('https');
  const bodyObj = { model, max_tokens: maxTokens, messages };
  if (system) bodyObj.system = system;
  const body = JSON.stringify(bodyObj);

  return new Promise(resolve => {
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      }
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw).content?.[0]?.text || null); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

// ══════════════════════════════════════════════════
//  분류 엔진 (기존 유지)
// ══════════════════════════════════════════════════

function classifyByRules(text) {
  const t = text.toLowerCase();
  if (/youtube\.com\/watch|youtu\.be\//.test(t))
    return { domain: 'business', confidence: 'high', keywords: [] };
  const alpha = (text.match(/[a-zA-Z]/g) || []).length;
  const total = (text.match(/[^\s]/g) || []).length;
  if (total > 0 && alpha / total > 0.55)
    return { domain: 'language', confidence: 'high', keywords: [] };
  if (/금리|증시|주가|연준|fed|fomc|etf|반도체|경제|인플레|기준금리|gdp|환율|코스피|나스닥|달러|채권|금융|투자|주식|ipo|기업|창업|마케팅/.test(t))
    return { domain: 'business', confidence: 'medium', keywords: [] };
  if (/조선|고려|신라|백제|고구려|임진왜란|세종|이순신|왕조|사건|혁명|전쟁|고대|중세|근세|근대|역사|문명|왕|제국|식민/.test(t))
    return { domain: 'humanities', confidence: 'medium', keywords: [] };
  if (/심리|철학|인지|감정|스트레스|관계|행동|동기|사고|무의식|자아|인간관계/.test(t))
    return { domain: 'psychology', confidence: 'medium', keywords: [] };
  if (/ai|인공지능|머신러닝|딥러닝|알고리즘|프로그래밍|코딩|과학|물리|화학|수학|공학|기술|tech/.test(t))
    return { domain: 'science', confidence: 'medium', keywords: [] };
  if (/건강|의학|운동|식단|다이어트|수면|영양|병원|치료|약|라이프스타일/.test(t))
    return { domain: 'life', confidence: 'medium', keywords: [] };
  if (/정치|사회|법|시사|선거|정부|복지|환경|기후|시위|국제/.test(t))
    return { domain: 'society', confidence: 'medium', keywords: [] };
  return { domain: 'business', confidence: 'low', keywords: [] };
}

async function classifyWithClaude(text) {
  const raw = await callClaude({
    maxTokens: 250,
    messages: [{
      role: 'user',
      content: `다음 텍스트를 8대 지식 도메인 중 하나로 분류하고 핵심 키워드 3개와 한 줄 요약을 추출하세요.

도메인:
- business   : 비즈니스, 경제, 금융, 주식, 기업, 창업, 마케팅, 커리어
- language   : 영어표현, 중국어, 일본어, 어학, 언어학습, 비즈니스 영어
- humanities : 역사, 문명, 문화사, 고전, 인류학, 지정학
- psychology : 심리학, 철학, 인간관계, 리더십, 인지과학, 행동경제학
- science    : 과학, 기술, IT, AI, 수학, 공학, 자연과학
- arts       : 문학, 영화, 음악, 미술, 디자인, 문화예술
- life       : 건강, 의학, 운동, 식단, 라이프스타일, 여행, 자기계발
- society    : 사회, 정치, 법, 시사, 환경, 국제

반드시 JSON만 출력:
{"domain":"language","keywords":["표현","협상","비즈니스"],"summary":"협상 시 사용하는 핵심 비즈니스 영어 표현"}

텍스트: ${text.slice(0, 600)}`
    }]
  });
  const parsed = safeParseJSON(raw);
  if (parsed?.domain && DOMAINS[parsed.domain]) return {
    domain   : parsed.domain,
    category : parsed.domain,   // 하위 호환
    keywords : parsed.keywords || [],
    summary  : parsed.summary || '',
    classifier: 'claude'
  };
  return null;
}

async function classify(text, manualDomain) {
  if (manualDomain) {
    const domain = DOMAINS[manualDomain] ? manualDomain : (CATEGORY_TO_DOMAIN[manualDomain] || 'business');
    return { domain, category: domain, keywords: [], summary: '', classifier: 'manual' };
  }
  const c = await classifyWithClaude(text);
  if (c) return c;
  const r = classifyByRules(text);
  return { ...r, category: r.domain, summary: '', classifier: `rules(${r.confidence})` };
}

// ══════════════════════════════════════════════════
//  YouTube URL 메타데이터 처리
// ══════════════════════════════════════════════════

/** rawText 내 YouTube URL 추출 */
function extractYouTubeUrl(text) {
  const m = text.match(/https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?[^\s]*v=|shorts\/|embed\/)|youtu\.be\/)[\w\-]+(?:[?&][^\s]*)?/i);
  return m ? m[0] : null;
}

/** YouTube oEmbed API 호출 (API 키 불필요) */
function fetchYouTubeOEmbed(videoUrl) {
  return new Promise(resolve => {
    const https = require('https');
    const oembedPath = `/oembed?url=${encodeURIComponent(videoUrl)}&format=json`;
    const req = https.get(
      { hostname: 'www.youtube.com', path: oembedPath, headers: { 'User-Agent': 'SJ-Archive/1.0' } },
      res => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve(null); } });
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(7000, () => { req.destroy(); resolve(null); });
  });
}

/** Gemini로 YouTube 영상 한국어 분석 생성 */
async function generateYouTubeAnalysis(title, channelName) {
  const prompt = `당신은 지식 큐레이터입니다. 아래 유튜브 영상을 한국어로 분석하세요.

영상 제목: ${title}
채널: ${channelName || '알 수 없음'}

반드시 아래 JSON 형식만 출력하고 다른 텍스트는 쓰지 마세요:
{"title":"한국어로 자연스럽게 번역한 영상 제목 (30자 이내)","summary":"이 영상에서 배울 수 있는 핵심 내용 2~3문장","keywords":["키워드1","키워드2","키워드3"]}`;

  const raw = await callGemini(prompt, 400);
  if (!raw) return null;
  const parsed = safeParseJSON(raw);
  return parsed?.title ? parsed : null;
}

// ══════════════════════════════════════════════════
//  서재 배치 엔진 (기존 유지)
// ══════════════════════════════════════════════════

/**
 * inbox에 쌓인 아이템을 적절한 서가로 이동
 *
 * [1순위] Claude AI 분류 — 실시간 분석 (API 키 있을 때)
 * [2순위] 규칙 기반 분류 — classifyByRules 결과 활용
 * [3순위] 규칙 기반도 inbox인 경우 + 7일 경과 → 'economy'(일반 서가)로 강제 이동
 *         Claude API 연동 실패·키 부재와 무관하게 반드시 작동하는 Failsafe
 */
async function reshelfOldInboxItems() {
  const FORCE_RESHELVE_DAYS = 7;

  const targets = _sqlQuery(
    "SELECT data FROM items WHERE category='inbox' AND created_at < ?",
    [new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()]
  ).map(r => JSON.parse(r.data));

  if (!targets.length) return 0;

  let changed = 0;
  for (const item of targets) {
    let newCategory = null;
    let newKeywords = item.keywords;
    let newSummary  = item.summary;
    let classifier  = item.classifier;

    // [1순위] Claude AI 분류
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const c = await classifyWithClaude(item.text || '');
        if (c && c.category !== 'inbox') {
          newCategory = c.category;
          newKeywords = c.keywords.length ? c.keywords : item.keywords;
          newSummary  = c.summary || item.summary;
          classifier  = `reshelved:${c.classifier}`;
        }
      } catch (e) {
        console.warn('[서재배치] Claude 분류 실패 (규칙 기반으로 전환):', e.message);
      }
    }

    // [2순위] 규칙 기반 분류
    if (!newCategory) {
      const ruled = classifyByRules(item.text || '');
      if (ruled.category !== 'inbox') {
        newCategory = ruled.category;
        classifier  = `reshelved:rules(${ruled.confidence})`;
      }
    }

    // [3순위] 7일 경과 Failsafe — API 상태와 무관하게 강제 이동
    if (!newCategory) {
      const daysOld = (Date.now() - new Date(item.createdAt).getTime()) / 86400000;
      if (daysOld >= FORCE_RESHELVE_DAYS) {
        newCategory = 'economy';   // 기본 서가 (일반 지식)
        classifier  = `reshelved:force-fallback(${Math.floor(daysOld)}d)`;
        console.log(`[서재배치] 강제 이동(Failsafe) — "${(item.text||'').slice(0,40)}" (${Math.floor(daysOld)}일 경과)`);
      }
    }

    if (newCategory) {
      item.category    = newCategory;
      item.keywords    = newKeywords;
      item.summary     = newSummary;
      item.classifier  = classifier;
      item.reshelvedAt = new Date().toISOString();
      item.updatedAt   = new Date().toISOString();
      dbUpdate(item);
      changed++;
    }
  }

  if (changed) console.log(`[서재배치] ${changed}개 항목 이동 완료`);
  return changed;
}
setInterval(reshelfOldInboxItems, 60 * 60 * 1000);


// ══════════════════════════════════════════════════
//  Web Push 라우팅
// ══════════════════════════════════════════════════

/**
 * GET /api/push/vapid-key
 * 프론트엔드가 구독 등록 전에 공개 VAPID 키를 가져감
 */
app.get('/api/push/vapid-key', (req, res) => {
  const key = process.env.PUBLIC_VAPID_KEY;
  if (!key) return res.status(503).json({ success: false, error: 'VAPID 키 미설정' });
  res.json({ success: true, publicKey: key });
});

/**
 * POST /api/push/subscribe
 * Body: { subscription: { endpoint, keys: { p256dh, auth } }, userId? }
 */
app.post('/api/push/subscribe', (req, res) => {
  const { subscription, userId = 'sj' } = req.body;
  if (!subscription?.endpoint) return res.status(400).json({ success: false, error: '구독 정보 없음' });

  const subs  = readPushSubs();
  const exist = subs.find(s => s.subscription.endpoint === subscription.endpoint);
  if (exist) {
    console.log('[Push] 이미 등록된 구독 — 갱신');
    exist.subscription = subscription;
    exist.updatedAt    = new Date().toISOString();
    writePushSubs(subs);
    return res.json({ success: true, updated: true });
  }

  subs.push({ userId, subscription, createdAt: new Date().toISOString() });
  writePushSubs(subs);
  console.log(`[Push] 구독 등록 완료 (총 ${subs.length}개)`);
  res.status(201).json({ success: true, registered: true });
});

/**
 * DELETE /api/push/subscribe
 * Body: { endpoint }
 */
app.delete('/api/push/subscribe', (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ success: false, error: 'endpoint 없음' });

  const subs    = readPushSubs();
  const cleaned = subs.filter(s => s.subscription.endpoint !== endpoint);
  writePushSubs(cleaned);
  console.log(`[Push] 구독 해제 (${subs.length - cleaned.length}개 삭제)`);
  res.json({ success: true });
});


// ══════════════════════════════════════════════════
//  Share Target & Inbox API
// ══════════════════════════════════════════════════

/**
 * GET /share-handler
 * PWA manifest의 share_target.action이 이 경로를 가리킴
 * Service Worker가 설치된 경우: SW의 fetch 이벤트에서 처리
 * SW 미설치 또는 폴백: 경량 HTML 페이지 서빙
 */
app.get('/share-handler', (req, res) => {
  // SW가 처리하지 못한 경우 → share-handler.html로 포워드
  // (URL 파라미터는 그대로 유지됨)
  // server.js가 /public/ 안에 있으므로 __dirname = /public
  res.sendFile(path.join(__dirname, 'share-handler.html'));
});

/**
 * POST /api/inbox
 * 공유 시트 / 빠른 수집을 통해 들어온 콘텐츠를 인박스에 저장
 * Body: { text, source?, title? }
 *
 * 일반 POST /api/items와 동일하나 category를 항상 'inbox'로 고정하고
 * AI 분류는 비동기 백그라운드로 처리 (응답 지연 없음)
 */
app.post('/api/inbox', async (req, res) => {
  const body = req.body || {};

  let rawText = body.text || body.content || body.url || '';
  if (body.url && !rawText.includes(body.url)) rawText = [rawText, body.url].filter(Boolean).join('\n');
  rawText = rawText.trim();

  if (!rawText) return res.status(400).json({ success: false, error: '내용이 비어 있습니다.' });

  const now     = new Date();
  const newItem = {
    id:         uuidv4(),
    text:       rawText,
    category:   'inbox',
    keywords:   [],
    summary:    body.title ? `공유: ${body.title}` : '',
    classifier: 'inbox-direct',
    source:     body.source || 'share-sheet',
    date:       toDateStr(now),
    time:       toTimeStr(now),
    createdAt:  now.toISOString(),
    updatedAt:  now.toISOString(),
    insights:   []
  };

  dbInsert(newItem);
  console.log(`[인박스] 수집: "${rawText.slice(0, 60)}" (${body.source || 'share-sheet'})`);

  // 즉시 201 반환 — AI 분류는 백그라운드로
  res.status(201).json({ success: true, item: newItem, message: '인박스에 수집되었습니다!' });

  // 비동기 AI 분류 (응답 이후)
  setImmediate(async () => {
    try {
      const c = await classify(rawText, null);
      if (c.category !== 'inbox') {
        newItem.category   = c.category;
        newItem.keywords   = c.keywords;
        newItem.summary    = c.summary || newItem.summary;
        newItem.classifier = `inbox-ai:${c.classifier}`;
        newItem.updatedAt  = new Date().toISOString();
        dbUpdate(newItem);
        console.log(`[인박스] AI 분류 완료: "${rawText.slice(0,40)}" → ${c.category}`);
      }
    } catch (e) {
      console.error('[인박스] AI 분류 실패:', e.message);
    }
  });
});

// ══════════════════════════════════════════════════
//  API — 유저 설정
// ══════════════════════════════════════════════════

/**
 * GET /api/user/settings
 * 현재 유저의 설정 조회 (배달 시간, 활성화된 피드 등)
 */
app.get('/api/user/settings', (req, res) => {
  const user = getDefaultUser();
  if (!user) return res.status(404).json({ success: false, error: '유저 없음' });

  const subs      = readJSON(SUBSCRIPTIONS_PATH, []);
  const enabled   = new Set(user.enabled_feeds || subs.filter(s=>s.enabled).map(s=>s.id));

  res.json({
    success: true,
    user: {
      id:             user.id,
      name:           user.name,
      delivery_time:  user.delivery_time,
      timezone:       user.timezone,
      enabled_feeds:  [...enabled],
      feed_settings:  user.feed_settings || {}
    },
    available_feeds: subs.map(s => ({
      id: s.id, label: s.label, type: s.type,
      category: s.category, desc: s.desc, icon: s.icon,
      enabled: enabled.has(s.id)
    }))
  });
});

/**
 * PATCH /api/user/settings
 * Body: { delivery_time?, enabled_feeds?, name? }
 */
app.patch('/api/user/settings', (req, res) => {
  const users = readUsers();
  if (!users.length) return res.status(404).json({ success: false, error: '유저 없음' });

  const user    = users[0];
  const allowed = ['delivery_time', 'enabled_feeds', 'name', 'timezone'];
  allowed.forEach(k => { if (req.body[k] !== undefined) user[k] = req.body[k]; });
  /* 빈 문자열·중복 정리 (클라이언트 버그 방어) */
  if (Array.isArray(user.enabled_feeds)) {
    user.enabled_feeds = [...new Set(user.enabled_feeds.filter(f => f && f.trim()))];
  }
  user.updated_at = new Date().toISOString();
  writeUsers(users);

  console.log(`[유저설정] 업데이트 — 배달시간: ${user.delivery_time}, 피드: ${(user.enabled_feeds||[]).join(',')}`);
  res.json({ success: true, user });
});

/**
 * PATCH /api/delivery-settings/all
 * Body: { feedId, settings }
 * feedId: 'en_expr' | 'zh_expr' | 'us_market' | 'kr_market'
 * settings: 피드별 상세 설정 오브젝트
 *
 * 영어/중국어: { count, themes[], level }
 * 시황:       { is_market_centric, is_macro_centric }
 */
app.patch('/api/delivery-settings/all', (req, res) => {
  const users = readUsers();
  if (!users.length) return res.status(404).json({ success: false, error: '유저 없음' });

  const user = users[0];
  if (!user.feed_settings) user.feed_settings = {};

  const { feedId, settings } = req.body;
  const VALID_FEED_IDS = ['en_expr', 'zh_expr', 'us_market', 'kr_market', 'hist_daily', 'quote_daily', 'idiom_daily', 'liber_classic', 'insight_daily'];
  if (!VALID_FEED_IDS.includes(feedId)) {
    return res.status(400).json({ success: false, error: '유효하지 않은 feedId' });
  }

  /* 피드 타입별 유효성 검사 */
  if (feedId === 'en_expr' || feedId === 'zh_expr') {
    const validLangThemes = feedId === 'en_expr'
      ? ['business_meeting', 'office_email', 'daily_travel', 'drama_spoken']
      : ['biz_hsk', 'biz_trip', 'daily_shop', 'drama_slang'];
    user.feed_settings[feedId] = {
      count : [5,7,10].includes(Number(settings.count)) ? Number(settings.count) : (feedId === 'zh_expr' ? 5 : 7),
      themes: Array.isArray(settings.themes) ? settings.themes.filter(t => validLangThemes.includes(t)) : [],
      level : ['intermediate','advanced'].includes(settings.level) ? settings.level : 'intermediate'
    };
  } else if (feedId === 'us_market' || feedId === 'kr_market') {
    /* 시황 피드 */
    user.feed_settings[feedId] = {
      is_market_centric: settings.is_market_centric !== false,
      is_macro_centric : settings.is_macro_centric  !== false
    };
  } else if (feedId === 'hist_daily') {
    /* 역사 피드 — 시대 선호 */
    user.feed_settings[feedId] = {
      era: ['한국사', '세계사', '상관없음'].includes(settings.era) ? settings.era : '상관없음'
    };
  } else {
    /* quote_daily, idiom_daily — 별도 상세 설정 없음 */
    user.feed_settings[feedId] = {};
  }

  user.updated_at = new Date().toISOString();
  writeUsers(users);

  /* ── 설정 변경 시 오늘 해당 피드 캐시 삭제 → 배달탭 진입 시 새 설정으로 재생성 ── */
  try {
    const todayKey   = toDateStr();
    const allFeeds   = readDailyFeeds();
    if (allFeeds[todayKey] && allFeeds[todayKey][feedId]) {
      delete allFeeds[todayKey][feedId];
      writeDailyFeeds(allFeeds);
      console.log(`[배달설정/${feedId}] ✅ 오늘 캐시 삭제 완료 → 재생성 예정`);
    }
  } catch (cacheErr) {
    console.warn('[배달설정] 캐시 삭제 실패 (무시):', cacheErr.message);
  }

  console.log(`[배달설정/${feedId}] ${JSON.stringify(user.feed_settings[feedId])}`);
  res.json({ success: true, feedId, settings: user.feed_settings[feedId] });
});

// ══════════════════════════════════════════════════
//  API — 데일리 피드 (★ 핵심: 캐시 우선 즉시 반환)
// ══════════════════════════════════════════════════

/**
 * GET /api/daily-feed
 *
 * 1순위: 오늘 날짜의 pre-generated 캐시 → 즉시 반환 (0ms)
 * 2순위: 캐시 없으면 실시간 Gemini 생성 후 캐시 저장 (30~60초)
 *
 * query:
 *   ?force=true  캐시를 무시하고 강제 재생성
 */
app.get('/api/daily-feed', async (req, res) => {
  const today  = toDateStr();
  const force  = req.query.force === 'true';
  const user   = getDefaultUser();

  /* ── 모드 격리 ── : 배달 피드는 직장인(전문직) 전용 큐레이션.
     수험생 모드에서는 일반 지식 카드를 렌더링 엔진 단계에서 원천 배제(빈 반환). */
  if (normalizeMode(req.query.mode) === MODE_EXAM) {
    return res.json({ success: true, date: today, cached: true, mode: MODE_EXAM, feeds: {} });
  }

  if (!user) return res.status(500).json({ success: false, error: '유저 설정 없음' });

  // ── 캐시 히트 체크 (활성화된 모든 피드가 캐시에 있어야 완전 히트) ──
  if (!force) {
    const cached      = getTodayFeeds(today);
    const enabledSubs = getEnabledSubscriptions(user);

    if (cached && Object.keys(cached).length > 0) {
      const missingSubs = enabledSubs.filter(s => !cached[s.id]);

      if (!missingSubs.length) {
        // 모든 활성화된 피드 캐시됨 → 즉시 반환
        const feeds = Object.values(cached);
        console.log(`[피드API] ✅ 캐시 완전 히트 — ${today} (${feeds.length}개 즉시 반환)`);
        return res.json({
          success: true, date: today, cached: true,
          feeds:   Object.fromEntries(feeds.map((f, i) => [i, f]))
        });
      }

      // 새로 활성화된 피드가 캐시에 없음 → 누락분 병렬 생성
      console.log(`[피드API] ⚡ 누락 피드 감지: [${missingSubs.map(s => s.id).join(', ')}] — 병렬 생성 시작`);
      await Promise.allSettled(missingSubs.map(async sub => {
        try {
          console.log(`  → [${sub.id}] 누락 피드 생성 중…`);
          const feed = await generateFeedForSubscription(sub, user);
          saveTodayFeed(today, sub.id, feed);
          console.log(`  ✓ [${sub.id}] 누락 피드 생성 완료`);
        } catch (e) {
          console.error(`  ✗ [${sub.id}] 누락 피드 생성 실패:`, e.message);
        }
      }));
      // 전체 캐시(기존 + 새로 생성) 반환
      const allCached = Object.values(getTodayFeeds(today) || {});
      return res.json({
        success: true, date: today, cached: false,
        feeds:   Object.fromEntries(allCached.map((f, i) => [i, f]))
      });
    }
  }

  // ── 캐시 미스: 실시간 생성 ──
  console.log(`[피드API] 🔄 캐시 미스 — ${today} 실시간 생성 시작`);
  try {
    const feeds = await buildDailyFeeds(user, force);
    const arr   = Object.values(feeds);
    res.json({
      success:   true,
      date:      today,
      cached:    false,
      feeds:     Object.fromEntries(arr.map((f, i) => [i, f]))
    });
  } catch (e) {
    console.error('[피드API] 생성 실패:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/daily-feed/generate
 * 수동으로 오늘 피드 재생성 트리거
 * Body: { force?: boolean }
 */
app.post('/api/daily-feed/generate', async (req, res) => {
  const user  = getDefaultUser();
  const force = req.body.force !== false;  // 기본 true
  if (!user) return res.status(500).json({ success: false, error: '유저 없음' });

  console.log('[피드API] 수동 재생성 요청');
  try {
    /* force 재생성 시 구독 해제된 피드는 오늘 캐시에서 제거 (유령 피드 방지) */
    if (force) {
      const today      = toDateStr();
      const all        = readDailyFeeds();
      const enabledIds = new Set(getEnabledSubscriptions(user).map(s => s.id));
      if (all[today]) {
        for (const subId of Object.keys(all[today])) {
          if (!enabledIds.has(subId)) {
            delete all[today][subId];
            console.log(`  🗑 [${subId}] 구독 해제됨 — 오늘 캐시에서 제거`);
          }
        }
        writeDailyFeeds(all);
      }
    }

    await buildDailyFeeds(user, force);
    // 생성 후 오늘 전체 피드(기존 캐시 포함) 반환
    const allFeeds = getTodayFeeds(toDateStr()) || {};
    const feedsArr = Object.values(allFeeds);
    res.json({
      success: true,
      date:    toDateStr(),
      count:   feedsArr.length,
      feeds:   Object.fromEntries(feedsArr.map((f, i) => [i, f]))
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/daily-feed/status
 * 오늘 피드 캐시 상태 확인
 */
app.get('/api/daily-feed/status', (req, res) => {
  const today   = toDateStr();
  const user    = getDefaultUser();
  const cached  = getTodayFeeds(today);
  const subs    = user ? getEnabledSubscriptions(user) : [];

  const subStatus = subs.map(s => ({
    id:        s.id,
    label:     s.label,
    generated: !!(cached?.[s.id]),
    generatedAt: cached?.[s.id]?.createdAt || null
  }));

  res.json({
    success:       true,
    date:          today,
    delivery_time: user?.delivery_time || '07:30',
    allReady:      subStatus.every(s => s.generated),
    subscriptions: subStatus
  });
});

/**
 * GET /api/user/status?mode=…
 * 콜드스타트 감지 — 해당 모드에 저장된 아이템이 거의 없으면 신규 유저로 판단.
 * (모드 격리: readDBByMode만 사용 — 반대 모드 데이터는 절대 카운트하지 않음)
 */
app.get('/api/user/status', (req, res) => {
  const mode  = normalizeMode(req.query.mode);
  const count = readDBByMode(mode).length;
  res.json({ success: true, isNewUser: count < 3, itemCount: count });
});

/**
 * GET /api/daily-feed/welcome?mode=…
 * 신규 유저 전용 웰컴 피드 — "최근 내 아이템"에 의존하지 않는 DB-first 구독만 즉시 생성(AI 호출 없음, 비용 0).
 * en_expr(SQLite 테마팩 JOIN) · liber_classic/insight_daily/idiom_daily(work_db) 4종 고정.
 * 수험생(EXAM_PREP)은 이미 /api/exam/daily-knowledge가 매 홈 로드마다 오늘 것을 항상 서빙하므로
 * 콜드스타트 공백이 없음 — 이 엔드포인트는 직장인(PROFESSIONAL) 전용.
 */
app.get('/api/daily-feed/welcome', async (req, res) => {
  const mode = normalizeMode(req.query.mode);
  if (mode !== MODE_PRO) return res.json({ success: true, feeds: [] });

  try {
    const user = getDefaultUser();
    const subs = readJSON(SUBSCRIPTIONS_PATH, []);
    const welcomeIds = ['en_expr', 'liber_classic', 'insight_daily', 'idiom_daily'];
    const picked = welcomeIds.map(id => subs.find(s => s.id === id)).filter(Boolean);

    const feeds = [];
    for (const sub of picked) {
      try {
        const feed = await generateFeedForSubscription(sub, user);
        if (feed) feeds.push(feed);
      } catch (e) { console.warn(`[웰컴피드] ${sub.id} 실패:`, e.message); }
    }
    res.json({ success: true, feeds });
  } catch (e) {
    res.status(500).json({ success: false, error: '웰컴 피드 생성 실패' });
  }
});

/**
 * GET /api/en-theme/today
 * 오늘 배달할 영어 테마팩 1개를 SQLite JOIN 단일 쿼리로 반환.
 * 런타임 AI 호출 없음 — 어드민 선행 생성 콘텐츠만 서빙.
 *
 * Response: { pack_id, theme_title, master_paragraph_en, master_paragraph_ko,
 *             highlights[], expressions[{ order, id, expression, meaning,
 *             nuance_story, dialogue_en, dialogue_ko, example_en, practice_en }] }
 */
app.get('/api/en-theme/today', (req, res) => {
  try {
    const pack = _queryEnThemePack('en_expr');
    if (!pack) return res.status(404).json({ error: 'No theme pack available. Seed the DB first.' });
    const { theme, expressions } = pack;
    const highlights = JSON.parse(theme.highlights_json || '[]');
    res.json({
      pack_id:             theme.pack_id,
      theme_title:         theme.theme_title,
      theme_title_en:      theme.theme_title_en  || '',
      theme_key:           theme.theme_key        || '',
      level:               theme.level            || 'intermediate',
      delivery_date:       theme.delivery_date    || null,
      master_paragraph_en: theme.master_paragraph_en,
      master_paragraph_ko: theme.master_paragraph_ko,
      highlights,
      expressions: expressions.map(e => ({
        order:        e.expression_order,
        id:           e.expr_id || String(e.id),
        expression:   e.expression,
        meaning:      e.meaning,
        nuance_story: e.nuance_story  || '',
        dialogue_en:  e.dialogue_en   || '',
        dialogue_ko:  e.dialogue_ko   || '',
        example_en:   e.example_en    || '',
        practice_en:  e.practice_en   || ''
      }))
    });
  } catch (err) {
    console.error('[/api/en-theme/today]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/en-theme/list
 * 어드민용: DB에 적재된 모든 테마팩 목록 조회 (표현 제외 메타만)
 */
app.get('/api/en-theme/list', (req, res) => {
  try {
    const rows = _sqlQuery(
      `SELECT id, pack_id, theme_title, theme_title_en, level, delivery_date, created_at
       FROM english_themes ORDER BY id ASC`, []
    );
    const recentPackIds = getRecentDeliveredIDs('en_expr', 30);
    res.json({
      total: rows.length,
      themes: rows.map(r => ({
        ...r,
        delivered_recently: recentPackIds.includes(r.pack_id)
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/daily-feed/:date/:subId/save
 * 피드 전체를 서재에 저장
 */
app.post('/api/daily-feed/:date/:subId/save', async (req, res) => {
  const { date, subId } = req.params;
  const all  = readDailyFeeds();
  const feed = all?.[date]?.[subId];

  if (!feed) return res.status(404).json({ success: false, error: '피드를 찾을 수 없습니다.' });
  if (feed.savedItemId) return res.json({ success: true, alreadySaved: true, itemId: feed.savedItemId });

  // 서재에 저장
  let text;
  if (feed.type === 'language') {
    /* 검색·폴백용 텍스트도 뉘앙스/예문까지 보강 (렌더는 구조화 데이터 사용) */
    text = `[영어 배달 ${date}] ${feed.title}\n` + (feed.vocabEntries || []).map(e => {
      const parts = [`• ${e.expression}: ${e.meaning}`];
      if (e.nuance)         parts.push(`  뉘앙스: ${e.nuance}`);
      if (e.sourceSentence) parts.push(`  예문: ${e.sourceSentence}`);
      return parts.join('\n');
    }).join('\n');
  } else if (feed.type === 'humanities') {
    const parts = [`[인문학 배달 ${date}] ${feed.title}`];
    if (feed.summary)     parts.push(feed.summary);
    if (feed.lesson)      parts.push(`교훈: ${feed.lesson}`);
    if (feed.application) parts.push(`활용: ${feed.application}`);
    if (feed.meaning)     parts.push(`의미: ${feed.meaning}`);
    if (feed.story)       parts.push(`유래: ${feed.story}`);
    text = parts.filter(Boolean).join('\n');
  } else {
    text = `[시황 배달 ${date}] ${feed.title}\n${feed.summary}\n${feed.report || ''}`;
  }

  const now     = new Date();
  const newItem = {
    id:         uuidv4(),
    text:       text.slice(0, 2000),
    category:   feed.category || 'en',
    mode:       normalizeMode(req.body?.mode),   // 저장 당시 세션 모드 적재
    keywords:   [feed.subCategory, date].filter(Boolean).slice(0, 3),
    summary:    feed.summary || feed.title || '',
    classifier: 'daily-feed',
    source:     'daily-feed',
    type:       feed.type,
    originalUrl: '',
    date:       toDateStr(now),
    time:       toTimeStr(now),
    createdAt:  now.toISOString(),
    updatedAt:  now.toISOString(),
    insights:   [],
    feedData:   feed
  };

  /* 언어 피드: 구조화 필드를 top-level에도 적재 → 서재 상세가 배달과 동일 포맷으로 렌더 */
  if (feed.type === 'language') {
    newItem.vocabEntries   = feed.vocabEntries   || [];
    newItem.themeTitle     = feed.themeTitle     || '';
    newItem.themeTitleEn   = feed.themeTitleEn   || '';
    newItem.masterParagraph= feed.masterParagraph|| null;
    newItem.subCategory    = feed.subCategory    || '';
    /* 카드 제목은 '[영어 배달 날짜]' 접두 없이 테마/제목으로 깔끔하게 */
    newItem.title          = feed.themeTitle || feed.title || '오늘의 표현';
  }

  dbInsert(newItem);

  // dailyFeeds에 savedItemId 기록
  all[date][subId].savedItemId = newItem.id;
  all[date][subId].saved       = true;
  writeDailyFeeds(all);

  console.log(`[피드저장] [${feed.category}] "${feed.title}" → ${newItem.id}`);
  res.status(201).json({ success: true, alreadySaved: false, itemId: newItem.id, item: newItem });
});

// ══════════════════════════════════════════════════
//  API — CRUD (기존 유지)
// ══════════════════════════════════════════════════

app.get('/api/items', (req, res) => {
  const { domain, category, shelf, limit = 100, sort = 'desc', search, mode } = req.query;

  /* ── 모드 격리(Isolation) ── : mode 파라미터가 오면 DB 단계에서 원천 분리.
     수험생 모드 조회 시 직장인 데이터는 쿼리 자체에서 배제(WHERE mode=?, 인덱스 활용). */
  let items = mode ? readDBByMode(mode) : readDB();

  // domain 필터 우선, 없으면 구형 category 파라미터 호환
  if (domain && domain !== 'all') {
    items = items.filter(i => getDomain(i) === domain);
  } else if (category && category !== 'all') {
    const mapped = CATEGORY_TO_DOMAIN[category] || category;
    items = items.filter(i => getDomain(i) === mapped);
  }
  if (shelf)    items = items.filter(i => getDomain(i) === shelf);
  if (req.query.starred === 'true') items = items.filter(i => i.starred === true);

  // 키워드 검색: 제목·요약·본문·키워드 모두 대상
  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    items = items.filter(i => {
      const m       = i.analysis || {};
      const title   = (m.title   || i.title   || '').toLowerCase();
      const summary = (m.summary || i.summary  || '').toLowerCase();
      const text    = (i.text    || '').toLowerCase();
      const kws     = (m.keywords || i.keywords || []).join(' ').toLowerCase();
      return title.includes(q) || summary.includes(q) || text.includes(q) || kws.includes(q);
    });
  }

  items.sort((a, b) => {
    const d = new Date(a.createdAt) - new Date(b.createdAt);
    return sort === 'asc' ? d : -d;
  });
  res.json({ success: true, total: items.length, items: items.slice(0, Number(limit)) });
});

/* ── 라이프 서재 — /:id 보다 먼저 등록해야 'life'가 id로 잡히지 않음 ── */
app.get('/api/items/life', (req, res) => {
  try {
    const { mood, year } = req.query;
    let items = readDB().filter(i => i.contentType === 'life');
    if (mood) items = items.filter(i => i.life?.mood === mood);
    if (year && year !== 'all') {
      items = items.filter(i => {
        const d = new Date(i.life?.date || i.createdAt);
        return String(d.getFullYear()) === String(year);
      });
    }
    items.sort((a, b) => {
      const da  = new Date(a.life?.date || a.createdAt);
      const db2 = new Date(b.life?.date || b.createdAt);
      return db2 - da;
    });
    res.json({ success: true, items });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/items/life', upload.array('photos', 10), (req, res) => {
  try {
    const { text, mood, location, weather, date, privacy } = req.body;
    if (!text && (!req.files || !req.files.length)) {
      return res.status(400).json({ success: false, error: '사진이나 텍스트 중 하나는 필요합니다' });
    }
    const photoUrls = (req.files || []).map(f => `/uploads/${f.filename}`);
    const lifeDate  = date ? new Date(date + 'T00:00:00') : new Date();
    const item = {
      id:          uuidv4(),
      title:       (text || '').slice(0, 50) || '라이프 기록',
      text:        text || '',
      category:    'life',
      contentType: 'life',
      mode:        'PROFESSIONAL',
      createdAt:   new Date().toISOString(),
      date:        toDateStr(lifeDate),
      life: {
        mood:     mood     || '',
        location: location || '',
        weather:  weather  || '',
        photos:   photoUrls,
        privacy:  privacy  || 'private',
        date:     lifeDate.toISOString(),
      },
    };
    dbInsert(item);
    res.json({ success: true, item });
  } catch (e) {
    res.status(500).json({ success: false, error: '라이프 기록 저장 실패: ' + e.message });
  }
});

app.get('/api/items/:id', (req, res) => {
  const item = readDB().find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ success: false, error: '항목을 찾을 수 없습니다.' });
  res.json({ success: true, item });
});

app.post('/api/items', async (req, res) => {
  const body = req.body || {};
  let rawText = body.text || body.content || body.note || '';
  if (body.url && !rawText.includes(body.url)) rawText = [rawText, body.url].filter(Boolean).join('\n');
  rawText = rawText.trim();
  if (!rawText) return res.status(400).json({ success: false, error: '텍스트가 비어 있습니다.' });

  const source         = body.source || body.origin || 'manual';
  const manualCategory = body.category || body.manualCategory || null;
  const extraTags      = Array.isArray(body.tags) ? body.tags : [];
  const sessionMode    = normalizeMode(body.mode);   // 현재 세션 모드 인터셉트 → 강제 적재

  // ── YouTube URL 전용 처리 ──
  const ytUrl = extractYouTubeUrl(rawText);
  if (ytUrl) {
    console.log(`[YouTube] URL 감지: ${ytUrl}`);
    const oembed      = await fetchYouTubeOEmbed(ytUrl);
    const rawTitle    = oembed?.title         || '제목 없음';
    const thumbnail   = oembed?.thumbnail_url || '';
    const channelName = oembed?.author_name   || '';
    console.log(`[YouTube] oEmbed: "${rawTitle}" / ${channelName}`);

    const aiResult = await generateYouTubeAnalysis(rawTitle, channelName);
    const analysis = {
      title   : aiResult?.title    || rawTitle,
      summary : aiResult?.summary  || `"${rawTitle}" — ${channelName || 'YouTube'} 영상`,
      keywords: aiResult?.keywords || []
    };

    const now     = new Date();
    const clientTs = body.createdAt && !isNaN(Date.parse(body.createdAt)) ? body.createdAt : now.toISOString();
    const newItem = {
      id         : uuidv4(),
      type       : 'youtube',
      text       : rawText,
      category   : 'youtube',
      source     : ytUrl,
      title      : rawTitle,
      thumbnail,
      channelName,
      keywords   : [...analysis.keywords, ...extraTags].slice(0, 6),
      summary    : analysis.summary,
      analysis,
      classifier : oembed ? 'youtube-oembed' : 'youtube-rules',
      mode       : sessionMode,
      date       : toDateStr(now),
      time       : toTimeStr(now),
      createdAt  : clientTs,
      updatedAt  : now.toISOString(),
      insights   : []
    };

    dbInsert(newItem);
    console.log(`[저장] [youtube] "${rawTitle}" (${sessionMode})`);
    return res.status(201).json({ success: true, item: newItem });
  }

  // ── 배달 카드 낱개 영어 표현 저장 — vocabEntries 구조 그대로 보존 ──
  // (일반 텍스트로 평탄화하면 dialogue 등이 사라져 서재 상세가 배달보다 빈약해짐 →
  //  /api/daily-feed/:date/:subId/save와 동일한 shape로 저장해 서재도 동일한 풍부한 렌더 사용)
  if (body.type === 'language' && Array.isArray(body.vocabEntries) && body.vocabEntries.length) {
    const entry     = body.vocabEntries[0];
    const now2      = new Date();
    const clientTs2 = body.createdAt && !isNaN(Date.parse(body.createdAt)) ? body.createdAt : now2.toISOString();
    const newItem   = {
      id:          uuidv4(),
      text:        rawText,
      title:       entry.expression || '오늘의 표현',
      category:    manualCategory || 'en',
      domain:      'language',
      mode:        sessionMode,
      keywords:    [entry.expression, body.subCategory].filter(Boolean).slice(0, 3),
      summary:     entry.meaning || '',
      classifier:  'daily-feed-entry',
      source,
      type:        'language',
      vocabEntries: body.vocabEntries,
      subCategory: body.subCategory || '',
      date:        toDateStr(now2),
      time:        toTimeStr(now2),
      createdAt:   clientTs2,
      updatedAt:   now2.toISOString(),
      insights:    []
    };
    dbInsert(newItem);
    console.log(`[저장] [language] "${entry.expression}" (${sessionMode})`);
    return res.status(201).json({ success: true, item: newItem });
  }

  // ── 일반 텍스트 처리 ──
  const now      = new Date();
  const clientTs = body.createdAt && !isNaN(Date.parse(body.createdAt)) ? body.createdAt : now.toISOString();
  const c        = await classify(rawText, manualCategory);
  const domain   = c.domain || CATEGORY_TO_DOMAIN[c.category] || 'business';

  const newItem = {
    id        : uuidv4(),
    text      : rawText,
    domain,
    category  : domain,         // 하위 호환
    tags      : body.tags || [],
    keywords  : [...c.keywords, ...extraTags].slice(0, 6),
    summary   : c.summary,
    classifier: c.classifier,
    source,
    mode      : sessionMode,
    date      : toDateStr(now),
    time      : toTimeStr(now),
    createdAt : clientTs,
    updatedAt : now.toISOString(),
    insights  : []
  };

  dbInsert(newItem);
  console.log(`[저장] [${newItem.category}] "${rawText.slice(0,60)}" (${sessionMode})`);

  res.status(201).json({ success: true, item: newItem });
});

app.patch('/api/items/:id', (req, res) => {
  const items = readDB();
  const item  = items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ success: false, error: '항목을 찾을 수 없습니다.' });
  const allowed = ['domain', 'tags', 'category', 'keywords', 'summary', 'source', 'text', 'myInsight', 'starred', 'reviewAt', 'reviewCount', 'reviewEase', 'wrongAnswer', 'userCategoryId', 'categoryConfirmed', 'contentType'];
  /* wrongAnswerMemo 편의 필드 — wrongAnswer.memo 에 저장 */
  if (req.body.wrongAnswerMemo !== undefined && item.wrongAnswer) {
    item.wrongAnswer = { ...item.wrongAnswer, memo: req.body.wrongAnswerMemo };
  }
  allowed.forEach(k => { if (req.body[k] !== undefined) item[k] = req.body[k]; });
  // domain 변경 시 category·shelf 자동 동기화 (dbUpdate 내부에서도 처리)
  item.updatedAt = new Date().toISOString();
  dbUpdate(item);
  res.json({ success: true, item });
});

// ══════════════════════════════════════════════════
//  API — 스페이스드 리피티션 (SM-2 간소화)
// ══════════════════════════════════════════════════

function calcNextReview(ease, count, quality) {
  if (quality < 3) return { interval: 1, ease };
  const newEase = Math.max(1.3, ease + 0.1 - (5 - quality) * 0.18);
  const interval = count === 0 ? 1 : count === 1 ? 6 : Math.round(count * newEase);
  return { interval, ease: newEase };
}

app.patch('/api/items/:id/review', (req, res) => {
  const items = readDB();
  const item  = items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ success: false, error: '항목을 찾을 수 없습니다.' });

  const quality    = Number(req.body.quality) || 3;
  const ease       = item.reviewEase   || 2.5;
  const count      = (item.reviewCount || 0) + 1;
  const { interval, ease: newEase } = calcNextReview(ease, count, quality);

  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + interval);

  item.reviewCount = count;
  item.reviewEase  = newEase;
  item.reviewAt    = nextDate.toISOString();
  item.updatedAt   = new Date().toISOString();
  dbUpdate(item);

  res.json({ success: true, item, nextReviewAt: item.reviewAt, intervalDays: interval });
});

// ══════════════════════════════════════════════════
//  Quiz DB — 사전 생성 퀴즈 로더 (AI 호출 비용 0원)
// ══════════════════════════════════════════════════

let _qdb = null;

function loadQuizDB() {
  if (_qdb) return _qdb;
  const dbDir = path.join(__dirname, 'data', 'quiz_db');
  const pool  = [];
  try {
    if (!fs.existsSync(dbDir)) { _qdb = pool; return pool; }
    for (const f of fs.readdirSync(dbDir).filter(f => f.endsWith('.json'))) {
      try {
        const raw  = JSON.parse(fs.readFileSync(path.join(dbDir, f), 'utf8'));
        const list = Array.isArray(raw.quiz) ? raw.quiz : [];
        pool.push(...list);
      } catch {}
    }
  } catch {}
  console.log(`[QuizDB] ${pool.length}개 퀴즈 로드`);
  _qdb = pool;
  return pool;
}

// ══════════════════════════════════════════════════
//  API — AI 퀴즈 생성 (DB-First, 비용 0원)
// ══════════════════════════════════════════════════

app.post('/api/quiz/generate', async (req, res) => {
  const { category = 'all', count = 5 } = req.body || {};

  const excludeIds = Array.isArray(req.body.excludeIds) ? req.body.excludeIds : [];

  // DB-First: quiz_db에서 먼저 시도
  let pool = loadQuizDB();
  if (category !== 'all') pool = pool.filter(q => q.category === category);

  if (pool.length > 0) {
    // 이미 본 문제 제외 — 전부 봤으면 seen 무시하고 새 라운드
    const fresh = pool.filter(q => !excludeIds.includes(q.id));
    const src   = fresh.length >= count ? fresh : pool;
    const shuffled = [...src];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const result = shuffled.slice(0, Math.min(count, shuffled.length));
    return res.json({ success: true, quiz: result, newRound: fresh.length < count });
  }

  // 폴백: 저장된 항목으로 Claude API 생성
  let items = readDB().filter(i => i.type !== 'daily_delivery');
  if (category !== 'all') items = items.filter(i => i.category === category);
  if (!items.length) return res.status(400).json({ success: false, error: '퀴즈를 만들 항목이 없습니다.' });

  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  const selected = items.slice(0, Math.min(count, items.length, 10));

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ success: false, error: 'ANTHROPIC_API_KEY 미설정' });
  }

  try {
    const quizItems = [];
    for (const item of selected) {
      const m     = item.analysis || {};
      const title = m.title || item.title || '';
      const text  = (m.summary || item.summary || item.text || '').slice(0, 400);
      if (!title && !text) continue;

      const raw = await callClaude({
        maxTokens: 300,
        system: '사용자의 저장된 지식 카드로 4지선다 퀴즈를 1개 만드세요. 반드시 JSON만 출력하세요.',
        messages: [{
          role: 'user',
          content: `지식: "${title}"\n내용: ${text}\n\n아래 JSON만 출력:\n{"question":"...","options":["A.","B.","C.","D."],"answer":"A","explanation":"..."}`
        }]
      });
      const parsed = safeParseJSON(raw);
      if (parsed?.question && parsed?.options?.length === 4) {
        quizItems.push({ ...parsed, itemId: item.id, category: item.category });
      }
    }
    if (!quizItems.length) return res.status(500).json({ success: false, error: '퀴즈 생성 실패' });
    res.json({ success: true, quiz: quizItems });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/items/:id', (req, res) => {
  const row = _sqlGet('SELECT id FROM items WHERE id=?', [req.params.id]);
  if (!row) return res.status(404).json({ success: false, error: '항목을 찾을 수 없습니다.' });
  dbDelete(req.params.id);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════
//  API — AI 기간별 학습 요약 (복습 대시보드)
// ══════════════════════════════════════════════════

/**
 * POST /api/summary
 * Body: { period, categories }
 *
 * period:
 *   'today'   → 오늘
 *   '3days'   → 최근 3일
 *   '1week'   → 지난 7일 (기본)
 *   '1month'  → 이번 달 전체
 *
 * categories: [] = 전체, ['en','economy'] = 해당 카테고리만
 *
 * 응답: { success, report, keywords[], itemCount, period, categories }
 */
app.post('/api/summary', async (req, res) => {
  const { period = '1week', categories = [] } = req.body || {};

  // ── 날짜 범위 계산 ──
  const now   = new Date();
  const today = toDateStr(now);

  function dateBefore(days) {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return toDateStr(d);
  }

  let fromDate;
  if (period === 'today') {
    fromDate = today;
  } else if (period === '3days') {
    fromDate = dateBefore(2);
  } else if (period === '1week') {
    fromDate = dateBefore(6);
  } else if (period === '1month') {
    // 이번 달 1일
    fromDate = `${today.slice(0, 7)}-01`;
  } else {
    fromDate = dateBefore(6);
  }

  // ── 데이터 필터링 ──
  let items = readDB();

  // 날짜 필터
  items = items.filter(i => i.date && i.date >= fromDate && i.date <= today);

  // 카테고리 필터 (빈 배열 = 전체)
  const cats = Array.isArray(categories) ? categories.filter(Boolean) : [];
  if (cats.length > 0) {
    items = items.filter(i => cats.includes(i.category));
  }

  const itemCount = items.length;
  console.log(`[요약API] 기간=${period}(${fromDate}~${today}), 카테고리=${cats.join(',') || '전체'}, 항목수=${itemCount}`);

  // ── 항목이 없을 때 ──
  if (itemCount === 0) {
    return res.json({
      success:    true,
      period,
      categories: cats,
      itemCount:  0,
      report:     '해당 기간에 기록된 지식 항목이 없습니다. 더 많은 지식을 아카이빙해보세요!',
      keywords:   []
    });
  }

  // ── AI 없을 때 목업 요약 ──
  if (!process.env.GEMINI_API_KEY) {
    const mock = generateMockSummary(items, period, cats);
    return res.json({ success: true, period, categories: cats, itemCount, ...mock });
  }

  // ── Gemini 프롬프트 구성 ──
  const corpus = items.slice(0, 80).map((i, idx) => {
    const cat     = i.category || 'inbox';
    const title   = i.title   || i.text?.slice(0, 80) || '';
    const summary = i.summary || i.aiSummary?.slice(0, 200) || i.text?.slice(0, 200) || '';
    const kws     = (i.keywords || []).slice(0, 3).join(', ');
    return `[${idx + 1}] [${cat}] ${title}${summary ? ' — ' + summary : ''}${kws ? ' (키워드: ' + kws + ')' : ''}`;
  }).join('\n');

  const catLabel = cats.length === 0 ? '전체 분야'
    : cats.map(c => ({ en:'English', history:'History', economy:'Economy', youtube:'YouTube', inbox:'임시서랍' }[c] || c)).join(', ');

  const periodLabel = { today:'오늘', '3days':'최근 3일', '1week':'지난 1주일', '1month':'이번 달 전체' }[period] || period;

  const prompt = `당신은 유저의 개인 학습 비서입니다.
아래는 유저 "성재"가 ${periodLabel} 동안 아카이빙한 지식 목록(${itemCount}개, 분야: ${catLabel})입니다.

---
${corpus}
---

다음 형식으로 한국어 학습 브리핑을 작성해주세요:

[종합 리포트 3줄]
• 이 기간 가장 두드러진 학습 패턴 1줄
• 핵심 개념 또는 키워드 연결 1줄
• 앞으로의 학습 방향 제안 1줄

[핵심 키워드/영어 표현 Top 5]
최근 학습에서 가장 중요한 키워드나 영어 표현 5개를 쉼표로 나열

JSON 형식으로 출력:
{
  "report": "• 리포트 줄1\\n• 리포트 줄2\\n• 리포트 줄3",
  "keywords": ["키워드1", "키워드2", "키워드3", "키워드4", "키워드5"]
}`;

  try {
    const raw = await callGemini(prompt, 600);
    const parsed = safeParseJSON(raw);

    if (parsed?.report) {
      return res.json({
        success:    true,
        period,
        categories: cats,
        itemCount,
        report:     parsed.report,
        keywords:   Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 5) : []
      });
    }

    // JSON 파싱 실패 → 원문 그대로 반환
    return res.json({
      success:    true,
      period,
      categories: cats,
      itemCount,
      report:     raw?.slice(0, 800) || '요약 생성에 실패했습니다.',
      keywords:   []
    });

  } catch (e) {
    console.error('[요약API] Gemini 호출 실패:', e.message);
    // 폴백: 목업 요약
    const mock = generateMockSummary(items, period, cats);
    return res.json({ success: true, period, categories: cats, itemCount, ...mock });
  }
});

/**
 * Gemini API 없을 때의 목업 요약 생성기
 */
function generateMockSummary(items, period, cats) {
  const catCounts = {};
  items.forEach(i => { catCounts[i.category] = (catCounts[i.category] || 0) + 1; });
  const topCat   = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0];
  const topLabel = topCat
    ? ({ en:'영어(English)', history:'역사(History)', economy:'경제(Economy)', youtube:'YouTube', inbox:'임시서랍' }[topCat[0]] || topCat[0])
    : '다양한 분야';

  const keywords = items
    .flatMap(i => i.keywords || [])
    .filter(Boolean)
    .slice(0, 5);

  const report = `• ${topLabel} 분야에 가장 많은 지식(${topCat?.[1] || 0}개)을 기록했습니다.\n`
               + `• 총 ${items.length}개의 지식 항목을 아카이빙하며 꾸준한 학습 루틴을 유지하고 있습니다.\n`
               + `• 다음 단계: 저장된 지식을 복습하고 나만의 인사이트를 추가해보세요.`;

  return { report, keywords: keywords.length ? keywords : ['학습', '아카이브', '지식', '복습', '성장'] };
}

// ══════════════════════════════════════════════════
//  Gemini 멀티모달 이미지 분석 함수
// ══════════════════════════════════════════════════

/**
 * callGeminiWithImage
 * imageBuffer : Buffer (파일 읽기 결과)
 * mimeType    : 'image/jpeg' | 'image/png' | 'image/webp' 등
 * userHint    : 유저가 입력한 메모/질문 (선택)
 * maxTokens   : 출력 최대 토큰
 */
async function callGeminiWithImage(imageBuffer, mimeType, userHint = '', maxTokens = 2000) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-1.5-flash'
  });

  const hintSection = userHint
    ? `\n\n[유저 메모 / 특별 요청]\n"${userHint}"\n위 요청을 최우선으로 반영하여 분석해 주세요.`
    : '';

  const prompt = `당신은 천재적인 지식 가이드입니다.
제공된 이미지 속 시각 자료(텍스트, 도표, 수식, 사진 등)를 정밀하게 분석하세요.${hintSection}

반드시 아래 JSON 형식으로만 출력하세요 (마크다운 코드블록 없이 순수 JSON):
{
  "title": "이 이미지를 한 문장으로 정의하는 제목 (최대 30자)",
  "summary": "사진이 담고 있는 핵심 내용 한 줄 정의",
  "concepts": [
    {"term": "개념 이름", "desc": "이 개념의 설명 (2~3문장)"},
    {"term": "개념 이름2", "desc": "설명"},
    {"term": "개념 이름3", "desc": "설명"}
  ],
  "steps": [
    "Step 1: 논리적인 단계별 풀이 또는 해석 첫 번째",
    "Step 2: 두 번째",
    "Step 3: 세 번째"
  ],
  "fullAnalysis": "전체 분석 결과를 친절하고 상세하게 마크다운 형식으로 작성"
}`;

  const imagePart = {
    inlineData: {
      data: imageBuffer.toString('base64'),
      mimeType
    }
  };

  const result = await model.generateContent([imagePart, prompt]);
  return result.response.text();
}

/**
 * 이미지 분석 목업 (Gemini API 키 없을 때)
 */
function generateMockImageAnalysis(filename, userHint) {
  return {
    title:       '이미지 분석 결과',
    summary:     '(Gemini API 키 미설정) 실제 분석을 위해 .env에 GEMINI_API_KEY를 입력하세요.',
    concepts:    [{ term: '분석 대기', desc: 'Gemini API 키가 설정되면 자동으로 개념이 추출됩니다.' }],
    steps:       ['Gemini API 키를 .env 파일에 설정하세요.', '서버를 재시작한 후 다시 시도하세요.'],
    fullAnalysis: userHint ? `유저 질문: "${userHint}"\n\nGemini API 키를 설정하면 정확한 분석이 제공됩니다.` : ''
  };
}

// ══════════════════════════════════════════════════
//  API — 이미지 업로드 & 멀티모달 분석
// ══════════════════════════════════════════════════

/**
 * POST /api/summarize-library
 * body: { startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD" }
 * 서재에 저장된 지식을 기간 필터 후 AI로 요약 리포트 생성
 */
app.post('/api/summarize-library', async (req, res) => {
  const { startDate, endDate } = req.body || {};
  if (!startDate || !endDate) {
    return res.status(400).json({ success: false, error: '시작일/종료일이 필요합니다.' });
  }
  /* 날짜 형식·순서 서버측 검증 (클라이언트 우회 호출 방어) */
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    return res.status(400).json({ success: false, error: '날짜 형식이 올바르지 않습니다. (YYYY-MM-DD)' });
  }
  if (startDate > endDate) {
    return res.status(400).json({ success: false, error: '시작일이 종료일보다 늦을 수 없습니다.' });
  }

  let items = readDB();
  items = items.filter(i => {
    const d = (i.createdAt || i.savedAt || i.date || '').slice(0, 10);
    return d >= startDate && d <= endDate;
  });

  const itemCount = items.length;
  console.log(`[서재요약API] ${startDate}~${endDate}, 항목=${itemCount}`);

  if (itemCount === 0) {
    return res.json({
      success  : true,
      itemCount: 0,
      report   : '해당 기간에 저장된 지식이 없습니다. 더 많은 지식을 서재에 저장해보세요!',
      keywords : []
    });
  }

  const corpus = items.slice(0, 80).map((item, idx) => {
    const m       = item.analysis || {};
    const title   = m.title   || item.title   || '';
    const summary = (m.summary || item.summary || item.text || '').slice(0, 200);
    const kws     = (m.keywords || item.keywords || []).slice(0, 3).join(', ');
    return `[${idx + 1}] ${title}${summary ? ' — ' + summary : ''}${kws ? ' (키워드: ' + kws + ')' : ''}`;
  }).join('\n');

  const prompt = `당신은 유저의 개인 학습 비서입니다.
아래는 유저가 ${startDate} ~ ${endDate} 기간 동안 서재에 저장한 지식 목록(${itemCount}개)입니다.

---
${corpus}
---

직장인에게 도움이 되는 관점에서 아래 형식의 한국어 마크다운 리포트를 작성해주세요:

• 이 기간 학습의 핵심 패턴 1줄
• 가장 중요한 인사이트 1~2줄
• 실무에 바로 쓸 수 있는 제안 1줄

[핵심 키워드 Top 5]: 가장 중요한 키워드나 표현 5개를 쉼표로 나열

JSON 형식으로만 출력:
{
  "report": "• 핵심 패턴\\n• 인사이트\\n• 실무 제안",
  "keywords": ["키워드1", "키워드2", "키워드3", "키워드4", "키워드5"]
}`;

  try {
    const raw    = await callAI(prompt, 600);
    const parsed = raw ? safeParseJSON(raw) : null;

    if (parsed?.report) {
      return res.json({
        success  : true,
        itemCount,
        report   : parsed.report,
        keywords : Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 5) : []
      });
    }

    return res.json({
      success  : true,
      itemCount,
      report   : raw?.slice(0, 800) || '요약 생성에 실패했습니다.',
      keywords : []
    });

  } catch (e) {
    console.error('[서재요약API] AI 호출 실패:', e.message);
    /* 폴백: 목업 */
    const topTitles = items.slice(0, 3).map(i => (i.analysis?.title || i.title || '').slice(0, 30)).filter(Boolean);
    return res.json({
      success  : true,
      itemCount,
      report   : `• 총 ${itemCount}개의 지식을 이 기간에 서재에 저장했습니다.\n• 주요 주제: ${topTitles.join(', ') || '다양한 분야'}\n• 저장된 지식을 주기적으로 복습해 장기 기억으로 전환해보세요.`,
      keywords : []
    });
  }
});

/**
 * POST /api/analyze-image
 * Content-Type: multipart/form-data
 * Field: image (File), memo (string, optional)
 *
 * 처리 흐름:
 *   1. multer로 이미지 임시 저장
 *   2. 영구 파일명으로 rename (uploads/UUID.ext)
 *   3. Gemini 멀티모달 API 호출
 *   4. JSON 파싱 → archive.json에 type:'image_analysis'로 저장
 *   5. 임시 파일 정리 (multer dest의 무작위 파일명 제거)
 *   6. 결과 반환
 */
const IMG_EXT_MAP = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
  'image/gif': '.gif',  'image/heic': '.heic', 'image/heif': '.heif'
};
function mimeFromUrl(u) {
  const e = (u || '').toLowerCase();
  if (e.endsWith('.png'))  return 'image/png';
  if (e.endsWith('.webp')) return 'image/webp';
  if (e.endsWith('.gif'))  return 'image/gif';
  if (e.endsWith('.heic')) return 'image/heic';
  if (e.endsWith('.heif')) return 'image/heif';
  return 'image/jpeg';
}
/* multer 임시 업로드 → 영구 경로 이동 → [{ url, path, mimeType }] */
function persistUploads(files) {
  return files.map(f => {
    const ext       = IMG_EXT_MAP[f.mimetype] || '.jpg';
    const fileName  = `${uuidv4()}${ext}`;
    const finalPath = path.join(UPLOADS_DIR, fileName);
    fs.renameSync(f.path, finalPath);
    return { url: `/uploads/${fileName}`, path: finalPath, mimeType: f.mimetype };
  });
}

/* 수험생 오답 아이템 기본 골격 (분석 전/대기 상태) */
function buildExamItemBase(subject, imageUrls, userHint, now) {
  return {
    id: uuidv4(), type: 'wrong_answer', domain: 'exam', category: 'exam',
    title: `[${EXAM_SUBJECTS[subject] || subject}] 오답`,
    text: '', summary: '', mode: MODE_EXAM,
    imageUrl: imageUrls[0], thumbnailUrl: imageUrls[0], imageUrls,
    userHint, keywords: [], classifier: 'gemini-exam', source: 'image-upload',
    date: toDateStr(now), time: toTimeStr(now),
    createdAt: now.toISOString(), updatedAt: now.toISOString(), insights: [],
    analysisStatus: 'pending',
    wrongAnswer: {
      subject, subjectName: EXAM_SUBJECTS[subject] || subject, unit: '단원 미분류',
      problemSummary: '', answer: '', requiredConcepts: [], hasSolution: false,
      solutionReview: { errorStep: '', diagnosis: '', fix: '' }, modelSteps: [],
      whatToReinforce: '', relatedConcepts: [],
      whyWrong: '', keyConceptName: '', keyConceptExplain: '', concepts: [], solvingTip: '',
      reviewStatus: 'pending', reviewCount: 0, reviewEase: 2.5, reviewAt: null, lastReview: null,
    }
  };
}

/* analysisResult → 아이템에 분석 결과 반영 (분석 완료 처리) */
function applyExamAnalysis(item, a, subject) {
  const reqConcepts = Array.isArray(a.requiredConcepts) ? a.requiredConcepts : [];
  const review      = a.solutionReview || {};
  const related     = Array.isArray(a.relatedConcepts) ? a.relatedConcepts : [];
  const first       = reqConcepts[0] || {};
  item.title   = a.title || item.title;
  item.text    = a.problemSummary || '';
  item.summary = a.problemSummary || '';
  item.keywords = related;
  item.analysisStatus = 'done';
  item.updatedAt = new Date().toISOString();
  item.wrongAnswer = {
    ...item.wrongAnswer,
    unit: a.unit || '단원 미분류',
    problemSummary: a.problemSummary || '', answer: a.answer || '',
    requiredConcepts: reqConcepts, hasSolution: !!a.hasSolution,
    solutionReview: { errorStep: review.errorStep || '', diagnosis: review.diagnosis || '', fix: review.fix || '' },
    modelSteps: Array.isArray(a.modelSteps) ? a.modelSteps : [],
    whatToReinforce: a.whatToReinforce || '', relatedConcepts: related,
    whyWrong: review.diagnosis || a.problemSummary || '',
    keyConceptName: first.term || '', keyConceptExplain: first.desc || '',
    concepts: related, solvingTip: a.whatToReinforce || '',
  };
}

/* 저장된 이미지들로 과외 분석 실행 → analysisResult | null */
async function runExamImageAnalysis(stored, subject, userHint) {
  if (!process.env.GEMINI_API_KEY) return null;
  const images = stored.map(s => ({ buffer: fs.readFileSync(s.path), mimeType: s.mimeType }));
  const rawText = await callGeminiWithImageExam(images, subject, userHint);
  const cleaned = (rawText || '').replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const parsed  = safeParseJSON(cleaned);
  return (parsed && (parsed.unit || parsed.problemSummary || parsed.answer)) ? parsed : null;
}

/* 보관된 오답 1건을 분석 → DB 업데이트 (백그라운드/지금 분석 공용) */
async function analyzeStoredExamItemById(itemId) {
  const item = readDB().find(i => i.id === itemId);
  if (!item || item.type !== 'wrong_answer') return;
  const subject = item.wrongAnswer?.subject || 'math';
  const urls    = item.imageUrls?.length ? item.imageUrls : (item.imageUrl ? [item.imageUrl] : []);
  if (!urls.length) return;
  const stored  = urls.map(u => ({ path: path.join(UPLOADS_DIR, path.basename(u)), mimeType: mimeFromUrl(u) }));
  item.analysisStatus = 'analyzing'; item.updatedAt = new Date().toISOString(); dbUpdate(item);
  try {
    const a = await runExamImageAnalysis(stored, subject, item.userHint || '');
    const fresh = readDB().find(i => i.id === itemId) || item;
    if (a) { applyExamAnalysis(fresh, a, subject); }
    else   { fresh.analysisStatus = 'failed'; fresh.updatedAt = new Date().toISOString(); }
    dbUpdate(fresh);
    console.log(`[오답분석] ${itemId} → ${fresh.analysisStatus}`);
  } catch (e) {
    console.error('[오답분석] 실패:', e.message);
    const fresh = readDB().find(i => i.id === itemId);
    if (fresh) { fresh.analysisStatus = 'failed'; fresh.updatedAt = new Date().toISOString(); dbUpdate(fresh); }
  }
}

app.post('/api/analyze-image', upload.array('image', 10), async (req, res) => {
  const files = req.files || [];
  if (!files.length) {
    return res.status(400).json({ success: false, error: '이미지 파일이 없습니다.' });
  }

  const userHint    = (req.body.memo || '').trim();
  const examMode    = req.body.mode === 'exam';
  const action      = req.body.action === 'store' ? 'store' : 'analyze';  // 기본=분석
  const examSubject = (req.body.subject || 'math').trim();

  let stored = [];
  try {
    stored = persistUploads(files);
    console.log(`[이미지분석] ${stored.length}장 저장 (mode=${examMode ? 'exam' : 'work'}, action=${action})`);

    // ══ 직장인 모드 — 단일 분석 유지(첫 장) ══
    if (!examMode) {
      const s0 = stored[0];
      let analysisResult;
      if (!process.env.GEMINI_API_KEY) {
        analysisResult = generateMockImageAnalysis(path.basename(s0.url), userHint);
      } else {
        const rawText = await callGeminiWithImage(fs.readFileSync(s0.path), s0.mimeType, userHint);
        const cleaned = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        const parsed  = safeParseJSON(cleaned);
        analysisResult = (parsed && parsed.title) ? parsed
          : { title: '사진 분석 결과', summary: rawText.slice(0, 100), concepts: [], steps: [], fullAnalysis: rawText };
      }
      const now = new Date();
      const newItem = {
        id: uuidv4(), type: 'image_analysis', category: 'inbox', mode: normalizeMode(req.body.mode),
        title: analysisResult.title || '사진 분석 결과',
        text: analysisResult.summary || '', summary: analysisResult.summary || '',
        aiSummary: analysisResult.fullAnalysis || '',
        concepts: analysisResult.concepts || [], steps: analysisResult.steps || [],
        imageUrl: s0.url, thumbnailUrl: s0.url, userHint,
        keywords: (analysisResult.concepts || []).slice(0, 3).map(c => c.term || ''),
        classifier: 'gemini-vision', source: 'image-upload',
        date: toDateStr(now), time: toTimeStr(now),
        createdAt: now.toISOString(), updatedAt: now.toISOString(), insights: []
      };
      dbInsert(newItem);
      return res.status(201).json({ success: true, item: newItem, analysis: analysisResult });
    }

    // ══ 수험생 모드 — 사진 1장당 오답 1건(각각 독립 분석) ══
    const now   = new Date();
    /* 사진마다 별도 오답 아이템 생성 → 각 문제가 자기 카드/분석을 가진다 */
    const items = stored.map(s => buildExamItemBase(examSubject, [s.url], userHint, now));

    // ── 보관하기: N건 즉시 저장(분석 대기) → 응답 → 순차 백그라운드 분석 ──
    if (action === 'store') {
      items.forEach(it => { it.analysisStatus = 'pending'; dbInsert(it); });
      console.log(`[이미지분석] 보관 완료(분석 대기): ${items.length}건`);
      res.status(201).json({ success: true, stored: true, count: items.length, items });
      if (process.env.GEMINI_API_KEY) {
        /* 레이트리밋 보호를 위해 순차 분석 */
        setImmediate(async () => {
          for (const it of items) { await analyzeStoredExamItemById(it.id).catch(() => {}); }
        });
      }
      return;
    }

    // ── 분석하기: 각 사진을 지금 바로(병렬) 분석 ──
    await Promise.all(items.map(async (it, i) => {
      const a = await runExamImageAnalysis([stored[i]], examSubject, userHint).catch(() => null);
      if (a) applyExamAnalysis(it, a, examSubject);
      else   it.analysisStatus = process.env.GEMINI_API_KEY ? 'failed' : 'pending';
      dbInsert(it);
    }));
    const doneCnt = items.filter(it => it.analysisStatus === 'done').length;
    console.log(`[이미지분석] 분석 완료: ${doneCnt}/${items.length}건`);
    return res.status(201).json({ success: true, count: items.length, items });

  } catch (e) {
    console.error('[이미지분석] 실패:', e.message);
    stored.forEach(s => { try { if (fs.existsSync(s.path)) fs.unlinkSync(s.path); } catch {} });
    files.forEach(f  => { try { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch {} });
    return res.status(500).json({ success: false, error: e.message });
  }
});

/* GET /api/exam/wrong/export-pdf?subject=all|math|… — 오답 문제 사진을 깨끗한 문제집 PDF로
   A4 세로, 한 페이지에 2×2(=4문제). 분석/정답 없이 '문제 사진'만 — 다시 풀어보기용.
   pdf-lib는 한글 글리프를 못 그리므로 PDF 내부 텍스트는 영문/숫자만(문제는 이미지). */
const PDF_SUBJECT_EN = {
  all: 'All Subjects', math: 'Mathematics', korean: 'Korean', english: 'English',
  history: 'Korean History', science: 'Science', cert: 'Certificate', etc: 'Others',
};
app.get('/api/exam/wrong/export-pdf', async (req, res) => {
  try {
    const subject = (req.query.subject || 'all').trim();
    const KNOWN   = ['math', 'korean', 'english', 'history', 'science', 'cert'];

    let items = readDB().filter(i => i.type === 'wrong_answer' && i.mode === MODE_EXAM);
    if (subject !== 'all') {
      items = subject === 'etc'
        ? items.filter(i => !KNOWN.includes(i.wrongAnswer?.subject))
        : items.filter(i => i.wrongAnswer?.subject === subject);
    }
    /* 누적 순(오래된 → 최신)으로 문제 번호 부여 */
    items.sort((a, b) => new Date(a.createdAt || a.date) - new Date(b.createdAt || b.date));

    /* 문제 사진 경로 수집 (사진 1장 = 문제 1개) */
    const photos = [];
    items.forEach(it => {
      const urls = it.imageUrls?.length ? it.imageUrls : (it.imageUrl ? [it.imageUrl] : []);
      urls.forEach(u => {
        const p = path.join(UPLOADS_DIR, path.basename(u));
        if (fs.existsSync(p)) photos.push({ path: p, mime: mimeFromUrl(u) });
      });
    });
    if (!photos.length) {
      return res.status(404).json({ success: false, error: '내보낼 오답 문제가 없습니다.' });
    }

    const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
    const pdf   = await PDFDocument.create();
    const font  = await pdf.embedFont(StandardFonts.Helvetica);
    const fontB = await pdf.embedFont(StandardFonts.HelveticaBold);

    /* A4 세로 레이아웃 (pt) */
    const PAGE_W = 595.28, PAGE_H = 841.89, M = 40, HEADER_H = 50, GUT = 16;
    const usableW = PAGE_W - 2 * M;
    const usableH = PAGE_H - 2 * M - HEADER_H;
    const colW = (usableW - GUT) / 2;
    const rowH = (usableH - GUT) / 2;
    const gridTopY = PAGE_H - M - HEADER_H;
    const ink  = rgb(0.165, 0.235, 0.40);   /* #2A3C66 */
    const gray = rgb(0.45, 0.50, 0.62);
    const lineGray = rgb(0.80, 0.82, 0.88);

    const cellRect = (j) => {
      const c = j % 2, r = Math.floor(j / 2);
      return { x: M + c * (colW + GUT), yTop: gridTopY - r * (rowH + GUT), w: colW, h: rowH };
    };
    const embedAuto = async (photo) => {
      const buf = fs.readFileSync(photo.path);
      return photo.mime === 'image/png' ? pdf.embedPng(buf) : pdf.embedJpg(buf);
    };

    const subjEn   = PDF_SUBJECT_EN[subject] || 'Wrong Answers';
    const dateStr  = toDateStr(new Date());
    const totalPg  = Math.ceil(photos.length / 4);

    for (let i = 0; i < photos.length; i += 4) {
      const pageNo = i / 4 + 1;
      const page   = pdf.addPage([PAGE_W, PAGE_H]);

      /* 헤더 */
      page.drawText('WRONG-ANSWER WORKSHEET', { x: M, y: PAGE_H - M - 12, size: 8.5, font, color: gray });
      page.drawText(subjEn, { x: M, y: PAGE_H - M - 30, size: 15, font: fontB, color: ink });
      const rt  = `${dateStr}    p.${pageNo} / ${totalPg}`;
      const rtW = font.widthOfTextAtSize(rt, 9);
      page.drawText(rt, { x: PAGE_W - M - rtW, y: PAGE_H - M - 12, size: 9, font, color: gray });
      page.drawLine({
        start: { x: M, y: gridTopY + 8 }, end: { x: PAGE_W - M, y: gridTopY + 8 },
        thickness: 1, color: ink,
      });

      for (let j = 0; j < 4 && (i + j) < photos.length; j++) {
        const num = i + j + 1;
        const { x, yTop, w, h } = cellRect(j);
        /* 셀 테두리 */
        page.drawRectangle({ x, y: yTop - h, width: w, height: h, borderColor: lineGray, borderWidth: 1, color: rgb(1, 1, 1) });
        /* 문제 번호 */
        page.drawText(String(num), { x: x + 11, y: yTop - 20, size: 13, font: fontB, color: ink });

        /* 이미지 박스(번호줄 아래) */
        const padX = 12, labelH = 26, padB = 12;
        const boxX = x + padX, boxW = w - 2 * padX;
        const boxH = h - labelH - padB, boxY = yTop - labelH - boxH;
        try {
          const img = await embedAuto(photos[i + j]);
          const scale = Math.min(boxW / img.width, boxH / img.height);
          const dw = img.width * scale, dh = img.height * scale;
          page.drawImage(img, { x: boxX + (boxW - dw) / 2, y: boxY + (boxH - dh) / 2, width: dw, height: dh });
        } catch {
          page.drawText('(image unavailable)', { x: boxX + 8, y: boxY + boxH / 2, size: 9, font, color: gray });
        }
      }
    }

    const bytes = await pdf.save();
    const asciiName = `wrong-answers-${subject}-${dateStr}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${asciiName}"`);
    res.setHeader('Content-Length', bytes.length);
    console.log(`[오답PDF] ${subject} ${photos.length}문제 / ${totalPg}쪽`);
    return res.end(Buffer.from(bytes));
  } catch (e) {
    console.error('[오답PDF] 실패:', e.message);
    return res.status(500).json({ success: false, error: 'PDF 생성 실패: ' + e.message });
  }
});

/* POST /api/exam/wrong/:id/analyze — 보관된 오답을 지금 분석 (대기/실패분 수동 분석) */
app.post('/api/exam/wrong/:id/analyze', async (req, res) => {
  const item = readDB().find(i => i.id === req.params.id);
  if (!item || item.type !== 'wrong_answer') {
    return res.status(404).json({ success: false, error: '오답을 찾을 수 없습니다.' });
  }
  if (!process.env.GEMINI_API_KEY) {
    return res.status(400).json({ success: false, error: '분석 기능이 비활성화되어 있어요.' });
  }
  if (item.analysisStatus === 'analyzing') {
    return res.json({ success: true, item, analyzing: true });
  }
  await analyzeStoredExamItemById(item.id);
  const updated = readDB().find(i => i.id === item.id);
  return res.json({ success: true, item: updated });
});

// ══════════════════════════════════════════════════
//  수험생 모드 API (Exam Mode)
// ══════════════════════════════════════════════════

/* 과목 코드 → 한국어 레이블 */
const EXAM_SUBJECTS = {
  math:    '수학',
  korean:  '국어',
  english: '영어',
  history: '한국사',
  science: '탐구',
  cert:    '자격증',
};

/* 과목별 추천 채널 (Phase 1 — 수동 큐레이션) */
const LECTURE_CHANNELS = {
  math:    ['수학의神', '수악중독', 'EBSi 수학'],
  korean:  ['EBSi 국어', '현우진 국어'],
  english: ['EBSi 영어', '조정식 영어'],
  history: ['EBSi 한국사', '설민석'],
  science: ['EBSi 과학탐구'],
  cert:    ['에듀윌', '해커스'],
};

/* 수험생 오답 분석용 Gemini 프롬프트 — 1:1 과외 선생님 톤
   images: [{ buffer, mimeType }] 배열 (한 문제가 여러 장에 걸쳐 있을 수 있음) */
async function callGeminiWithImageExam(images, subject = 'math', userHint = '') {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-1.5-flash' });
  const subjectName = EXAM_SUBJECTS[subject] || '수학';
  const imgList = Array.isArray(images) ? images : [images];
  const multiNote = imgList.length > 1
    ? `\n\n사진이 ${imgList.length}장 첨부되었습니다. 한 문제가 여러 장에 나뉘어 있을 수 있으니 모두 종합해서 분석하세요.`
    : '';

  const hintSection = userHint
    ? `\n\n[학생이 남긴 메모]\n"${userHint}"\n이 메모를 최우선으로 반영해서 짚어주세요.`
    : '';

  const prompt = `당신은 ${subjectName}을(를) 가르치는 다정하지만 정확한 1:1 과외 선생님입니다.
학생이 문제 사진을 보냈습니다. 사진에는 (1) 문제만 있을 수도 있고, (2) 문제 + 학생이 직접 푼 풀이과정이 함께 있을 수도 있습니다.

먼저 사진을 꼼꼼히 보고 판단하세요:
- 학생이 손으로 쓴 풀이/계산/답이 보이면 → 그 풀이를 채점하듯 읽고, 정확히 어느 단계에서 어긋났는지 짚어주세요.
- 문제만 있으면 → 이 문제를 풀려면 무엇을 알아야 하는지에 집중하세요.

학생에게 보여줄 흐름은 반드시 [정답 → 풀이 과정 → 개념 설명] 순서입니다.
설명은 학생이 "아, 그래서 그렇구나" 하고 이해할 만큼은 자세히, 그러나 핵심 위주로 간결하게 적으세요.
전체 응답이 너무 길어지지 않도록 각 항목은 꼭 필요한 만큼만 쓰세요.${multiNote}${hintSection}

[수식 표기 규칙 — 매우 중요]
- 절대로 LaTeX나 역슬래시(\\)를 쓰지 마세요. (\\frac, \\sqrt, \\times 등 금지)
- 수식은 사람이 읽는 평범한 텍스트로: 분수는 "3/2", 거듭제곱은 "x^2", 첨자는 "a_n", 루트는 "√2", 곱셈은 "×", 나눗셈은 "÷", 부등호는 "≤ ≥ ≠", 원주율은 "π" 처럼.
- 부등호 < 와 > 는 꼭 필요할 때만 쓰고, 가능하면 "이하/이상/미만/초과" 같은 한국어로 풀어 쓰세요.

반드시 아래 JSON 형식으로만 출력하세요 (마크다운 코드블록 없이 순수 JSON, 모든 문자열에 역슬래시 금지):
{
  "title": "카드 제목 (예: [${subjectName}] 등차수열의 합)",
  "unit": "대단원 > 소단원 (예: 수열 > 등차수열의 합)",
  "problemSummary": "이 문제가 무엇을 묻고 있는지 학생 말로 1~2문장 요약",
  "answer": "이 문제의 정답을 명확히 (예: 정답은 3번, 또는 42, 또는 x = 5). 객관식이면 번호와 값 모두.",
  "modelSteps": [
    "1. 풀이 과정 첫 단계 (왜 이렇게 하는지 한마디 포함)",
    "2. 둘째 단계",
    "3. 정답에 도달하는 마지막 단계"
  ],
  "requiredConcepts": [
    {"term": "이 문제를 풀려면 반드시 알아야 할 개념명", "desc": "그 개념이 무엇이고 이 문제에서 어떻게 쓰이는지 2~3문장으로 설명"},
    {"term": "개념2 (필요할 때만)", "desc": "설명"}
  ],
  "hasSolution": true,
  "solutionReview": {
    "errorStep": "학생 풀이에서 어긋난 지점을 콕 집어서 (풀이가 없으면 빈 문자열)",
    "diagnosis": "왜 그렇게 틀렸는지 원인 진단 — 개념 오해인지 계산 실수인지 (풀이가 없으면 빈 문자열)",
    "fix": "그 부분을 어떻게 바로잡아야 하는지 (풀이가 없으면 빈 문자열)"
  },
  "whatToReinforce": "과외쌤의 첨언 — 다음에 같은 유형에서 실수하지 않으려면 무엇을 보완해야 하는지 2~3문장, 따뜻하지만 구체적으로",
  "relatedConcepts": ["연관개념1", "연관개념2", "연관개념3"]
}

주의: hasSolution은 사진에 학생 풀이가 실제로 보일 때만 true. 풀이가 없으면 false로 두고 solutionReview의 세 값은 모두 빈 문자열로 두세요.`;

  const timeoutP = new Promise((_, rej) => setTimeout(() => rej(new Error('Gemini 타임아웃')), 45000));
  const imageParts = imgList.map(im => ({
    inlineData: { mimeType: im.mimeType, data: im.buffer.toString('base64') }
  }));
  const result = await Promise.race([
    model.generateContent({
      contents: [{
        role: 'user',
        parts: [ ...imageParts, { text: prompt } ]
      }],
      generationConfig: { maxOutputTokens: 4096, temperature: 0.35 }
    }),
    timeoutP
  ]);

  /* finishReason 로깅 + 잘림(MAX_TOKENS) 시에도 부분 텍스트 안전 추출 */
  const cand   = result?.response?.candidates?.[0];
  const reason = cand?.finishReason;
  if (reason && reason !== 'STOP') console.warn(`[이미지분석/exam] finishReason: ${reason}`);
  let text = '';
  try { text = result.response.text() || ''; } catch { /* MAX_TOKENS 등에서 throw 방지 */ }
  if (!text && cand?.content?.parts?.length) {
    text = cand.content.parts.map(p => p.text || '').join('');
  }
  return text;
}

/* ══════════════════════════════════════════════════
   수험생 지식 배달 — 영어 단어 / 한국사 (AI 호출 없음, DB 기반)
══════════════════════════════════════════════════ */

/* GET /api/exam/daily-knowledge — 오늘의 영어 단어 팩 + 한국사 1건 */
app.get('/api/exam/daily-knowledge', (req, res) => {
  try {
    const today = toDateStr(new Date());
    const { vocab, history } = _queryExamDaily(today);
    res.json({
      success: true,
      date: today,
      vocab: vocab ? {
        packId:     vocab.pack.pack_id,
        themeTitle: vocab.pack.theme_title,
        tip:        vocab.pack.tip,
        level:      vocab.pack.level,
        words: vocab.words.map(w => ({
          id: w.word_id, word: w.word, pos: w.pos, meaning: w.meaning,
          exampleEn: w.example_en, exampleKo: w.example_ko,
          csatRef: w.csat_ref, synonyms: w.synonyms
        }))
      } : null,
      history: history ? {
        id:       history.item_id,
        era:      history.era,
        eraLabel: history.era_label,
        title:    history.title,
        summary:  history.summary,
        keyPoint: history.key_point,
        examTip:  history.exam_tip
      } : null
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/* POST /api/exam/daily-knowledge/save — 배달된 단어팩/한국사를 서재(items, EXAM_PREP)에 저장
   Body: { kind:'vocab'|'history', id }  (id = pack_id 또는 item_id) */
app.post('/api/exam/daily-knowledge/save', (req, res) => {
  const { kind, id } = req.body || {};
  if (!kind || !id) return res.status(400).json({ success: false, error: 'kind, id 필요' });
  try {
    const now  = new Date();
    const date = toDateStr(now);
    let item   = null;

    if (kind === 'vocab') {
      const pack = _sqlGet('SELECT * FROM exam_vocab_themes WHERE pack_id = ?', [id]);
      if (!pack) return res.status(404).json({ success: false, error: '단어팩을 찾을 수 없습니다.' });
      const words = _sqlQuery(
        'SELECT * FROM exam_vocab_words WHERE theme_id = ? ORDER BY word_order ASC', [pack.id]
      );
      const text = [`[수능 영단어] ${pack.theme_title}`, pack.tip]
        .concat(words.map(w => `• ${w.word} (${w.pos}) — ${w.meaning}\n   ${w.example_en}`))
        .filter(Boolean).join('\n');
      item = {
        id: `exv_${pack.pack_id}`, type: 'exam_vocab',
        mode: MODE_EXAM, category: 'exam', domain: 'exam',
        title: `[수능 영단어] ${pack.theme_title}`,
        text, summary: pack.tip || '',
        date, createdAt: now.toISOString(),
        examVocab: {
          packId: pack.pack_id, themeTitle: pack.theme_title, tip: pack.tip, level: pack.level,
          words: words.map(w => ({
            id: w.word_id, word: w.word, pos: w.pos, meaning: w.meaning,
            exampleEn: w.example_en, exampleKo: w.example_ko, csatRef: w.csat_ref, synonyms: w.synonyms
          }))
        }
      };
    } else if (kind === 'word') {
      /* 단어 1개 단위 저장 — packId로 정확히 특정 */
      const { packId } = req.body || {};
      const w = packId
        ? _sqlGet(`SELECT w.* FROM exam_vocab_words w
                   JOIN exam_vocab_themes t ON w.theme_id = t.id
                   WHERE t.pack_id = ? AND w.word_id = ? LIMIT 1`, [packId, id])
        : _sqlGet('SELECT * FROM exam_vocab_words WHERE word_id = ? LIMIT 1', [id]);
      if (!w) return res.status(404).json({ success: false, error: '단어를 찾을 수 없습니다.' });
      const text = [`${w.word} (${w.pos}) — ${w.meaning}`, w.example_en, w.example_ko]
        .filter(Boolean).join('\n');
      item = {
        id: `exw_${packId || 'x'}_${w.word_id}`, type: 'exam_word',
        mode: MODE_EXAM, category: 'exam', domain: 'exam',
        title: `${w.word} — ${w.meaning}`,
        text, summary: w.meaning || '',
        date, createdAt: now.toISOString(),
        examWord: {
          id: w.word_id, word: w.word, pos: w.pos, meaning: w.meaning,
          exampleEn: w.example_en, exampleKo: w.example_ko,
          csatRef: w.csat_ref, synonyms: w.synonyms, packId: packId || ''
        }
      };
    } else if (kind === 'history') {
      const h = _sqlGet('SELECT * FROM exam_history_items WHERE item_id = ?', [id]);
      if (!h) return res.status(404).json({ success: false, error: '한국사 항목을 찾을 수 없습니다.' });
      const text = [`[한국사] ${h.title}`, h.summary,
        h.key_point ? `핵심: ${h.key_point}` : '',
        h.exam_tip  ? `시험팁: ${h.exam_tip}` : ''].filter(Boolean).join('\n');
      item = {
        id: `exh_${h.item_id}`, type: 'exam_history',
        mode: MODE_EXAM, category: 'exam', domain: 'exam',
        title: `[한국사] ${h.title}`,
        text, summary: h.summary || '',
        date, createdAt: now.toISOString(),
        examHistory: {
          id: h.item_id, era: h.era, eraLabel: h.era_label, title: h.title,
          summary: h.summary, keyPoint: h.key_point, examTip: h.exam_tip
        }
      };
    } else {
      return res.status(400).json({ success: false, error: 'kind는 vocab|history' });
    }

    /* 중복 저장 방지 — 동일 id 이미 있으면 그대로 성공 반환 */
    const exists = _sqlGet('SELECT id FROM items WHERE id = ?', [item.id]);
    if (exists) return res.json({ success: true, alreadySaved: true, id: item.id });

    dbInsert(item);
    res.json({ success: true, id: item.id });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/* GET /api/exam/settings */
app.get('/api/exam/settings', (req, res) => {
  const settings = readJSON(EXAM_SETTINGS_PATH, {});
  res.json({ success: true, ...settings });
});

/* POST /api/exam/settings */
app.post('/api/exam/settings', (req, res) => {
  const { examDate, examName } = req.body;
  const settings = { examDate: examDate || null, examName: examName || '' };
  writeJSON(EXAM_SETTINGS_PATH, settings);
  res.json({ success: true, ...settings });
});

/* GET /api/exam/today-summary */
app.get('/api/exam/today-summary', (req, res) => {
  const items = readDB();
  const now   = new Date();
  const todayStr = toDateStr(now);

  /* 오늘 틀린 문제 수 */
  const todayWrong = items.filter(i => i.type === 'wrong_answer' && i.date === todayStr).length;

  /* 복습 대기 중인 오답 (reviewAt <= now) */
  const reviewDue = items.filter(i =>
    i.type === 'wrong_answer' &&
    i.wrongAnswer?.reviewAt &&
    new Date(i.wrongAnswer.reviewAt) <= now
  ).length;

  /* 연속 학습일 (오답 저장 기준, 최대 365일 역추적) */
  const wrongDates = new Set(
    items.filter(i => i.type === 'wrong_answer').map(i => i.date).filter(Boolean)
  );
  let streak = 0;
  const cursor = new Date();
  while (wrongDates.has(toDateStr(cursor)) && streak < 365) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  res.json({ success: true, todayWrong, reviewDue, streak });
});

/* GET /api/exam/weakness-analysis */
app.get('/api/exam/weakness-analysis', (req, res) => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  const items = readDB().filter(i =>
    i.type === 'wrong_answer' && new Date(i.createdAt) >= cutoff
  );

  /* 과목 + 단원별 집계 */
  const unitMap = {};
  items.forEach(i => {
    const w = i.wrongAnswer || {};
    const key = `${w.subject || 'etc'}::${w.unit || '미분류'}`;
    if (!unitMap[key]) {
      unitMap[key] = {
        subject:     w.subject || 'etc',
        subjectName: EXAM_SUBJECTS[w.subject] || w.subject || '기타',
        unit:        w.unit || '미분류',
        concepts:    [],
        count:       0
      };
    }
    unitMap[key].count++;
    (w.concepts || []).forEach(c => {
      if (!unitMap[key].concepts.includes(c)) unitMap[key].concepts.push(c);
    });
  });

  const topWeakness = Object.values(unitMap)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  const subjectCounts = {};
  items.forEach(i => {
    const s = i.wrongAnswer?.subject || 'etc';
    subjectCounts[s] = (subjectCounts[s] || 0) + 1;
  });

  res.json({ success: true, topWeakness, subjectCounts, totalWrong: items.length });
});

/* GET /api/lecture-recommend?concept=X&subject=Y */
app.get('/api/lecture-recommend', (req, res) => {
  const { concept = '', subject = 'math' } = req.query;
  const searchQuery = encodeURIComponent(`${concept} 개념 강의`);
  res.json({
    success: true,
    links: [
      {
        title:    `"${concept}" 유튜브 강의 검색`,
        url:      `https://www.youtube.com/results?search_query=${searchQuery}`,
        platform: 'YouTube',
        isFree:   true,
      },
      {
        title:    `EBSi에서 "${concept}" 찾기`,
        url:      `https://www.ebsi.co.kr/ebs/search/search.ebs?searchKeyword=${encodeURIComponent(concept)}`,
        platform: 'EBSi',
        isFree:   true,
      }
    ]
  });
});

/* PATCH /api/items/:id/wrong-review  (SM-2 오답 복습 평가) */
app.patch('/api/items/:id/wrong-review', (req, res) => {
  const items = readDB();
  const item  = items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ success: false, error: '항목을 찾을 수 없습니다.' });
  if (item.type !== 'wrong_answer') return res.status(400).json({ success: false, error: '오답 항목이 아닙니다.' });

  const quality    = Number(req.body.quality) || 3;
  const w          = item.wrongAnswer || {};
  const ease       = w.reviewEase  || 2.5;
  const count      = (w.reviewCount || 0) + 1;
  const { interval, ease: newEase } = calcNextReview(ease, count, quality);

  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + interval);

  /* wrongAnswer 필드 내 복습 상태 업데이트 */
  item.wrongAnswer = {
    ...w,
    reviewCount:  count,
    reviewEase:   newEase,
    reviewAt:     nextDate.toISOString(),
    reviewStatus: quality >= 4 ? 'done' : quality >= 3 ? 'reviewing' : 'pending',
    lastReview:   new Date().toISOString(),
  };
  item.updatedAt = new Date().toISOString();
  dbUpdate(item);

  res.json({ success: true, item, nextReviewAt: item.wrongAnswer.reviewAt, intervalDays: interval });
});

/* 로그 클릭 API (Phase 2 CPA 준비) */
app.post('/api/log/lecture-click', (req, res) => {
  const { concept, subject, platform, url } = req.body;
  console.log(`[강의클릭] ${subject}/${concept} → ${platform}`);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════
//  카테고리 API
// ══════════════════════════════════════════════════

app.get('/api/categories', (req, res) => {
  try {
    const rows = _sqlQuery(
      'SELECT * FROM user_categories ORDER BY is_default DESC, sort_order ASC, id ASC', []
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/categories', (req, res) => {
  const { name, emoji, color } = req.body;
  if (!name) return res.status(400).json({ error: '이름을 입력해주세요' });
  try {
    const maxRow  = _sqlGet('SELECT MAX(sort_order) AS m FROM user_categories');
    const nextOrd = (Number(maxRow?.m) || 0) + 1;
    getSQLiteDB().run(
      "INSERT INTO user_categories (name, emoji, color, sort_order, is_default, modes) VALUES (?,?,?,?,0,'both')",
      [name, emoji || '📁', color || '#6b7280', nextOrd]
    );
    const newCat = _sqlGet('SELECT * FROM user_categories WHERE rowid = last_insert_rowid()');
    _persistDB();
    res.json(newCat);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/categories/:id', (req, res) => {
  const { name, emoji, color, sort_order } = req.body;
  try {
    const fields = [], vals = [];
    if (name !== undefined)       { fields.push('name=?');       vals.push(name); }
    if (emoji !== undefined)      { fields.push('emoji=?');      vals.push(emoji); }
    if (color !== undefined)      { fields.push('color=?');      vals.push(color); }
    if (sort_order !== undefined) { fields.push('sort_order=?'); vals.push(sort_order); }
    if (!fields.length) return res.status(400).json({ error: '수정할 필드가 없습니다' });
    vals.push(req.params.id);
    getSQLiteDB().run(`UPDATE user_categories SET ${fields.join(',')} WHERE id=?`, vals);
    _persistDB();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/categories/:id', (req, res) => {
  try {
    /* 포함 아이템의 userCategoryId를 null로 초기화 */
    const affected = readDB().filter(i => String(i.userCategoryId) === req.params.id);
    for (const item of affected) {
      item.userCategoryId     = null;
      item.categoryConfirmed  = false;
      item.updatedAt          = new Date().toISOString();
      dbUpdate(item);
    }
    getSQLiteDB().run('DELETE FROM user_categories WHERE id=?', [req.params.id]);
    _persistDB();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════
//  결산 API
// ══════════════════════════════════════════════════

app.get('/api/summary/:type/:period', async (req, res) => {
  const { type, period } = req.params;
  /* 모드 격리 — 캐시 키에 mode 포함해야 직장인/수험생 결산이 서로 안 섞임 */
  const mode     = normalizeMode(req.query.mode);
  const cacheKey = `${mode}:${type}:${period}`;

  /* 캐시 반환 */
  const cache = readSummaries();
  if (cache[cacheKey] && req.query.force !== '1') return res.json(cache[cacheKey]);

  try {
    /* 기간 계산 */
    let from, to;
    if (type === 'monthly') {
      const [y, m] = period.split('-').map(Number);
      from = new Date(y, m - 1, 1);
      to   = new Date(y, m, 0, 23, 59, 59, 999);
    } else if (type === 'half-year') {
      const y = Number(period.split('-H')[0]);
      const h = Number(period.split('-H')[1]);
      from = new Date(y, h === 1 ? 0 : 6,  1);
      to   = new Date(y, h === 1 ? 5 : 11, 31, 23, 59, 59, 999);
    } else {
      const y = Number(period);
      from = new Date(y, 0, 1);
      to   = new Date(y, 11, 31, 23, 59, 59, 999);
    }

    const allItems  = readDBByMode(mode).filter(i => {
      const d = new Date(i.createdAt || i.date);
      return d >= from && d <= to;
    });
    const knowledge = allItems.filter(i => i.contentType !== 'life');
    const lifeItems = allItems.filter(i => i.contentType === 'life');

    /* 카테고리 빈도 */
    const catCount = {};
    knowledge.forEach(i => {
      const cat = i.category || getDomain(i) || '기타';
      catCount[cat] = (catCount[cat] || 0) + 1;
    });
    const topCategories = Object.entries(catCount)
      .sort(([,a],[,b]) => b - a).slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    /* 키워드 빈도 */
    const kwCount = {};
    knowledge.forEach(i => {
      ((i.analysis?.keywords) || i.keywords || []).forEach(k => {
        if (k && k.length > 1) kwCount[k] = (kwCount[k] || 0) + 1;
      });
    });
    const topKeywords = Object.entries(kwCount)
      .sort(([,a],[,b]) => b - a).slice(0, 10)
      .map(([word, count]) => ({ word, count }));

    /* 월별 분포 */
    const monthlyMap = {};
    allItems.forEach(i => {
      const d  = new Date(i.createdAt || i.date);
      const mk = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      monthlyMap[mk] = (monthlyMap[mk] || 0) + 1;
    });
    const monthlyBreakdown = Object.entries(monthlyMap)
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([month, count]) => ({ month, count }));

    const highlights = knowledge.filter(i => i.starred).slice(0, 5).map(i => i.id);

    const stats = { totalItems: knowledge.length, totalLife: lifeItems.length,
                    topCategories, topKeywords, monthlyBreakdown };

    /* AI 총평 */
    let aiReview = '';
    if (knowledge.length > 0) {
      const typeLabel = type === 'monthly' ? '이번 달' : type === 'half-year' ? '반기' : '올해';
      const prompt = `유저의 ${typeLabel} 학습 데이터야. 총 지식: ${stats.totalItems}개, 많이 배운 분야: ${topCategories.map(c=>c.name).join(', ')}, 주요 키워드: ${topKeywords.slice(0,5).map(k=>k.word).join(', ')}. 따뜻하고 격려하는 톤으로 2~3문장 총평을 한국어로 써줘. 구체적인 숫자와 분야를 언급해줘.`;
      const raw = await callClaude({ maxTokens: 300, messages: [{ role:'user', content: prompt }] });
      aiReview = raw || '';
    }

    const result = { type, period, stats, aiReview, highlights,
                     generatedAt: new Date().toISOString() };
    cache[cacheKey] = result;
    writeSummaries(cache);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: '결산 생성 실패: ' + e.message });
  }
});

/**
 * GET /api/country/:code
 * 여행 아카이브(Feature 5) — data/country_db/<코드>.json을 그대로 서빙.
 * 사전 생성(scripts/buildCountryDB.js) 콘텐츠만 서빙 — 런타임 AI 호출 없음.
 * 모드 격리 무관(직장인/수험생 공용 기능 — items 테이블과 무관한 정적 참고자료).
 */
app.get('/api/country/:code', (req, res) => {
  const code = String(req.params.code || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!code) return res.status(400).json({ success: false, error: '국가 코드가 필요합니다.' });
  const filePath = path.join(__dirname, 'data', 'country_db', `${code}.json`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, error: '아직 준비되지 않은 국가예요.' });
  }
  try {
    res.json({ success: true, ...JSON.parse(fs.readFileSync(filePath, 'utf8')) });
  } catch {
    res.status(500).json({ success: false, error: '국가 데이터를 불러오지 못했습니다.' });
  }
});

// ══════════════════════════════════════════════════
//  헬스체크 엔드포인트 (Render.com / 로드밸런서용)
// ══════════════════════════════════════════════════

/**
 * GET /health
 * Render.com 헬스체크 + 가동 상태 빠른 확인용
 */
// 루트 접속 시 앱으로 자동 리다이렉트
app.get('/', (req, res) => {
  res.redirect('/index_mobile.html');
});

app.get('/health', (req, res) => {
  let dbItemCount = 0;
  try { const r = _sqlGet('SELECT COUNT(*) AS c FROM items'); dbItemCount = r ? Number(r.c) : 0; } catch {}
  res.json({
    status:    'ok',
    service:   'SJ 지식 서재',
    version:   'v35',
    timestamp: new Date().toISOString(),
    db:        { type: 'sqlite', items: dbItemCount },
    env: {
      gemini:    !!process.env.GEMINI_API_KEY,
      claude:    !!process.env.ANTHROPIC_API_KEY,
      push:      !!(process.env.PUBLIC_VAPID_KEY && process.env.PRIVATE_VAPID_KEY)
    }
  });
});

// ══════════════════════════════════════════════════
//  서버 시작  (0.0.0.0 바인딩 — Render.com 필수)
// ══════════════════════════════════════════════════

// sql.js WASM 초기화는 async — DB 준비 후 listen
initSQLiteDB().then(() => {
app.listen(PORT, '0.0.0.0', async () => {
  console.log('\n┌──────────────────────────────────────────────────────┐');
  console.log('│      SJ 지식 서재 (Knowledge Library) v5              │');
  console.log(`│      http://localhost:${PORT}                           │`);
  console.log('│                                                      │');
  console.log('│  GET  /api/daily-feed           → 배달 피드 (캐시)   │');
  console.log('│  POST /api/daily-feed/generate  → 수동 재생성        │');
  console.log('│  GET  /api/daily-feed/status    → 캐시 상태 확인     │');
  console.log('│  GET  /api/user/settings        → 유저 설정 조회     │');
  console.log('│  PATCH /api/user/settings       → 배달 시간 변경     │');
  console.log('│  GET  /api/push/vapid-key       → VAPID 공개키       │');
  console.log('│  POST /api/push/subscribe       → 푸시 구독 등록     │');
  console.log('│  DELETE /api/push/subscribe     → 구독 해제          │');
  console.log('│  POST /api/push/test            → 테스트 알림 발송   │');
  console.log('│  POST /api/inbox                → 공유 수집 인박스   │');
  console.log('│  GET  /share-handler            → 공유 시트 수신     │');
  console.log('└──────────────────────────────────────────────────────┘\n');

  const geminiOk = !!process.env.GEMINI_API_KEY;
  const claudeOk = !!process.env.ANTHROPIC_API_KEY;
  console.log(`  Gemini API : ${geminiOk ? '✅ 활성화 (피드 AI 생성)' : '⚠  미설정 → Mock 데이터'}`);
  console.log(`  Claude API : ${claudeOk ? '✅ 활성화 (분류·인사이트)' : '⚠  미설정 → 규칙 기반 분류'}`);
  console.log('');

  // 서버 시작 시 즉시 임시 서랍 처리
  reshelfOldInboxItems().catch(() => {});

  // 서버 시작 시 오늘 캐시 상태 확인 — 없으면 즉시 생성
  const today   = toDateStr();
  const user    = getDefaultUser();
  const cached  = getTodayFeeds(today);
  const hasFeed = cached && Object.keys(cached).length > 0;

  if (!hasFeed && user) {
    console.log(`[시작] 오늘(${today}) 피드 캐시 없음 — 백그라운드 생성 시작`);
    buildDailyFeeds(user, false)
      .then(f => console.log(`[시작] 피드 사전 생성 완료 (${Object.keys(f).length}개)`))
      .catch(e => console.error('[시작] 피드 생성 실패:', e.message));
  } else {
    console.log(`[시작] 오늘(${today}) 피드 캐시 존재 (${Object.keys(cached||{}).length}개) — 즉시 반환 준비 완료`);
  }
});
}).catch(e => { console.error('[SQLite] 초기화 실패 — 서버 종료:', e); process.exit(1); });
