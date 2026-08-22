FitLife — HOTFIX: lab report PDF failing to read
================================================

1 FILE. Extract, drag the "server" FOLDER onto GitHub at the repo ROOT.
NOTHING TO RENAME. No new packages. No schema change.

server/routes/aiChat.js

WHAT WAS WRONG
The error you saw — "Could not read that report" with a 502 in the console —
came from the JSON-parse branch. Gemini did respond; it just did not respond
with parseable JSON. Four causes stacked up.

1. THE WRONG MODEL WAS READING IT
   Documents were going to gemini-2.5-flash-lite, the same light model the
   text chat uses. Lite models are noticeably weaker at long structured
   extraction. The full model now leads for documents, with lite as fallback.

2. THE ANSWER WAS BEING CUT OFF
   maxOutputTokens was 4000. A full pathology panel with thirty markers, each
   with name, value, unit and two reference bounds, does not fit. The response
   ended mid-object, and half a JSON object is unparseable. Raised to 16000,
   and the timeout from 60s to 90s to match.

3. JSON WAS REQUESTED BUT NOT ENFORCED
   The prompt asked for raw JSON and hoped. The API can guarantee it —
   responseMimeType 'application/json' is now set, which is the single biggest
   reliability improvement here.

4. EXTRACTION WAS TOO FRAGILE
   The old code only stripped ``` fences. One sentence of preamble and it
   failed. Extraction now recovers from preamble, trailing text, fences, and
   partial output, and reports WHY when it genuinely cannot.
   Tested against seven real failure shapes, all handled.

ERROR MESSAGES NOW SAY SOMETHING USEFUL
"Please try again" on a report that will never parse just wastes the member's
time. The reader now distinguishes:
  · too many results   -> "try uploading one page at a time"
  · file rejected      -> "export as PDF, or photograph the results page"
  · unreadable content -> "a photo of just the results table often works better"
  · busy / auth        -> as before

DIAGNOSTICS
Failures now log the model, the failure kind and the first 120 characters of
what came back — enough to diagnose, not enough to spill someone's blood work
into the logs. If it still fails after this, the Railway logs will say why.

OPTIONAL
Set GEMINI_DOC_MODEL in Railway to pin a specific model for document reading.
Defaults to gemini-2.5-flash, which is the right choice.

TESTS
7/7 extraction failure modes handled. Regression: 150 assertions across the
four affected suites, all passing.
