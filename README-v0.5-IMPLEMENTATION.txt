FogRadar v0.5 — ACTUAL CONNECTED MVP PATCH (foreground field-test only)
======================================================================

NO full project extraction. MERGE the contents of the PATCH ZIP into E:\FogRadar.
Do not replace backend\.env, project root .env, assets, or node_modules.
Create a Git commit/backup before copying.

WHAT IS IMPLEMENTED IN CODE:
- In-app Settings -> Server Connection: manually test /health, apply a temporary LAN URL,
  view Socket status, accepted GPS upload time, radar snapshot time and error details.
- Fix for a common blocker: Expo compiled API URL missing in JS bundle. You can now
  manually enter http://192.168.0.217:4000 into the app in this session.
- Cloud Socket auth + telemetry acknowledgments: on-screen upload failures visible.
- iPhone foreground GPS warm-start from a RECENT cached fix, High accuracy watcher,
  manual request-new-fix button. This NEVER fabricates GPS or speed.
- Nearby phones in Redis GEO 1km, automatic 2-second server snapshots for tiny
  field-test groups (MAX 30 sockets in refresh, NOT a scalable production design).
- Radar markers use actual distance from server; proximity visualization:
    RED <=80m, YELLOW 80-250m, GREEN 250-1000m.
  When GPS uncertainty makes the threshold ambiguous => GRAY (uncertain).
- Each phone's row displays distance in meters plus combined GPS accuracy estimates.
- No fake vehicles or fake GPS data are injected into the production app.
- Optional explicit developer smoke test script simulates two virtual phones against
  the LOCAL server ONLY; prints TEST-ONLY, disconnects and removes positions.

INSTALLATION: Windows PowerShell, existing E:\FogRadar
1. Back up or commit your working project. Extract PATCH into E:\FogRadar and
   merge (not into E:\FogRadar\FogRadar_v0.5_... subfolder).
2. In backend terminal (keep it running):
     cd E:\FogRadar\backend
     npm install
     npm run typecheck
     npm test
     npm run dev
3. In NEW mobile terminal:
     cd E:\FogRadar
     npm install
     npm run typecheck
     npx expo-doctor
     npx expo start -c
4. iPhone in Expo Go: Settings -> Server Connection. Enter:
     http://192.168.0.217:4000
   Tap "Test backend /health" — expect green "Backend reachable".
   Tap "Apply URL to FogRadar". This override is ONLY for this app session.
   For persistence set E:\FogRadar\.env with the EXACT line:
     EXPO_PUBLIC_API_URL=http://192.168.0.217:4000
   Check competing .env.local or .env.development.local (they take precedence).
   Reload the Expo Go application after the change.
5. Test GPS outside (not indoors): Settings on iPhone -> Privacy & Security
   -> Location Services -> Expo Go -> While Using the App, Precise Location ON.
   Start Journey; if GPS unavailable press "Retry actual GPS fix".
   When reading is recent and estimated accuracy <=50m, accepted uploads begin.
6. Check Server Connection diagnostics:
   "Socket: online" and "Last accepted upload: <seconds> ago".
   If health works but Socket offline, inspect WebSocket/server error in screen.
   If Socket online and upload never accepted, fix GPS first.
7. Install/open same app on second/third actual phone from SAME Expo dev server.
   Phones must use same backend URL, same manually selected test route (M-2),
   with precise CURRENT GPS, and within 1km of each other.
   Keep app foreground on each phone. On the radar each should see the other,
   real geo distance, GPS uncertainty and color. Overlapping phones may show
   0-30m with GPS jitter. Very close markers are pulled outward visually so
   they do not cover the central YOU icon; numeric distances are not changed.
8. Optionally run controlled transport smoke test (NOT real GPS, no iPhones):
     cd E:\FogRadar
     npm run test:proximity
     npm run smoke:two-phones
   The smoke script deliberately inserts two synthetic trip locations. Run
   on PRIVATE TEST BACKEND ONLY, never on a public production service.

COMMON FAILURES:
- "Server URL missing" => Expo bundle did not receive .env; open in-app Server
  Connection and set it manually. Ensure .env is at ROOT, not backend\.env.
- /health works on iPhone Safari but test in app fails => different server URL,
  an invalid scheme, or iOS/app networking restriction. Look at in-app error.
- "Cannot obtain current location" => turn on Precise Location, move outdoors,
  allow iOS to get GNSS fix; try one-shot refresh. Core Location may still fail.
- "Waiting for fresh GPS" => do NOT show fabricated speed or locations.
- Socket online but nearby 0 => no other good GPS, not within 1000m, different
  route, stale fix, or two devices were given different servers.
- iPhone speed delay => speed is delivered when native GPS reports it. No zero
  delay is physically guaranteed. Watch GPS callback/fix age in Diagnostics.

IMPORTANT SAFETY LIMITS:
- Foreground Expo Go only. Background GPS is NOT implemented.
- Proximity colors are NOT collision-risk levels or safe following distances.
- 2-phone smoke script uses explicit synthetic coordinates; real radar uses actual GPS.
- Hazard reports remain UNVERIFIED. Two anonymous reports do NOT confirm a crash.
- Road map-matching, opposite carriageway filtering, identity attestation,
  tamper protection, automated stopped-traffic inference, production privacy/retention,
  TLS deployment, background services and offline predictive cache are NOT complete.
- HTTP LAN test only. No public motorway use, no driving while interacting.

VERIFICATION IN THIS DELIVERY:
- TypeScript/TSX syntax parse for 27 files PASS.
- Pure proximity tests 6/6 PASS using Node type stripping.
- Relative mobile imports validated.
- Actual npm dependency-based TypeScript compilation and iPhone/Redis/PostGIS
  full end-to-end runs cannot be performed in this environment; do not treat
  this code package as fully verified until checks above pass on your Windows PC.
