/**
 * services/personName.js — what to call someone.
 *
 * `name.split(' ')[0]` greeted T V Sharada as "T".
 *
 * Indian names are very often written with leading initials — the father's or
 * the village name abbreviated, with the given name last. "T V Sharada" is
 * Sharada. Taking the first token is right for "Subramanya Prasad" and wrong
 * for a large share of this app's members, and being addressed by an initial in
 * your own coaching app reads as the app not knowing who you are.
 *
 * The same rule exists in client/src/utils/personName.js — the two run on
 * opposite sides of the wire and cannot import each other, so the copy is
 * unavoidable. test-coach-view asserts they agree on the same list of names.
 */

/** Mrs. Padmini is Padmini. */
const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'prof',
                        'shri', 'sri', 'smt', 'kum']);

/** "T", "V.", "MP" — an abbreviation, not what anyone calls you. */
function isInitial(token) {
  const t = token.replace(/\./g, '');
  if (t.length === 1) return true;
  // Two letters, both capitals: "MP", "TV". A genuine short name like "Bo" or
  // "Jo" is mixed case and survives.
  return t.length === 2 && t === t.toUpperCase() && /^[A-Za-z]+$/.test(t);
}

/**
 * @param {string} name
 * @param {string} [fallback='']
 * @returns {string} the name to greet them by
 */
function firstName(name, fallback = '') {
  const raw = String(name || '').trim();
  if (!raw) return fallback;

  const tokens = raw.split(/\s+/)
    .filter(t => !TITLES.has(t.replace(/\./g, '').toLowerCase()));

  const real = tokens.find(t => !isInitial(t));
  if (real) return real;

  // Every token is an initial ("T V S"). There is no better name available, so
  // use what they gave us rather than greeting someone by a single letter.
  return tokens.join(' ') || raw;
}

module.exports = { firstName, isInitial, TITLES };
