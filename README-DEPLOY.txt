FitLife — HOTFIX 2: the browser was giving up before the server answered
=======================================================================

Extract, drag "client" and "server" FOLDERS onto GitHub at the repo ROOT.
NOTHING TO RENAME. No new packages. No schema change.

INCLUDES HOTFIX 1 (the model, token ceiling and JSON parsing fixes). If you
have not deployed that yet, this supersedes it.

WHAT THE SECOND SCREENSHOT SHOWED
The error text ended with a full stop — "please try again." — and that exact
string only exists in the CLIENT. The server's messages have no trailing
period. So the browser never received a JSON error body at all, which is a
different failure from the first one. The console agreed: no 502 this time.

THE CAUSE
The shared API client aborts every request at 35 seconds. Hotfix 1 raised the
server's Gemini timeout to 90 seconds. So the browser was hanging up at 35s
while the server was still working, and the member saw a read error for a
request that had not failed — and might have been about to succeed.

THE FIX — the timeout chain now nests properly

    50s   each Gemini attempt          (was 90s)
   100s   server worst case, 2 models
   120s   browser, lab report only     (was 35s)

Each layer now outlasts the one inside it. Two model attempts fit inside the
browser's ceiling with 20 seconds to spare.

THE PHOTO PATH HAD THE SAME EXPOSURE
Vision calls also ran against the 35s default. Raised to 60s, with the server
side comfortably inside it. Nobody had reported this yet; it would have failed
the same way on a slow connection.

TWO OTHER THINGS FIXED
· A progress line now appears while reading: "Reading your report… a full
  panel can take up to a minute." Without it the screen sat blank and members
  re-uploaded the same file, doubling the load and making it slower still.
· Files over 8MB are refused instantly with a clear message instead of after
  a long upload. Express caps the body at 12MB and base64 inflates by a third,
  so anything larger was going to be rejected anyway.

A TIMEOUT NOW SAYS SO
It no longer blames the report. "That report took too long to read. A single
page, or a photo of just the results table, is much quicker." — which is
actionable, unlike "please try again".

IF IT STILL FAILS AFTER THIS
The Railway logs will now name the model and the failure kind. Send me that
line and I can tell you exactly which layer is refusing.
