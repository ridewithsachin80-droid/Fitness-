-- ═══════════════════════════════════════════════════════════════════════
-- Health Monitor — Full Database Schema
-- Run once: psql $DATABASE_URL -f server/db/schema.sql
-- ═══════════════════════════════════════════════════════════════════════

-- ── USERS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(100) NOT NULL,
  phone        VARCHAR(15)  UNIQUE,
  email        VARCHAR(100) UNIQUE,
  role         VARCHAR(20)  NOT NULL CHECK (role IN ('patient', 'monitor', 'admin')),
  password     VARCHAR(255),          -- monitor/admin only
  otp_hash     VARCHAR(255),          -- hashed OTP for patient login
  otp_expires  TIMESTAMPTZ,
  active       BOOLEAN      DEFAULT true,
  created_at   TIMESTAMPTZ  DEFAULT NOW()
);

-- ── MONITOR–PATIENT LINKS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monitor_patients (
  id           SERIAL PRIMARY KEY,
  monitor_id   INT REFERENCES users(id) ON DELETE CASCADE,
  patient_id   INT REFERENCES users(id) ON DELETE CASCADE,
  assigned_at  TIMESTAMPTZ DEFAULT NOW(),
  active       BOOLEAN     DEFAULT true,
  UNIQUE(monitor_id, patient_id)
);

