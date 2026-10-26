#!/usr/bin/env bash
#
# test-local.sh — stand up a throwaway Postgres, load schema.sql, run every suite.
#
# WHY THIS EXISTS
# ---------------
# Five suites (gaps, labs, macrolab, lab-insight, journey) refuse to start
# unless DATABASE_URL contains "localhost" — test-journey wipes tables, so the
# guard stops someone pointing it at Railway and deleting real member data.
#
# They do NOT need fixtures. Each one seeds whatever it needs and cleans up
# after itself, so a bare schema is enough. The only thing that was ever
# missing is this: something that creates the database and sets the two env
# vars. Without it the barrier was setup friction, and 252 assertions sat
# unrun for months.
#
# The pure-logic suites (coach-view, rename-contracts, smoke-routes,
# member-questions, coach-program) don't need a database at all, but they run
# here too so one command is the whole gate.
#
# USAGE
#   ./scripts/test-local.sh              # start PG if needed, run everything
#   ./scripts/test-local.sh --keep       # leave PG running afterwards
#   ./scripts/test-local.sh --db-only    # just set up the DB, print the DSN
#
# REQUIREMENTS
#   PostgreSQL binaries on PATH, or at /usr/lib/postgresql/*/bin (Debian/Ubuntu).
#   Nothing else — no Docker, no service, no sudo.

set -uo pipefail

PGPORT=5433                       # deliberately NOT 5432, so this can never
                                  # collide with a real local Postgres
PGDATA=${PGDATA:-/tmp/fitlife-pgdata}
DBNAME=fitlife_test
SOCKDIR=/tmp
KEEP=0
DB_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --keep)    KEEP=1 ;;
    --db-only) DB_ONLY=1; KEEP=1 ;;
    *) echo "Unknown option: $arg"; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.." || exit 1
ROOT=$(pwd)

# On GitHub, also write what failed as an annotation (17 Oct 2026). The job
# log is stored on a server our build workspace cannot reach; annotations can
# be read through the GitHub API. Output only — no check changes.
failed_suites=""
if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
  GATE_OUT=$(mktemp)
  exec > >(tee "$GATE_OUT") 2>&1
  gh_annotate() {
    local code=$? body="" s log
    [ "$code" -eq 0 ] && return
    sleep 1
    body=$(grep -E -A4 '✗|FAILED|could not run' "$GATE_OUT" | head -40)
    for s in $failed_suites; do
      log="${RESULTS_DIR:-}/$s.log"
      [ -f "$log" ] && body="$body
── $s.log ──
$(grep -E -B2 -A3 '✗|Error|error:|AssertionError|Timeout' "$log" | head -40)"
    done
    [ -f "${RESULTS_DIR:-}/ui-tests.log" ] && grep -q '✗\|Error' "${RESULTS_DIR}/ui-tests.log" && body="$body
── ui-tests.log (✗ lines) ──
$(grep -E -B2 -A3 '✗|Error' "${RESULTS_DIR}/ui-tests.log" | head -40)"
    # Short, one per failed suite: a very long annotation is dropped by GitHub
    # (17 Oct 2026: a 120-line one never arrived).
    enc() { printf '%s' "$1" | head -c 900 | sed -e 's/%/%25/g' -e 's/\r/%0D/g' -e 's/::/: :/g' | awk '{printf "%s%%0A", $0}'; }
    for s in $failed_suites; do
      log="${RESULTS_DIR:-}/$s.log"
      [ -f "$log" ] && echo "::error title=Gate: $s failed::$(enc "$(grep -E '✗|Error|AssertionError|Timeout' "$log" | head -6)")"
    done
    # Fixes-2p (20 Oct 2026): on 864590c ui-tests failed on GitHub and this line showed only a PASSING
    # check whose name contains "✗" (the old pattern matched it), with no cause. Match failure lines only,
    # and when there are none (a crash, a time limit, a missing summary) send the end of the log instead.
    if [ "${ui_failed:-0}" = "1" ] && [ -f "${RESULTS_DIR:-}/ui-tests.log" ]; then
      ui_fail_lines=$(grep -E '^\s*✗' "${RESULTS_DIR}/ui-tests.log" | head -6)
      echo "::error title=Gate: ui-tests failed (${ui_reason:-see log})::$(enc "${ui_fail_lines:-$(grep -E 'Error|ERR_|Killed|heap|Timed out|Timeout' "${RESULTS_DIR}/ui-tests.log" | head -3)
── last lines ──
$(tail -8 "${RESULTS_DIR}/ui-tests.log")}")"
    fi
    [ -z "$failed_suites" ] && echo "::error title=Test gate failed (exit $code)::$(enc "${body:-no ✗ line printed}")"
    [ -n "${GITHUB_STEP_SUMMARY:-}" ] && printf '### Test gate failed\n\n```\n%s\n```\n' "$body" >> "$GITHUB_STEP_SUMMARY"
  }
  trap gh_annotate EXIT
