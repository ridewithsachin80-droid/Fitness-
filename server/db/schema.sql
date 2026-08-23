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

-- Coach messages: track when the member has read a note, so the Today page
-- only shows unread ones and read history moves into the notification bell.
ALTER TABLE monitor_notes ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

-- Biological sex — required by the Mifflin-St Jeor BMR equation used for TDEE.
-- Nullable: when unset, the app falls back to a sex-neutral average and tells
-- the member to ask their coach to set it.
ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS gender VARCHAR(10);

-- Cardio entries on a workout session, e.g.
-- [{ "type":"running", "duration_min":30, "speed_kmh":9, "distance_km":4.5 }]
-- Stored as JSONB rather than its own table: entries are always read and
-- written with their session, and never queried independently.
ALTER TABLE workout_sessions ADD COLUMN IF NOT EXISTS cardio JSONB DEFAULT '[]';

-- Per-member portion memory. "1 katori" is not a fixed weight — it depends on
-- whose kitchen the katori came from. When a member corrects the grams the AI
-- suggested, we remember it and use their figure next time.
--
-- Keyed on a normalised phrase ("katori dal", "glass milk") rather than the
-- food id, because the unit is the thing being learned, not the food.
CREATE TABLE IF NOT EXISTS member_portions (
  id          SERIAL PRIMARY KEY,
  patient_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phrase      VARCHAR(80)  NOT NULL,
  grams       NUMERIC(7,1) NOT NULL,
  samples     INT          DEFAULT 1,
  updated_at  TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (patient_id, phrase)
);
CREATE INDEX IF NOT EXISTS idx_member_portions_patient
  ON member_portions(patient_id);

