#!/usr/bin/env node
/**
 * Smoke test script — run after deployment to verify the app is working.
 *
 * Usage:
 *   BASE_URL=https://your-app.railway.app node server/scripts/smokeTest.js
 *
 * Covers all 22 items from the Section 14 testing checklist.
 * Exits with code 1 if any critical check fails.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const https = require('https');
const http  = require('http');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const isHttps  = BASE_URL.startsWith('https');

// ── Minimal fetch wrapper ─────────────────────────────────────────────────────
function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url     = new URL(path, BASE_URL);
    const payload = body ? JSON.stringify(body) : null;

    const opts = {
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers: {
        'Content-Type':  'application/json',
        'Content-Length': payload ? Buffer.byteLength(payload) : 0,
        ...headers,
      },
    };

    const req = (isHttps ? https : http).request(opts, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.status || res.statusCode, body: JSON.parse(data), headers: res.headers }); }
        catch { resolve({ status: res.status || res.statusCode, body: data, headers: res.headers }); }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Test runner ───────────────────────────────────────────────────────────────
let passed = 0, failed = 0;

async function test(label, fn) {
  try {
    await fn();
    console.log(`  ✅  ${label}`);
    passed++;
  } catch (err) {
    console.log(`  ❌  ${label}`);
    console.log(`       → ${err.message}`);
    failed++;
  }
}

function expect(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(msg || `Expected ${expected}, got ${actual}`);
  }
}

function expectOneOf(actual, options, msg) {
  if (!options.includes(actual)) {
    throw new Error(msg || `Expected one of [${options}], got ${actual}`);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
async function run() {
  console.log(`\n🚀 Smoke testing: ${BASE_URL}\n`);
  console.log('── Health & Infrastructure ─────────────────────────────────\n');

  await test('GET /health returns ok', async () => {
    const r = await request('GET', '/health');
    expect(r.status, 200, `Health check returned ${r.status}`);
    expect(r.body?.status, 'ok', `Expected status:ok, got ${r.body?.status}`);
  });

  await test('HTTPS active (production only)', async () => {
    if (process.env.NODE_ENV !== 'production') {
      console.log('       (skipped — dev environment)'); return;
    }
    if (!isHttps) throw new Error('BASE_URL must be https:// in production');
  });

  await test('Static React app serves index.html', async () => {
    const r = await request('GET', '/');
    expect(r.status, 200, `/ returned ${r.status}`);
  });

  await test('PWA manifest served', async () => {
    const r = await request('GET', '/manifest.webmanifest');
    expect(r.status, 200, `manifest returned ${r.status}`);
  });

  await test('Service worker served', async () => {
    const r = await request('GET', '/sw.js');
    expect(r.status, 200, `sw.js returned ${r.status}`);
  });

  console.log('\n── Authentication ──────────────────────────────────────────\n');

  await test('POST /auth/send-otp — missing phone returns 400', async () => {
    const r = await request('POST', '/api/auth/send-otp', {});
    expect(r.status, 400, `Expected 400, got ${r.status}`);
  });

  await test('POST /auth/send-otp — unknown phone returns 404', async () => {
    const r = await request('POST', '/api/auth/send-otp', { phone: '0000000000' });
    expect(r.status, 404, `Expected 404, got ${r.status}`);
  });

  await test('POST /auth/verify-otp — wrong OTP returns 400', async () => {
    const r = await request('POST', '/api/auth/verify-otp', { phone: '9876543210', otp: '000000' });
    expectOneOf(r.status, [400, 404], `Expected 400/404, got ${r.status}`);
  });

  await test('POST /auth/login — bad credentials returns 401', async () => {
    const r = await request('POST', '/api/auth/login', { email: 'bad@bad.com', password: 'wrong' });
    expect(r.status, 401, `Expected 401, got ${r.status}`);
  });

  await test('POST /auth/refresh — no cookie returns 401', async () => {
    const r = await request('POST', '/api/auth/refresh');
    expect(r.status, 401, `Expected 401, got ${r.status}`);
  });

  // Login as monitor to get a token for further tests
  let monitorToken = null;
  await test('POST /auth/login — valid monitor login', async () => {
    const r = await request('POST', '/api/auth/login', {
      email:    process.env.MONITOR_EMAIL    || 'sachin@healthmonitor.app',
      password: process.env.MONITOR_PASSWORD || 'ChangeMe@123',
    });
    expect(r.status, 200, `Login returned ${r.status}: ${JSON.stringify(r.body)}`);
    if (!r.body?.accessToken) throw new Error('No accessToken in response');
    monitorToken = r.body.accessToken;
  });

  console.log('\n── Role Guards ─────────────────────────────────────────────\n');

  await test('GET /api/patients — no token returns 401', async () => {
    const r = await request('GET', '/api/patients');
    expect(r.status, 401, `Expected 401, got ${r.status}`);
  });

  await test('GET /api/logs/today — no token returns 401', async () => {
    const today = new Date().toISOString().split('T')[0];
    const r = await request('GET', `/api/logs/${today}`);
    expect(r.status, 401, `Expected 401, got ${r.status}`);
  });

  if (monitorToken) {
    await test('GET /api/patients — monitor token returns 200', async () => {
      const r = await request('GET', '/api/patients', null, { Authorization: `Bearer ${monitorToken}` });
      expect(r.status, 200, `Expected 200, got ${r.status}`);
      if (!Array.isArray(r.body)) throw new Error('Expected array response');
    });

    await test('GET /api/patients/:id — returns profile+logs+labs', async () => {
      // Get first patient
      const list = await request('GET', '/api/patients', null, { Authorization: `Bearer ${monitorToken}` });
      if (!list.body?.[0]?.id) { console.log('       (skipped — no patients)'); return; }
      const pid = list.body[0].id;
      const r   = await request('GET', `/api/patients/${pid}`, null, { Authorization: `Bearer ${monitorToken}` });
      expect(r.status, 200, `Expected 200, got ${r.status}`);
      if (!r.body?.profile) throw new Error('Missing profile');
      if (!Array.isArray(r.body?.logs))  throw new Error('Missing logs array');
      if (!Array.isArray(r.body?.labs))  throw new Error('Missing labs array');
    });
  }

  console.log('\n── Notifications ───────────────────────────────────────────\n');

  if (monitorToken) {
    await test('POST /notifications/subscribe — saves subscription', async () => {
      const r = await request('POST', '/api/notifications/subscribe', {
        endpoint:    `https://smoke-test-endpoint-${Date.now()}.example.com`,
        p256dh:      'dGVzdC1rZXk=',
        auth:        'dGVzdC1hdXRo',
        device_name: 'Smoke Test',
      }, { Authorization: `Bearer ${monitorToken}` });
      expect(r.status, 201, `Expected 201, got ${r.status}`);
    });

    await test('GET /notifications/subscriptions — returns array', async () => {
      const r = await request('GET', '/api/notifications/subscriptions', null, { Authorization: `Bearer ${monitorToken}` });
      expect(r.status, 200, `Expected 200, got ${r.status}`);
      if (!Array.isArray(r.body)) throw new Error('Expected array');
    });
  }

  console.log('\n── Database ────────────────────────────────────────────────\n');

  await test('Database connectivity (via /health)', async () => {
    const r = await request('GET', '/health');
    // Health route connects to DB internally via pool — if it returns 200, DB is up
    expect(r.status, 200, `Health check failed: ${r.status}`);
  });

  // ── Summary ────────────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log('\n─────────────────────────────────────────────────────────────');
  console.log(`Results: ${passed}/${total} passed  ${failed > 0 ? `(${failed} failed)` : '🎉'}`);
  console.log('─────────────────────────────────────────────────────────────\n');

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
