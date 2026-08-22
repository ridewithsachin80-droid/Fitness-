FitLife — download lab results as PDF and CSV
=============================================

Extract, drag the "client" FOLDER onto GitHub at the repo ROOT.
NOTHING TO RENAME. No new packages. No schema change. Server untouched.

THREE BUTTONS ON THE LAB RESULTS CARD

  PDF       a formatted report: every panel by test date, the interval
            comparisons, and — for coaches — the nutritional guidance
  CSV       one row per lab value: test, result, unit, reference range,
            status, date, lab, who entered it
  Changes   one row per interval comparison, including the average intake,
            protein, weight change, training and cardio in that window,
            and what percentage of the window was actually logged

MEMBERS GET THESE TOO
A PDF of their own results is exactly what someone needs to hand a doctor at
their next appointment. Members see values and comparisons; the nutritional
guidance stays coach-only, as it was.

WHY PRINT-TO-PDF RATHER THAN A PDF LIBRARY
jsPDF and its peers add roughly a quarter of a megabyte to a bundle whose
members are often on patchy mobile data, and the browser already has a
competent PDF writer. The app already uses this pattern for the coach's Print
Report, so behaviour stays consistent.

The cost is one extra tap: the print dialog opens and you choose "Save as
PDF". Chrome on Android and Safari on iOS both offer it. If that tap matters
more than the payload, say so and I will swap in a real library.

The CSV is a genuine one-click download with no dialog.

DETAILS THAT MATTER IN PRACTICE
· The CSV carries a UTF-8 byte-order mark, without which Excel renders Indian
  test names and the µ in µg as mojibake — which reads as corrupted data.
· Fields containing commas, quotes or newlines are quoted and escaped
  properly. Verified against a test name containing both a comma and quotes.
· NaN reference bounds render as "< 100" rather than "NaN - 100", matching
  the on-screen fix.
· Out-of-range rows are shaded in the PDF so they are findable at a glance.
· If pop-ups are blocked the button says so instead of failing silently.
· Filenames include the member name and date: harsha-lab-results-2026-08-22.csv

TESTS
CSV escaping verified against awkward real values. Regression: 160 assertions
across the three affected suites, all passing.
