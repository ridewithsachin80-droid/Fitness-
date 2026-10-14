# Phase 10 — consistent member and coach dialogs

Migrates coach lab entry, login PIN setup, weight entry and member milestone celebration to the existing shared Sheet. Each now has a named dialog, keyboard focus containment and restoration, background isolation, viewport-aware scrolling, a 44px close target and consistent backdrop/Escape handling. Labels and validation alerts improve assistive-technology access. Existing fields, endpoints, callbacks and success states remain. In-flight submits are guarded.

Verification: test-modal-accessibility mounts the actual four components in Chromium in both themes at 320px with enlarged text. It checks focus, dismissal, isolation, labels, layout, validation and existing save payloads against synthetic API responses. The shared Sheet suite also covers nested dialogs, scroll and keyboard lifecycle. Full local and CI regression results are recorded in the accompanying Excel/evidence.

Scope limits: coach history drill-down and other legacy dialogs remain for a follow-up; this release does not claim all accessibility work is complete. Physical Android/iPhone keyboards and screen readers need device acceptance. Authenticated Railway browser testing depends on the managed browser runtime being available; local synthetic tests are not live-account acceptance.
