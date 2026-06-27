/**
 * voiceSetParser.js
 *
 * Parses a spoken phrase like "60 kg 8 reps" or "3 sets of 60 kilos for 8
 * reps" into structured { sets, reps, weight_kg }. Built for gym-floor use:
 * short phrases, small numbers, said quickly between sets.
 *
 * Deliberately simple — regex-based, no AI call. A wrong parse here is just
 * a wrong number for the user to glance at and fix, not worth the latency
 * or cost of a model call for something this constrained.
 */

// Word-to-number map for the range gym numbers actually fall in. Chrome's
// speech recognition usually already returns digits for numbers, but this
// covers the cases where it doesn't (varies by locale/accent).
const ONES = { zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9,
  ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16,
  seventeen:17, eighteen:18, nineteen:19 };
const TENS = { twenty:20, thirty:30, forty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90 };

/** Converts spoken number words within a string to digits (best-effort). */
function wordsToDigits(text) {
  let result = text.toLowerCase();
  // Compound tens, e.g. "sixty five" → "65"
  result = result.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-](one|two|three|four|five|six|seven|eight|nine)\b/g,
    (_, t, o) => String(TENS[t] + ONES[o]));
  result = result.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/g, (_, t) => String(TENS[t]));
  result = result.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b/g,
    (_, o) => String(ONES[o]));
  return result;
}

/**
 * @param {string} raw - the speech transcript
 * @returns {{ sets: number, reps: number|null, weight_kg: number }}
 *   reps is null if nothing matched — caller should treat that as a failed parse.
 */
export function parseVoiceSet(raw) {
  const text = wordsToDigits(raw);

  let sets = 1;
  const setsMatch = text.match(/(\d+)\s*sets?\b/);
  if (setsMatch) sets = parseInt(setsMatch[1]);

  let weight_kg = 0;
  const weightMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:kgs?|kilos?|kilograms?)\b/);
  if (weightMatch) weight_kg = parseFloat(weightMatch[1]);

  let reps = null;
  const repsMatch = text.match(/(\d+)\s*reps?\b/);
  if (repsMatch) {
    reps = parseInt(repsMatch[1]);
  } else {
    // Fallback: "60 kg for 8" or just "8" with no unit words at all —
    // take the number that isn't already claimed by sets/weight.
    const allNumbers = [...text.matchAll(/\d+(?:\.\d+)?/g)].map(m => parseFloat(m[0]));
    const claimed = new Set([sets, weight_kg].filter(Boolean));
    const leftover = allNumbers.find(n => !claimed.has(n));
    if (leftover !== undefined) reps = Math.round(leftover);
  }

  return { sets, reps, weight_kg };
}
