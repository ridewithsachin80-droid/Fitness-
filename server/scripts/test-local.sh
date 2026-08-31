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
trap cleanup EXIT

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
LOGIC_SUITES="test-coach-view test-rename-contracts smoke-routes test-member-questions test-coach-program test-coach-questions"
DB_SUITES="test-journey test-gaps test-labs test-macrolab test-lab-insight"

failed=0
total_pass=0

run_suite() {
  local name=$1
  local log="/tmp/fitlife-$name.log"
  if [ ! -f "scripts/$name.js" ]; then
    printf "  %-24s %s\n" "$name" "— not present, skipped"
    return
  fi
  if timeout 300 node "scripts/$name.js" >"$log" 2>&1; then
    local n; n=$(grep -c '✓' "$log")
    total_pass=$((total_pass + n))
    printf "  ✓ %-22s %s assertions\n" "$name" "$n"
  else
    failed=$((failed + 1))
    printf "  ✗ %-22s FAILED\n" "$name"
    grep -E '✗|Error|error:' "$log" | head -4 | sed 's/^/      /'
  fi
}

echo
echo "▸ Logic suites (no database needed)"
for s in $LOGIC_SUITES; do run_suite "$s"; done

echo
echo "▸ Database suites (these self-seed; no fixtures required)"
for s in $DB_SUITES; do run_suite "$s"; done

echo
if [ "$failed" -eq 0 ]; then
  echo "✅ All suites passed — $total_pass assertions"
else
  echo "❌ $failed suite(s) failed — see /tmp/fitlife-<suite>.log"
fi
exit $failed
