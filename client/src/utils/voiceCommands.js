/**
 * utils/voiceCommands.js — the spoken command vocabulary.
 *
 * Separate from the hook so it can be tested without a browser, a microphone
 * or a speech engine. The hook owns the conversation; this owns the words.
 *
 * EVERY COMMAND RETURNS SOMETHING TO SAY. The member cannot see the screen —
 * that is the whole premise — so an action with no spoken response is
 * indistinguishable from the app having ignored them. There is no silent
 * success here.
 */

/**
 * Recognised commands, in match order. First match wins, so more specific
 * phrases must come before the general ones.
 *
 * `speak` is what the member hears. Keep it short: they are across the room,
 * possibly on earbuds, and a long sentence is worse than no sentence.
 */
const COMMANDS = [
  {
    id: 'open_chat',
    // "chat box" is what Sachin actually says, so it is matched literally
    // rather than being normalised away into "chat".
    match: /\b(open|show|go to|start)\b.*\b(ai )?chat( ?box)?\b|^chat( ?box)?$/,
    route: '/?open=ai',
    speak: 'Chat is open. Tell me what to log.',
  },
  {
    id: 'open_weight',
    match: /\b(open|show|go to|log)\b.*\bweight\b(?!\s+\d)|^weight$/,
    route: '/?open=weight',
    speak: 'Weight is open. Say your weight.',
  },
  {
    id: 'open_workout',
    match: /\b(open|show|go to|start)\b.*\b(workout|training|gym|exercise)\b/,
    route: '/workout',
    speak: 'Workout is open.',
  },
  {
    id: 'open_food',
    match: /\b(open|show|go to)\b.*\b(food|meal|nutrition|diet)\b/,
    route: '/food',
    speak: 'Food log is open.',
  },
  {
    id: 'open_progress',
    match: /\b(open|show|go to)\b.*\b(progress|charts?|graphs?|trend)\b/,
    route: '/progress',
    speak: 'Progress is open.',
  },
  {
    id: 'go_home',
    match: /\b(go )?(home|dashboard|today)\b|^back$/,
    route: '/',
    speak: 'Home.',
  },
  {
    id: 'help',
    match: /\b(help|what can (you|i) (do|say)|commands)\b/,
    route: null,
    // Three examples, not a list of everything. Someone listening cannot hold
    // ten options in their head, and a long menu is where people give up.
    speak: 'Say: open chat. Or just tell me what you ate, and I will read it back before saving.',
  },
  {
    id: 'stop',
    match: /\b(stop listening|turn off|go to sleep|never mind|nothing)\b/,
    route: null,
    speak: 'Okay.',
    sleep: true,
  },
];

/**
 * Matches a spoken phrase to a navigation command.
 *
 * Deliberately conservative. Anything not clearly a command must fall through
 * and be treated as something to LOG — a member saying "two roti and dal"
 * should not be swallowed because it happened to contain the word "food".
 *
 * @param {string} text  already lower-cased and punctuation-stripped
 * @returns {{id, route, speak, sleep}|null}
 */
export function matchCommand(text) {
  const t = String(text || '').trim();
  if (!t) return null;

  // A sentence carrying numbers is almost always a log, not navigation —
  // "log weight 78.4" is a weigh-in, not a request to open the weight screen.
  // The `open_weight` pattern excludes a following number for the same reason,
  // and this is the second line of defence.
  for (const c of COMMANDS) {
    if (c.match.test(t)) {
      if (c.id.startsWith('open_') && /\d/.test(t)) continue;
      return { id: c.id, route: c.route || null, speak: c.speak, sleep: !!c.sleep };
    }
  }
  return null;
}

export const COMMAND_IDS = COMMANDS.map(c => c.id);
