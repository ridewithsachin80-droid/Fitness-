FitLife — gold logo + matching theme
====================================

Extract, drag the "client" FOLDER onto GitHub at the ROOT of your repo.
NOTHING TO RENAME. No new packages. No schema change.

This replaces the whole client/src tree plus icons, so it is a larger upload
than usual - the colour change touches 38 files.

THE ICON
Built from your FL monogram. The source artwork is a mockup - the logo shot on
a textured wall with directional lighting - so cropping it straight into an
icon would drag the wall texture and light falloff along with it, which looks
muddy at 48px.

Instead the mark is extracted: gold is isolated by channel difference (red
meaningfully above blue), which separates metal from the neutral wall whatever
the lighting; the alpha shape is kept and the photographed colour discarded;
then it is re-filled with a clean gold gradient and given a rim light, and
composited onto the app's dark ground. The metal is rendered, not photographed.
Verified legible down to 48px and clip-free under circular and squircle masks.

THE THEME
Violet accent swapped for the logo's gold across the app, keeping the same
three-step ramp so hierarchy survives:

  #7c5cfc  primary   -> #c9a227  gold
  #a78bfa  light     -> #e0c98a  light gold
  #c4b5fd  pale      -> #f0dfae  pale gold
  #4c2fd8  deep      -> #8a6a1e  bronze (gradient fills only, never text)
  Tailwind purple/violet/indigo utilities -> amber

CONTRAST IMPROVED, NOT JUST CHANGED
  gold  #c9a227 on the page background: 8.12:1
  violet #7c5cfc on the same background: 4.49:1
WCAG AA needs 4.5:1 for body text - the old violet was scraping past it, the
gold clears it comfortably. Light and pale gold sit at 12:1 and 14:1.

logo-source.png is kept in client/ so the icon can be regenerated with
make_icons.py if the mark is ever revised.

AFTER DEPLOYING
Android caches home-screen icons hard. Remove FitLife from the home screen and
re-add it from the browser menu; a reload will not update it.
