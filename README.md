# Tlön

A privacy-first Cognitive Operating System that improves mental health one thought at a time.

## Guiding principles

These are load-bearing. Code that violates them is wrong even if it passes tests.

- Do not optimize for engagement. Optimize for user understanding, agency, and safety.
- Every inference must be explainable.
- Preserve provenance. Every derived node traces back to the raw observation it came from.
- Treat all psychological inferences as hypotheses.
- Never diagnose.

## Layout

```
apps/backend      Python + FastAPI. Observation intake, extraction, graph persistence.
apps/mobile       Expo + TypeScript. Voice and text journal, dashboard, graph explorer.
packages/ontology Graph schema v0.1 — node kinds, edge kinds, confidence and provenance rules.
packages/prompts  Versioned prompt templates, read from disk at runtime. No hidden prompts.
packages/shared   Types shared between backend and mobile.
infrastructure    Docker Compose: Postgres + FalkorDB.
docs/adr          Architecture Decision Records.
benchmarks        Extraction quality and graph algorithm benchmarks.
scripts           Repo-wide checks (ontology drift).
```

## Getting started

Start the datastores:

```bash
cd infrastructure
docker compose up -d
```

Run the backend:

```bash
cd apps/backend
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
cp .env.example .env    # set OPENROUTER_API_KEY, or leave blank to use the stub extractor
.venv/bin/python -m uvicorn tlon.main:app --reload --port 8080
```

The API listens on `http://localhost:8080`. Check it:

```bash
curl http://localhost:8080/health
```

Run the mobile app:

```bash
cd apps/mobile
npm install
npm start
```

## Testing

```bash
# Unit tests — no database required
cd apps/backend && .venv/bin/python -m pytest -m "not integration"

# Integration tests — needs the Postgres from docker compose; creates and drops
# its own `tlon_test` database, so development data is untouched
cd apps/backend && .venv/bin/python -m pytest -m integration

cd apps/mobile && npx tsc --noEmit

# The ontology lives in four files by necessity. This checks they agree.
python3 scripts/check_ontology_sync.py

# End to end: drives the app in a real browser against a real backend.
# Needs Postgres up and ports 8080/8081 free.
scripts/e2e.sh
```

## Status

Milestone 1 (MVP) in progress. See `docs/MILESTONES.md`.
