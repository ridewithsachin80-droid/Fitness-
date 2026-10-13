/** Request-specific recovery; the main composer draft stays untouched. */
export default function AIRequestRecovery({ request, requestEdit, setRequestEdit,
  disabled, send, sendPhoto, onReplace }) {
  if (!request) return null;
  return (
    <div className="mt-3 space-y-2">
      {requestEdit?.request.id === request.id ? <>
        <label className="block text-caption text-mid">
          Edit this message
          <textarea value={requestEdit.text} rows={3} data-testid="ai-request-edit-input"
            className="block w-full mt-1 p-3 rounded-xl bg-surface border border-hair text-white text-sm resize-y"
            onChange={e => setRequestEdit(current => current ? { ...current, text: e.target.value } : null)} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" data-testid="ai-request-edit-send" className="min-h-[44px] px-3 rounded-xl bg-gold text-charcoal font-semibold"
            disabled={!requestEdit.text.trim() || disabled}
            onClick={() => { const edit = requestEdit; setRequestEdit(null); send(edit.text, { recovery: edit.request }); }}>Try edited message</button>
          <button type="button" data-testid="ai-request-edit-cancel" className="min-h-[44px] px-3 rounded-xl border border-hair text-mid"
            onClick={() => setRequestEdit(null)}>Cancel</button>
        </div>
      </> : <div className="flex flex-wrap gap-2">
        {(request.payload || request.file) && <button type="button" data-testid="ai-request-retry" className="min-h-[44px] px-3 rounded-xl bg-gold text-charcoal font-semibold"
          disabled={disabled}
          onClick={() => request.kind === 'photo'
            ? sendPhoto(request.file, { recovery: request })
            : send(undefined, { recovery: request })}>Retry</button>}
        {request.kind === 'photo'
          ? <button type="button" data-testid="ai-request-replace" className="min-h-[44px] px-3 rounded-xl border border-hair text-mid"
            disabled={disabled}
            onClick={() => onReplace(request)}>Replace photo</button>
          : <button type="button" data-testid="ai-request-edit" className="min-h-[44px] px-3 rounded-xl border border-hair text-mid"
            disabled={disabled}
            onClick={() => setRequestEdit({ request, text: request.payload.message })}>Edit message</button>}
      </div>}
    </div>
  );
}
