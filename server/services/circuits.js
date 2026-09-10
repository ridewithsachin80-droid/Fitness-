/**
 * services/circuits.js — the coach's house circuits (Sprint 11d).
 *
 * A coach who says "push day Monday" means THEIR push day — the exercises they
 * teach, in the order they teach them — not five gym staples the model picked.
 * This stores those circuits and renders them into the coach-parse prompt so
 * the AI copies them exactly when a split day matches by name.
 *
 * `parseCircuitText` turns the way a coach actually types a circuit —
 *
 *     Bench press 4x8-12
 *     Incline DB press 3 x 10
 *     Cable fly 3x12-15 chest
 *
 * — into rows the program assigner already understands. Lenient on spacing
 * and the × character; strict that a line has a name.
 */
const MUSCLES = ['chest', 'back', 'legs', 'shoulders', 'arms', 'core', 'full_body'];

function parseLine(line) {
  const raw = String(line || '').trim();
  if (!raw) return null;
  // "Name 4x8-12 chest" | "Name 3 x 10" | "Name" (no prescription)
  const m = raw.match(/^(.*?)(?:\s+(\d{1,2})\s*[x×]\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?)?(?:\s+(chest|back|legs|shoulders|arms|core|full_body))?\s*$/i);
  if (!m) return null;
  const name = m[1].trim().replace(/\s+/g, ' ');
  if (!name) return null;
  const sets = m[2] ? parseInt(m[2], 10) : null;
  const lo = m[3] ? parseInt(m[3], 10) : null;
  const hi = m[4] ? parseInt(m[4], 10) : lo;
  const mg = m[5] ? m[5].toLowerCase() : null;
  return { name, sets, reps_min: lo, reps_max: hi, muscle_group: mg };
}

function parseCircuitText(text) {
  return String(text || '').split(/\r?\n/).map(parseLine).filter(Boolean);
}

/** Validate a circuit as it arrives from the client. Returns { ok, error?, circuit? }. */
function validateCircuit(body = {}) {
  const name = String(body.name || '').trim();
  if (!name) return { ok: false, error: 'A circuit needs a name' };
  if (name.length > 60) return { ok: false, error: 'Keep the name under 60 characters' };
  const exercises = Array.isArray(body.exercises) ? body.exercises : parseCircuitText(body.text);
  if (!exercises.length) return { ok: false, error: 'A circuit needs at least one exercise' };
  if (exercises.length > 15) return { ok: false, error: 'Keep a circuit to 15 exercises or fewer' };
  const clean = exercises.map(e => ({
    name: String(e.name || '').trim().slice(0, 80),
    sets: e.sets != null ? Math.max(1, Math.min(10, parseInt(e.sets, 10) || 0)) || null : null,
    reps_min: e.reps_min != null ? Math.max(1, Math.min(100, parseInt(e.reps_min, 10) || 0)) || null : null,
    reps_max: e.reps_max != null ? Math.max(1, Math.min(100, parseInt(e.reps_max, 10) || 0)) || null : null,
    muscle_group: MUSCLES.includes(String(e.muscle_group || '').toLowerCase()) ? String(e.muscle_group).toLowerCase() : null,
  })).filter(e => e.name);
  if (!clean.length) return { ok: false, error: 'Every exercise needs a name' };
  return { ok: true, circuit: { name, exercises: clean } };
}

/** The prompt block. Empty string when the coach has no circuits. */
function circuitsPromptBlock(circuits = []) {
  if (!circuits.length) return '';
  const fmt = (e) => {
    const rx = e.sets ? ` ${e.sets}×${e.reps_min || '?'}${e.reps_max && e.reps_max !== e.reps_min ? '–' + e.reps_max : ''}` : '';
    return `${e.name}${rx}${e.muscle_group ? ` (${e.muscle_group})` : ''}`;
  };
  return `
THE COACH'S HOUSE CIRCUITS. When a program day the coach names matches one of
these (loosely — "push", "push day", "Push circuit" all match "Push"), use
EXACTLY these exercises, sets and reps for that day, in this order. Do NOT
substitute or add generic exercises. Only build a generic day when no circuit
matches.
${circuits.map(c => `  - "${c.name}": ${c.exercises.map(fmt).join('; ')}`).join('\n')}
`;
}

/** Match a day label the AI produced to a house circuit, loosely. */
function matchCircuit(label, circuits = []) {
  const norm = (s) => String(s || '').toLowerCase().replace(/\b(day|circuit|session|workout)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const l = norm(label);
  if (!l) return null;
  return circuits.find(c => { const n = norm(c.name); return n && (n === l || l.startsWith(n) || n.startsWith(l)); }) || null;
}

module.exports = { parseLine, parseCircuitText, validateCircuit, circuitsPromptBlock, matchCircuit, MUSCLES };
