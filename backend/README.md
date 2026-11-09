# FogRadar Cloud MVP
See `../README-MVP-v0.4.md` for full Windows/phone steps.

```
cp .env.example .env    # set SESSION_SECRET before startup
# run docker compose up -d
npm install
npm run typecheck
npm test
npm run dev
```

API: `GET /health`, `POST /v1/session` (returns one 8-hour signed anonymous trip token).
Socket.IO handshake auth: `{token}`; events: `telemetry:update` -> `radar:snapshot`, `hazards:snapshot`; `hazard:report` -> `{ok,id,status,reportCount}` ACK.
Hazard warnings require independent trip corroboration; this is not authoritative incident validation.
