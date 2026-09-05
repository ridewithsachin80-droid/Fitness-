/**
 * scripts/test-twa-contract.js — the two things that break the Android app
 * silently.
 *
 * Neither of these produces an error anyone would see. They produce an app
 * that merely looks wrong, which is far harder to notice and much harder to
 * attribute once members are using it.
 *
 * 1. ASSETLINKS. Android verifies that the installed app owns the domain
 *    before it hides the browser chrome. If /.well-known/assetlinks.json ever
 *    404s, or returns the wrong package, every Android member gets a URL bar
 *    across the top of the app overnight. Nothing logs an error; the app just
 *    looks like a website again.
 *
 * 2. THE BRAND COLOUR. A Trusted Web Activity uses the web manifest's
 *    theme_color for the splash screen and status bar. The manifest carried
 *    #c9a227 — an older gold that sprint6-test was written to catch, except
 *    that test was never wired into the gate and the manifest was never
 *    checked. As a website it was invisible. As an app it is the first thing
 *    every member sees on every launch.
 *
 * Pure — no database, no network.
 */
const fs   = require('fs');
const path = require('path');
const express = require('express');

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 200))); };

const ROOT    = path.join(__dirname, '..', '..');
const GOLD    = '#D4AF37';
const OLD_GOLD = '#c9a227';
const PKG     = 'app.upscale.fitlife';

