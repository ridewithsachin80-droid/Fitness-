const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const boundedMinutes = value => typeof value === 'number' && Number.isFinite(value)
  && value >= 1 && value <= 1440 ? Math.round(value) : null;

/** A narrow fallback for direct numeric duration statements, not a general
 * sleep-language parser. It only asks for missing times; it never writes a
 * duration or derives a bedtime from the member's target schedule. */
function statedSleepDuration(message) {
  const text = String(message || '').slice(0, 1200);
  const match = /\b(?:slept|sleep)\s*(?:for\s*)?(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)(?=\b|\d)(?:\s*(?:and\s*)?(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b)?/i.exec(text);
  if (!match) return null;
  const before = text.slice(Math.max(0, match.index - 65), match.index).split(/[,;.!?]/).at(-1);
  const after = text.slice(match.index + match[0].length);
  if (/\b(?:not|never|didn['’]?t|haven['’]?t|hasn['’]?t|should|want|plan|aim|target|need|usually|normally)\b/i.test(before)
    || /^\s*ago\b/i.test(after)) return null;
  const hours = /^h/i.test(match[2]);
  const minutes = boundedMinutes(Number(match[1]) * (hours ? 60 : 1) + (hours ? Number(match[3] || 0) : 0));
  // Preserve existing clock parsing when the request also supplies times.
  // This fallback does not try to associate every clock in a mixed sentence.
  const clock = /\b\d{1,2}:\d{2}\b|\b\d{1,2}\s*(?:am|pm)\b|\b(?:from|until|till|woke(?:\s+up)?(?:\s+at)?)\s+\d{1,2}\b/i.test(text);
  return { minutes, clock };
}

function resolveSleepReview(rawSleep, rawUnresolved, message) {
  const bedtime = object(rawSleep) && HHMM.test(rawSleep.bedtime || '') ? rawSleep.bedtime : null;
  const waketime = object(rawSleep) && HHMM.test(rawSleep.waketime || '') ? rawSleep.waketime : null;
  const stated = statedSleepDuration(message);
  const requested = object(rawUnresolved) && rawUnresolved.reason === 'times_needed';
  // Numeric duration with no source clock must not inherit model-invented
  // times. Existing explicitly timed sleep keeps its usual review behavior.
  if (stated && !stated.clock) return { sleep: null,
    unresolvedSleep: { reason: 'times_needed', duration_minutes: stated.minutes } };
  const sleep = bedtime || waketime ? { bedtime, waketime } : null;
  if (sleep) return { sleep, unresolvedSleep: null };
  return { sleep, unresolvedSleep: requested || stated
    ? { reason: 'times_needed', duration_minutes: stated?.minutes ?? boundedMinutes(rawUnresolved?.duration_minutes) }
    : null };
}

module.exports = { resolveSleepReview, statedSleepDuration };
