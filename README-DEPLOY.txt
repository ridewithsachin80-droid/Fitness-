FitLife — QA pass fixes
=======================

Extract, drag the "server" FOLDER onto GitHub at the ROOT of your repo.
NOTHING TO RENAME. No new packages. No schema change. Client untouched.

FILES (4)
server/routes/logs.js            water + weight clamping, compliance fallback
server/middleware/auth.js        missing cookie jar returns 401, not 500
server/scripts/test-journey.js   NEW - full login-to-sleep journey test
server/scripts/test-aichat.js    fixed a timing-dependent assertion

WHAT THE QA PASS FOUND

1. Negative water stored verbatim (REAL)
   POST /api/logs with water_ml: -500 saved -500 to the database. The
   hydration bar and the coach's view would both show nonsense. water_ml is
   now clamped 0-20000, and weight to 20-400 kg so a fat-fingered entry
   cannot poison weight trends or the BMR/TDEE calculation.

2. Auth middleware 500 instead of 401 (LATENT)
   middleware/auth.js read req.cookies.accessToken. If cookie-parser is not
   mounted, req.cookies is undefined and the middleware threw, turning every
   unauthenticated request into a 500. Production mounts cookie-parser so this
   was not live, but it is now optional-chained.

3. Compliance fallback could report 100% (LATENT)
   When protocol_total is absent, compliance was derived from the keys present
   in the payload - so {walk:true} alone scored 100%. The real client always
   sends protocol_total so live data is correct; the fallback now clamps to the
   default protocol size of 16 and caps at 100.

RUNNING THE JOURNEY TEST
  cd server
  DATABASE_URL=<local test db> JWT_SECRET=x JWT_REFRESH_SECRET=y \
    node scripts/test-journey.js

It walks login -> profile -> weight -> strength -> cardio -> auto-ticks ->
food -> water -> ACV -> supplements -> sleep -> compliance -> TDEE ->
coach view -> security -> edge cases. 70 assertions.
