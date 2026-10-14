# Phase 7: logging and questions together

Members can include a question alongside their logging request. The parser
retains the proposed entries and extracts the question separately. A short
answer uses the existing saved-data context and appears under an explicit
snapshot label. Review values, editable quantities, canonical nutrition and
save receipts remain the authorities for logging.

The answer excludes the pending review. It is not recalculated when a member
edits or saves the review, so the label explicitly says “when you asked”.
Questions about a projected result are directed to review/save first and ask
again. This increment does not predict totals from pending entries.

Answer retrieval has a ten-second overall deadline and one provider attempt
with an eight-second network timeout. Failure returns a recoverable notice
while retaining the parsed review. Normal parsing and pure-question fallback
behavior retain their existing provider retries.

## Validation

- `test-mixed-request-answer.js`: actual parser with isolated DB/provider;
  English, Hindi, Kannada and mixed-language question extraction contract,
  saved-data context, no log writes, provider failure, no optional retry loop,
  missing/empty answers, deadline and response bounds.
- `test-ai-preview-status.mjs`: actual React review displays the answer
  separately, explicitly excludes pending entries, keeps unsaved status and
  does not introduce a saved-data claim into follow-up logging context.
- Existing regression suites remain the release gate. Isolated-provider tests
  do not establish the quality of every live model response or translation.

## Still pending

- Physical Android/iPhone keyboard, camera/mic, offline reconnect, installed
  PWA and rotation acceptance (deferred by the member).
- Atomic workout writes and stronger lab/body-metric duplicate protection.
- Offline cold-start acceptance, remaining staff-modal accessibility,
  reminder refinement and a monitored member pilot.
- Optional projected totals that update with the review would be a separate
  increment, not an implicit promise of this snapshot answer.

Deploy only to the GitHub `test` branch and Railway test environment.
