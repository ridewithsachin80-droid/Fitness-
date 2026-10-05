# Delivery: safety replies, cooked rice and dal, gate fix — 4 Oct 2026

Cumulative from the `main` ZIP of 3 Oct 2026: it also carries every Phase 1.3
and Phase 2 file, unchanged since those deliveries. Upload to `test`, wait for
green, try it on fitness-test.up.railway.app, then merge.

## 1. Safety replies in the member chat (and voice quick-log)

Checked BEFORE the AI sees the message. Fixed, tested replies; nothing logged;
the AI is not called.

| Kind | Caught (English, Hinglish, some Kannada) | Reply |
|---|---|---|
| Self-harm | "want to die", "kill myself", "marna chahta hoon", "saayabeku" | Tele-MANAS 14416 / 1-800-891-4416 (free, 24x7), 112 if in danger |
| Emergency | "chest pain", "chest feels tight", "fainted", "seene mein dard", "ede novu" | Call 112 or 108 now; nothing was logged |
| Purging / starving | "make myself vomit", "laxatives to lose weight", "starving myself" | Doctor, or Tele-MANAS 14416 |
| Medicine change | "stop my metformin", "skip my thyroid tablet", "reduce my insulin dose" | The doctor decides; keep taking it as prescribed |
| Very low calories | "only 600 kcal a day", "fast for 3 days", "skip all my meals" | Not safe alone; ask your coach |
| Pregnancy | "I'm pregnant", "main pregnant hoon", "breastfeeding", "nanu garbhini" | No cutting or fasting until the doctor agrees; tell your coach |

- Nothing is sent to the coach automatically.
- "tell my coach I'm pregnant" still goes to the coach as before. Chest pain and self-harm are answered whoever the message is addressed to.
- Ordinary messages stay ordinary: "killer workout", "chest day", "took my thyronorm", "800 kcal left" (22 such messages in the tests).
- The AI's answer prompt carries the same rules as a backstop.
- Helpline numbers checked 4 Oct 2026.

## 2. Rice and dal costed as eaten

- "brown rice", "white rice", "rice", "boiled rice", "anna", "kusubalakki" find cooked rice (123–130 kcal per 100 g), not the raw grain (346–362).
- "moong dal" finds cooked dal (105), not dry dal (334–347). Generally, when two foods tie, a "Cooked" row now wins and a "Raw" row loses, unless the member says "raw".
- Two rows added: cooked brown rice and cooked parboiled rice (source `manual`). The raw rows keep their names; their everyday name now says "(raw)".
- Applied at every boot by `services/foodFixes.js`, after the food seed. Not in `schema.sql`, because the seed only runs on an empty table.
- Past logs are unchanged; only new logs use the new figures.
- Also fixed: the food matcher's "declared alias" rank was described in a comment but missing from the SQL.

## 3. Gate on GitHub

- The workflow now installs headless Chrome and the lint tools in one step, so the phone-width checks and lint run on GitHub. Expect the gate to take longer.
- The UI suite's time limit is raised from 5 to 10 minutes.

## Files

New since Phase 2 (5 new, 5 changed):

| Path | Status |
|---|---|
| `server/services/safety.js` | **NEW** |
| `server/services/foodFixes.js` | **NEW** |
| `server/scripts/test-safety.js` | **NEW** |
| `server/scripts/test-food-cooked.js` | **NEW** |
| `DELIVERY-SAFETY-FOOD.md` | **NEW** (this file) |
| `server/routes/aiChat.js` | changed |
| `server/routes/quickLog.js` | changed |
| `server/startup.js` | changed |
| `server/scripts/test-local.sh` | changed |
| `.github/workflows/test-gate.yml` | changed |

No file renamed or deleted. No tables or columns added.

## Gate

- 2,897 checks green: all suites on real Postgres, lint, screen tests in jsdom
  and real Chrome at 320/360/390 px.
- New: `test-safety` 33 checks, `test-food-cooked` 25 checks (runs the real
  NIN food seed).
- 12 bugs put back one at a time; each turned a test red.
- Real Postgres caught two bugs in this work before delivery: an untyped SQL
  parameter, and a column missing from the matcher's candidate list.
