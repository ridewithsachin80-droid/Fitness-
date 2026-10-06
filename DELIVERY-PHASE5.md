# Delivery: Phase 5 (diet plan as PDF, grocery and prep lists) — 5 Oct 2026

Cumulative from the `main` ZIP of 3 Oct 2026: carries every earlier file too
(Phases 1.3–4), unchanged since those deliveries. Upload to `test`, wait for
green, try it on fitness-test.up.railway.app, then merge.

## What it does

- **Member, Plan › Nutrition:** "Plan as PDF" and "Grocery list".
  - On a phone the PDF opens the share sheet (WhatsApp, Drive, Files); on a
    computer it downloads. File: `FitLife-Diet-Plan-<Name>-v<version>.pdf`.
  - Grocery list: the week's foods added up over seven days, a tick box per
    item (remembered on that phone for that plan version), "Share the list"
    as plain text, and the prep list by day.
- **Coach, Studio:** "PDF to send" next to "Revise this plan". A draft's PDF
  says DRAFT, not approved, on every page.
- **The PDF:** page 1, targets, eating window, every meal with time, foods,
  household measure, grams and kcal, what changes by day; your day; avoid;
  cautions (lab cautions included). Last page, grocery list (with tick boxes
  to print) and prep list. Footer on every page: dietary guidance from your
  coach, not medical treatment.

## Choices made

- **Amounts are as eaten** (the plan's cooked grams), with a note that raw
  rice and dal weigh about a third to half of cooked. Converting to raw needs
  a yield figure per food; not guessed.
- **Same content as the app:** built from the member's view of the plan, so
  the coach's brief, the lab flags, the checks and the model's notes never
  appear in it.
- **No new packages:** a small PDF writer in `server/services/pdfDoc.js`
  using the PDF's built-in fonts. Kannada or Hindi letters and emoji in a name
  are dropped (food names in the app are in English letters).

## Files

New (6): `server/services/pdfDoc.js`, `server/services/planPdf.js`,
`server/scripts/test-plan-pdf.js`, `client/src/utils/shareFile.js`,
`client/src/components/plan/GrocerySheet.jsx` (new folder `components/plan/`),
`DELIVERY-PHASE5.md`.

Changed (5): `server/routes/dietPlans.js` (`/me/pdf`, `/me/grocery`,
`/:id/pdf`), `server/scripts/test-local.sh`, `server/scripts/ui-tests.mjs`,
`client/src/pages/Plan.jsx`, `client/src/components/coach/DietPlanStudio.jsx`.

No file renamed or deleted. No tables or columns added.

## Gate

- 3,176 checks green in one full run, including real Chrome at 320/360/390 px.
- New: `test-plan-pdf` 31 checks (PDF structure checked object by object,
  and its text read back), screen tests 8, phone-width check for the list.
- Bugs put back one at a time: notes leaking into the member's PDF, draft not
  marked, grocery not summed, broken file offsets, unreadable characters;
  each turned a test red.
