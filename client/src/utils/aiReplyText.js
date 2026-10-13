const hasRows = value => Array.isArray(value) && value.length > 0;
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0;

/** Logging replies describe a proposal, never a completed write. The model's
 * prose can disagree with resolved foods, member edits or save status, so the
 * review itself owns quantities, nutrition and the eventual save receipt. */
export function hasLoggingPreview(message) {
  if (message?.reviewProposed) return true;
  const parsed = message?.parsed;
  if (hasRows(message?.lab?.results)) return true;
  if (!parsed) return false;
  return ['foods', 'activities', 'acv', 'supplements', 'workouts', 'corrections', 'bodyMetrics']
    .some(key => hasRows(parsed[key]))
    || positive(parsed.weight_kg) || positive(parsed.water_ml_add) || !!(parsed.sleep?.bedtime || parsed.sleep?.waketime)
    || parsed.notesOn === true || (typeof parsed.notes === 'string' && parsed.notes.trim().length > 0);
}

/** Follow-ups need the member's current reviewed values, including a photo's
 * food names. Model completion prose is not conversation state. */
export function aiContextText(message) {
  if (!hasLoggingPreview(message)) return aiReplyText(message);
  const p = message.parsed || {};
  const rows = value => Array.isArray(value) ? value.filter(Boolean) : [];
  const parts = rows(p.foods).map(f => `${f.name} ${f.grams}g ${f.meal || ''}${f.on === false ? ' (excluded)' : ''}`.trim());
  if (positive(p.weight_kg)) parts.push(`Weight ${p.weight_kg}kg${p.weightOn === false ? ' (excluded)' : ''}`);
  if (positive(p.water_ml_add)) parts.push(`Water +${p.water_ml_add}ml${p.waterOn === false ? ' (excluded)' : ''}`);
  if (p.sleep) parts.push(`Sleep ${p.sleep.bedtime || ''}–${p.sleep.waketime || ''}${p.sleepOn === false ? ' (excluded)' : ''}`);
  for (const key of ['activities', 'acv', 'supplements', 'workouts', 'corrections', 'bodyMetrics']) {
    for (const row of rows(p[key])) {
      const details = [row.name || row.label || row.id || key];
      if (row.grams != null) details.push(`${row.grams}g`);
      if (row.meal) details.push(row.meal);
      if (row.value != null) details.push(`${row.value}${row.unit || ''}`);
      if (row.duration_min != null) details.push(`${row.duration_min}min`);
      if (hasRows(row.sets)) details.push(rows(row.sets).map(set => `${set.reps} reps at ${set.weight_kg || 0}kg`).join(', '));
      if (row.on === false || (key === 'bodyMetrics' && p.bodyMetricsOn === false)) details.push('(excluded)');
      parts.push(details.join(' '));
    }
  }
  if (typeof p.notes === 'string' && p.notes.trim()) parts.push(`Note: ${p.notes.trim()}${p.notesOn === false ? ' (excluded)' : ''}`);
  for (const row of rows(message.lab?.results)) parts.push(`${row.test_name} ${row.value ?? ''} ${row.unit || ''}${row.on === false ? ' (excluded)' : ''}`.trim());
  return `${message.applied ? 'Reviewed entries' : 'Unsaved preview'}: ${parts.join('; ')}`;
}

export function aiReplyText(message) {
  if (!hasLoggingPreview(message)) return typeof message?.text === 'string' ? message.text : '';
  // Even when every row is excluded, this remains an unsaved proposal.
  // Applied can mean queued or a partial failure; its status below is the
  // only authority for whether anything actually reached the member's log.
  return message.applied
    ? 'Your reviewed entries.'
    : 'Review the details below. These entries haven’t been saved yet.';
}
