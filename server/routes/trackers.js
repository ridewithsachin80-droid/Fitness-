/**
 * /api/trackers  — Wearable device integration routes
 *
 * Handles:
 *  - OAuth flow  : Fitbit, WHOOP, Polar (GET /oauth/:provider  →  GET /oauth/:provider/callback)
 *  - Manual push : Health Connect (Android) pushes data  →  POST /healthconnect/sync
 *  - HART BLE    : Client sends parsed BLE readings      →  POST /ble/sync
 *  - Status      : GET /status          — which providers are connected
 *  - Disconnect  : DELETE /:provider    — revoke & clear tokens
 *  - Latest data : GET /data            — merged snapshot for the dashboard
 */

const express  = require('express');
const router   = express.Router();
const axios    = require('axios');
const auth     = require('../middleware/auth');
const pool     = require('../db/pool');

/* ─────────────────────────────────────────────────────────────────
   Provider configs  (add real client IDs/secrets in .env)
───────────────────────────────────────────────────────────────── */
const PROVIDERS = {
  fitbit: {
    authUrl:     'https://www.fitbit.com/oauth2/authorize',
    tokenUrl:    'https://api.fitbit.com/oauth2/token',
    apiBase:     'https://api.fitbit.com/1/user/-',
    scope:       'activity heartrate sleep oxygen_saturation',
    clientId:    process.env.FITBIT_CLIENT_ID     || 'FITBIT_CLIENT_ID',
    secret:      process.env.FITBIT_CLIENT_SECRET || 'FITBIT_SECRET',
  },
  whoop: {
    authUrl:     'https://api.prod.whoop.com/oauth/oauth2/auth',
    tokenUrl:    'https://api.prod.whoop.com/oauth/oauth2/token',
    apiBase:     'https://api.prod.whoop.com/developer/v1',
    scope:       'read:recovery read:sleep read:workout read:cycles read:body_measurement',
    clientId:    process.env.WHOOP_CLIENT_ID      || 'WHOOP_CLIENT_ID',
    secret:      process.env.WHOOP_CLIENT_SECRET  || 'WHOOP_SECRET',
  },
  polar: {
    authUrl:     'https://flow.polar.com/oauth2/authorization',
    tokenUrl:    'https://polarremote.com/v2/oauth2/token',
    apiBase:     'https://www.polaraccesslink.com/v3',
    scope:       'accesslink.read_all',
    clientId:    process.env.POLAR_CLIENT_ID      || 'POLAR_CLIENT_ID',
    secret:      process.env.POLAR_CLIENT_SECRET  || 'POLAR_SECRET',
  },
};

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
// SERVER_URL is the Express server base URL — used for OAuth callback URIs.
// In production set this to your Railway backend URL (e.g. https://your-app.railway.app).
// In dev it defaults to localhost:3000 (the Express port, not Vite's 5173).
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

/* ─────────────────────────────────────────────────────────────────
   Helper: upsert tracker token row
───────────────────────────────────────────────────────────────── */
async function saveToken(userId, provider, tokenData) {
  await pool.query(
    `INSERT INTO tracker_connections
       (user_id, provider, access_token, refresh_token, expires_at, raw)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id, provider)
     DO UPDATE SET
       access_token  = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       expires_at    = EXCLUDED.expires_at,
       raw           = EXCLUDED.raw,
       updated_at    = NOW()`,
    [
      userId,
      provider,
      tokenData.access_token,
      tokenData.refresh_token || null,
      tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000)
        : null,
      JSON.stringify(tokenData),
    ]
  );
}

