/**
 * services/speechPresence.js — Fixes-2u (B18): is there any speech in a voice note?
 *
 * The first real voice run (21 Oct 2026, S4) sent 6 seconds of silence. Whisper
 * answered "Transcription by ESO. Translation by —" with confidence numbers that
 * looked fine (log-prob −0.45, no-speech 0.19), so FitLife accepted invented
 * words. A provider's own confidence cannot be the only judge of silence, so
 * the recording itself is checked here, on the server, before any provider is
 * asked.
 *
 * How: the recording (webm/opus from Android and desktop, mp4/AAC from iPhone)
 * is decoded by ffmpeg to 16 kHz mono and kept to the voice band (70 Hz-1 kHz).
 * It is cut into 30 ms frames every 20 ms. A frame counts as VOICED only when
 * both hold:
 *   1. it is louder than the recording's own background (its quietest fifth)
 *      by 3 dB, and louder than -55 dBFS (so digital silence never counts), and
 *   2. it is periodic the way a voice is: the YIN pitch detector (de Cheveigné
 *      & Kawahara, 2002) finds a pitch between 80 and 400 Hz with a clear dip
 *      (cumulative-mean-normalised difference below 0.35).
 * Noise is loud but not periodic, so noise energy alone never counts as speech
 * (pink, white, brown, blue, violet and velvet noise from very soft to very loud
 * all measured 0 voiced frames). Speech means: at least 200 ms of voiced frames,
 * a run of at least 60 ms, and a pitch that moves (at least 6 Hz between the
 * 10th and 90th percentile), so a steady tone, beep, two-tone beat or mains hum
 * is not taken for a voice. Speech is still found with noise about as loud as
 * the voice; only a voice buried well under loud noise is missed (then the
 * member is asked to retry or type, which is also what Whisper needs).
 *
 * These limits are deliberately low: a short, quiet "do idli" has well over a
 * second of voiced frames. The check refuses only recordings with no voice in
 * them at all; anything else goes to the providers exactly as before.
 *
 * If the recording cannot be decoded (a format ffmpeg does not know, a damaged
 * file) or ffmpeg is missing, the answer is 'unavailable'/'undecodable' and the
 * caller carries on as before (providers, then their own checks); /health says
 * whether the check is available, so a missing ffmpeg cannot go unnoticed.
 */
const { spawn } = require('child_process');
const fs = require('fs');

const VERSION = 'speech-v1 (70-1000 Hz band; YIN 80-400 Hz, d<0.35; frame >= background+3 dB and > -55 dBFS; >=200 ms voiced, run >=60 ms, F0 spread >=6 Hz)';
const RATE = 16000;
const FRAME = 480;           // 30 ms
const HOP = 320;             // 20 ms
const TAU_MIN = Math.floor(RATE / 400);   // 40 → 400 Hz
const TAU_MAX = Math.ceil(RATE / 80);     // 200 → 80 Hz
const YIN_THRESHOLD = 0.35;
const MIN_VOICED_MS = 200;
const MIN_RUN_MS = 60;
const MIN_F0_SPREAD_HZ = 6;
const ABS_FLOOR_DB = -55;    // a frame quieter than this is never voiced
const ABOVE_BACKGROUND_DB = 3;
// Fixes-2x: the live limits, and the ONE decision function the live check and the calibration
// kit's offline replay both use. `features` are the raw measurements (whole frame counts and the
// unrounded pitch spread); the reported voiced_ms / f0_spread_hz are rounded for display and must
// not be used to decide (5.6 Hz reports as 6 but is refused).
const LIVE_LIMITS = Object.freeze({ min_voiced_ms: MIN_VOICED_MS, min_run_ms: MIN_RUN_MS, min_f0_spread_hz: MIN_F0_SPREAD_HZ });
function decide(features, limits = LIVE_LIMITS) {
  const f = features || {};
  const voicedMs = Math.round(f.voiced_frames * f.hop_ms);
  const runMs = Math.round(f.longest_run_frames * f.hop_ms);
  return voicedMs >= limits.min_voiced_ms && runMs >= limits.min_run_ms && f.f0_spread_raw >= limits.min_f0_spread_hz;
}

