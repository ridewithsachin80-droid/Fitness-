/**
 * scripts/test-hands-free.js — the spoken command vocabulary and the
 * yes/no matching that decides whether something gets written.
 *
 * WHY THIS MATTERS MORE THAN A NORMAL UI TEST
 * -------------------------------------------
 * Hands-free is built for a member who is across the room, cooking, or wearing
 * earbuds. They cannot see the screen and will not look at it. Two failures
 * are therefore much worse here than they would be in the app:
 *
 *   1. Mishearing "nahi" as yes writes food to their day and they never find
 *      out, because nothing on screen tells them.
 *   2. Swallowing "two roti and dal" as a navigation command means they think
 *      they logged and did not.
 *
 * Both are silent to the person affected. So the matching is pinned here.
 *
 * These import the REAL client modules through client-bundle, not copies.
 */
const { importClient } = require('./lib/client-bundle');

let pass = 0, fail = 0;
const ck = (n, c, e) => { c ? (pass++, console.log('  \u2713 ' + n))
                            : (fail++, console.log('  \u2717 ' + n + ' ' + JSON.stringify(e ?? '').slice(0, 200))); };

(async () => {
  const { matchCommand } = importClient('utils/voiceCommands.js');

  // The hook touches window at module scope, so give it somewhere to land.
  global.window = { SpeechRecognition: function () {}, speechSynthesis: {} };
  const { __test } = importClient('hooks/useHandsFree.js');
  const { saidOneOf, heardWake, afterWake, YES, NO } = __test;

  // ── Navigation ──────────────────────────────────────────────────────────
  console.log('\nNavigation commands');
  const id = (t) => matchCommand(t)?.id || null;

  ck('"open ai chat box" opens the chat — the phrase Sachin actually uses',
     id('open ai chat box') === 'open_chat', id('open ai chat box'));
  ck('"open chat" works too', id('open chat') === 'open_chat');
  ck('"chat box" on its own works', id('chat box') === 'open_chat');
  ck('"show me the chat" works', id('show me the chat') === 'open_chat');
  ck('"open workout" opens training', id('open workout') === 'open_workout');
  ck('"go to progress" opens progress', id('go to progress') === 'open_progress');
  ck('"home" goes home', id('home') === 'go_home');
  ck('"help" is recognised', id('help') === 'help');
  ck('"stop listening" is recognised and sleeps', matchCommand('stop listening')?.sleep === true);

  console.log('\nEvery command says something back');
  for (const phrase of ['open chat', 'open workout', 'home', 'help', 'stop listening']) {
    const c = matchCommand(phrase);
    ck(`"${phrase}" has a spoken response — a silent action is indistinguishable from being ignored when you cannot see the screen`,
       !!(c && c.speak && c.speak.length > 0), c);
  }

  // ── Things that must NOT be swallowed as commands ───────────────────────
  // This is the dangerous direction: a member says what they ate, it matches a
  // navigation pattern, the app navigates, and they believe they logged.
  console.log('\nLogs must not be mistaken for commands');
  const notCommand = [
    'two roti and dal',
    'weight seventy eight point four',
    'log weight 78.4',
    'i had food at the gym',
    'ate dal chawal',
    'walked thirty minutes',
    'drank two glasses of water',
    'chicken and rice for lunch',
  ];
  for (const p of notCommand) {
    ck(`"${p}" falls through to logging rather than navigating`, matchCommand(p) === null, matchCommand(p));
  }

  ck('a phrase with a number never opens a screen — "log weight 78" is a weigh-in, not navigation',
     matchCommand('open weight 78') === null);

  ck('an empty phrase matches nothing', matchCommand('') === null);
  ck('null does not throw', matchCommand(null) === null);

  // ── Yes and no ──────────────────────────────────────────────────────────
  // Getting this wrong writes to a member's day without them knowing.
  console.log('\nConfirmation');
  for (const y of ['yes', 'yeah', 'ok', 'okay', 'correct', 'haan', 'log it', 'save it']) {
    ck(`"${y}" is a yes`, saidOneOf(y, YES) === true);
  }
  for (const n of ['no', 'nope', 'nahi', 'cancel', 'stop', 'wrong']) {
    ck(`"${n}" is a no`, saidOneOf(n, NO) === true);
  }

  ck('"nahi" is NOT read as yes — mishearing this writes food to their day and nothing on screen tells them',
     saidOneOf('nahi', YES) === false);
  ck('"no" is not a yes', saidOneOf('no', YES) === false);
  ck('"yes" is not a no', saidOneOf('yes', NO) === false);

  // Whole-word matching. "ha" inside another word must not agree to anything.
  ck('"chalo" does not contain a yes', saidOneOf('chalo', YES) === false);
  ck('"channa" does not contain a yes', saidOneOf('channa', YES) === false);
  ck('"banana" does not contain a no', saidOneOf('banana', NO) === false);

  ck('a food sentence is neither yes nor no, so it gets read back as a correction rather than guessed at',
     saidOneOf('two roti and dal', YES) === false && saidOneOf('two roti and dal', NO) === false);

  // ── The wake phrase ─────────────────────────────────────────────────────
  console.log('\nWake phrase');
  ck('"hey fitlife" wakes it', heardWake('hey fitlife') === true);
  ck('"hey fit life" wakes it — speech engines split the name',
     heardWake('hey fit life') === true);
  ck('"ok fitlife" wakes it', heardWake('ok fitlife') === true);
  ck('ordinary speech does not wake it', heardWake('two roti and dal') === false);
  ck('the app name alone does not wake it — "I logged it in fitlife" must not trigger',
     heardWake('i logged it in fitlife') === false);

  ck('a command said in the same breath is picked up',
     afterWake('hey fitlife two roti and dal') === 'two roti and dal');
  ck('the wake phrase alone leaves nothing after it',
     afterWake('hey fitlife') === '');
  ck('afterWake on a non-wake phrase returns nothing', afterWake('two roti') === '');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