fi

# ── Locate the Postgres binaries ─────────────────────────────────────────────
if ! command -v initdb >/dev/null 2>&1; then
  for d in /usr/lib/postgresql/*/bin /opt/homebrew/opt/postgresql*/bin /usr/local/opt/postgresql*/bin; do
    [ -x "$d/initdb" ] && export PATH="$d:$PATH" && break
  done
fi

if ! command -v initdb >/dev/null 2>&1; then
  cat <<'EOF'
✗ PostgreSQL binaries not found.

  Ubuntu/Debian :  sudo apt-get install -y postgresql
  macOS         :  brew install postgresql@16

  Nothing needs to be running as a service — this script starts its own
  instance on port 5433 and tears it down again.
EOF
  exit 1
fi

echo "▸ Using $(initdb --version)"

# ── Privilege handling ───────────────────────────────────────────────────────
# Postgres refuses to run as root, by design. Normally irrelevant — a developer
# runs this as themselves — but in a container or CI image you often ARE root,
# and the failure is easy to miss if pg_ctl's stderr is swallowed. So: detect
# it, drop to an unprivileged user, and say so.
AS_USER=""
if [ "$(id -u)" = "0" ]; then
  for candidate in postgres pgtest; do
    id -u "$candidate" >/dev/null 2>&1 && AS_USER="$candidate" && break
  done
  if [ -z "$AS_USER" ]; then
    useradd -m pgtest >/dev/null 2>&1 && AS_USER=pgtest
  fi
  if [ -z "$AS_USER" ]; then
    echo "✗ Running as root, and no unprivileged user available to run Postgres as."
    echo "  Re-run as a normal user, or create one: useradd -m pgtest"
    exit 1
  fi
  echo "▸ Running as root — Postgres will run as '$AS_USER'"
fi

# Run a Postgres command, dropping privileges when we're root.
pg_run() {
  if [ -n "$AS_USER" ]; then
    su "$AS_USER" -c "PATH=\"$PATH\" $*"
  else
    eval "$*"
  fi
}

