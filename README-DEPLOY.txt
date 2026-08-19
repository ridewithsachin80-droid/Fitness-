FitLife — new app icon (runner mark)
====================================

Extract, drag the "client" FOLDER onto GitHub at the ROOT of your repo.
NOTHING TO RENAME. No new packages. No schema change.

FILES
client/public/icons/*.png   7 icons (replaces the 4 old ones)
client/vite.config.js       manifest: dark background + split maskable icons
client/make_icons.py        the generator, so the mark can be regenerated

THE MARK
A runner mid-stride, violet-to-pale gradient on near-black, lit along the
top-left edge. One idea, no ring, no wordmark.

What makes it read as premium rather than clip-art:
  · Tapered limbs that narrow along their length, so the silhouette has
    weight. Uniform stick strokes are what make an icon look free.
  · A real linear gradient through a shape mask, not a flat fill.
  · A rim light on the lit edge, giving the form physicality.
  · An off-centre background glow, as if light falls from the top-left.
  · Optical centring - the mark sits a fraction above true centre, because a
    perfectly centred form reads as sitting low.

TWO TECHNICAL FIXES SHIPPED WITH IT
1. background_color was #ffffff, which flashed a white screen on every cold
   start before the app painted. Now #0b0b0e, matching the app.
2. The old manifest marked one icon 'any maskable'. Launchers applying a
   circular mask crop such icons because the art runs to the edge. There are
   now separate maskable files with the mark inside the centre 80% safe zone -
   verified against both circular and squircle masks, nothing clips.

AFTER DEPLOYING
Android caches home-screen icons hard. Remove FitLife from the home screen and
re-add it from the browser menu; a reload will not update it.
