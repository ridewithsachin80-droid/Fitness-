// Reference limits come from the entered lab report. A single printed bound
// is enough to compare a value; an absent/invalid bound is never treated as 0.
function finiteOrNull(value) {
  if (value == null || (typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function rangeState(value, refMin, refMax) {
  const v = finiteOrNull(value), min = finiteOrNull(refMin), max = finiteOrNull(refMax);
  if (v === null || (min === null && max === null)) return null;
  if (min !== null && v < min) return 'low';
  if (max !== null && v > max) return 'high';
  return 'normal';
}
function refText(refMin, refMax) {
  const min = finiteOrNull(refMin), max = finiteOrNull(refMax);
  if (min !== null && max !== null) return `${min}–${max}`;
  if (min !== null) return `≥ ${min}`;
  if (max !== null) return `≤ ${max}`;
  return null;
}
module.exports = { finiteOrNull, rangeState, refText };
