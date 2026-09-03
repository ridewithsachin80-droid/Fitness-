/**
 * scripts/test-session-logic.js — the onboarding gate and the session store.
 *
 * These import the REAL client modules through scripts/lib/client-bundle.js.
 * They are not copies. A copy cannot fail when the original changes, which is
 * exactly how this codebase once ran three assertions against a pasted
 * `computeDayTotals` for months.
 *
 * THE BUG THIS GUARDS
 * -------------------
 * A member of eight months, on an iPhone, was asked who was using the app and
 * what their goal was. Not a cosmetic fault: onboarding OVERWRITES the answers
 * they already gave, and the coach sees the replacement.
 *
 * The cause was a single fall-through:
 *
 *     serverOnboarded === null ? !onboardingDone : !serverOnboarded
 *
 * `serverOnboarded` starts at null on EVERY render, before the fetch resolves.
 * `onboardingDone` lives in localStorage, which iOS clears along with the
 * session cookie. So a wiped device rendered the setup screen — and note it
 * did not need the request to fail. A slow connection was enough.
 *
 * The rule now: setup is shown only on POSITIVE evidence that it has not been
 * done. Not knowing is not an answer.
 */
const { importClient } = require('./lib/client-bundle');

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 200))); };

// ── A localStorage stand-in, so the real module can be exercised in Node ─────
function installStorage({ throwOnWrite = false } = {}) {
  const map = new Map();
  global.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { if (throwOnWrite) throw new Error('QuotaExceededError'); map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
  return map;
}

/**
 * Node 22 ships its own read-only `navigator` global (a getter), so
 * `global.navigator = {...}` is SILENTLY IGNORED — the assignment appears to
 * work and the value never changes. An earlier version of this file did
 * exactly that and the platform assertions ran against 'Node.js/22'. That is
 * the failure mode this repo has been bitten by before: a test that cannot
 * fail because it never exercised what it claimed to.
 */
function setEnv({ userAgent, maxTouchPoints = 0, standalone = false, displayMode = false }) {
  const nav = { userAgent, maxTouchPoints, standalone };
  Object.defineProperty(globalThis, 'navigator', {
    value: nav, configurable: true, writable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: { navigator: nav, matchMedia: () => ({ matches: displayMode }) },
    configurable: true, writable: true,
  });
}

/** A structurally valid JWT — three segments — since the store checks shape. */
const TOKEN  = 'aaaaaaaaaa.bbbbbbbbbb.cccccccccc';
const TOKEN2 = 'dddddddddd.eeeeeeeeee.ffffffffff';

(async () => {
  // ── The onboarding gate ───────────────────────────────────────────────────
  console.log('\nOnboarding gate — setup needs positive evidence');
  const { onboardingDecision, needsOnboarding } = importClient('utils/onboardingGate.js');

  // THE REGRESSION. Both flags are the wiped-iPhone state.
  ck('a wiped device with no server answer WAITS — it must never render setup (the reported bug)',
     onboardingDecision({ serverOnboarded: null, onboardingDone: false }) === 'wait',
     onboardingDecision({ serverOnboarded: null, onboardingDone: false }));

  ck('...and that holds when the check FAILED, not just while it is in flight',
     onboardingDecision({ serverOnboarded: null, onboardingDone: false, checkFailed: true }) === 'wait');

  ck('undefined is treated the same as null — an absent key must not read as "no"',
     onboardingDecision({ serverOnboarded: undefined, onboardingDone: false }) === 'wait');

  ck('called with no arguments at all it still waits rather than onboarding',
     onboardingDecision() === 'wait');

  // The server is the source of truth in both directions.
  ck('server says done → app', onboardingDecision({ serverOnboarded: true, onboardingDone: false }) === 'app');
  ck('server says NOT done → onboarding (a genuinely new member must still get setup)',
     onboardingDecision({ serverOnboarded: false, onboardingDone: false }) === 'onboarding');
  ck('server says not done, but this device remembers finishing → still onboarding; the server wins',
     onboardingDecision({ serverOnboarded: false, onboardingDone: true }) === 'onboarding');

  // The local flag may only keep someone OUT.
  ck('no server answer but the device remembers finishing → app (offline members are not trapped)',
     onboardingDecision({ serverOnboarded: null, onboardingDone: true }) === 'app');

  // The original stranding bug, still fixed.
  ck('finishing setup in this session beats a stale server "not done" — otherwise the Save button never releases',
     onboardingDecision({ serverOnboarded: false, onboardingDone: true, justFinished: true }) === 'app');

  ck('exactly three outcomes are possible',
     ['app', 'onboarding', 'wait'].includes(onboardingDecision({ serverOnboarded: null, onboardingDone: false })));

  // A truthy-but-not-true server value must not be read as "not onboarded".
  ck('a non-boolean server value waits rather than guessing',
     onboardingDecision({ serverOnboarded: 'yes', onboardingDone: false }) === 'wait');

  // Back-compat: anything still importing the old name gets the SAFE answer.
  ck('the deprecated needsOnboarding maps "wait" to false, so a stale caller cannot resurrect the bug',
     needsOnboarding({ serverOnboarded: null, onboardingDone: false }) === false);
  ck('the deprecated needsOnboarding still returns true for a real new member',
     needsOnboarding({ serverOnboarded: false, onboardingDone: false }) === true);

  // ── The session store ─────────────────────────────────────────────────────
  console.log('\nSession store — the fallback that used to be dead code');
  installStorage();
  const S = importClient('utils/session.js');

  ck('nothing stored → empty refresh body, so the server falls through to the cookie exactly as before',
     JSON.stringify(S.refreshRequestBody()) === '{}');

  S.storeRefreshToken(TOKEN);
  ck('a stored token is returned', S.getStoredRefreshToken() === TOKEN);
  ck('...and is sent in the refresh body — the whole point; this path was unreachable before',
     S.refreshRequestBody().refreshToken === TOKEN);

  S.storeRefreshToken(TOKEN2);
  ck('rotation replaces the stored copy — keeping the login copy would expire on the ORIGINAL schedule',
     S.getStoredRefreshToken() === TOKEN2);

  ck('junk is not stored', S.storeRefreshToken('nope') === false && S.getStoredRefreshToken() === TOKEN2);
  ck('null is not stored', S.storeRefreshToken(null) === false && S.getStoredRefreshToken() === TOKEN2);
  ck('a non-JWT shape is rejected even when it is long enough',
     S.storeRefreshToken('x'.repeat(60)) === false && S.getStoredRefreshToken() === TOKEN2);

  S.clearRefreshToken();
  ck('clearing removes it', S.getStoredRefreshToken() === null);

  // The old dead key. Nothing wrote it, but if any build ever did, that member
  // must not be signed out by the upgrade.
  const map = installStorage();
  map.set('refreshToken', TOKEN);
  ck('a token under the legacy key is honoured once', S.getStoredRefreshToken() === TOKEN);
  ck('...and migrated to the new key', map.get('fl-refresh-token') === TOKEN);
  ck('...and the legacy key is dropped', map.has('refreshToken') === false);

  // ── Remembering who was here ──────────────────────────────────────────────
  console.log('\nRemembered member — "welcome back" instead of a blank form');
  installStorage();

  S.rememberMember({ id: 1, name: 'Asha Kumar', role: 'patient', phone: '9000000001' });
  ck('a member is remembered', S.getRememberedMember()?.name === 'Asha Kumar');
  ck('the phone is kept so the login field is prefilled', S.getRememberedMember()?.phone === '9000000001');

  installStorage();
  S.rememberMember({ id: 2, name: 'Sachin', role: 'monitor', phone: '9000000002' });
  ck('a COACH is not remembered — their identity must not sit on a shared screen for the next person',
     S.getRememberedMember() === null);

  installStorage();
  S.rememberMember({ id: 3, name: 'X', role: 'admin' });
  ck('an admin is not remembered either', S.getRememberedMember() === null);

  installStorage();
  ck('remembering nothing is safe', S.rememberMember(null) === false && S.getRememberedMember() === null);

  const m2 = installStorage();
  m2.set('fl-last-member', '{ this is not json');
  ck('a corrupt remembered value returns null rather than throwing on every boot',
     S.getRememberedMember() === null);
  ck('...and the corrupt value is dropped so it cannot fail twice', m2.has('fl-last-member') === false);

  // ── Clearing on the way out ───────────────────────────────────────────────
  console.log('\nClearing');
  installStorage();
  S.storeRefreshToken(TOKEN);
  S.rememberMember({ id: 1, name: 'Asha', role: 'patient', phone: '9000000001' });

  S.clearSession({ deliberate: false });
  ck('a session that ENDED clears the token — leaving it would sign the previous member back in',
     S.getStoredRefreshToken() === null);
  ck('...but keeps the name, which is exactly the case "welcome back" exists for',
     S.getRememberedMember()?.name === 'Asha');

  S.storeRefreshToken(TOKEN);
  S.clearSession({ deliberate: true });
  ck('a DELIBERATE log out forgets the member too', S.getRememberedMember() === null);
  ck('...and the token', S.getStoredRefreshToken() === null);

  // ── The diagnostic report ─────────────────────────────────────────────────
  console.log('\nSession-loss report');
  installStorage();
  setEnv({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', maxTouchPoints: 5 });
  ck('the test harness actually replaced navigator (Node 22 makes this easy to get wrong)',
     /iPhone/.test(globalThis.navigator.userAgent), globalThis.navigator.userAgent);

  const rep = S.sessionLossReport('cold-start');
  ck('an iPhone is identified as ios', rep.platform === 'ios', rep);
  ck('had_token is false when nothing was stored', rep.had_token === false);
  ck('days_since is null when the app has never succeeded here', rep.days_since === null);
  // An allowlist, not a blocklist. A pattern-match kept snagging on
  // `had_token` — a BOOLEAN saying whether a copy existed, not a token — and
  // a blocklist only catches the leaks somebody thought of in advance. Pinning
  // the exact key set means ADDING a field to the beacon fails this test and
  // forces the privacy question to be asked out loud.
  const ALLOWED = ['reason', 'platform', 'standalone', 'had_token', 'days_since'];
  ck('the beacon sends exactly the agreed fields and nothing else',
     JSON.stringify(Object.keys(rep).sort()) === JSON.stringify([...ALLOWED].sort()),
     Object.keys(rep));
  ck('no value in the report is a JWT',
     !Object.values(rep).some((v) => typeof v === 'string' && v.split('.').length === 3));

  S.storeRefreshToken(TOKEN);
  ck('had_token flips once a fallback copy exists — this is what tells an evicted device from a fresh one',
     S.sessionLossReport('x').had_token === true);

  S.markSeen();
  ck('days_since is 0 immediately after a successful session', S.daysSinceSeen() === 0);

  setEnv({ userAgent: 'Mozilla/5.0 (Linux; Android 14)', maxTouchPoints: 5, displayMode: true });
  ck('Android is identified', S.platformName() === 'android');
  ck('display-mode standalone is detected on Android', S.isStandalone() === true);

  setEnv({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', maxTouchPoints: 5 });
  ck('an iPad claiming to be a Mac is still ios — it has touch points, a real Mac does not',
     S.platformName() === 'ios');

  setEnv({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', maxTouchPoints: 0 });
  ck('a real desktop Mac is not misread as ios', S.platformName() === 'other');

  // ── Private Browsing ──────────────────────────────────────────────────────
  // Safari THROWS on localStorage writes in Private Browsing. An uncaught
  // throw during boot is a white screen — a worse bug than the one being fixed.
  console.log('\nPrivate Browsing (Safari throws on write)');
  installStorage({ throwOnWrite: true });
  let threw = false;
  try {
    S.storeRefreshToken(TOKEN);
    S.rememberMember({ id: 1, name: 'Asha', role: 'patient', phone: '9000000001' });
    S.markSeen();
    S.refreshRequestBody();
    S.sessionLossReport('x');
    S.clearSession({ deliberate: true });
  } catch (_) { threw = true; }
  ck('no storage call throws when writes are blocked', threw === false);
  ck('a failed write reports false rather than pretending to have worked',
     S.storeRefreshToken(TOKEN) === false);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
