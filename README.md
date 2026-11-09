# FogRadar v0.4 — Connected MVP (REAL DATA; FIELD-TEST ONLY)

This package integrates the existing Expo 58 / React Native mobile app with a Node.js TypeScript server, Socket.IO, Redis GEO and PostgreSQL + PostGIS.

**This is not a certified collision-avoidance system. Do not rely on it to drive in fog. Pilot tests must be done with passengers or controlled stationary tests.** GPS is only tracked in foreground. Traffic without the app is invisible. Road route is selected manually, not map-matched. User reports can be false/spoofed.

## Prerequisites (Windows)
- Node.js 22 LTS; Docker Desktop running; iPhone and PC on same Wi-Fi/network; optional Expo Go for foreground tests.
- Keep the original `E:\FogRadar` backed up or committed in Git. This is an MVP update, not a new app concept.

## A. Server setup (PowerShell terminal #1)
1. Copy backend folder into `E:\FogRadar\backend` (or use complete repository ZIP).
2. `cd E:\FogRadar\backend`
3. `Copy-Item .env.example .env`
4. Generate a strong secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and paste it into `.env` as `SESSION_SECRET=<random value>` (replace the placeholder entirely).
5. `docker compose up -d`
6. `npm install`
7. `npm run typecheck` and `npm test`
8. `npm run dev`
9. In a browser on Windows open `http://localhost:4000/health`. Expect `{ "ok": true, ... }`.

*PostGIS schema migration is run automatically by PostgreSQL on the **first creation of the DB volume**. For an existing database, run `docker compose exec -T db psql -U fogradar -d fogradar < sql/001_init.sql` from a shell that supports `<` redirection (e.g. Git Bash). In PowerShell use `Get-Content .\sql\001_init.sql -Raw | docker compose exec -T db psql -U fogradar -d fogradar`.*

If Docker fails to start PostgreSQL, run `docker compose logs db`. If Windows Firewall prompts, allow Node.js on private networks only. The database ports in compose are bound to localhost only.

## B. Phone + app setup (PowerShell terminal #2)
1. From your original root: `cd E:\FogRadar`
2. Apply the **PATCH ZIP**: merge its `app/`, `src/`, `backend/` and root `app.json`, `package.json`; retain your assets and other files. Prefer a Git commit first. A complete reference repository ZIP is also included.
3. Run `npm install` (new dependency: `socket.io-client`).
4. Find your PC IPv4 address: `ipconfig` (e.g. `192.168.1.50`).
5. `Copy-Item .env.example .env` and edit to `EXPO_PUBLIC_API_URL=http://<YOUR_PC_IPV4>:4000`. **Don't use localhost on iPhone.** This is HTTP for LAN dev only. Use HTTPS/WSS on a real internet server.
6. Verify from **iPhone Safari**: `http://<YOUR_PC_IPV4>:4000/health`. If this does not load, fix Wi-Fi/firewall first. Some Wi-Fi networks isolate clients.
7. `npm run typecheck`; `npx expo-doctor`; `npx expo start -c`.
8. Open on iPhone through Expo. Start Journey with GPS enabled. Home should show **Connected**; radar should display real vehicles only.

Expo Go supports foreground GPS. For background tracking and iOS native permissions you'll need a development build and platform-specific lifecycle testing in a later milestone. **Do not run foreground-only tracking as if it were continuous protection.**

## C. Two-phone real-world test
- Phone A and B: both FogRadar; same backend; grant precise location permission and choose same manually selected route.
- Tap Start Journey on both. Outdoors with good GPS (under ±50m), keep apps foreground. Within ~1km both radar screens should show the other as a **real connected phone**, with distance and speed. Avoid running the test while driving yourself.
- On a **passenger's phone with fresh GPS heading and accuracy <=35m**, submit a hazard report. The backend records **candidate**, not broadcast warning.
- From a **second distinct active trip** within 150m and aligned direction, same route and type, report again within the hazard lifetime. State becomes `corroborated` and nearby aligned active users may see an **experimental** advisory. This is not a verified road incident.
- End Journey: position is removed immediately on disconnect. Offline/timeout: stale location is excluded after 12 seconds and cleaned from Redis after ~20 seconds.

## Current working features
- Real GPS foreground telemetry (device timestamp, GPS accuracy, speed, heading); sends only accurate recent fixes.
- Signed short-lived anonymous per-journey session tokens (8h). No permanent user account.
- Socket.IO real-time connection/reconnection; explicit online/offline states.
- Redis GEOSEARCH radius 1000 m; stale positioning filtered; live nearby connected vehicles only.
- Radar positions rotated relative to your GPS heading; range 1 km; stale-feed blanking.
- PostGIS hazard report persistence, spatiotemporal deduplication, independent trip corroboration (two reports), TTL and directional filtering; live on-screen feed and voice/haptics where supported.
- Start/End Journey, GPS diagnostics, timer and estimated trip distance from previous versions.

## NOT shipped / NOT safety-ready
- Reliable background iOS/Android tracking and alerts, push notifications when suspended, 1–2 second guaranteed GPS, offline predictive caching, automated stopped-traffic inference, road map-matching/opposite-carriageway disambiguation, anti-Sybil/report trust, mobile privacy consent, privacy policy, load tests, emergency-authority integration, independent third-party validation, public deployment hardening.
- Single anonymous device can make a new session and potentially spoof reports. **Do not deploy this pilot backend publicly until device attestation, rate-limits, route verification, abuse prevention, TLS and independent validation are implemented.**
- HTTP/WSS needs HTTPS in production. No claims of validated road hazard prevention.

## Useful checks
```
cd E:\FogRadar\backend
npm run typecheck
npm test
curl.exe http://localhost:4000/health

cd E:\FogRadar
npm run typecheck
npx expo-doctor
npx expo start -c
```

## Architecture
```
React Native (GPS) -> Socket.IO authenticated trip session
    -> Fastify Node.js -> Redis GEO (live positions, TTL 12-20s)
                     -> PostgreSQL + PostGIS (hazard reports, expiry, corroboration)
                     -> per-driver directional snapshots -> mobile radar / experimental advisories
```

## Privacy notes
Coordinates are uploaded while Start Journey is active, using TLS **only after you deploy with HTTPS**; on local HTTP Wi-Fi they are unencrypted. Raw coordinates are stored temporarily in Redis; hazard location and anonymous reporter IDs remain in PostgreSQL until database retention/cleanup is implemented. Trips and settings still use in-memory state; no completed-trip persistence. Avoid real user/public collection until policy, deletion and retention are developed.