-- Macro trials. Coach-facing only: members never see the trial, only their
-- targets changing. Blinding is deliberate — a member told mid-trial that
-- they're doing worse on the current arm changes their behaviour, which
-- destroys the measurement being taken.
--
-- Arms are stored with their full macro targets so the analysis can prove
-- calories and protein were actually held constant, which is the whole basis
-- for attributing any difference to the carb/fat split.
CREATE TABLE IF NOT EXISTS macro_trials (
  id            SERIAL PRIMARY KEY,
  patient_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  coach_id      INT REFERENCES users(id) ON DELETE SET NULL,
  status        VARCHAR(12) NOT NULL DEFAULT 'running'
                CHECK (status IN ('running','completed','abandoned')),
  arm_a         JSONB NOT NULL,          -- { label, kcal, protein_g, carbs_g, fat_g }
  arm_b         JSONB NOT NULL,
  arm_days      INT  NOT NULL DEFAULT 28,
  washout_days  INT  NOT NULL DEFAULT 10, -- discarded at the start of each arm
  current_arm   CHAR(1) DEFAULT 'A' CHECK (current_arm IN ('A','B')),
  a_started_on  DATE NOT NULL,
  b_started_on  DATE,
  completed_on  DATE,
  result        JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_macro_trials_patient
  ON macro_trials(patient_id, status);

-- Members can now enter their own lab results, so we record who did.
-- `entered_by` matters for trust: a coach transcribing from a PDF and a member
-- typing from their phone deserve different confidence, and the analysis
-- surfaces which it was rather than presenting all values as equal.
ALTER TABLE lab_values ADD COLUMN IF NOT EXISTS entered_by INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE lab_values ADD COLUMN IF NOT EXISTS entered_role VARCHAR(10);
ALTER TABLE lab_values ADD COLUMN IF NOT EXISTS lab_name VARCHAR(120);
ALTER TABLE lab_values ADD COLUMN IF NOT EXISTS notes TEXT;

-- Notification channel preferences. Default ON for push and WhatsApp because
-- a coaching product that cannot reach its members is not coaching; SMS is
-- opt-in since it costs per message and reads as more intrusive.
--
-- notify_opted_out is separate from the individual flags on purpose: turning
-- off one channel is a preference, opting out is a withdrawal of consent and
-- must survive anyone toggling the others back on.
ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS notify_push      BOOLEAN DEFAULT true;
ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS notify_whatsapp  BOOLEAN DEFAULT true;
ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS notify_sms       BOOLEAN DEFAULT false;
ALTER TABLE patient_profiles ADD COLUMN IF NOT EXISTS notify_opted_out BOOLEAN DEFAULT false;

-- Delivery log. Needed to answer "did she actually get it?", to stop paying
-- for a channel that silently fails, and to prove consent was honoured.
CREATE TABLE IF NOT EXISTS message_log (
  id           SERIAL PRIMARY KEY,
  user_id      INT REFERENCES users(id) ON DELETE CASCADE,
  channel      VARCHAR(12) NOT NULL,
  template_key VARCHAR(40),
  ok           BOOLEAN NOT NULL,
  detail       TEXT,
  sent_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_message_log_user ON message_log(user_id, sent_at DESC);

-- Clean reference bounds that were stored as NaN. Postgres NUMERIC accepts
-- NaN as a legitimate value, so a non-numeric bound on a report ("< 100", "-")
-- became parseFloat(...) = NaN and was stored happily, then rendered as
-- "ref NaN-100.00". Null is the honest representation of "not printed".
UPDATE lab_values SET ref_min = NULL WHERE ref_min IS NOT NULL AND ref_min = 'NaN'::numeric;
UPDATE lab_values SET ref_max = NULL WHERE ref_max IS NOT NULL AND ref_max = 'NaN'::numeric;

-- Recompute status for any row whose bounds have just changed, so a value
-- previously compared against NaN is not left mislabelled.
UPDATE lab_values SET status = CASE
    WHEN ref_min IS NOT NULL AND value < ref_min THEN 'low'
    WHEN ref_max IS NOT NULL AND value > ref_max THEN 'high'
    ELSE 'normal' END
  WHERE status IS NULL OR status NOT IN ('low','normal','high')
     OR (ref_min IS NULL AND ref_max IS NULL AND status <> 'normal');

-- Backfill muscle_group for exercises created without one (AI chat used to
-- create name-only rows, which /muscle-coverage silently skipped). Idempotent:
-- only touches rows still NULL, and never overwrites a coach's own value.
UPDATE exercises SET muscle_group = 'chest'
  WHERE muscle_group IS NULL AND (name ILIKE '%bench%' OR name ILIKE '%chest%'
    OR name ILIKE '%pec%' OR name ILIKE '%fly%' OR name ILIKE '%push up%'
    OR name ILIKE '%pushup%' OR name ILIKE '%push-up%' OR name ILIKE '%dip%');
UPDATE exercises SET muscle_group = 'back'
  WHERE muscle_group IS NULL AND (name ILIKE '%row%' OR name ILIKE '%pull up%'
    OR name ILIKE '%pullup%' OR name ILIKE '%pull-up%' OR name ILIKE '%lat %'
    OR name ILIKE '%deadlift%' OR name ILIKE '%back%' OR name ILIKE '%pulldown%'
    OR name ILIKE '%shrug%');
UPDATE exercises SET muscle_group = 'legs'
  WHERE muscle_group IS NULL AND (name ILIKE '%squat%' OR name ILIKE '%leg%'
    OR name ILIKE '%lunge%' OR name ILIKE '%calf%' OR name ILIKE '%quad%'
    OR name ILIKE '%hamstring%' OR name ILIKE '%glute%' OR name ILIKE '%hip thrust%');
UPDATE exercises SET muscle_group = 'shoulders'
  WHERE muscle_group IS NULL AND (name ILIKE '%shoulder%' OR name ILIKE '%overhead%'
    OR name ILIKE '%military%' OR name ILIKE '%lateral raise%' OR name ILIKE '%delt%'
    OR name ILIKE '%arnold%' OR name ILIKE '%upright%');
UPDATE exercises SET muscle_group = 'arms'
  WHERE muscle_group IS NULL AND (name ILIKE '%curl%' OR name ILIKE '%bicep%'
    OR name ILIKE '%tricep%' OR name ILIKE '%pushdown%' OR name ILIKE '%hammer%'
    OR name ILIKE '%forearm%' OR name ILIKE '%preacher%');
UPDATE exercises SET muscle_group = 'core'
  WHERE muscle_group IS NULL AND (name ILIKE '%abs%' OR name ILIKE '%core%'
    OR name ILIKE '%plank%' OR name ILIKE '%crunch%' OR name ILIKE '%sit up%'
    OR name ILIKE '%situp%' OR name ILIKE '%oblique%' OR name ILIKE '%leg raise%');
CREATE INDEX IF NOT EXISTS idx_monitor_notes_patient_unread
  ON monitor_notes(patient_id, read_at);

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

-- ── RESISTANCE TRAINING (Phase 1: freeform logging) ──────────────────────────
-- Normalized (not JSONB) on purpose — Phase 3's per-exercise volume trends and
-- 1RM tracking need real SQL aggregation across sessions, which is much
-- simpler with rows than unpacking JSON arrays in application code.

CREATE TABLE IF NOT EXISTS exercises (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(100) NOT NULL,
  muscle_group VARCHAR(50),       -- 'chest','back','legs','shoulders','arms','core','full_body'
  equipment    VARCHAR(50),       -- 'barbell','dumbbell','machine','bodyweight','cable','band'
  created_by   INT REFERENCES users(id) ON DELETE SET NULL,  -- NULL = built-in seeded exercise
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(name)
);

CREATE INDEX IF NOT EXISTS idx_exercises_muscle_group ON exercises(muscle_group);

CREATE TABLE IF NOT EXISTS workout_sessions (
  id           SERIAL PRIMARY KEY,
  patient_id   INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  duration_min INT,
  notes        TEXT,
  program_id   INT,               -- nullable now; FK added in Phase 2 once workout_programs exists
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(patient_id, session_date)
);

CREATE INDEX IF NOT EXISTS idx_workout_sessions_patient_date
  ON workout_sessions(patient_id, session_date DESC);

CREATE TABLE IF NOT EXISTS session_sets (
  id          SERIAL PRIMARY KEY,
  session_id  INT NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_id INT NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
  set_number  INT NOT NULL,
  reps        INT NOT NULL,
  weight_kg   NUMERIC(6,2) NOT NULL DEFAULT 0,  -- 0 = bodyweight-only set
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_sets_session  ON session_sets(session_id);
CREATE INDEX IF NOT EXISTS idx_session_sets_exercise ON session_sets(exercise_id);

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

-- ── WORKOUT SESSIONS UNIQUE CONSTRAINT MIGRATION ─────────────────────────────
-- Defensive: in case workout_sessions already exists from an earlier deploy
-- without the UNIQUE(patient_id, session_date) constraint above.
DO $$
BEGIN
  ALTER TABLE workout_sessions ADD CONSTRAINT workout_sessions_patient_date_unique
    UNIQUE (patient_id, session_date);
EXCEPTION WHEN duplicate_table THEN NULL;       -- constraint already exists
WHEN OTHERS THEN
  RAISE NOTICE 'workout_sessions unique constraint migration skipped: %', SQLERRM;
END $$;

-- ── RESISTANCE TRAINING (Phase 2: coach-assigned programs) ───────────────────
CREATE TABLE IF NOT EXISTS workout_programs (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  patient_id INT REFERENCES users(id) ON DELETE CASCADE,  -- NULL = reusable template, not yet assigned to anyone
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  active     BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- At most one ACTIVE program per patient — avoids any ambiguity about which
-- program is "the" current one (no ORDER BY + LIMIT 1 tie-breaking needed
-- anywhere in application code). Templates (patient_id IS NULL) are exempt.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_program_per_patient
  ON workout_programs(patient_id) WHERE active = true AND patient_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS program_exercises (
  id              SERIAL PRIMARY KEY,
  program_id      INT NOT NULL REFERENCES workout_programs(id) ON DELETE CASCADE,
  exercise_id     INT NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
  day_number      INT NOT NULL DEFAULT 1,
  day_label       VARCHAR(50),       -- e.g. 'Push Day' — UI falls back to 'Day N' if null
  order_index     INT NOT NULL DEFAULT 0,
  target_sets     INT NOT NULL DEFAULT 3,
  target_reps_min INT NOT NULL DEFAULT 8,
  target_reps_max INT,               -- nullable; if set, UI shows a range like "8-12"
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_program_exercises_program
  ON program_exercises(program_id, day_number, order_index);

-- ── WORKOUT SESSIONS → PROGRAM FK MIGRATION ──────────────────────────────────
-- workout_sessions.program_id was added in Phase 1 as a bare column (no FK
-- yet, since workout_programs didn't exist then). Add the real FK now.
DO $$
BEGIN
  ALTER TABLE workout_sessions ADD CONSTRAINT workout_sessions_program_fk
    FOREIGN KEY (program_id) REFERENCES workout_programs(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;      -- constraint already exists
WHEN OTHERS THEN
  RAISE NOTICE 'workout_sessions program FK migration skipped: %', SQLERRM;
END $$;

