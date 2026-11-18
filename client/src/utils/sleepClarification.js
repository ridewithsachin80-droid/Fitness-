/** Duration is a clarification hint only; the daily log still needs clocks. */
export function normalizeSleepClarification(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.reason !== 'times_needed') return null;
  const n = value.duration_minutes;
  return { reason: 'times_needed', duration_minutes: typeof n === 'number' && Number.isFinite(n) && n >= 1 && n <= 1440 ? Math.round(n) : null };
}

export function sleepClarificationText(value) {
  const issue = normalizeSleepClarification(value);
  if (!issue) return '';
  const minutes = issue.duration_minutes;
  const duration = minutes == null ? '' : [Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)} h` : '', minutes % 60 ? `${minutes % 60} min` : ''].filter(Boolean).join(' ');
  return `Sleep isn’t included yet.${duration ? ` You mentioned ${duration}.` : ''} What time did you go to bed and wake up?`;
}