# ── Start a throwaway instance ───────────────────────────────────────────────
# We only ever stop an instance this script started. If one is already
# listening on the port, it is someone else's and we leave it alone.
started_here=0
if ! pg_isready -h 127.0.0.1 -p $PGPORT >/dev/null 2>&1; then
  if [ ! -d "$PGDATA/base" ]; then
    echo "▸ Creating a fresh cluster at $PGDATA"
    rm -rf "$PGDATA"; mkdir -p "$PGDATA"
    [ -n "$AS_USER" ] && chown -R "$AS_USER" "$PGDATA"
    if ! pg_run "initdb -D $PGDATA -U postgres" >/tmp/fitlife-initdb.log 2>&1; then
      echo "✗ initdb failed:"; tail -5 /tmp/fitlife-initdb.log; exit 1
    fi
  fi
  echo "▸ Starting Postgres on port $PGPORT"
  # -k puts the unix socket somewhere writable; the default /var/run/postgresql
  # needs root and the failure message is unhelpfully cryptic.
  #
  # stderr is NOT swallowed here on purpose. An earlier version hid it, and a
  # start that was silently failing looked like a pass because a Postgres
  # started by hand happened to be listening on the same port.
  touch /tmp/fitlife-pg.log
  [ -n "$AS_USER" ] && chown "$AS_USER" /tmp/fitlife-pg.log
  if ! pg_run "pg_ctl -D $PGDATA -o '-p $PGPORT -k $SOCKDIR' -l /tmp/fitlife-pg.log start" \
       >/tmp/fitlife-start.log 2>&1; then
    echo "✗ Could not start Postgres:"; tail -6 /tmp/fitlife-start.log; tail -6 /tmp/fitlife-pg.log
    exit 1
  fi
  started_here=1
  for _ in $(seq 1 20); do
    pg_isready -h 127.0.0.1 -p $PGPORT >/dev/null 2>&1 && break
    sleep 0.5
  done
fi

if ! pg_isready -h 127.0.0.1 -p $PGPORT >/dev/null 2>&1; then
  echo "✗ Postgres did not come up. Log:"; tail -20 /tmp/fitlife-pg.log; exit 1
fi

cleanup() {
  if [ "$KEEP" = "0" ] && [ "$started_here" = "1" ]; then
    echo "▸ Stopping Postgres"
    pg_run "pg_ctl -D $PGDATA stop -m fast" >/dev/null 2>&1
  fi
}
# One EXIT trap for both jobs (19 Oct 2026). A second `trap … EXIT` replaces
# the first, so the GitHub failure annotation above never ran and two gate
# failures on GitHub arrived with no detail. Annotate first, then stop Postgres,
# and keep the original exit code.
on_exit() {
  local code=$?
  if declare -F gh_annotate >/dev/null; then (exit "$code"); gh_annotate; fi
  cleanup
  exit "$code"
}
trap on_exit EXIT

# ── Rebuild the database from schema.sql ─────────────────────────────────────
# Dropped and recreated every run, so this also verifies that schema.sql still
# loads cleanly on an EMPTY database. That is not academic: schema.sql once had
# an UPDATE positioned above the CREATE TABLE it targeted, and because
# startup.js runs the file as a single query, one error rolled back the whole
# batch and a fresh deploy created zero tables.
echo "▸ Rebuilding $DBNAME from db/schema.sql"
psql -h 127.0.0.1 -p $PGPORT -U postgres -q \
  -c "DROP DATABASE IF EXISTS $DBNAME;" -c "CREATE DATABASE $DBNAME;" >/dev/null 2>&1

if ! psql -h 127.0.0.1 -p $PGPORT -U postgres -d $DBNAME -v ON_ERROR_STOP=1 \
     -q -f db/schema.sql >/tmp/fitlife-schema.log 2>&1; then
  echo "✗ schema.sql failed to load on an empty database:"
  grep -iE "error" /tmp/fitlife-schema.log | head -5
  exit 1
fi

TABLES=$(psql -h 127.0.0.1 -p $PGPORT -U postgres -d $DBNAME -tAc \
  "select count(*) from information_schema.tables where table_schema='public'")
echo "  ✓ schema loaded — $TABLES tables"

# The DSN must literally contain "localhost": the DB-backed suites check for
# that substring before they will run, because test-journey wipes tables and
# the guard is what stops it ever pointing at Railway.
export DATABASE_URL="postgres://postgres@localhost:$PGPORT/$DBNAME"
export JWT_SECRET="${JWT_SECRET:-local-test-secret}"
export NODE_ENV=test

