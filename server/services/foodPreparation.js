/**
 * services/foodPreparation.js — raw or cooked: what a food's nutrition numbers
 * are for (Fixes-2h, 18 Oct 2026).
 *
 * Stored on the shared foods row (set by a coach or admin, who and when kept),
 * on a member's own label, and copied onto each logged item, saved meal and
 * plan item at the moment the food is chosen — so history keeps what it was
 * logged as. NULL means "not specified": nothing is guessed from the name
 * here. The client may still read the name as a clearly-labelled fallback.
 */
const VALUES = Object.freeze(['raw', 'cooked']);

/**
 * Read a preparation value from a request body.
 *   'raw' | 'cooked'            → that value
 *   null | '' | 'unknown'       → null (clear it)
 *   undefined                   → undefined (leave as it is)
 *   anything else               → throws a 400 the caller can show
 */
function parsePreparation(v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const t = String(v).trim().toLowerCase();
  if (t === '' || t === 'unknown' || t === 'not specified') return null;
  if (VALUES.includes(t)) return t;
  throw Object.assign(new Error('Preparation must be raw, cooked or not specified.'), { status: 400 });
}

/** For copying onto an item: a stored value or null, never anything else. */
const cleanPreparation = (v) => (VALUES.includes(v) ? v : null);

module.exports = { PREPARATION_VALUES: VALUES, parsePreparation, cleanPreparation };
