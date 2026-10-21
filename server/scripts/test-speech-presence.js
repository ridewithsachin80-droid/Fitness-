/**
 * test-speech-presence.js — Fixes-2u (B18): the recording's own speech check
 * (services/speechPresence.js) and the narrow guard against generated
 * subtitle/credit text (services/voiceLanguage.generatedText, mirrored in
 * client/src/utils/voiceLanguage.js).
 *
 * Uses the committed audio fixtures in scripts/fixtures/voice (made by
 * make-fixtures.sh from computer voices, silence, noise and tones) and the
 * bundled ffmpeg. No provider, no database, no network.
 * Computer voices stand in for speech: they show that the check tells a voice
 * from silence, noise and tones. They are not real member recordings.
 */
const fs = require('fs');
const path = require('path');
const sp = require('../services/speechPresence');
const VL = require('../services/voiceLanguage');

let pass = 0, fail = 0;
const ck = (name, ok, info) => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${info !== undefined ? ` — ${JSON.stringify(info).slice(0, 300)}` : ''}`); } };
const FX = path.join(__dirname, 'fixtures', 'voice');
const b64 = (f) => fs.readFileSync(path.join(FX, f)).toString('base64');

(async () => {
  console.log('\n[1] ffmpeg is available (the server reports this on /health)');
  ck('the bundled ffmpeg is found', sp.available());

  console.log('\n[2] speech is found: computer voices, quiet, short, noisy, mixed language, iPhone audio');
  const SPEECH = {
    'speech-en.webm': 'English: "Two idli, one bowl sambar, weight 82.5 kg"',
    'speech-kn.webm': 'Kannada',
    'speech-hi.webm': 'Hindi',
    'speech-mixed.webm': 'mixed Hinglish',
    'speech-female.webm': 'a higher voice',
    'speech-quiet.webm': 'quiet speech (-30 dB) in a quiet room',
    'speech-quiet-noise.webm': 'quiet speech over low background noise',
    'speech-noise-as-loud.webm': 'speech with background noise about as loud as the voice',
    'speech-short.webm': 'a short "Do idli" then 4 s of quiet',
    'speech-en-iphone.m4a': 'an iPhone-style AAC/mp4 recording',
  };
  for (const [f, what] of Object.entries(SPEECH)) {
    const r = await sp.check(b64(f));
    ck(`${what} → speech`, r.status === 'speech' && r.voiced_ms >= sp.LIMITS.MIN_VOICED_MS, r);
  }

  console.log('\n[3] no speech: silence, noise of every loudness, mains hum, beeps');
  const NONE = {
    'silence-digital.webm': '6 s of silence (the first real run\'s S4 recipe)',
    'noise-room.webm': 'soft room noise',
    'noise-loud-pink.webm': 'loud pink noise',
    'noise-white.webm': 'white noise',
    'noise-loud-rumble.webm': 'loud low rumble (brown noise)',
    'hum-mains.webm': 'mains hum (50/100/150 Hz)',
    'tone-beeps.webm': 'repeated 300 Hz beeps (periodic, but a steady pitch)',
  };
  for (const [f, what] of Object.entries(NONE)) {
    const r = await sp.check(b64(f));
    ck(`${what} → no speech`, r.status === 'no_speech', r);
  }
  const loud = await sp.check(b64('noise-loud-pink.webm'));
  ck('loud noise has energy but no voiced frames (noise energy alone is never speech)', loud.peak_dbfs > -30 && loud.voiced_ms === 0, loud);
  const beeps = await sp.check(b64('tone-beeps.webm'));
  ck('beeps are periodic (voiced frames) but refused for a steady pitch', beeps.voiced_ms >= 200 && beeps.f0_spread_hz < sp.LIMITS.MIN_F0_SPREAD_HZ, beeps);

  console.log('\n[4] documented limit: a voice buried well under loud noise');
  const buried = await sp.check(b64('speech-under-loud-noise.webm'));
  ck('the first run\'s S5 recipe (speech at 0.12 under pink noise at 0.5) is refused as no speech; the member is asked to retry or type', buried.status === 'no_speech', buried);

  console.log('\n[5] what cannot be checked carries on (never refused for that reason)');
  const junk = await sp.check(Buffer.from('synthetic recorded audio').toString('base64'));
  ck('bytes ffmpeg cannot read → undecodable (the caller carries on as before)', junk.status === 'undecodable' && /could not decode/.test(junk.error || ''), junk);
  ck('an empty recording → undecodable', (await sp.check('')).status === 'undecodable');
  const saved = process.env.FFMPEG_PATH; process.env.FFMPEG_PATH = '/nonexistent/ffmpeg';
  const none = await sp.check(b64('speech-en.webm'));
  ck('no ffmpeg on the server → unavailable (and /health says so)', none.status === 'unavailable' && sp.available() === false, none);
  if (saved === undefined) delete process.env.FFMPEG_PATH; else process.env.FFMPEG_PATH = saved;

  console.log('\n[6] the pure analysis');
  ck('pure digital silence → no speech, no voiced frames', (() => { const r = sp.analyse(new Int16Array(16000 * 3)); return !r.speech && r.voiced_ms === 0; })());
  ck('a continuous 150 Hz tone → not speech (it never rises above its own background)', (() => {
    const x = new Int16Array(16000 * 3); for (let i = 0; i < x.length; i++) x[i] = Math.round(8000 * Math.sin(2 * Math.PI * 150 * i / 16000));
    const r = sp.analyse(x); return !r.speech && r.voiced_ms === 0; })());
  ck('the same tone switched on and off (periodic, above the background) → not speech: its pitch never moves', (() => {
    const x = new Int16Array(16000 * 3); for (let i = 0; i < x.length; i++) x[i] = ((i / 16000) % 1) < 0.6 ? Math.round(8000 * Math.sin(2 * Math.PI * 150 * i / 16000)) : 0;
    const r = sp.analyse(x); return !r.speech && r.voiced_ms > 1000 && r.f0_spread_hz < sp.LIMITS.MIN_F0_SPREAD_HZ; })());
  ck('a gliding pitch (110→190 Hz, like intonation) with gaps → speech', (() => {
    const x = new Int16Array(16000 * 3); let ph = 0;
    for (let i = 0; i < x.length; i++) { const t = i / 16000; const f = 110 + 80 * (t / 3); ph += 2 * Math.PI * f / 16000; const on = (t % 1) < 0.6;
      x[i] = on ? Math.round(6000 * (Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.25 * Math.sin(3 * ph))) : 0; }
    const r = sp.analyse(x); return r.speech && r.f0_spread_hz >= 20; })());
  const t0 = Date.now(); await sp.check(b64('speech-en-iphone.m4a'));
  ck('checking a 9 s recording takes well under a second', Date.now() - t0 < 1500, Date.now() - t0);

  console.log('\n[7] generated subtitle/credit text (narrow, whole answer only)');
  const S4 = 'Transcription by ESO. Translation by —';
  const refused = [S4, 'Thanks for watching!', 'Thank you for watching.', 'Subtitles by the Amara.org community', 'transcribed by https://otter.ai', 'Please subscribe to my channel.', 'Translation by', 'Sous-titrage ST\' 501'];
  for (const t of refused) ck(`refused: "${t}"`, VL.generatedText(t) === true);
  const kept = ['2 idli, 1 bowl sambar, weight 82.5 kg.', '2 idli. Thanks for watching.', 'Thank you.', 'Breakfast: 1 plate upma, 1 cup coffee', 'ಎರಡು ಇಡ್ಲಿ ಒಂದು ಬೌಲ್ ಸಾಂಬಾರ್',
    'दो रोटी और एक कटोरी दाल खाई', 'Aaj breakfast mein do idli aur one cup coffee liya', 'Captain cool', 'Translate this to Kannada please', ''];
  for (const t of kept) ck(`not refused: "${t}"${t === '2 idli. Thanks for watching.' ? ' (real content: passed on unchanged, nothing stripped)' : ''}`, VL.generatedText(t) === false);
  // The exact saved S4 response from the first real run (21 Oct 2026, try 8).
  const s4 = { text: ' Transcription by ESO. Translation by —', language: 'english',
    segments: [{ id: 0, start: 0, end: 29.98, text: ' Transcription by ESO. Translation by —', avg_logprob: -0.4477262, no_speech_prob: 0.18652344, compression_ratio: 1.025 }] };
  ck('the first run\'s exact S4 Whisper reply (English, log-prob -0.448, no-speech 0.187, compression 1.025) is now refused: generated_text', (() => { const r = VL.reviewWhisper(s4, 'en-IN'); return r.ok === false && r.reason === 'generated_text'; })(), VL.reviewWhisper(s4, 'en-IN'));
  ck('…its own confidence numbers alone would have passed it (why the guard and the audio check are needed)', (() => { const r = VL.reviewWhisper({ ...s4, text: ' 2 idli', segments: [{ ...s4.segments[0], text: ' 2 idli' }] }, 'en-IN'); return r.ok === true; })());
  ck('a real Whisper answer from that run is still accepted ("2 idli, 1 bowl sambar, weight 82.5 kg.")', VL.reviewWhisper({ text: ' 2 idli, 1 bowl sambar, weight 82.5 kg.', language: 'english',
    segments: [{ text: ' 2 idli, 1 bowl sambar, weight 82.5 kg.', avg_logprob: -0.23134391, no_speech_prob: 0.036224365, compression_ratio: 0.82978725 }] }, 'en-IN').ok === true);

  console.log('\n[8] the client uses the same rule (on-device dictation and hands-free)');
  const esbuild = require('esbuild');
  const clientFile = path.join(__dirname, '../../client/src/utils/voiceLanguage.js');
  const out = esbuild.buildSync({ entryPoints: [clientFile], bundle: false, format: 'cjs', write: false, platform: 'neutral' });
  const mod = { exports: {} }; new Function('module', 'exports', out.outputFiles[0].text)(mod, mod.exports);
  const C = mod.exports;
  ck('the client and server lists are identical', JSON.stringify(C.GENERATED_CREDITS.map(r => r.source + '/' + r.flags)) === JSON.stringify(VL.GENERATED_CREDITS.map(r => r.source + '/' + r.flags)));
  ck('…and decide every case the same way', [...refused, ...kept].every(t => C.generatedText(t) === VL.generatedText(t)));

  console.log(`\nSpeech presence + generated text: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