if [ "$DB_ONLY" = "1" ]; then
  echo
  echo "Database ready. To run a suite by hand:"
  echo "  export DATABASE_URL=\"$DATABASE_URL\" JWT_SECRET=\"$JWT_SECRET\""
  echo "  node scripts/test-gaps.js"
  exit 0
fi

# ── Run every suite ──────────────────────────────────────────────────────────
# Every test-*.js in this directory is listed below. That is the point: a suite
# that exists but is not in the gate is 200 assertions of work that never runs
# again, and nobody can tell it apart from one that does. Fourteen suites were
# in exactly that state — written, passing, invisible.
#
# The only file NOT here is smokeTest.js, and deliberately: it checks a running
# deployment over HTTP, so it belongs after a deploy, not in `npm test`. It says
# so itself now if you run it with nothing listening.
#
# Split by whether the suite needs Postgres, which is just whether it carries
# the localhost guard. Both lists run after DATABASE_URL is exported, so this is
# for reading, not for wiring.
LOGIC_SUITES="test-ci-completion test-mixed-request-answer test-sleep-clarification test-draft-food-edits test-ai-draft-food-edits test-food-clarifications test-voice-phase2 test-coach-view test-rename-contracts smoke-routes test-member-questions \
test-coach-program test-coach-questions test-image-routing \
test-layout-contracts test-session-logic test-push-vapid test-twa-contract test-hands-free test-day-lib test-offline-queue test-workout-session-logic test-ci55-regressions test-speech-presence"

DB_SUITES="test-reliable-writes test-workout-merge test-weekly-report test-journey test-gaps test-coach-triage test-ai-reads test-coach-circuits test-labs test-macrolab test-lab-insight \
test-sprint1 test-aichat test-messaging test-adaptive test-food-lookup test-features \
test-food-learning test-portion-memory test-ai-workout-sets test-cardio \
test-learning-model test-evals test-foods-queue test-nudges test-diet-plan test-coach-assign test-nutrition-contract test-food-propagate test-session test-morning-nudge test-member-apply test-quick-log test-diet-studio test-diet-fit test-member-plan test-safety test-food-cooked test-day-merge test-plate-photo test-progress-photos test-plan-pdf test-swaps test-weekly test-audit test-voice-pilot test-sleep-target test-member-foods test-known-fixes test-usual-foods test-food-preparation test-nutrient-unknown test-target-origin test-nutrient-provenance test-learning-features test-voice-fallback-test test-voice-calibration test-voice-calibration-2y test-voice-calibration-2z test-voice-calibration-3a test-voice-calibration-3b test-voice-calibration-3c test-voice-calibration-3d"

MODULE_SUITES="test-connection-recovery test-timeline-meal-entry test-ai-chat-scroll test-ai-food-caption-sync test-progress-weight test-sleep-clarification-ui test-ai-draft-food-edits-ui test-ai-food-clarifications test-modal-accessibility test-ai-save-receipts test-ai-preview-status test-logging-phase2 test-built-css test-private-api-cache test-portion-defaults test-logging-phase1 test-private-api-cache-browser test-voice-evidence-robot test-calibration-mode"
RESULTS_DIR="${TEST_RESULTS_DIR:-$ROOT/../qa/results}"
mkdir -p "$RESULTS_DIR"

failed=0
total_pass=0

run_suite() {
  local name=$1
  local log="$RESULTS_DIR/$name.log"
  local script="scripts/$name.js"
  [ -f "$script" ] || script="scripts/$name.mjs"
  if [ ! -f "$script" ]; then
    printf "  %-24s %s\n" "$name" "— missing required suite"
    failed=$((failed + 1))
    return
  fi
  if timeout 300 node "$script" >"$log" 2>&1; then
    local n; n=$(grep -c '✓' "$log")
    # A suite that exits 0 having asserted NOTHING is not a pass. test-weekly-report
    # skipped itself for months because it wanted TEST_DATABASE_URL and the gate
    # exports DATABASE_URL — 214 lines of coverage printing a green tick and
    # "0 assertions", which reads like a pass unless you look at the number.
    if [ "$n" -eq 0 ]; then
      failed=$((failed + 1))
      printf "  ✗ %-22s RAN BUT ASSERTED NOTHING — skipped itself, or its output format changed\n" "$name"
      head -5 "$log" | sed 's/^/      /'
      return
    fi
    total_pass=$((total_pass + n))
    printf "  ✓ %-22s %s assertions\n" "$name" "$n"
  else
    failed=$((failed + 1))
    failed_suites="$failed_suites $name"
    printf "  ✗ %-22s FAILED\n" "$name"
    grep -E '✗|Error|error:' "$log" | head -4 | sed 's/^/      /'
  fi
}

