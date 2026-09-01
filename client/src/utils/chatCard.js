/**
 * utils/chatCard.js — what an applied AI-chat card becomes after Undo or Edit.
 *
 * Both buttons roll the day's log back to its pre-apply snapshot. They differ
 * only in what the CARD becomes afterwards, and getting that difference wrong
 * is confusing in a way that is hard to describe and easy to ship:
 *
 *   Undo → "Changes reverted." The card closes. Offering Apply again on
 *          something the member just reverted invites them to re-apply it by
 *          accident.
 *   Edit → the preview comes back, editable, so they can fix a value and
 *          re-apply. Editing is NOT a revert, so the card must not be marked
 *          undone or it disappears instead of reopening.
 *
 * Extracted from AIChatLog.jsx because the transition is pure and the suite had
 * a copy of it. The log rollback, the workout restore and the haptics stay in
 * the component.
 */

/**
 * @param {object}  card
 * @param {boolean} opts.reopen  true for Edit, false for Undo
 */
export function rollbackCard(card, { reopen }) {
  return {
    ...card,
    applied: false,
    undone: !reopen,      // reopening isn't a revert — the card comes back
    // The pending summary described the state before the rollback and is now
    // a lie. Cleared on both paths.
    pending: null,
    editing: !!reopen,
  };
}

/**
 * Does the preview (with its Apply button) render?
 * Mirrors the render condition in AIChatLog: items present, not applied, not
 * undone.
 */
export function previewVisible(card) {
  return !card.applied && !card.undone;
}
