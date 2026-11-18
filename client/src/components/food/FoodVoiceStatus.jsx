/** Status and recovery actions for the food search microphone. */
export default function FoodVoiceStatus({ voice }) {
  return (
    <>
      {voice.listening && (
        <div className="mt-1 text-xs text-red-400 font-medium px-1">🎤 Listening… tap again when done</div>
      )}
      {voice.transcribing && (
        <div className="mt-1 text-xs text-gold font-medium px-1">✨ Getting the exact words…</div>
      )}
      {voice.error && (
        <div role="status" className="mt-1 text-xs text-warn font-medium px-1">{voice.error}</div>
      )}
      {voice.canRetry && (
        <div className="flex flex-wrap gap-2 mt-2">
          <button type="button" data-testid="food-voice-retry" onClick={voice.retry} disabled={voice.transcribing}
            className="rounded-xl border border-gold/40 px-3 text-xs text-gold disabled:opacity-40" style={{ minHeight: 44 }}>
            {voice.transcribing ? 'Retrying…' : 'Retry recording'}
          </button>
          <button type="button" data-testid="food-voice-discard" onClick={voice.discardTake}
            className="rounded-xl border border-hair px-3 text-xs text-mid" style={{ minHeight: 44 }}>
            Discard recording
          </button>
        </div>
      )}
    </>
  );
}