echo
echo "▸ Logic suites (no database needed)"
for s in $LOGIC_SUITES; do run_suite "$s"; done
for s in $MODULE_SUITES; do run_suite "$s"; done

echo
echo "▸ Database suites (these self-seed; no fixtures required)"
for s in $DB_SUITES; do run_suite "$s"; done

echo
echo "▸ Lint (undefined identifiers — Sprint 12b)"
# The one rule a bundler will not enforce. Optional: prints NOT RUN when ESLint
# is absent (npm run lint:install), fails the gate when it finds a problem.
if node scripts/lint-undef.mjs; then :; else failed=$((failed + 1)); fi
echo

echo "▸ UI suites (jsdom — needs client dependencies installed)"
# Bundles the real client and mounts it in jsdom. Deliberately NOT written as
# "skip if the dependencies are missing": a suite that skips itself while
# printing a green tick is how test-weekly-report reported 214 lines of
# coverage and zero assertions for months. If it cannot run, it fails and says
# what to install.
if [ ! -f "scripts/ui-tests.mjs" ]; then
  printf "  %-24s %s\n" "ui-tests" "— not present, skipped"
elif [ ! -d "$ROOT/../node_modules/react" ] && [ ! -d "$ROOT/../client/node_modules/react" ]; then
  printf "  %-24s %s\n" "ui-tests" "✗ client dependencies missing — run: npm install (from the repo root)"
  failed=$((failed + 1))
else
  uilog="$RESULTS_DIR/ui-tests.log"
  if timeout 600 node scripts/ui-tests.mjs >"$uilog" 2>&1; then
    n=$(grep -c '✓' "$uilog")
    if ! grep -Eq '^✅ ui-tests: [1-9][0-9]* passed, 0 failed$' "$uilog"; then
      printf "  %-24s %s\n" "ui-tests" "✗ missing successful completion summary"
      ui_failed=1; ui_reason="no completion summary"
      failed=$((failed + 1))
    elif [ "$n" -eq 0 ]; then
      printf "  %-24s %s\n" "ui-tests" "✗ exited 0 having asserted nothing"
      ui_failed=1; ui_reason="asserted nothing"
      failed=$((failed + 1))
    else
      printf "  %-24s %s\n" "ui-tests" "✓ $n assertions"
      total_pass=$((total_pass + n))
    fi
  else
    ui_status=$?
    ui_failed=1; ui_reason="exit $ui_status$([ "$ui_status" = 124 ] && echo ', 600 s time limit')"
    printf "  %-24s %s\n" "ui-tests" "✗ FAILED (exit $ui_status)"
    grep -E '✗|could not run' "$uilog" | head -8 | sed 's/^/        /'
    # Uncaught exceptions, heap failures and signals do not necessarily include
    # our assertion marker. Keep the actual failure visible in GitHub's log.
    echo "        Last 40 lines of the UI process log:"
    tail -40 "$uilog" | sed 's/^/        /'
    failed=$((failed + 1))
  fi
fi

echo
if [ "$failed" -eq 0 ]; then
  echo "✅ All suites passed — $total_pass assertions"
else
  echo "❌ $failed suite(s) failed — see $RESULTS_DIR/<suite>.log"
fi
exit $failed
