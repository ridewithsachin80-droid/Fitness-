const label = { daily: 'Daily log', workout: 'Workout', body: 'Body metrics' };
const stateText = { pending: 'Not saved yet', saving: 'Saving…', saved: 'Saved', queued: 'Kept on this device — waiting to sync', failed: 'Save failed — retry available',
  conflict: 'Newer changes need review — not overwritten', unconfirmed: 'Save not confirmed — check before repeating', 'not-needed': 'No changes' };
const undoText = { saved: 'Reverted', queued: 'Reverted on this device — waiting to sync', saving: 'Undoing…',
  failed: 'Undo not saved — retry available', conflict: 'Undo needs review — newer changes preserved', unconfirmed: 'Undo not confirmed — retry to check' };

/** Report actual destination acknowledgements, including partial success. */
export default function AIReviewSaveStatus({ card, disabled, onRetry, onEdit, onUndo, onRetryUndo }) {
  const receipt = card.saveReceipt;
  if (!card.applied) return card.undoNotice ? <p data-testid="ai-card-undo-result" role="status" className="text-caption text-mid">{card.undoNotice}</p> : null;
  if (!receipt) return <p role="status" className="text-caption text-mid">{card.logSaveFailed ? 'Save was not confirmed.' : card.queued ? 'Kept on this device — waiting to sync.' : 'This is an earlier saved review.'} Open the daily log to check or edit it; this review has no undo receipt.</p>;
  const entries = ['daily', 'workout', 'body'].filter(key => receipt[key].state !== 'not-needed');
  const complete = entries.every(key => receipt[key].state === 'saved');
  const retry = !receipt.undoRequested && entries.some(key => ['failed', 'pending'].includes(receipt[key].state) || ((key === 'workout' || (key === 'body' && receipt.body.requestId)) && receipt[key].state === 'unconfirmed'));
  return <div data-testid="ai-card-save-status" className="border border-hair rounded-xl px-3.5 py-3 space-y-2" role="status">
    <p className="text-body-sm font-semibold text-white">{receipt.running ? receipt.undoRequested ? 'Undoing this review…' : 'Saving this review…' : receipt.undoRequested ? 'Undo needs attention' : complete ? 'Saved' : 'Check your save status'}</p>
    {entries.map(key => <p key={key} data-testid={`ai-card-${key}-status`} className="text-caption text-mid">
      {label[key]}: {undoText[receipt[key].undoState] || receipt[key].detail || stateText[receipt[key].state]}
    </p>)}
    {receipt.body.state === 'unconfirmed' && <p className="text-caption text-warn">{receipt.body.requestId ? 'Retry safely to confirm this submission without adding its body metrics twice.' : 'Body metrics may already be in Lab results. They will not be sent again automatically.'}</p>}
    {receipt.daily.change?.canonicalConflict && <p className="text-caption text-warn">The server kept different values. Review the daily log before making another change; this review cannot undo those values.</p>}
    {receipt.undoError && <p data-testid="ai-card-undo-error" className="text-caption text-warn">{receipt.undoError}</p>}
    <div className="flex flex-wrap gap-3">
      {retry && <button type="button" data-testid="ai-card-retry" disabled={disabled} onClick={onRetry} className="min-h-[44px] text-sm font-semibold text-gold disabled:opacity-40">Retry unfinished saves</button>}
      {receipt.undoRequested
        ? <button type="button" data-testid="ai-card-undo-retry" disabled={disabled} onClick={onRetryUndo} className="min-h-[44px] text-sm font-semibold text-gold disabled:opacity-40">Retry undo</button>
        : <><button type="button" data-testid="ai-card-edit" disabled={disabled} onClick={onEdit} className="min-h-[44px] text-caption font-semibold text-gold disabled:opacity-40">Edit</button>
          <button type="button" data-testid="ai-card-undo" disabled={disabled} onClick={onUndo} className="min-h-[44px] text-caption text-mid underline disabled:opacity-40">Undo</button></>}
    </div>
    {complete && card.pending?.length > 0 && <p className="text-caption text-mid">Still pending today: {card.pending.join(' · ')}</p>}
  </div>;
}
