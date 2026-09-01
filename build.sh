#!/bin/bash
set -e  # Exit on any error

echo "=== Health Monitor Build Script v2 ==="
echo "Working directory: $(pwd)"
echo "Directory contents:"
ls -la

# ── Find project root ────────────────────────────────────────────────────────
# Handle cases where Railway runs from repo root or a subdirectory
ROOT_DIR="$(pwd)"

if [ -d "client" ] && [ -d "server" ]; then
  ROOT_DIR="$(pwd)"
  echo "✅ Found client/ and server/ in $(pwd)"
elif [ -d "../client" ] && [ -d "../server" ]; then
  ROOT_DIR="$(cd .. && pwd)"
  echo "✅ Found client/ and server/ in $ROOT_DIR"
else
  echo "❌ Cannot find client/ and server/ directories"
  echo "Current directory contents:"
  find . -maxdepth 2 -type d | sort
  exit 1
fi

# ── Build React client ────────────────────────────────────────────────────────
echo ""
echo "=== Building React client ==="
cd "$ROOT_DIR/client"
echo "Client dir: $(pwd)"

npm install --prefer-offline 2>&1 | tail -5
npm run build 2>&1
echo "✅ Client build complete"

# ── Install server dependencies ───────────────────────────────────────────────
echo ""
echo "=== Installing server dependencies ==="
cd "$ROOT_DIR/server"
echo "Server dir: $(pwd)"

# --omit=dev: nothing the server RUNS comes from devDependencies. `npm start`
# is `node index.js`; nodemon, esbuild and jsdom exist only for `npm test` and
# the UI suites, which never execute on Railway.
#
# Without this flag every test dependency is installed on every deploy, which
# is why the jsdom/esbuild tooling was held back in the first place — the cost
# landed on the build rather than on the developer running the tests. With it,
# server devDependencies are free and that trade-off disappears.
npm install --omit=dev --prefer-offline 2>&1 | tail -5
echo "✅ Server install complete"

echo ""
echo "=== Build finished successfully ==="
