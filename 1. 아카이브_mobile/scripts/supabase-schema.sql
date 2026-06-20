-- ================================================================
-- SJ 지식 서재 — Supabase (PostgreSQL) 스키마
-- 사용법: Supabase 대시보드 > SQL Editor 에 전체 붙여넣기 후 실행
-- ================================================================

-- ── 메인 아이템 테이블 ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS items (
  id           TEXT PRIMARY KEY,
  category     TEXT NOT NULL DEFAULT 'inbox',
  mode         TEXT NOT NULL DEFAULT 'PROFESSIONAL',  -- 'PROFESSIONAL' | 'EXAM_PREP'
  content_type TEXT NOT NULL DEFAULT 'knowledge',     -- 'knowledge' | 'life'
  date         TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  data         JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_mode_created   ON items(mode, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_content_type   ON items(content_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_category       ON items(category);

-- ── 커스텀 카테고리 ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_categories (
  id          SERIAL PRIMARY KEY,
  name        TEXT    NOT NULL,
  emoji       TEXT    DEFAULT '📁',
  color       TEXT    DEFAULT '#6b7280',
  sort_order  INT     DEFAULT 0,
  is_default  BOOLEAN DEFAULT false,
  modes       TEXT    DEFAULT 'both',  -- 'work' | 'exam' | 'both'
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 기본 카테고리 시드
INSERT INTO user_categories (name, emoji, color, sort_order, is_default, modes) VALUES
  ('영어',     '🗽', '#4f46e5', 1,  true, 'both'),
  ('경제/시황', '📈', '#059669', 2,  true, 'work'),
  ('역사',     '🏛️', '#92400e', 3,  true, 'both'),
  ('명언',     '💡', '#7c3aed', 4,  true, 'both'),
  ('고사성어', '📜', '#c2410c', 5,  true, 'work'),
  ('수학',     '📐', '#2563eb', 6,  true, 'exam'),
  ('국어',     '📖', '#dc2626', 7,  true, 'exam'),
  ('한국사',   '🇰🇷', '#92400e', 8,  true, 'exam'),
  ('탐구',     '🔬', '#059669', 9,  true, 'exam'),
  ('자격증',   '📋', '#7c3aed', 10, true, 'exam'),
  ('기타',     '📌', '#6b7280', 99, true, 'both')
ON CONFLICT DO NOTHING;

-- ── 직장인 영어 테마팩 ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS english_themes (
  id                  SERIAL PRIMARY KEY,
  pack_id             TEXT UNIQUE NOT NULL,
  theme_title         TEXT NOT NULL,
  theme_title_en      TEXT DEFAULT '',
  theme_key           TEXT DEFAULT '',
  level               TEXT DEFAULT 'intermediate',
  delivery_date       TEXT,
  master_paragraph_en TEXT DEFAULT '',
  master_paragraph_ko TEXT DEFAULT '',
  highlights_json     JSONB DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS english_expressions (
  id               SERIAL PRIMARY KEY,
  theme_id         INT REFERENCES english_themes(id) ON DELETE CASCADE,
  expression_order INT NOT NULL,
  expr_id          TEXT UNIQUE,
  expression       TEXT NOT NULL,
  meaning          TEXT NOT NULL,
  nuance_story     TEXT DEFAULT '',
  dialogue_en      TEXT DEFAULT '',
  dialogue_ko      TEXT DEFAULT '',
  example_en       TEXT DEFAULT '',
  practice_en      TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_ee_theme_id ON english_expressions(theme_id, expression_order);

-- ── 수험생 영어 단어 ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exam_vocab_themes (
  id            SERIAL PRIMARY KEY,
  pack_id       TEXT UNIQUE NOT NULL,
  theme_title   TEXT NOT NULL,
  level         TEXT DEFAULT 'high',
  tip           TEXT DEFAULT '',
  delivery_date TEXT
);

CREATE TABLE IF NOT EXISTS exam_vocab_words (
  id          SERIAL PRIMARY KEY,
  theme_id    INT REFERENCES exam_vocab_themes(id) ON DELETE CASCADE,
  word_order  INT NOT NULL,
  word_id     TEXT UNIQUE,
  word        TEXT NOT NULL,
  pos         TEXT DEFAULT '',
  meaning     TEXT NOT NULL,
  example_en  TEXT DEFAULT '',
  example_ko  TEXT DEFAULT '',
  csat_ref    TEXT DEFAULT '',
  synonyms    TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_evw_theme_id ON exam_vocab_words(theme_id, word_order);

-- ── 수험생 한국사 ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exam_history_items (
  id            SERIAL PRIMARY KEY,
  item_id       TEXT UNIQUE NOT NULL,
  era           TEXT DEFAULT '',
  era_label     TEXT DEFAULT '',
  title         TEXT NOT NULL,
  summary       TEXT DEFAULT '',
  key_point     TEXT DEFAULT '',
  exam_tip      TEXT DEFAULT '',
  delivery_date TEXT
);

-- ── 결산 캐시 ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS summaries (
  id           SERIAL PRIMARY KEY,
  cache_key    TEXT UNIQUE NOT NULL,  -- "monthly:2026-06"
  type         TEXT NOT NULL,
  period       TEXT NOT NULL,
  stats        JSONB,
  ai_review    TEXT DEFAULT '',
  highlights   JSONB DEFAULT '[]',
  generated_at TIMESTAMPTZ DEFAULT now()
);
