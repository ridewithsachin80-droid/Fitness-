# Upgrade validation — 12 October 2026

## Passed

| Check | Result |
| --- | --- |
| Production React/Vite build and PWA service worker | Passed; compiled client included |
| New premium UI suite | 24 DOM/interaction assertions plus 30 browser assertions passed, 0 failed |
| Final responsive screenshot checks | Light/dark at 320, 390 and 1280 px; home, AI review and macro sheet did not overflow horizontally |
| Layout/source contracts | 152 passed, 0 failed |
| Built app under production Content Security Policy | 9 passed, 0 failed; login, same-origin scripts, recovery watchdog, photo blobs, permitted storage host and voice media |
| Day calculations | 153 passed, 0 failed |
| Offline queue logic | 52 passed, 0 failed |
| Session logic | 49 passed, 0 failed |
| Hands-free logic | 54 passed, 0 failed |
| Coach questions | 59 passed, 0 failed |
| Push/VAPID configuration logic | 13 passed, 0 failed |
| Android/TWA contracts | 33 passed, 0 failed |
| Rename contracts and route reachability | Passed |
| Image-routing and coach-program logic | Passed |
| Server AI route syntax | Passed |
| Original file retention | All original source/project files retained |

The premium suite exercises real client components against a fixture API: initial data loading, three-destination navigation, persistent themes, manual water/supplements, automatic photo submission, live decimal-quantity calculation, invalid quantities, macro and meal-slot edits, saving those edits, duplicate-tap prevention, daily notes, failed-save feedback, retry without duplicating water/notes, and closing/reopening the conversation.

The existing plate-photo regression also confirmed that an edited macro value and personal-label flag reach the saved food, alongside the original planned/extras/quantity flow. Existing regression runs exercised progress, plans, profile, onboarding, coach/admin tools, diets, reports, photos, check-ins, labels and integrations. Layout-specific assertions were updated for the simplified navigation and AI workspace. The new harness closes jsdom windows between cases to avoid lingering timers.

## Limits and remaining integration checks

- This is not a certification that the entire historical test gate passes. Broad legacy UI runs were not completed cleanly; some old-layout assertions were updated and rechecked, while timing-dependent legacy scenarios remain to be run in the full development/CI environment. The complete original suite is retained.
- Database-backed tests could not be completed because local PostgreSQL was unavailable. In particular, the workout-merge integration test could not connect. Some existing scripts print a database warning even after their pure assertions pass; those warnings are not counted as database success here.
- Gemini/Groq were not called with live credentials. Photo, voice and text services remain wired to the real existing endpoints. Verify them with the deployment's provider configuration.
- Camera, microphone permission, live wearable sync, push delivery, storage upload, WhatsApp services, and physical Android/iOS behavior require the actual deployment/devices. They were not replaced or provisioned by this upgrade.
- The production build retains an existing large-bundle warning and mixed static/dynamic import warnings. These are warnings, not build failures.
- Preview screenshots contain synthetic fixture data. The UI test's expected failed-save scenario deliberately emits console errors before it verifies recovery.

Before release, run the original database/UI gate against a disposable local test database, then verify one real image → AI estimate → macro/quantity edit → save → reload flow with a test account. No production deployment or data migration was performed.
