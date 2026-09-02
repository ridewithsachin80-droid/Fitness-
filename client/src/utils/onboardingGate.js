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
 * flips — and the gate ignores the local flag entirely because the server value
 * has "settled". Onboarding renders again, the button never leaves "Saving…",
 * and the member cannot get into the app at all. The save had worked every
 * time.
 *
 * The server stays the source of truth — that is what stops a member who set up
 * on another phone being asked to do it again. But a completion in THIS session
 * is newer than the value fetched on mount, so it wins.
 *
 * @param {boolean|null} serverOnboarded  from the server; null = not yet known
 * @param {boolean} onboardingDone        local flag, set on completion
 * @param {boolean} justFinished          completed during this session
 */
export function needsOnboarding({ serverOnboarded, onboardingDone, justFinished = false }) {
  if (justFinished) return false;
  if (serverOnboarded !== null && serverOnboarded !== undefined) return !serverOnboarded;
  // Offline, or the endpoint is unreachable: fall back to the local flag rather
  // than trapping a returning member in setup they have already done.
  return !onboardingDone;
}
