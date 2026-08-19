/**
 * exerciseCalories.js — one source of truth for exercise energy expenditure.
 *
 * Used by the Workout log, the Today hero chip and the Profile TDEE card, so
 * all three can never disagree with each other.
 *
 * ── Why two different models ────────────────────────────────────────────────
 *
 * STRENGTH → volume-based.
 *   Duration is a poor proxy for lifting because most of a session is rest.
 *   A 60-minute session might contain 8 minutes of actual effort, and a
 *   duration × MET formula bills the member for all 60 — it also can't tell
 *   3 sets from 20 if both take an hour. Since we capture reps and weight,
 *   we use the work actually done:
 *       volume (kg) = Σ (reps × weight)
 *       kcal        = volume × 0.08
 *   The 0.08 coefficient sits in the middle of the published range for
 *   resistance training including between-set recovery (~0.06–0.11 kcal per
 *   kg lifted). Body-weight movements carry no external load, so they're
 *   charged per rep instead (0.35 kcal/rep, an average-adult figure).
 *
 * CARDIO → MET-based, which is what METs were designed for.
 *       kcal = (MET − 1) × body weight (kg) × hours
 *   The −1 matters: 1 MET *is* resting metabolism, and the day's resting burn
 *   is already counted as BMR × 1.2 in the TDEE card. Charging the full MET
 *   value on top would bill those minutes twice.
 *
 * All figures are estimates with roughly ±30% error. Good enough to tell a
 * member whether they're in a deficit; not precise enough for exact targets.
 */

// ── Strength ────────────────────────────────────────────────────────────────

const KCAL_PER_KG_VOLUME = 0.08;   // resistance work incl. recovery
const KCAL_PER_BODYWEIGHT_REP = 0.35;

/**
 * @param {Array} exercises [{ sets: [{ reps, weight_kg }] }]
 * @returns {{ kcal:number, volumeKg:number, sets:number, reps:number }}
 */
export function strengthEnergy(exercises = []) {
  let volumeKg = 0, bodyweightReps = 0, sets = 0, reps = 0;

  for (const ex of exercises) {
    for (const st of ex?.sets || []) {
      const r = parseInt(st?.reps) || 0;
      const w = parseFloat(st?.weight_kg) || 0;
      if (r <= 0) continue;
      sets += 1;
      reps += r;
      if (w > 0) volumeKg += r * w;
      else bodyweightReps += r;   // push-ups, air squats, etc.
    }
  }

  const kcal = Math.round(volumeKg * KCAL_PER_KG_VOLUME + bodyweightReps * KCAL_PER_BODYWEIGHT_REP);
  return { kcal, volumeKg: Math.round(volumeKg), sets, reps };
}

// ── Cardio ──────────────────────────────────────────────────────────────────

/**
 * Cardio types with their MET values. Speed-dependent types carry a table of
 * [km/h, MET] breakpoints (Compendium of Physical Activities); we interpolate
 * between them so 7 km/h isn't forced into a 5 or 8 km/h bucket.
 */
export const CARDIO_TYPES = [
  { id: 'walking',    label: 'Walking',        icon: '🚶', speed: true,
    mets: [[3, 2.0], [4.5, 3.0], [5.5, 3.8], [6.5, 5.0], [8, 7.0]] },
  { id: 'running',    label: 'Running',        icon: '🏃', speed: true,
    mets: [[8, 8.3], [9.7, 9.8], [11.3, 11.0], [12.9, 11.8], [16, 14.5]] },
  { id: 'cycling',    label: 'Cycling',        icon: '🚴', speed: true,
    mets: [[16, 4.0], [19, 6.8], [22, 8.0], [25, 10.0], [30, 12.0]] },
  { id: 'swimming',   label: 'Swimming',       icon: '🏊', speed: false, met: 7.0 },
  { id: 'elliptical', label: 'Elliptical',     icon: '⛷️', speed: false, met: 5.0 },
  { id: 'rowing',     label: 'Rowing',         icon: '🚣', speed: false, met: 7.0 },
  { id: 'stairs',     label: 'Stair climbing', icon: '🪜', speed: false, met: 8.8 },
  { id: 'skipping',   label: 'Skipping rope',  icon: '🤸', speed: false, met: 11.8 },
  { id: 'yoga',       label: 'Yoga',           icon: '🧘', speed: false, met: 3.0 },
  { id: 'other',      label: 'Other cardio',   icon: '💨', speed: false, met: 5.0 },
];

export function cardioTypeById(id) {
  return CARDIO_TYPES.find(t => t.id === id) || CARDIO_TYPES[CARDIO_TYPES.length - 1];
}

/** MET for a cardio type at a given speed, linearly interpolated. */
export function cardioMET(typeId, speedKmh) {
  const t = cardioTypeById(typeId);
  if (!t.speed || !t.mets) return t.met || 5.0;

  const speed = parseFloat(speedKmh);
  if (!Number.isFinite(speed) || speed <= 0) {
    // No speed given — use the middle breakpoint as a moderate default
    return t.mets[Math.floor(t.mets.length / 2)][1];
  }
  const pts = t.mets;
  if (speed <= pts[0][0]) return pts[0][1];
  if (speed >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [s1, m1] = pts[i], [s2, m2] = pts[i + 1];
    if (speed >= s1 && speed <= s2) {
      const ratio = (speed - s1) / (s2 - s1);
      return m1 + ratio * (m2 - m1);
    }
  }
  return t.mets[0][1];
}

/**
 * @param {Array} entries [{ type, duration_min, speed_kmh }]
 * @param {number} bodyWeightKg
 * @returns {{ kcal:number, minutes:number }}
 */
export function cardioEnergy(entries = [], bodyWeightKg) {
  if (!bodyWeightKg || bodyWeightKg <= 0) return { kcal: 0, minutes: 0 };
  let kcal = 0, minutes = 0;

  for (const e of entries) {
    const mins = parseFloat(e?.duration_min) || 0;
    if (mins <= 0) continue;
    const capped = Math.min(300, mins);   // 5 h ceiling — beyond that it's a typo
    const met = cardioMET(e?.type, e?.speed_kmh);
    // (MET − 1): resting burn for these minutes is already counted in BMR × 1.2
    kcal += Math.max(0, met - 1) * bodyWeightKg * (capped / 60);
    minutes += capped;
  }
  return { kcal: Math.round(kcal), minutes: Math.round(minutes) };
}

/** Whole session: strength volume + cardio. */
export function sessionEnergy({ exercises = [], cardio = [], bodyWeightKg }) {
  const s = strengthEnergy(exercises);
  const c = cardioEnergy(cardio, bodyWeightKg);
  return {
    strengthKcal: s.kcal,
    cardioKcal:   c.kcal,
    totalKcal:    s.kcal + c.kcal,
    volumeKg:     s.volumeKg,
    sets:         s.sets,
    reps:         s.reps,
    cardioMin:    c.minutes,
  };
}

/** Auto-estimate for a cardio row's distance when speed and duration are known. */
export function distanceFrom(speedKmh, durationMin) {
  const s = parseFloat(speedKmh), m = parseFloat(durationMin);
  if (!Number.isFinite(s) || !Number.isFinite(m) || s <= 0 || m <= 0) return null;
  return +(s * (m / 60)).toFixed(2);
}