/* ─────────────────────────────────────────────────────────────────
   Helper: get a valid access token (refresh if expired)
───────────────────────────────────────────────────────────────── */
async function getAccessToken(userId, provider) {
  const { rows } = await pool.query(
    `SELECT * FROM tracker_connections WHERE user_id=$1 AND provider=$2`,
    [userId, provider]
  );
  if (!rows.length) return null;

  const conn = rows[0];
  const cfg  = PROVIDERS[provider];

  // Refresh if expired (5-min buffer)
  if (conn.expires_at && new Date(conn.expires_at) < new Date(Date.now() + 300_000)) {
    if (!conn.refresh_token) return conn.access_token; // some providers don't rotate
    try {
      const params = new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: conn.refresh_token,
        client_id:     cfg.clientId,
        client_secret: cfg.secret,
      });
      const { data } = await axios.post(cfg.tokenUrl, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      await saveToken(userId, provider, data);
      return data.access_token;
    } catch {
      return conn.access_token; // return stale token, let the API call fail with 401
    }
  }

  return conn.access_token;
}

/* ─────────────────────────────────────────────────────────────────
   Helper: upsert tracker_data row
───────────────────────────────────────────────────────────────── */
async function saveTrackerData(userId, provider, metrics) {
  const today = new Date().toISOString().slice(0, 10);
  await pool.query(
    `INSERT INTO tracker_data (user_id, provider, date, metrics)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, provider, date)
     DO UPDATE SET metrics = tracker_data.metrics || EXCLUDED.metrics, synced_at = NOW()`,
    [userId, provider, today, JSON.stringify(metrics)]
  );
}

/* ═══════════════════════════════════════════════════════════════════
   1.  OAUTH FLOWS
═══════════════════════════════════════════════════════════════════ */

/**
 * GET /api/trackers/oauth/:provider
 * Redirects the user to the provider's OAuth consent page.
 */
router.get('/oauth/:provider', auth, (req, res) => {
  const { provider } = req.params;
  const cfg = PROVIDERS[provider];
  if (!cfg) return res.status(400).json({ error: 'Unknown provider' });

  const state    = Buffer.from(JSON.stringify({ userId: req.user.id, provider })).toString('base64');
  const redirect = `${SERVER_URL}/api/trackers/oauth/${provider}/callback`;

  const url = new URL(cfg.authUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id',     cfg.clientId);
  url.searchParams.set('redirect_uri',  redirect);
  url.searchParams.set('scope',         cfg.scope);
  url.searchParams.set('state',         state);

  res.redirect(url.toString());
});

/**
 * GET /api/trackers/oauth/:provider/callback
 * Provider redirects back here with ?code=...
 * Exchanges code for tokens, saves them, then redirects to /devices in the client.
 */
router.get('/oauth/:provider/callback', async (req, res) => {
  const { provider } = req.params;
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`${CLIENT_URL}/devices?error=oauth_denied&provider=${provider}`);
  }

  let userId;
  try {
    ({ userId } = JSON.parse(Buffer.from(state, 'base64').toString()));
  } catch {
    return res.status(400).send('Invalid state');
  }

  const cfg      = PROVIDERS[provider];
  const redirect = `${SERVER_URL}/api/trackers/oauth/${provider}/callback`;

  try {
    const params = new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: redirect,
      client_id:    cfg.clientId,
      client_secret: cfg.secret,
    });

    const { data } = await axios.post(cfg.tokenUrl, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      auth: provider === 'fitbit'
        ? { username: cfg.clientId, password: cfg.secret }  // Fitbit uses Basic auth
        : undefined,
    });

    await saveToken(userId, provider, data);

    // Kick off first sync immediately (non-blocking)
    syncProvider(userId, provider).catch(console.error);

    res.redirect(`${CLIENT_URL}/devices?connected=${provider}`);
  } catch (err) {
    console.error(`OAuth callback error (${provider}):`, err.response?.data || err.message);
    res.redirect(`${CLIENT_URL}/devices?error=oauth_failed&provider=${provider}`);
  }
});

/* ═══════════════════════════════════════════════════════════════════
   2.  DATA SYNC — per-provider fetch functions
═══════════════════════════════════════════════════════════════════ */