-- ── PATIENT PROFILES ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patient_profiles (
  user_id        INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  dob            DATE,
  height_cm      NUMERIC(5,1),
  start_weight   NUMERIC(5,1),
  target_weight  NUMERIC(5,1),
  -- e.g. ["fatty_liver", "pre_diabetic", "b12_deficient"]
  conditions     JSONB       DEFAULT '[]',
  diet_notes     TEXT,
  water_target   INT         DEFAULT 3000,   -- ml
  -- per-member protocol: which items are assigned (null = use all defaults)
  protocol_activities  JSONB DEFAULT NULL,   -- ["walk","sun","steps1",...] or null
  protocol_acv         JSONB DEFAULT NULL,   -- ["acv1","acv2","acv3"] or null
  protocol_supplements JSONB DEFAULT NULL,   -- [...] or null
  custom_activities    JSONB DEFAULT '[]',   -- [{id,label,sub},...] member-specific extras
  custom_acv           JSONB DEFAULT '[]',
  custom_supplements   JSONB DEFAULT '[]',
  item_overrides       JSONB DEFAULT '{}',   -- {[itemId]: {label,sub,fromTime,toTime,totalTime}}
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── DAILY LOGS ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_logs (
  id             SERIAL PRIMARY KEY,
  patient_id     INT REFERENCES users(id) ON DELETE CASCADE,
  log_date       DATE NOT NULL,
  weight_kg      NUMERIC(5,1),
  activities     JSONB DEFAULT '{}',    -- { walk: true, sun: false, ... }
  acv            JSONB DEFAULT '{}',    -- { acv1: true, acv2: false, acv3: true }
  food_items     JSONB DEFAULT '[]',    -- [{ id, name, grams, meal }, ...]
  water_ml       INT   DEFAULT 0,
  supplements    JSONB DEFAULT '{}',    -- { b12: true, d3: false, ... }
  sleep          JSONB DEFAULT '{}',    -- { bedtime: "22:00", waketime: "06:30", quality: 4 }
  notes          TEXT,
  compliance_pct INT,                   -- calculated server-side
  saved_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(patient_id, log_date)
);

-- ── LAB VALUES ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lab_values (
  id          SERIAL PRIMARY KEY,
  patient_id  INT REFERENCES users(id) ON DELETE CASCADE,
  test_date   DATE NOT NULL,
  test_name   VARCHAR(100) NOT NULL,   -- 'HbA1c', 'GGT', 'B12', etc.
  value       NUMERIC(10,2) NOT NULL,
  unit        VARCHAR(30),
  ref_min     NUMERIC(10,2),
  ref_max     NUMERIC(10,2),
  status      VARCHAR(10) CHECK (status IN ('low', 'normal', 'high')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── PUSH SUBSCRIPTIONS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           SERIAL PRIMARY KEY,
  user_id      INT REFERENCES users(id) ON DELETE CASCADE,
  endpoint     TEXT NOT NULL UNIQUE,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  device_name  VARCHAR(100),
  active       BOOLEAN     DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── NOTIFICATIONS LOG ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications_log (
  id        SERIAL PRIMARY KEY,
  user_id   INT REFERENCES users(id) ON DELETE CASCADE,
  type      VARCHAR(50),     -- 'weight','acv','water','supplement','no_log'
  title     VARCHAR(100),
  body      TEXT,
  sent_at   TIMESTAMPTZ DEFAULT NOW(),
  opened_at TIMESTAMPTZ,
  failed    BOOLEAN     DEFAULT false
);

-- ── MONITOR NOTES ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monitor_notes (
  id          SERIAL PRIMARY KEY,
  monitor_id  INT REFERENCES users(id) ON DELETE CASCADE,
  patient_id  INT REFERENCES users(id) ON DELETE CASCADE,
  note_date   DATE NOT NULL,
  note        TEXT NOT NULL,
  flagged     BOOLEAN     DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── MIGRATIONS — ADD MISSING COLUMNS SAFELY ──────────────────────────────
-- ALTER TABLE ADD COLUMN IF NOT EXISTS is idempotent — safe to re-run every
-- deploy. This handles the case where patient_profiles was originally created
-- from an older schema that was missing some columns (e.g. if the CREATE TABLE
-- above failed mid-run due to the duplicate protocol_supplements column that
-- existed in early versions of this file).
--
-- Sprint 0 columns (may be missing on older deployments)
ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS dob                 DATE;
ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS diet_notes          TEXT;
ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS water_target        INT          DEFAULT 3000;
ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS protocol_activities JSONB        DEFAULT NULL;
ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS protocol_acv        JSONB        DEFAULT NULL;
ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS protocol_supplements JSONB       DEFAULT NULL;
ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS custom_activities   JSONB        DEFAULT '[]';
ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS custom_acv          JSONB        DEFAULT '[]';
ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS custom_supplements  JSONB        DEFAULT '[]';
ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS item_overrides      JSONB        DEFAULT '{}';
ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ  DEFAULT NOW();
--
-- Sprint 2 columns (fasting + macros)
ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS fasting_start  TIME;
ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS fasting_end    TIME;
ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS fasting_note   TEXT;
ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS fasting_label  VARCHAR(100);
ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS macro_kcal     INT;
ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS macro_pro      INT;
ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS macro_carb     INT;
ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS macro_fat      INT;
ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS macro_phase    VARCHAR(100);

-- ── FOODS (Sprint 1) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS foods (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(200) NOT NULL,
  name_hindi   VARCHAR(200),
  name_local   VARCHAR(200),
  category     VARCHAR(50) CHECK (category IN
                 ('dairy','grain','vegetable','fruit','nut','oil',
                  'supplement','branded','other')),
  source       VARCHAR(20) CHECK (source IN ('nin','usda','off','manual')),
  verified     BOOLEAN     DEFAULT false,
  per_100g     JSONB       NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Full-text search on name + transliteration columns
CREATE INDEX IF NOT EXISTS idx_foods_name_fts
  ON foods USING GIN (to_tsvector('simple', name));
CREATE INDEX IF NOT EXISTS idx_foods_category
  ON foods(category);
CREATE INDEX IF NOT EXISTS idx_foods_source
  ON foods(source);

-- Unique name per source to prevent duplicate seeding
CREATE UNIQUE INDEX IF NOT EXISTS idx_foods_name_source
  ON foods(lower(name), source);

-- ── INDEXES ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_daily_logs_patient_date
  ON daily_logs(patient_id, log_date DESC);

CREATE INDEX IF NOT EXISTS idx_lab_values_patient
  ON lab_values(patient_id, test_date DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications_log(user_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_push_subs_user
  ON push_subscriptions(user_id) WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_monitor_patients_monitor
  ON monitor_patients(monitor_id) WHERE active = true;
