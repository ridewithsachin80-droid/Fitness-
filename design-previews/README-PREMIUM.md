# FitLife refined interface

These are real React component captures in Chromium using fictional fixture data, not live member data or image-generated screens.

- `FitLife-Built-Dark-Light.jpeg`: side-by-side Home comparison.
- `home-dark-390-viewport.jpeg`, `home-light-390-viewport.jpeg`: actual 390 × 844 CSS pixel viewport at 2× pixel density.
- `ai-review-dark.jpeg`, `ai-review-light.jpeg`: automatic food estimate with editable quantity and macros, before saving.
- `more-dark.jpeg`, `more-light.jpeg`: the complete feature directory.

The default premium test script also captures full-page Home and AI PNGs in this directory. Optional test dependencies are documented in `server/package.json` and `docs/reviews/APPLY-PREMIUM-UPDATE.md`.

The screenshot harness uses API fixtures; its nutrition values are illustrative. Camera capture is checked at the browser input boundary and still needs physical-device validation. Review `docs/reviews/FitLife-UX-Review.html` for tested behavior and outstanding work.
