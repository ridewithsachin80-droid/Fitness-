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
-- Sprint 5 columns (micronutrient RDA overrides)
ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS rda_overrides JSONB DEFAULT '{}';

ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS meal_plan JSONB DEFAULT NULL;

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
                  'supplement','branded','other',
                  'pulse','meat','beverage','spice')),
  source       VARCHAR(20) CHECK (source IN ('nin','usda','off','manual','ai')),
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

-- ── FOODS — Kannada / regional alias column (Sprint 16) ──────────────────────
-- Stores alternate language names as a JSON array, e.g.
-- ["Bendekai", "ಬೆಂಡೆಕಾಯಿ", "Bendekaayi"]
-- Search query matches against this column so members can type in Kannada.
ALTER TABLE foods ADD COLUMN IF NOT EXISTS name_aliases JSONB DEFAULT '[]';

-- GIN index for fast containment checks on the array
CREATE INDEX IF NOT EXISTS idx_foods_name_aliases
  ON foods USING GIN (name_aliases);

-- ── MIGRATIONS TABLE — tracks one-time data patches ──────────────────────────
-- Each named migration runs exactly once at boot, then is recorded here.
-- The schema itself is idempotent; this tracks DATA migrations only.
CREATE TABLE IF NOT EXISTS migrations (
  id       SERIAL PRIMARY KEY,
  name     TEXT NOT NULL UNIQUE,
  run_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── AUDIT LOG (Sprint 13) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          SERIAL PRIMARY KEY,
  actor_id    INT REFERENCES users(id) ON DELETE SET NULL,
  actor_name  VARCHAR(100),
  actor_role  VARCHAR(20),
  action      VARCHAR(80)  NOT NULL,   -- e.g. 'member_created', 'pin_reset', 'member_toggled'
  target_id   INT,                      -- id of the affected user/record
  target_name VARCHAR(100),
  detail      TEXT,                     -- human-readable summary
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created
  ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor
  ON audit_log(actor_id);

-- ── Tracker connections (OAuth tokens + BLE device records) ───────────────────
CREATE TABLE IF NOT EXISTS tracker_connections (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      VARCHAR(40) NOT NULL,        -- fitbit | whoop | polar | ble_ring | healthconnect
  access_token  TEXT,
  refresh_token TEXT,
  expires_at    TIMESTAMPTZ,
  raw           JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, provider)
);

-- ── Daily tracker data (merged metrics per provider per day) ──────────────────
CREATE TABLE IF NOT EXISTS tracker_data (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider   VARCHAR(40) NOT NULL,
  date       DATE NOT NULL,
  metrics    JSONB DEFAULT '{}',
  synced_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, provider, date)
);

CREATE INDEX IF NOT EXISTS idx_tracker_data_user_date ON tracker_data (user_id, date DESC);

-- ── REMINDER SCHEDULES & ACKS (Sprint 17) ────────────────────────────────────
-- reminder_schedules: admin-configured reminder times per type (global or per-patient)
CREATE TABLE IF NOT EXISTS reminder_schedules (
  id                  SERIAL PRIMARY KEY,
  patient_id          INT REFERENCES users(id) ON DELETE CASCADE,  -- NULL = global
  type                VARCHAR(20) NOT NULL CHECK (type IN ('water','activity','weight','acv')),
  times               TEXT[]      NOT NULL DEFAULT '{}',  -- e.g. ['07:00','13:00']
  max_retries         INT         NOT NULL DEFAULT 3,
  retry_interval_min  INT         NOT NULL DEFAULT 5,
  active              BOOLEAN     NOT NULL DEFAULT true,
  created_by          INT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (patient_id, type)
);

CREATE INDEX IF NOT EXISTS idx_reminder_schedules_active
  ON reminder_schedules(active) WHERE active = true;

-- reminder_acks: tracks each sent reminder and whether the patient acknowledged it
CREATE TABLE IF NOT EXISTS reminder_acks (
  id            SERIAL PRIMARY KEY,
  patient_id    INT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          VARCHAR(20) NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  sent_at       TIMESTAMPTZ DEFAULT NOW(),
  retry_count   INT         DEFAULT 0,
  acked         BOOLEAN     DEFAULT false,
  acked_at      TIMESTAMPTZ,
  UNIQUE (patient_id, type, scheduled_for)
);

CREATE INDEX IF NOT EXISTS idx_reminder_acks_pending
  ON reminder_acks(acked, sent_at) WHERE acked = false;

-- ── LIVE CHECK CONSTRAINT MIGRATION ──────────────────────────────────────────
-- The CREATE TABLE IF NOT EXISTS above won't update CHECK constraints on an
-- existing table. These DO statements safely drop and re-add the constraints
-- so existing deployments pick up the new 'ai' source and expanded categories.
DO $$
BEGIN
  -- foods source: add 'ai'
  ALTER TABLE foods DROP CONSTRAINT IF EXISTS foods_source_check;
  ALTER TABLE foods ADD CONSTRAINT foods_source_check
    CHECK (source IN ('nin','usda','off','manual','ai'));

  -- foods category: add pulse, meat, beverage, spice
  ALTER TABLE foods DROP CONSTRAINT IF EXISTS foods_category_check;
  ALTER TABLE foods ADD CONSTRAINT foods_category_check
    CHECK (category IN (
      'dairy','grain','vegetable','fruit','nut','oil',
      'supplement','branded','other',
      'pulse','meat','beverage','spice'
    ));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Check constraint migration skipped: %', SQLERRM;
END $$;