async function syncFitbit(userId) {
  const token   = await getAccessToken(userId, 'fitbit');
  const headers = { Authorization: `Bearer ${token}` };
  const today   = new Date().toISOString().slice(0, 10);

  const [hrRes, actRes, sleepRes, spo2Res] = await Promise.allSettled([
    axios.get(`https://api.fitbit.com/1/user/-/activities/heart/date/${today}/1d/1min.json`, { headers }),
    axios.get(`https://api.fitbit.com/1/user/-/activities/date/${today}.json`, { headers }),
    axios.get(`https://api.fitbit.com/1.2/user/-/sleep/date/${today}.json`, { headers }),
    axios.get(`https://api.fitbit.com/1/user/-/spo2/date/${today}.json`, { headers }),
  ]);

  const metrics = {};

  if (hrRes.status === 'fulfilled') {
    const zones = hrRes.value.data['activities-heart']?.[0]?.value?.heartRateZones || [];
    const rhr   = hrRes.value.data['activities-heart']?.[0]?.value?.restingHeartRate;
    metrics.heart_rate = { resting: rhr, zones };
  }
  if (actRes.status === 'fulfilled') {
    const s = actRes.value.data.summary || {};
    metrics.activity = {
      steps:         s.steps,
      calories_out:  s.caloriesOut,
      active_minutes: (s.lightlyActiveMinutes || 0) + (s.fairlyActiveMinutes || 0) + (s.veryActiveMinutes || 0),
      distance_km:   s.distances?.find(d => d.activity === 'total')?.distance,
    };
  }
  if (sleepRes.status === 'fulfilled') {
    const s = sleepRes.value.data.summary || {};
    metrics.sleep = {
      total_minutes: s.totalMinutesAsleep,
      efficiency:    sleepRes.value.data.sleep?.[0]?.efficiency,
      stages:        s.stages,
    };
  }
  if (spo2Res.status === 'fulfilled') {
    metrics.spo2 = { avg: spo2Res.value.data?.value?.avg };
  }

  await saveTrackerData(userId, 'fitbit', metrics);
  return metrics;
}

async function syncWhoop(userId) {
  const token   = await getAccessToken(userId, 'whoop');
  const headers = { Authorization: `Bearer ${token}` };

  const [recRes, sleepRes, cycleRes] = await Promise.allSettled([
    axios.get('https://api.prod.whoop.com/developer/v1/recovery?limit=1', { headers }),
    axios.get('https://api.prod.whoop.com/developer/v1/activity/sleep?limit=1', { headers }),
    axios.get('https://api.prod.whoop.com/developer/v1/cycle?limit=1', { headers }),
  ]);

  const metrics = {};

  if (recRes.status === 'fulfilled') {
    const r = recRes.value.data.records?.[0] || {};
    metrics.recovery = {
      score:         r.score?.recovery_score,
      hrv_rmssd_milli: r.score?.hrv_rmssd_milli,
      resting_heart_rate: r.score?.resting_heart_rate,
      spo2_percentage:    r.score?.spo2_percentage,
    };
  }
  if (sleepRes.status === 'fulfilled') {
    const s = sleepRes.value.data.records?.[0]?.score || {};
    metrics.sleep = {
      total_in_bed_time_milli:    s.total_in_bed_time_milli,
      total_awake_time_milli:     s.total_awake_time_milli,
      total_no_data_time_milli:   s.total_no_data_time_milli,
      total_light_sleep_time_milli: s.total_light_sleep_time_milli,
      total_slow_wave_sleep_time_milli: s.total_slow_wave_sleep_time_milli,
      total_rem_sleep_time_milli: s.total_rem_sleep_time_milli,
      sleep_cycle_count:          s.sleep_cycle_count,
      disturbance_count:          s.disturbance_count,
    };
  }
  if (cycleRes.status === 'fulfilled') {
    const c = cycleRes.value.data.records?.[0]?.score || {};
    metrics.strain = {
      score:              c.strain,
      kilojoule:          c.kilojoule,
      average_heart_rate: c.average_heart_rate,
      max_heart_rate:     c.max_heart_rate,
    };
  }

  await saveTrackerData(userId, 'whoop', metrics);
  return metrics;
}

