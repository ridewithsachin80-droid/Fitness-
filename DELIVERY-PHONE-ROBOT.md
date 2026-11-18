# Delivery: the phone robot (17 Oct 2026)

The robot does the repeatable part of the tester's real-phone run automatically, after every push to **test**.

## What it is
- Real Chrome, set up as an Android phone (390 px and 360 px, touch, light and dark), driving the **live test site**: fitness-test.up.railway.app. Production is refused.
- A GitHub job (`.github/workflows/phone-robot.yml`) runs after every push to `test`:
  1. waits until the test site serves the pushed app;
  2. runs 44 checks;
  3. keeps a report with screenshots for 14 days (GitHub → Actions → "Phone robot" → the run → Artifacts).
- It signs in with three throwaway test-site accounts. Their logins live only in GitHub secrets.

## What it checks (workbook v4 cases in brackets)
| Check | Covers |
|---|---|
| Sign in; four tabs | LOG-001, RDS-001, SMK-004 |
| "What's new" once | RDS-010 |
| Weight and sleep survive a reload | RPR-004, SHT-001, SHT-008, TOD-004 |
| Water offline → online, saved exactly once | RPR-006, OFF-002, OFF-003, TOD-003, RDS-021 |
| Typed meal: review → Save → totals → reload | RPR-001, AIC-001, SMK-005, TOD-022 |
| Undo removes only that card's food | RPR-003, AIC-010, AIC-011 |
| Meal for yesterday lands on yesterday; today unchanged | RPR-002, AIC-029, TOD-017, RDS-018 |
| Food without an amount: FitLife asks *(warning only)* | RDS-020 |
| Every main screen at 390 and 360 px, light and dark: no sideways scroll, no gold, last item reachable | UI-001, UI-002, UI-009, RDS-008, RPR-012, RPR-013 |
| AI panel and food sheet in both themes | TOD-023, RDS-016 |
| Theme choice switches at once and is kept | RDS-006, SET-006 |
| More: seven rows, each opens | RDS-015 |
| Plan and Progress tabs load | PLN-001, PRG-003 |
| Coach home and member page load; only assigned members | SMK-006, SMK-007, COH-015 |
| Coach note reaches the member's coach line | RPR-005, CMP-005, TOD-014, RDS-011 |
| Another member sees none of it | RPR-005, SEC-001 |
| Sign out on a shared phone; the next member sees only their own day | RPR-007, LOG-013, SEC-006 |
| No script errors on any page | UI-001 |

**Clean-up:** it removes its own food and water, and the coach deletes the robot's note.

**Still manual (the robot cannot prove these):**
- the microphone and a real accent;
- the camera on real food;
- installing the app and its icon;
- the keyboard over inputs;
- push notifications;
- how it feels.

These are the "Phone only" rows in column Q of the workbook.

## How it was proven
1. **Rehearsed** against a production-mode copy with a fake AI: 44 of 44 checks pass.
2. **Mutation-checked:** I broke two things on purpose, and the robot caught both:
   - gold on the Today ring → 6 screen checks failed, naming the ring;
   - food silently dropped from the save → the meal, undo and yesterday checks failed.
3. **Guards:**
   - with a login missing, the run is **BLOCKED**: it fails red and says nothing was tested (changed 17 Oct from a green "skipped");
   - pointed at production, it refuses.

## Retries and evidence (added 18 Oct)
- A check that only worked on a second tap is **not** counted as a clean pass. The report shows "passed cleanly" and "passed after retry" separately, and only clean passes count as covered workbook cases.
- Every retry is listed in a **Retries** table with:
  - the screen it was on;
  - the panel it meant to open;
  - what the first tap hit (or what covered the tile);
  - whether the page reloaded in between;
  - what the retry did.
- Each retry also shows as a yellow "Robot retry" warning on the GitHub run.
- When a check fails, the robot saves a screenshot **and** a `.txt` file with the page address and text. The account-isolation checks (R15, R16) still fail at once; they are never retried.
- When no retries happen, the report says "Retries: none — every interaction worked first time."

## Setup (Sachin, once)
1. On the **test site** (admin), create:
   - **Auto Member** (member);
   - **Auto Member Two** (member);
   - **Auto Coach** (coach).
2. Assign **only Auto Member** to Auto Coach. Do not assign Auto Member Two.
3. Set a PIN for both members.
4. In GitHub → the repo → Settings → Secrets and variables → Actions → New repository secret, add the six secrets named in the workflow file:
   - the two members' phone numbers and PINs;
   - the coach's email and password.
5. Never send these logins in a chat.

## Files (all new except package.json; nothing renamed or deleted)
- NEW `server/scripts/robot-phone-run.mjs`
- NEW `.github/workflows/phone-robot.yml`
- NEW `DELIVERY-PHONE-ROBOT.md`
- changed `server/package.json`: adds `npm run robot`
