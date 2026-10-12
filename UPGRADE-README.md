# FitLife — premium member experience

This is the complete updated application source based on `Fitness--main (6).zip`, keeping the original `client/`, `server/`, Android, scripts and project files. It is not the earlier demonstration page. The original routes and services remain in the project.

## What changed

- Three member navigation destinations: **Today**, **Progress**, **You**. The complete plan is reachable from Today. Progress uses one section picker for Body, Nutrition, Training and Reports.
- Today combines an AI entry point, the next prescribed meal, food/water/training/sleep, weight, a daily checklist, nutrition detail, the coach's message and the day's history.
- **Light and dark themes**, saved per device. Switch on Today or in Settings. Shared theme tokens also reach existing sheets, charts, coach and admin screens.
- A dedicated AI workspace for text, voice, photos and lab reports. Draft conversation remains available when closed and reopened.
- Selecting a meal image automatically downscales it and calls the existing `/api/ai-chat/photo` service. The response becomes an editable review with food selection, decimal grams, meal slot, live totals and macro editing. A photo is not saved as a food until the member reviews and presses Save.
- Macro edits support per 100 g or the current portion. Calories recalculate from protein, carbohydrate and fat. The existing option to remember a personal food label is retained.
- Planned-meal plate photos also gain macro editing alongside their existing matching, quantity, extras and retake controls.
- The AI parser can now include explicitly described mood, energy or symptoms as a daily note; members can edit or exclude that note before saving.
- Duplicate-tap protection, invalid-quantity checks, current-day checks and visible save/retry states protect the new review flow.

## Existing functions and where to find them

| Function | Entry point |
| --- | --- |
| AI food, weight, water, sleep, activity, supplements, ACV and workout logging | Today → Speak, Snap a meal, Type anything, or the AI dock |
| Manual daily logging and corrections | Daily essentials, weight, checklist, or a history entry |
| Planned meals, plate checks, meal swaps, full training and recovery plan | Next prescribed meal or View your complete plan |
| Food search, saved labels, repeat meals and detailed macros | Food tile → existing food sheet |
| Vitamins/minerals and meal ideas | Today → Nutrition & micronutrients / What could I eat next? |
| Body trends, progress photos, labs, training charts and reports | Progress → section picker |
| Profile, targets, account, reminders, accessibility and connected devices | You / Settings |
| Coach notes, replies, notifications, check-ins, recovery, fasting and enabled voice pilot | Existing contextual cards, bell, profile and plan |
| Coach/admin management, AI, diets, programs, labs and monitoring | Existing role-based routes, retained |
| Offline queue, PWA, push, Android wrapper and account permissions | Existing mechanisms, retained |

## Run the application

Use Node 20 or newer. From this folder:

```bash
npm ci
npm --prefix server ci
npm run build
npm --prefix server start
```

For development, use `npm run dev` and `npm --prefix server run dev` in separate terminals. Keep the original application's environment configuration and deployment settings. The existing server serves the built client; the ZIP also includes a production `client/dist/` build.

Use your existing database, authentication, object-storage, messaging and AI provider configuration. Photo analysis uses the existing Gemini integration (`GEMINI_API_KEY`). Text/voice use the existing Groq/Gemini provider paths. No credentials are supplied in this archive. Do not place server provider keys in client code.

No database schema changes were introduced. Existing databases still require the original project's migrations/configuration. Follow the original README for initial server provisioning; this upgrade does not provision accounts or external services.

## Verify locally

```bash
UI_BROWSER=0 npm --prefix server run test:premium
npm --prefix server run test:ui:install
npm --prefix server run test:premium
```

The first premium test needs jsdom/esbuild (server development dependencies). Real-browser checks additionally need the optional Chromium packages installed by `test:ui:install`. Set `UI_BROWSER=0` for a DOM-only run. Screenshots are written to `design-previews/` and use clearly synthetic test fixture data.

`npm --prefix server test` remains the full original test gate and requires local PostgreSQL. See `UPGRADE-TEST-REPORT.md` for the checks performed and their limits. `CHANGED-FILES.md` lists added and modified source files; `FILE-STRUCTURE.txt` lists the delivered files.

## Preview images

`design-previews/` contains the actual rendered home in light/dark at phone and desktop sizes, plus both AI food review screens. These are screenshots of the implemented components with fixture API responses, not evidence of a live AI provider call.

AI photo portions and nutrition remain estimates. The interface asks members to review them; quantity and macro corrections remain available before and after logging.
