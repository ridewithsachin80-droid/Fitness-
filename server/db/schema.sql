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
  protocol_supplements JSONB DEFAULT NULL,   -- ["b12","d3","fishoil",...] or null
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
