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

## The animations

All from the prototype, all honouring `prefers-reduced-motion`:

- **Headspace** is a three.js topographic chart (`src/lib/headspace.ts`). Each
  whorl is concentric contour rings — three harmonics and a seeded squash, with
  every third ring inked heavier the way a survey map reads its index lines.
  Radii and ring counts are the data. A gravity warp leans each peak's contours
  toward its neighbours, a 90-pass settle keeps any two from touching, peaks
  arrive on a staggered back-out ease, the rings breathe, and hovering lerps a
  whorl toward its tint and lifts it. The camera frames the massif after the
  settle, so nothing is cropped. PAUSE stops all ambient motion and puts every
  ring back where it started rather than freezing it mid-swell.
- **Identity** draws its rings on with `stroke-dashoffset`, staggered outward,
  then breathes.
- **Journal** entries rise and their seals draw themselves, staggered by day.
- **Talk** animates the avatar from the server-measured amplitude envelope,
  interpolated by playback position, so the shape moves *with* the voice rather
  than beside it.

## Still to come

- The whorl groups are all rendered as one layer; the prototype's per-lens 3D
  visibility toggle is wired (`setVisible`) but every lens currently rebuilds
  the scene instead.
- Voice capture works in the journal; the Talk screen is typed-only so far.
