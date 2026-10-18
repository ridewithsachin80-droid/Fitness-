/**
 * lib/day/nutrientStatus.js — where one nutrient value came from (Fixes-2k).
 * Mirror of server/services/nutrientStatus.js; test-nutrient-provenance checks
 * the two agree.
 *
 *   reference  IFCT 2017 / USDA / exact label record    confirmed
 *   recorded   coach, admin, member label, barcode label  confirmed
 *   recipe     calculated from ingredients and factors     estimate
 *   ai         AI estimate                                 estimate
 *   unknown    nothing recorded, or an old uncertain 0
 *
 * An old value with no `_status`: null/0 → unknown; > 0 → ai when the logged
 * item came from the AI or a photo, otherwise recorded. Old logs are never
 * rewritten; this is only how they are read.
 */
export const CONFIRMED_STATUSES = ['reference', 'recorded'];
export const ESTIMATE_STATUSES = ['recipe', 'ai'];

const AI_SOURCES = ['ai', 'ai-estimate', 'photo'];

export function nutrientStatus(per100, key, item = null) {
  const v = per100 ? per100[key] : undefined;
  if (v === null || v === undefined || v === '') return 'unknown';
  const n = Number(v);
  if (!Number.isFinite(n)) return 'unknown';
  const st = per100._status?.[key];
  if (st) return st;
  if (n === 0) return 'unknown';
  return item && AI_SOURCES.includes(item.source) ? 'ai' : 'recorded';
}

export const isConfirmed = (s) => CONFIRMED_STATUSES.includes(s);
export const isEstimate = (s) => ESTIMATE_STATUSES.includes(s);

/** Words for a status, as shown beside a value. */
export const STATUS_LABEL = {
  reference: 'Reference value',
  recorded: 'Recorded',
  recipe: 'Recipe estimate',
  ai: 'AI estimate',
  unknown: 'Not known',
};