async function syncPolar(userId) {
  const token   = await getAccessToken(userId, 'polar');
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

  // Polar requires registering the user first (one-time)
  try {
    await axios.post('https://www.polaraccesslink.com/v3/users', {}, { headers });
  } catch { /* already registered is fine */ }

  const [actRes, sleepRes] = await Promise.allSettled([
    axios.get('https://www.polaraccesslink.com/v3/exercises?limit=5', { headers }),
    axios.get('https://www.polaraccesslink.com/v3/users/sleep', { headers }),
  ]);

  const metrics = {};

  if (actRes.status === 'fulfilled') {
    const ex = actRes.value.data?.['exercises']?.[0] || {};
    metrics.activity = {
      sport:             ex.sport,
      duration:          ex.duration,
      calories:          ex.calories,
      heart_rate_avg:    ex.heart_rate?.average,
      heart_rate_max:    ex.heart_rate?.maximum,
      training_load:     ex.training_load,
      vo2max_estimate:   ex.vo2_max_estimate,
    };
  }
  if (sleepRes.status === 'fulfilled') {
    const s = sleepRes.value.data?.nights?.[0] || {};
    metrics.sleep = {
      sleep_start:      s.sleep_start_time,
      sleep_end:        s.sleep_end_time,
      sleep_score:      s.sleep_score?.total_score,
      hrv_avg:          s.hrv_avg,
      breathing_rate:   s.breathing_rate,
    };
  }

  await saveTrackerData(userId, 'polar', metrics);
  return metrics;
}

/* Main dispatcher */
async function syncProvider(userId, provider) {
  switch (provider) {
    case 'fitbit': return syncFitbit(userId);
    case 'whoop':  return syncWhoop(userId);
    case 'polar':  return syncPolar(userId);
    default:       throw new Error(`No sync handler for provider: ${provider}`);
  }
}

