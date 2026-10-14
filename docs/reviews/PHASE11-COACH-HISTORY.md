# Phase 11 — easier coach history review

Coach daily history now uses the shared Sheet for keyboard focus containment, focus restoration, background isolation and scrolling. Date, weight, compliance, foods, portions, meal slots, calories, water and notes retain their existing calculations. The date heading now includes the year. Long notes and food names wrap inside narrow screens.

A labelled day selector complements chart tapping, allowing keyboard access and access to zero-score days. A single logged day is now available. Selection resets after opening, so the same day can be reviewed repeatedly. Water-only and notes-only days no longer show the misleading empty message.

The actual MemberCharts and CoachHistorySheet are tested together in local Chromium in light/dark mode at320px with enlarged text. Coverage includes all displayed fields, long-content scrolling, focus restoration, repeated selection, zero-score/water-only/notes-only/empty/single-day states and absence of write requests. Full local and CI regression plus deployment results are recorded in the accompanying Excel.

Remaining: authenticated live-account acceptance depends on the managed browser runtime. Android/iPhone keyboards and screen readers need physical-device testing. Other legacy staff dialogs, reminder refinements and monitored pilot remain separate work.

Regression-gate hardening: a local UI run ended without its completion summary. The shell gate now requires a successful final summary as well as assertions and a zero exit. A focused test exercises the actual shell block with complete, partial, failing, nonzero and assertion-free logs. The incomplete run is retained as evidence; only the completed rerun is counted.
