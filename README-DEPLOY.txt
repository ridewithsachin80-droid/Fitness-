FitLife — real logo on the login screen
=======================================

Extract, drag the "client" FOLDER onto GitHub at the ROOT of your repo.
NOTHING TO RENAME. No new packages. No schema change.

FILES (3)
client/src/pages/Login.jsx   uses the logo lockup
client/public/logo-full.png  mark + FITLIFE wordmark, transparent
client/public/logo-mark.png  mark only, transparent (for future use)

LOGIN SCREEN
The heart icon and the typed "FitLife" heading are replaced by your actual
lockup. The <h1> is gone deliberately - the logo already contains the word
FITLIFE, so keeping the heading would have printed the name twice. The
tagline stays, and the pulse rings now scale around the larger logo.

Both PNGs are extracted from your artwork, not cropped: the metal is isolated
by channel difference so the mockup's wall texture and lighting are left
behind, then re-rendered with the brand gradient (#F0E2B6 -> #D4AF37 ->
#8C6D37) on transparency. They will sit correctly on any background.

THE CHROME BADGE ON THE HOME-SCREEN ICON
That badge is Android's marker for a SHORTCUT rather than an installed app.
It is not a manifest fault - I audited all ten WebAPK installability criteria
against the built manifest and every one passes (name, short_name, start_url,
standalone display, 192 and 512 icons, a maskable icon, an any-purpose icon,
theme and background colour, plus a service worker with a fetch handler).

It happens when the icon is added via "Add to Home screen", or when it was
added at a time the manifest was not yet complete - which is the case here,
since your icon predates the maskable-icon fix.

TO REMOVE IT
  1. Long-press the FitLife icon and remove it from the home screen.
  2. Deploy this build and open the site in Chrome.
  3. Chrome menu -> "Install app" (or "Add to Home screen" if it now offers
     to install). The app's own install banner also triggers the correct path.
  4. The new icon appears with no Chrome badge.

If the menu still only offers "Add to Home screen", clear the site data once
(Settings -> Site settings -> fitness.upscale-app.com -> Clear and reset) so
Chrome re-reads the manifest, then try again.
