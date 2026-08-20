/**
 * dailyRead.js — the one-sentence coaching read at the top of Today.
 *
 * Template-based, not AI-generated. Three reasons: it renders instantly with
 * no network call, it costs nothing on every page view, and it can never say
 * anything unexpected about someone's health. The AI calls are better spent
 * in the chat, where variety actually matters.
 *
 * The rules are ordered by what matters most at that moment, and the first
 * match wins — a member who has logged nothing needs a different sentence to
 * one who is four items from a perfect day.
 *
 * Tone: honest but never guilt-tripping. "You haven't logged yet today" is
 * useful; "You've failed to log" is not. Nothing here shames a missed day.
 */

/** Time bands, in the member's own clock. */
function band(hour) {
  if (hour < 11) return 'morning';
  if (hour < 16) return 'midday';
  if (hour < 21) return 'evening';
  return 'night';
}

function list(items) {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * @returns {{ text: string, tone: 'prompt'|'progress'|'win' } | null}
 *   null when there is nothing worth saying — better silence than filler.
 */
export function dailyRead({
  hour = new Date().getHours(),
  isToday = true,
  weight = null,
  kcalIn = 0,
  kcalTarget = null,
  balance = null,          // kcal in − out; negative = deficit
  protocolDone = 0,
  protocolTotal = 0,
  waterMl = 0,
  waterTarget = 3000,
  foodCount = 0,
  workoutKcal = 0,
  volumeKg = 0,
  sleepSet = false,
  streak = 0,
  streakIsBest = false,
  pendingLabels = [],      // e.g. ['2 ACV doses', 'sleep times']
} = {}) {
  const t = band(hour);

  // Past days get a factual summary rather than a nudge — you can't act on it.
  if (!isToday) {
    if (protocolTotal > 0 && protocolDone === protocolTotal) {
      return { text: 'A complete day — every protocol item ticked.', tone: 'win' };
    }
    if (protocolTotal > 0) {
      return { text: `${protocolDone} of ${protocolTotal} protocol items completed on this day.`, tone: 'progress' };
    }
    return null;
  }

  const nothingLogged = !weight && foodCount === 0 && protocolDone === 0 && waterMl === 0;

  // ── Empty day ────────────────────────────────────────────────────────────
  if (nothingLogged) {
    if (t === 'morning') {
      return { text: 'Fresh day. Start with your morning weight — it takes ten seconds.', tone: 'prompt' };
    }
    if (t === 'midday') {
      return { text: "Nothing logged yet. Tell me what you've eaten so far and I'll fill the rest in.", tone: 'prompt' };
    }
    return { text: "Nothing logged today. One message covers the whole day — say what you ate and did.", tone: 'prompt' };
  }

  // ── Perfect day ──────────────────────────────────────────────────────────
  const protocolComplete = protocolTotal > 0 && protocolDone === protocolTotal;
  if (protocolComplete && foodCount > 0 && sleepSet) {
    if (streakIsBest && streak >= 3) {
      return { text: `Everything logged, and ${streak} days straight — your best run this month.`, tone: 'win' };
    }
    return { text: 'Everything logged and every protocol item done. A complete day.', tone: 'win' };
  }

  // ── Morning: weight first, it anchors the day's numbers ──────────────────
  if (t === 'morning' && !weight) {
    if (streak >= 3) {
      return { text: `${streak} days running. Log your weight to keep it going.`, tone: 'prompt' };
    }
    return { text: 'Log your morning weight to set up the rest of the day.', tone: 'prompt' };
  }

  // ── Energy balance, once there is food to balance against ────────────────
  if (foodCount > 0 && balance != null) {
    const pct = protocolTotal ? Math.round((protocolDone / protocolTotal) * 100) : 0;
    const left = pendingLabels.slice(0, 2);

    if (balance < -200) {
      const head = `You're ${Math.abs(Math.round(balance)).toLocaleString()} under`;
      if (left.length) {
        return { text: `${head} and ${pct}% through the protocol. ${cap(list(left))} still to go.`, tone: 'progress' };
      }
      return { text: `${head} and ${pct}% through the protocol.`, tone: 'progress' };
    }
    if (balance > 300) {
      const head = `You're ${Math.round(balance).toLocaleString()} over today`;
      if (t === 'evening' || t === 'night') {
        return { text: `${head}. A walk before bed would close some of that.`, tone: 'progress' };
      }
      return { text: `${head}. Worth keeping the next meal light.`, tone: 'progress' };
    }
    // Close to even
    if (left.length) {
      return { text: `Balanced so far today. ${cap(list(left))} left on the protocol.`, tone: 'progress' };
    }
    return { text: 'Balanced so far today — intake and burn are close to even.', tone: 'progress' };
  }

  // ── Training highlight, when there's a session but no food yet ───────────
  if (workoutKcal > 0 && foodCount === 0) {
    const vol = volumeKg > 0 ? ` and ${volumeKg.toLocaleString()} kg lifted` : '';
    return { text: `${workoutKcal} kcal burned${vol}. Log your meals so I can show the full picture.`, tone: 'prompt' };
  }

  // ── Evening sweep: name what's actually left ─────────────────────────────
  if ((t === 'evening' || t === 'night') && pendingLabels.length) {
    return { text: `Still open today: ${list(pendingLabels.slice(0, 3))}.`, tone: 'prompt' };
  }

  // ── Water, when it's the clear gap ───────────────────────────────────────
  if (waterMl < waterTarget * 0.5 && (t === 'midday' || t === 'evening')) {
    const short = ((waterTarget - waterMl) / 1000).toFixed(1);
    return { text: `${short}L of water still to go today.`, tone: 'prompt' };
  }

  // ── Generic progress ─────────────────────────────────────────────────────
  if (protocolTotal > 0 && protocolDone > 0) {
    const pct = Math.round((protocolDone / protocolTotal) * 100);
    return { text: `${protocolDone} of ${protocolTotal} protocol items done — ${pct}% through the day.`, tone: 'progress' };
  }

  return null;
}

function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
