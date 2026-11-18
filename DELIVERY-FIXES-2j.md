# FitLife — Fixes-2j: coach-set targets vs FitLife standards (18 Oct 2026)

Test branch only. Production is unchanged and needs Sachin's explicit approval.
Backlog item **B3**.

## The problem
Members were shown FitLife's standard values as if their coach had chosen them:
- **The Plan header said "Set by your coach"** even when the coach had set nothing.
- **Water:** every profile starts at 3000 ml, a database default. A stored 3000 couldn't say whether a coach chose it.
- **Sleep:** 10 PM–6:30 AM is the standard when no times are set, but it was shown as the member's own target.
- **Daily routine:** with no selection made, every built-in item is switched on (16 items), shown as if prescribed.
- **The Today sleep bar** filled against a fixed 8 hours, whatever the member's target.

## Found while building: the Plan ignored the coach's routine choice
- The Plan reads the profile row, which names the coach's choice `protocol_activities`. The routine code reads `activities`, found nothing there, and **listed all 16 standard items even after a coach had picked a few**.
- Today was not affected: it reads a different response that uses the other name. The coach day view had the same mismatch, fixed in 2i.
- **Fix:** one shared mapping (`protocolFromProfile`), used by the Plan and the coach day view.
- **Proof:** with a coach choice of walk + B12, the old Plan listed 16 items; it now lists 2.

## The rule
| Target | Coach-set when | FitLife standard when |
|---|---|---|
| Water | the coach or admin saved it (recorded now), or the value isn't 3000 | 3000 with no record of anyone choosing it |
| Sleep | both times are set | no times set |
| Activities, ACV, supplements (each group) | the coach made a selection (even an empty one) | no selection yet (every item on) |
| Calorie and macro targets | any is set | none set ("Targets not set yet", as before) |

- **Nothing is guessed for existing members.** The new record (`patient_profiles.target_set_by`) starts empty.
- A water value other than 3000 counts as coach-set: only a coach or admin can change it.
- **One honest gap:** a coach who deliberately chose exactly 3 L before today shows as "FitLife standard" until they save it once. Their card offers "Keep 3.0 L as <name>'s target" for exactly this.

## What the member sees
- **Plan header:**
  - nothing set: "FitLife starting plan · your coach will personalise it";
  - some set: "Set by your coach · some items are FitLife standards";
  - all set: "Set by your coach".
- **Water and sleep lines** (Plan Today and Recovery): "FitLife standard · your coach hasn't set yours yet" when standard. Coach-set values carry no label.
- **Routine (Plan → Recovery):**
  - all standard: "This is FitLife's standard daily routine. Your coach hasn't chosen yours yet.";
  - mixed: "Your coach chose some of this. ACV: FitLife standard."
- **Today:**
  - water sheet: "FitLife standard. Your coach hasn't set your own water target yet.";
  - sleep sheet: "FitLife standard times…";
  - checklist: "FitLife's standard routine… so every item is on.";
  - Profile water card: the same note.
- **The Today sleep bar** fills against the member's own target: 6 h slept on a 6 h target is a full bar; on the standard 8.5 h it is about 71%.

## What the coach sees
- **NEW water-target card** on the member page (Training tab, under the sleep card), in the same style as the sleep card:
  - the value, and whether it is standard or set by the coach;
  - Change, plus "Keep 3.0 L as <name>'s target" when it is still the standard;
  - "Go back to the FitLife standard" when it is set.
- Under it, the routine status: "FitLife standard (every item on)", "you chose some groups; ACV still standard", or "chosen by you". It also says when no calorie or macro targets are set.

## The AI
- **Member and coach AI context:**
  - water reads "3000 ml target (FitLife standard; the coach has not set one)" or "(set by the coach)";
  - a "Daily routine" line says which groups are still standard.
  - So the AI can no longer say "your coach set 3 litres".
- **The coach AI's "water to 4.5 litres" command** now records that the coach set it.

## Server
- **The coach's profile save (`PATCH /members/:id/profile`):**
  - a water target is checked: 500–8000 ml, whole millilitres. 9000, 100, "lots" and 2.5 are refused with 400, and nothing changes;
  - saving one records who and when;
  - `null` goes back to the standard 3000 and removes the record.
  - **Behaviour change:** this route used to accept any water value.
- **Creating a member:** marked as coach-set only if the coach actually sent a water target.
- **Every response the app reads now carries `target_origin`:** the member's day, the Plan, the member's profile, and the coach's member view.
- **Exports:** no report, PDF or weekly summary shows these targets (checked), so none needed a label.

## Results (local)
- Gate: all suites pass, 5,926 assertions (target-origin 29, sleep-target 37, ui-tests 943).
- Robot (local): 50 passed cleanly, 0 retries, 0 failed.
- 2j screens at 360 px, both themes: 28/28 checks.

## Tests (none weakened)
- **Four existing tests changed, one line each:**
  - `test-mixed-request-answer.js`, `test-sleep-clarification.js`, `test-draft-food-edits.js`, `test-food-clarifications.js`;
  - each loads the AI chat code in a sandbox that refuses any module not on its list of pure modules;
  - `../services/targetOrigin` (no database, no network) is added to that list, exactly as `personName` and `nutrients` are;
  - no assertion changed. They pass 27, 35, 77 and 135.
- **NEW `server/scripts/test-target-origin.js`** (real Postgres, real HTTP, 29 checks):
  - the column, with no existing row marked;
  - all four reads say "standard" before anything is set;
  - keep / set / reset / refused values;
  - water and sleep in one save;
  - the coach AI command;
  - routine null vs list, and the Plan mapping (2 items, not 16);
  - server and client rules give the same answer on 10 rows × 6 targets;
  - the AI wording and the Plan header.
  - Added to the gate's database suites.
- **`ui-tests.mjs`, NEW sections E3 and E4:**
  - Plan in three states (all standard, all coach-set, mixed);
  - water and sleep sheets, the coach card ("Keep" saves 3000 for that member and the card updates), and the sleep bar on a 6 h and an 8.5 h target.
- **Mutation:**
  - coach-AI recording removed → 1 check fails;
  - old Plan mapping and fixed 8 h bar → 3 checks fail.
  - Restored → all pass.

## Files
- **NEW:**
  - `DELIVERY-FIXES-2j.md`
  - `server/services/targetOrigin.js`
  - `server/scripts/test-target-origin.js`
  - `client/src/lib/day/targets.js`
  - `client/src/components/coach/WaterTargetCard.jsx`
- **Changed (server):**
  - `server/db/schema.sql` (`ADD COLUMN IF NOT EXISTS target_set_by`)
  - `server/routes/patients.js`, `logs.js`, `aiChat.js`
  - `server/scripts/test-local.sh`, `ui-tests.mjs`
- **Changed (client):**
  - `client/src/lib/day/index.js`
  - `client/src/pages/Plan.jsx`, `Profile.jsx`, `Monitor.jsx`
  - `client/src/components/sheets/WaterSheet.jsx`, `SleepSheet.jsx`, `ProtocolSheet.jsx`
  - `client/src/components/today/DayStrip.jsx`
  - `client/src/components/coach/DayDetail.jsx`
  - `client/dist/` (rebuilt app)
- Nothing renamed or deleted.

## Not done here
- **Older than 2j, seen in the screenshots:** on Today, "0.00 / 3.0 L" wraps its "L" onto a second line at 360 px. Logged in the backlog.