function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try { return require('ffmpeg-static'); } catch { return null; }
}
function available() {
  const p = ffmpegPath();
  try { return !!p && fs.existsSync(p); } catch { return false; }
}

/** Decode any audio ffmpeg understands to 16 kHz mono 16-bit samples. Rejects on failure. */
function decode(buf, { timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const bin = ffmpegPath();
    if (!bin) { reject(Object.assign(new Error('ffmpeg is not installed'), { code: 'NO_FFMPEG' })); return; }
    const p = spawn(bin, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', String(RATE), '-f', 's16le', 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = []; let err = ''; let size = 0; let done = false;
    const finish = (e, v) => { if (done) return; done = true; clearTimeout(t); e ? reject(e) : resolve(v); };
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* gone */ } finish(new Error('decoding took too long')); }, timeoutMs);
    p.stdout.on('data', d => { size += d.length; if (size > RATE * 2 * 120) { try { p.kill('SIGKILL'); } catch { /* gone */ } finish(new Error('recording too long to check')); } else out.push(d); });
    p.stderr.on('data', d => { if (err.length < 2000) err += d; });
    p.on('error', e => finish(e));
    p.on('close', code => {
      if (code !== 0) { finish(new Error(`ffmpeg could not decode the recording${err ? `: ${err.trim().split('\n')[0].slice(0, 160)}` : ''}`)); return; }
      const b = Buffer.concat(out);
      finish(null, new Int16Array(b.buffer, b.byteOffset, Math.floor(b.length / 2)));
    });
    p.stdin.on('error', () => { /* ffmpeg may close early on a bad file; 'close' reports it */ });
    p.stdin.end(buf);
  });
}

const dbOf = (x) => (x > 0 ? 20 * Math.log10(x) : -120);

/** YIN on one frame (Float32Array of FRAME + TAU_MAX samples). Returns { f0, d } or null. */
function yin(x) {
  const W = FRAME, diff = new Float64Array(TAU_MAX + 1);
  for (let tau = 1; tau <= TAU_MAX; tau++) {
    let s = 0;
    for (let j = 0; j < W; j++) { const v = x[j] - x[j + tau]; s += v * v; }
    diff[tau] = s;
  }
  let running = 0, best = null;
  for (let tau = 1; tau <= TAU_MAX; tau++) {
    running += diff[tau];
    const dn = running > 0 ? diff[tau] * tau / running : 1;
    diff[tau] = dn;   // reuse: now the normalised value
  }
  for (let tau = TAU_MIN; tau <= TAU_MAX; tau++) {
    if (diff[tau] < YIN_THRESHOLD) {
      while (tau + 1 <= TAU_MAX && diff[tau + 1] < diff[tau]) tau++;   // walk to the bottom of the dip
      best = tau; break;
    }
  }
  if (best == null) return null;
  // parabolic interpolation for a finer pitch
  let t = best;
  if (best > TAU_MIN && best < TAU_MAX) {
    const a = diff[best - 1], b = diff[best], c = diff[best + 1], den = a - 2 * b + c;
    if (den > 0) t = best + 0.5 * (a - c) / den;
  }
  return { f0: RATE / t, d: diff[best] };
}

