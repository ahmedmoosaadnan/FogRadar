FogRadar v0.2 GPS Diagnostics PATCH

Apply on top of your working E:\FogRadar project after backup.
Only six source files are included. No dependencies or app.json changes are required.
New files: app/gps-diagnostics.tsx, src/hooks/useGpsHealth.ts.
Updated files: app/_layout.tsx, app/(tabs)/home.tsx, app/(tabs)/radar.tsx, app/(tabs)/settings.tsx.
Do not override customized work without reviewing the diff.
Run: npm run typecheck; npx expo-doctor; npx expo start -c.
Test diagnostics on iPhone outdoors, stationary or as a passenger. No backend and no real radar detection.

Author verification: TS/TSX syntactic transpilation scan passed. Full npm install/typecheck and device runtime were not verified in this environment.