/* ═══════════════════════════════════════════════════════════════════
   3.  MANUAL SYNC TRIGGER  (OAuth providers)
═══════════════════════════════════════════════════════════════════ */
router.post('/sync/:provider', auth, async (req, res) => {
  const { provider } = req.params;
  if (!PROVIDERS[provider]) return res.status(400).json({ error: 'Unknown provider' });

  try {
    const metrics = await syncProvider(req.user.id, provider);
    res.json({ ok: true, provider, metrics });
  } catch (err) {
    console.error(`Sync error (${provider}):`, err.message);
    res.status(502).json({ error: `Failed to sync ${provider}`, detail: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════
   4.  HEALTH CONNECT  (Android — push from client)
       Client calls POST /api/trackers/healthconnect/sync
       with a body containing the metrics read via Web Health Connect API
═══════════════════════════════════════════════════════════════════ */
router.post('/healthconnect/sync', auth, async (req, res) => {
  /*
    Expected body shape (all fields optional — client sends what it read):
    {
      steps:         number,
      heart_rate:    { samples: [{ time, bpm }], resting: number },
      sleep:         { start, end, stages: [...] },
      spo2:          { avg: number },
      calories:      number,
      distance_m:    number,
      hrv:           { sdnn: number },
      source_app:    "com.samsung.health" | "com.garmin.android.apps.connectmobile" | ...
    }
  */
  const body    = req.body;
  const metrics = {};

  if (body.steps         != null) metrics.steps         = body.steps;
  if (body.calories      != null) metrics.calories      = body.calories;
  if (body.distance_m    != null) metrics.distance_m    = body.distance_m;
  if (body.heart_rate)            metrics.heart_rate    = body.heart_rate;
  if (body.sleep)                 metrics.sleep         = body.sleep;
  if (body.spo2)                  metrics.spo2          = body.spo2;
  if (body.hrv)                   metrics.hrv           = body.hrv;
  if (body.source_app)            metrics.source_app    = body.source_app;

  try {
    await saveTrackerData(req.user.id, 'healthconnect', metrics);
    res.json({ ok: true, saved: Object.keys(metrics) });
  } catch (err) {
    console.error('Health Connect sync error:', err.message);
    res.status(500).json({ error: 'Failed to save Health Connect data' });
  }
});

/* ═══════════════════════════════════════════════════════════════════
   5.  BLE SYNC  (HART ring — push from client Web Bluetooth)
       Client reads BLE characteristics and POSTs parsed values
═══════════════════════════════════════════════════════════════════ */
router.post('/ble/sync', auth, async (req, res) => {
  /*
    Expected body:
    {
      device_id:   "HART-PRO-7589",
      device_name: "HART PRO 7589",
      heart_rate:  number,
      spo2:        number,
      steps:       number,
      hrv:         number,
      skin_temp:   number,
      battery:     number
    }
  */
  const { device_id, device_name, heart_rate, spo2, steps, hrv, skin_temp, battery } = req.body;

  const metrics = {
    device_id, device_name,
    ...(heart_rate != null && { heart_rate }),
    ...(spo2       != null && { spo2 }),
    ...(steps      != null && { steps }),
    ...(hrv        != null && { hrv }),
    ...(skin_temp  != null && { skin_temp }),
    ...(battery    != null && { battery }),
    synced_at: new Date().toISOString(),
  };

  try {
    await saveTrackerData(req.user.id, 'ble_ring', metrics);

    // Also upsert into tracker_connections so the device appears as "connected"
    await pool.query(
      `INSERT INTO tracker_connections (user_id, provider, access_token, raw)
       VALUES ($1, 'ble_ring', 'bluetooth', $2)
       ON CONFLICT (user_id, provider)
       DO UPDATE SET raw = EXCLUDED.raw, updated_at = NOW()`,
      [req.user.id, JSON.stringify({ device_id, device_name, battery })]
    );

    res.json({ ok: true, metrics });
  } catch (err) {
    console.error('BLE sync error:', err.message);
    res.status(500).json({ error: 'Failed to save BLE data' });
  }
});

/* ═══════════════════════════════════════════════════════════════════
   6.  STATUS — which providers are connected for this user
═══════════════════════════════════════════════════════════════════ */
router.get('/status', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT provider, updated_at,
              CASE WHEN expires_at IS NULL OR expires_at > NOW() THEN true ELSE false END AS token_valid,
              raw
       FROM tracker_connections WHERE user_id = $1`,
      [req.user.id]
    );
    res.json({ connections: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════
   7.  LATEST DATA snapshot — merged across all providers
═══════════════════════════════════════════════════════════════════ */
router.get('/data', auth, async (req, res) => {
  const days = parseInt(req.query.days) || 7;
  try {
    const { rows } = await pool.query(
      `SELECT provider, date, metrics, synced_at
       FROM tracker_data
       WHERE user_id = $1
         AND date >= CURRENT_DATE - INTERVAL '${days} days'
       ORDER BY date DESC, synced_at DESC`,
      [req.user.id]
    );

    // Group by date then merge all provider metrics
    const byDate = {};
    for (const row of rows) {
      if (!byDate[row.date]) byDate[row.date] = { date: row.date, sources: [] };
      byDate[row.date].sources.push({ provider: row.provider, ...row.metrics });
      // Merge metrics (later rows win if same key)
      Object.assign(byDate[row.date], row.metrics);
    }

    res.json({ data: Object.values(byDate) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════
   8.  DISCONNECT
═══════════════════════════════════════════════════════════════════ */
router.delete('/:provider', auth, async (req, res) => {
  const { provider } = req.params;
  try {
    await pool.query(
      `DELETE FROM tracker_connections WHERE user_id=$1 AND provider=$2`,
      [req.user.id, provider]
    );
    res.json({ ok: true, disconnected: provider });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
