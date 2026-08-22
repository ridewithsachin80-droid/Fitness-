FitLife — lab analysis and diet guidance
========================================

Extract, drag "client" and "server" FOLDERS onto GitHub at the repo ROOT.
ONE RENAME: server/server-package.json -> package.json (in server/)
No new packages. No schema change.

WHAT IT DOES
A coach opens a member's Lab Results and taps "Analyse this panel". For each
out-of-range marker with a real dietary lever it returns what the marker
measures in plain language, the specific food change, and how long before a
retest could show movement — plus three meal ideas that fit the member's
existing calorie and protein targets.

WHERE I DREW THE LINE, AND WHY

IN SCOPE — nutritional interpretation. A nutritionist looks at ferritin, B12,
vitamin D, HbA1c, lipids and uric acid and changes what someone eats. Those
markers have genuine dietary levers and the advice is standard practice.

OUT OF SCOPE — explaining WHY a marker is abnormal. That is differential
diagnosis. It needs medication history, symptoms and examination. "ALT is high
because of fatty liver" could equally be hepatitis, a statin, or last weekend.
The app does not know, so it does not say.

THE RULE LAYER RUNS BEFORE THE AI
The dangerous failure is not poor diet advice. It is offering diet advice at
all when the number needs a doctor this week. A member with haemoglobin of 7
does not need spinach recipes, and receiving them is an implicit reassurance.

So deterministic thresholds classify every marker first. Anything urgent —
haemoglobin under 9, fasting glucose over 180, HbA1c over 9, creatinine over
2.0, potassium outside 3.0-5.5, ALT or AST over 120, TSH over 10 or under 0.1,
platelets or white cells well out of range — escalates, and the AI is never
called at all. Advice is withheld for the WHOLE panel, not just that marker.

CLINICAL LANGUAGE IS BLOCKED, NOT DISCOURAGED
The prompt forbids naming conditions, but a prompt is a request. The server
scans the response and DISCARDS it entirely if it contains disease names,
diagnostic phrasing, "you have", or any medication or dosage language. Better
to show nothing than something that reads like a diagnosis.

THE COACH IS THE GATE
Coach-only endpoint. Members cannot generate it, cannot read it, and see
nothing until their coach chooses to act on it. Asserted in tests.

TESTS — 44 assertions, and the safety ones are the point
  · 7 red-flag values each correctly suppress all advice
  · one urgent finding suppresses the whole panel even when other markers
    are perfectly actionable
  · urgent values never appear in the prompt sent to the AI
  · 7 clinical phrases rejected, 4 legitimate nutrition phrases allowed
  · Indian report naming resolved: SGPT, SGOT, Glycosylated Hb, 25-OH Vitamin D
  · only the newest result per marker is used, so a superseded low value
    cannot trigger advice
  · members blocked on every route

  npm run test:insight
Regression: 177 assertions across the four affected suites, all passing.

REQUIRES GEMINI_API_KEY, which you already have set.