/** Measure speech in decoded samples (Int16Array at 16 kHz). Pure. */
function analyse(pcm) {
  const n = pcm.length;
  const duration_ms = Math.round(n / RATE * 1000);
  // DC removal + gentle high-pass (~70 Hz) so rumble does not fake loudness or pitch.
  const x = new Float32Array(n);
  let prevIn = 0, prevOut = 0; const a = Math.exp(-2 * Math.PI * 70 / RATE);
  for (let i = 0; i < n; i++) { const v = pcm[i] / 32768; const y = a * (prevOut + v - prevIn); prevIn = v; prevOut = y; x[i] = y; }
  { // voice band: biquad low-pass at 1 kHz, Q 0.707, applied twice (4th order). Hiss and
    // high-frequency noise drop away; a voice's pitch and first harmonics stay.
    const LP = 1000;
    for (let pass = 0; pass < 2; pass++) {
      const w = 2 * Math.PI * LP / RATE, al = Math.sin(w) / (2 * 0.7071), c = Math.cos(w);
      const b0 = (1 - c) / 2 / (1 + al), b1 = (1 - c) / (1 + al), b2 = b0, a1 = -2 * c / (1 + al), a2 = (1 - al) / (1 + al);
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < n; i++) { const v = x[i]; const y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = y; }
    }
  }
  const frames = [];
  for (let start = 0; start + FRAME + TAU_MAX <= n; start += HOP) {
    let s = 0; for (let j = 0; j < FRAME; j++) s += x[start + j] * x[start + j];
    frames.push({ start, db: dbOf(Math.sqrt(s / FRAME)) });
  }
  if (!frames.length) return { version: VERSION, speech: false, duration_ms, frames: 0, voiced_frames: 0, voiced_ms: 0, longest_run_ms: 0, f0_spread_hz: 0, peak_dbfs: -120, background_dbfs: -120,
    features: { voiced_frames: 0, longest_run_frames: 0, f0_spread_raw: 0, f0_count: 0, hop_ms: HOP / RATE * 1000, frames: 0, peak_db_raw: -120, background_db_raw: -120 } };
  const sorted = frames.map(f => f.db).sort((p, q) => p - q);
  const background = sorted[Math.floor(sorted.length * 0.2)];
  const peak = sorted[sorted.length - 1];
  const gate = Math.max(ABS_FLOOR_DB, background + ABOVE_BACKGROUND_DB);
  const f0s = []; let voiced = 0, run = 0, longest = 0;
  for (const f of frames) {
    let v = false;
    if (f.db > gate) {
      const r = yin(x.subarray(f.start, f.start + FRAME + TAU_MAX));
      if (r) { v = true; f0s.push(r.f0); }
    }
    if (v) { voiced++; run++; longest = Math.max(longest, run); } else run = 0;
  }
  const hopMs = HOP / RATE * 1000;
  const voiced_ms = Math.round(voiced * hopMs);
  const longest_run_ms = Math.round(longest * hopMs);
  let spread = 0;
  if (f0s.length >= 3) { const s = [...f0s].sort((p, q) => p - q); spread = s[Math.floor(s.length * 0.9)] - s[Math.floor(s.length * 0.1)]; }
  const features = { voiced_frames: voiced, longest_run_frames: longest, f0_spread_raw: spread, f0_count: f0s.length, hop_ms: hopMs, frames: frames.length,
    peak_db_raw: peak, background_db_raw: background };
  const speech = decide(features);
  return { version: VERSION, speech, duration_ms, frames: frames.length, voiced_frames: voiced, voiced_ms, longest_run_ms,
    f0_spread_hz: Math.round(spread), peak_dbfs: Math.round(peak), background_dbfs: Math.round(background), features };
}

/**
 * Check a base64 recording. Never throws.
 * status: 'speech' | 'no_speech' | 'undecodable' (ffmpeg could not read it) | 'unavailable' (no ffmpeg).
 */
async function check(base64) {
  let buf;
  try { buf = Buffer.from(String(base64 || ''), 'base64'); } catch { return { status: 'undecodable', version: VERSION, error: 'not base64' }; }
  if (!buf.length) return { status: 'undecodable', version: VERSION, error: 'empty recording' };
  try {
    const pcm = await decode(buf);
    const m = analyse(pcm);
    return { status: m.speech ? 'speech' : 'no_speech', ...m };
  } catch (e) {
    return { status: e.code === 'NO_FFMPEG' || e.code === 'ENOENT' ? 'unavailable' : 'undecodable', version: VERSION, error: String(e.message || e).slice(0, 200) };
  }
}

module.exports = { check, analyse, decode, available, decide, LIVE_LIMITS, VERSION, RATE,
  LIMITS: { MIN_VOICED_MS, MIN_RUN_MS, MIN_F0_SPREAD_HZ, YIN_THRESHOLD, ABS_FLOOR_DB, ABOVE_BACKGROUND_DB } };