(async () => {
  // ── The web manifest ────────────────────────────────────────────────────
  console.log('\nWeb manifest');
  const vite = fs.readFileSync(path.join(ROOT, 'client', 'vite.config.js'), 'utf8');
  const themeMatch = /theme_color:\s*'([^']+)'/.exec(vite);

  ck('theme_color is the brand gold — it becomes the Android splash screen and status bar',
     themeMatch && themeMatch[1] === GOLD, themeMatch && themeMatch[1]);
  ck(`the old gold ${OLD_GOLD} does not reappear`,
     !new RegExp(OLD_GOLD, 'i').test(vite.replace(/\/\/.*$/gm, '')));
  ck('the manifest declares an id, which Play requires for a TWA',
     /\bid:\s*'\//.test(vite), 'no id');
  ck('scope and start_url are the site root, or the app would only cover part of it',
     /start_url:\s*'\/'/.test(vite) && /scope:\s*'\/'/.test(vite));
  ck('display is standalone, or the wrapper shows browser chrome anyway',
     /display:\s*'standalone'/.test(vite));

  // ── Digital asset links ─────────────────────────────────────────────────
  console.log('\nDigital asset links');

  // Mounted through a real Express app, because the failure mode being
  // guarded against is the route not existing — which a direct function call
  // cannot detect. It also has to be OUTSIDE the production-only block: it
  // landed inside one on the first attempt and would have 404'd everywhere
  // except production, including in this test.
  const index = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
  const linkAt = index.indexOf("'/.well-known/assetlinks.json'");
  const prodAt = index.indexOf("if (process.env.NODE_ENV === 'production')");
  ck('the assetlinks route exists', linkAt > -1);
  ck('...and is registered OUTSIDE the production-only block, so it works in every environment',
     linkAt > -1 && prodAt > -1 && linkAt < prodAt, { linkAt, prodAt });

  const app = express();
  app.get('/.well-known/assetlinks.json', (req, res) => {
    const fp  = process.env.TWA_FINGERPRINT || '';
    const pkg = process.env.TWA_PACKAGE || PKG;
    res.type('application/json');
    if (!fp) return res.json([]);
    res.json([{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: pkg,
        sha256_cert_fingerprints: fp.split(',').map(f => f.trim()).filter(Boolean),
      },
    }]);
  });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    let res = await fetch(`${base}/.well-known/assetlinks.json`);
    ck('it returns 200 even before a fingerprint is configured — a 404 here puts a URL bar across every Android member\'s app',
       res.status === 200, res.status);
    ck('...with a JSON content type, which Android requires',
       (res.headers.get('content-type') || '').includes('application/json'),
       res.headers.get('content-type'));
    let body = await res.json();
    ck('...and an empty list, meaning "no app verified yet" rather than broken JSON',
       Array.isArray(body) && body.length === 0, body);

    process.env.TWA_FINGERPRINT = 'AA:BB:CC';
    res  = await fetch(`${base}/.well-known/assetlinks.json`);
    body = await res.json();
    ck('with a fingerprint set, one statement is returned', body.length === 1, body);
    ck('the relation is handle_all_urls',
       body[0].relation[0] === 'delegate_permission/common.handle_all_urls', body[0].relation);
    ck('the namespace is android_app', body[0].target.namespace === 'android_app');
    ck('the package matches the app id — a mismatch verifies nothing and is silent',
       body[0].target.package_name === PKG, body[0].target.package_name);
    ck('the fingerprint is carried through',
       body[0].target.sha256_cert_fingerprints[0] === 'AA:BB:CC',
       body[0].target.sha256_cert_fingerprints);

    process.env.TWA_FINGERPRINT = 'AA:BB, CC:DD';
    body = await (await fetch(`${base}/.well-known/assetlinks.json`)).json();
    ck('two fingerprints are supported — Play App Signing means the upload key and the app signing key differ',
       body[0].target.sha256_cert_fingerprints.length === 2,
       body[0].target.sha256_cert_fingerprints);
    delete process.env.TWA_FINGERPRINT;
  } finally {
    server.close();
  }

  // ── The Android project ─────────────────────────────────────────────────
  console.log('\nAndroid project');
  const andRoot = path.join(ROOT, 'android');
  const read = (p) => fs.readFileSync(path.join(andRoot, p), 'utf8');

  ck('the project is committed to the repo', fs.existsSync(andRoot));

  const gradle = read('app/build.gradle');
  ck(`applicationId is ${PKG} — permanent, and what assetlinks verifies against`,
     new RegExp(`applicationId "${PKG}"`).test(gradle));
  ck('targetSdk is 36 — Play rejects new apps and updates below it',
     /targetSdk 36/.test(gradle), gradle.match(/targetSdk \d+/)?.[0]);
  ck('no signing config is committed — a keystore in git lets anyone with repo access sign as you',
     !/storePassword|keyPassword|storeFile/.test(gradle));

  const ignore = read('.gitignore');
  ck('keystores are gitignored', /\*\.keystore/.test(ignore) && /\*\.jks/.test(ignore));

  const colors = read('app/src/main/res/values/colors.xml');
  ck('the native splash colour matches the web manifest, or the launch flashes a different gold',
     new RegExp(GOLD, 'i').test(colors), colors);

  const manifest = read('app/src/main/AndroidManifest.xml');
  ck('the TWA launcher activity is declared',
     /androidbrowserhelper\.trusted\.LauncherActivity/.test(manifest));
  ck('deep links are declared for the site, so links open the app rather than Chrome',
     /fitness\.upscale-app\.com/.test(manifest) && /autoVerify="true"/.test(manifest));
  ck('the voice activity has NO display theme — any UI forces an unlock and defeats the point',
     /QuickLogActivity[\s\S]{0,400}Theme\.NoDisplay/.test(manifest));
  ck('shortcuts.xml is referenced from the launcher activity, which is where Android looks',
     /android\.app\.shortcuts[\s\S]{0,120}@xml\/shortcuts/.test(manifest));

  const shortcuts = read('app/src/main/res/xml/shortcuts.xml');
  ck('a capability is declared for voice', /<capability/.test(shortcuts));
  ck('a parameterless fallback intent exists — a capability without one leaves Assistant nothing to do when the member does not say what to log',
     (shortcuts.match(/<intent/g) || []).length >= 2);
  ck('a plain static shortcut exists too — it needs no App Actions review and still works where Assistant has been replaced by Gemini',
     /<shortcut\b/.test(shortcuts));

  const kt = read('app/src/main/java/app/upscale/fitlife/QuickLogActivity.kt');
  // Comments stripped first: the file EXPLAINS why it never calls
  // setContentView, and that explanation was matching the check.
  const ktCode = kt.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ck('the token is stored encrypted, not in plain preferences',
     /EncryptedSharedPreferences/.test(ktCode));
  ck('the activity never calls setContentView — UI would force an unlock',
     !/setContentView/.test(ktCode));
  ck('a network failure still speaks a sentence — silence makes a member assume it worked',
     /Could not reach FitLife/.test(kt));
  ck('a 401 tells the member to set it up again rather than failing mutely',
     /401/.test(kt));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
