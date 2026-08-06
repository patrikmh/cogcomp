# Tlön — web

The design from the Open Design project (`tlon.html`, project 7f66d608), made
real: the same visual system, wired to the API in `apps/backend` instead of the
prototype's hardcoded arrays.

## Run

The API must be up first — the app has no mock mode, on purpose.

```bash
# 1. Postgres
docker compose -f infrastructure/docker-compose.yml up -d

# 2. API on :8080
cd apps/backend && .venv/bin/python -m uvicorn tlon.main:app --reload --port 8080

# 3. This app on :5173  (Vite proxies /v1 to :8080)
cd apps/web && npm install && npm run dev
```

## Verify

```bash
npm run typecheck     # tsc, no emit
npm run build         # production bundle
npm run preview       # serve the bundle on :4173
```

## What came from the design, unchanged

- `src/styles/tlon.css` — the prototype's stylesheet verbatim, minus its `:root`
  block, which now comes from `packages/design/tokens.css` so the mobile app
  reads the same values.
- `src/lib/seal.tsx` — the contour whorl per entry id, and the deterministic
  PRNG behind every generated shape. Same id, same seal, always.
- `src/lib/three-d-stage.js` — the three.js stage element, carried over intact
  for the Headspace map. Not yet mounted; see below.
- `public/assets/` — the mark and wordmark.

## What is deliberately different

- **Everything is real.** The prototype had no `fetch` anywhere; every screen
  here reads and writes the live API, and the rail's counts are the actual
  numbers.
- **The mic records.** The prototype's was a click toggle with a fake timer;
  this uses `MediaRecorder` and posts to `/v1/observations/voice`.
- **Delete account is disabled**, with a note saying so. There is no endpoint
  behind it yet, and a delete control that does not delete is worse than none.
- **Fonts are self-hosted** (`public/fonts`) rather than loaded from Google, so
  the app renders identically with no network beyond its own API.

## Not done yet

- The three.js topographic Headspace. The stage file is here and the screen
  renders the same harmonic contours in SVG from real data; mounting the 3D
  scene is the next pass.
- Talk speaks through the server's TTS (`/v1/voice/speak`) in the prototype's
  design; today it holds a real conversation and animates the canvas, without
  audio playback.
