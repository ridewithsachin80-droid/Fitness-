/** Compact per-member/day/browser receipt. No health payload is stored here.
 * A sequence may be applied once; only a newer edit from the same stream can
 * continue a timed-out commit, and only while no external edit changed the day.
 */
const { createHash } = require('crypto');
const FIELDS = ['weight_kg', 'activities', 'acv', 'food_items', 'water_ml', 'supplements', 'sleep', 'notes'];
const ordered = value => Array.isArray(value) ? value.map(ordered)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]))
    : value;
const digest = value => createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
const snapshot = doc => Object.fromEntries(FIELDS.map(key => [key,
  key === 'weight_kg' ? (doc?.[key] == null ? null : Number(doc[key]))
    : key === 'water_ml' ? Number(doc?.[key]) || 0
      : key === 'food_items' ? (Array.isArray(doc?.[key]) ? doc[key] : [])
        : key === 'notes' ? (doc?.[key] || '') : (doc?.[key] || {})]));

function writeMetadata(body) {
  if (body.client_stream_id == null && body.client_sequence == null) return null;
  if (typeof body.client_stream_id !== 'string' || !/^[a-zA-Z0-9_-]{1,96}$/.test(body.client_stream_id)
    || !Number.isSafeInteger(body.client_sequence) || body.client_sequence < 1 || body.client_sequence > 2147483647) {
    const error = new Error('Invalid save revision. Please reload and try again.');
    error.status = 400; throw error;
  }
  const parent = body.base_client_write;
  if (parent != null && (typeof parent.streamId !== 'string' || !/^[a-zA-Z0-9_-]{1,96}$/.test(parent.streamId)
    || !Number.isSafeInteger(parent.sequence) || parent.sequence < 1 || parent.sequence > 2147483647)) {
    const error = new Error('Invalid save parent revision. Please reload and try again.');
    error.status = 400; throw error;
  }
  return { streamId: body.client_stream_id, sequence: body.client_sequence, parent };
}

const dayFingerprint = doc => digest(snapshot(doc));
const requestFingerprint = (doc, protocolTotal) => digest({ day: snapshot(doc), protocol_total: Number(protocolTotal) || null });

function receiptDecision(receipt, stored, metadata, payloadHash) {
  if (!receipt || !stored || !metadata) return { replay: false, continuation: false };
  const last = Number(receipt.sequence), sequence = metadata.sequence;
  if (sequence === last && payloadHash !== receipt.payload_hash) {
    const error = new Error('This save revision was already used for another edit. Please reload and try again.');
    error.status = 409; throw error;
  }
  const unchanged = dayFingerprint(stored) === receipt.day_hash;
  const externalMerge = receipt.outcome?.merged || receipt.outcome?.merged_live;
  return {
    replay: sequence <= last,
    superseded: sequence < last,
    externalChanged: !unchanged,
    continuation: sequence > last && unchanged && !externalMerge
      && metadata.parent?.streamId === metadata.streamId && metadata.parent.sequence === last,
  };
}

module.exports = { writeMetadata, dayFingerprint, requestFingerprint, receiptDecision };
