# Apply the FitLife member experience update

This is an **updated-files overlay**, not a complete project. Its baseline is `ridewithsachin80-droid/Fitness-`, branch `test`, commit `2ebbf01e35cdfcf9e71c7c68ec54ce58b7c65c4f`.

The ZIP includes the earlier camera/weight adjustments and this refined member interface. Copy the **contents** of `Fitness--main/` over the existing repository root, preserving `client/`, `server/`, `docs/` and `design-previews/`. Do not put another project folder inside the existing root. If your branch has newer edits, compare them before replacing matching files.

## Build

Use Node.js 20 or newer. No new runtime package, environment variable, API contract or database migration is introduced.

From the existing repository root:

```sh
npm ci
npm run build
```

The ZIP deliberately omits `client/dist/`, dependencies and secrets. The build regenerates the production client and service worker. Deploy that regenerated output with your existing server/deployment process. A source-file upload by itself will not update the served interface.

## Verify locally

From the repository root:

```sh
npm ci --prefix server
node server/scripts/test-layout-contracts.js
node server/scripts/test-session-logic.js
node server/scripts/test-private-api-cache.mjs
node server/scripts/test-portion-defaults.mjs
UI_BROWSER=0 node server/scripts/test-premium-ui.mjs
```

For real Chromium layout and interaction checks, install the existing optional test tooling and run:

```sh
npm run test:ui:install --prefix server
npm run test:premium --prefix server
npm run test:ui --prefix server
```

On a development machine with PostgreSQL available, run the repository's disposable local database gate:

```sh
npm test --prefix server
```

That gate creates its local `fitlife_test` database. Do not point destructive fixture suites at production or a shared member database. PostgreSQL-dependent integration checks were unavailable in the build environment used for this delivery.

## Member acceptance checks

- Open both themes and enlarged text on supported Android and iPhone browsers and installed PWAs.
- Tap Speak once; allow recording, cancel it, and repeat with permission denied.
- Tap Snap; confirm the physical device offers the intended rear camera. Photo library must remain a separate action. Desktop file chooser behavior is expected for the capture input.
- Select a meal photo; confirm analysis starts automatically, grams/macros can be corrected, and double-tapping Save produces one entry.
- Change weight, water, sleep and a supplement manually. Confirm all use the existing log.
- Edit a past date; test save failure and retry before moving to another day.
- Open More → Food & saved meals, Coach & check-ins, and Your daily entries. Open Profile, Preferences, devices and Progress.
- Test an offline edit, re-entry, reconnect, and account switch on a shared device. The new private cache must not expose another member's responses.
- Confirm existing coach and admin journeys against a staging database.

## Review and previews

`FitLife-UX-Review.html` contains the implementation review, preserved-feature map, comparison with five apps, prioritized enhancements and verification limitations. The JPEGs in `design-previews/` are actual browser captures with fictional data.

`UPDATED-FILES.txt` in this folder lists the files included in the ZIP. There are no source-file deletions to apply. The production build replaces generated assets.

## GitHub status

The connected GitHub integration previously rejected writes with insufficient integration permissions. This delivery does not claim a successful push to `test` or a deployment. The local changes and ZIP are ready to apply using a GitHub identity with repository write access.
