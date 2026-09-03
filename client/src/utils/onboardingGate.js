/**
 * utils/onboardingGate.js — should this member see the first-run setup?
 *
 * The rule lived inline in App.jsx as a one-line ternary, which is how it came
 * to strand people:
 *
 *   const settled = serverOnboarded !== null;
 *   const needsOnboarding = settled ? !serverOnboarded : !onboardingDone;
 *
 * `serverOnboarded` is fetched once on mount and never refreshed. For a new
 * member it is FALSE. They complete setup, the PUT succeeds, the local flag
 * flips — and the gate ignored the local flag entirely because the server
 * value had "settled". Onboarding rendered again, the button never left
 * "Saving...", and the member could not get into the app at all. That half was
 * fixed by `justFinished`.
 *
 * What remained was the other half of the same mistake, and it is the one
 * iPhone members have been hitting:
 *
 *   THE ABSENCE OF EVIDENCE WAS TREATED AS EVIDENCE OF ABSENCE.
 *
 * `onboardingDone` lives in localStorage under `fitlife-settings-v2`. When iOS
 * clears site data — which it does to standalone web apps, and which takes the
 * session cookie with it — that flag goes back to false. On the next launch
 * the member logs in again, and then, because `serverOnboarded` is null on the
 * first render (ALWAYS, for at least one frame, and for the whole round trip
 * in practice), the gate fell through to the wiped local flag and rendered
 * setup. A member of eight months was asked who was using the app and what
 * their goal was.
 *
 * Note this did not need the request to FAIL. Null is the starting value, so
 * on a slow connection the setup screen appeared while a perfectly good
 * request was still in flight.
 *
 * Two rules now, and they are the whole file:
 *
 *   1. Setup is shown only on POSITIVE evidence that it has not been done —
 *      the server said so, in as many words.
 *   2. Not knowing yet is not an answer. While the check is in flight, or
 *      after it has failed, the caller is told to WAIT, never to onboard.
 *
 * The local flag can now only keep someone OUT of onboarding (offline, server
 * unreachable, but this device remembers finishing). It can no longer put
 * anyone INTO it. A wiped flag is indistinguishable from a new member, so it
 * must not be trusted in that direction.
 *
 * @param {boolean|null|undefined} serverOnboarded  server's answer; null/undefined = not yet known
 * @param {boolean} onboardingDone   local cache, set on completion
 * @param {boolean} justFinished     completed during this session
 * @param {boolean} checkFailed      the check errored, rather than still being in flight
 * @returns {'app'|'onboarding'|'wait'}
 */
export function onboardingDecision({
  serverOnboarded,
  onboardingDone,
  justFinished = false,
  checkFailed = false,
} = {}) {
  // Finishing setup in THIS session is newer than anything fetched on mount.
  if (justFinished) return 'app';

  // The server has answered. It is the source of truth, which is what stops a
  // member who set up on another phone being asked to do it again.
  if (serverOnboarded === true)  return 'app';
  if (serverOnboarded === false) return 'onboarding';

  // No server answer yet. This device remembering a completed setup is enough
  // to let them through: that flag can only ever be a false NEGATIVE (a wipe),
  // never a false positive, because nothing sets it except finishing.
  if (onboardingDone === true) return 'app';

  // Nothing known either way. This is the case that used to render setup.
  //
  // 'wait' while the request is in flight, and 'wait' ALSO when it has failed,
  // because a failed check tells us nothing about whether this member has
  // onboarded — and guessing wrong means overwriting the goal they already
  // chose. The caller shows a retry, which is recoverable. Onboarding is not.
  //
  // `checkFailed` is accepted so the caller can tell a spinner from a retry
  // button, and is deliberately NOT used to change the decision.
  void checkFailed;
  return 'wait';
}

/**
 * Kept so nothing importing the old name breaks. Note the deliberate
 * asymmetry: 'wait' is NOT onboarding, so any stale caller gets the safe
 * answer rather than the damaging one.
 *
 * @deprecated prefer onboardingDecision — a boolean cannot express "not known".
 */
export function needsOnboarding(args) {
  return onboardingDecision(args) === 'onboarding';
}
