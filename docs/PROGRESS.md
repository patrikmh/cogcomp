# Progress against the spec

Tracked against `PRODUCT_SPEC.md`. Updated as work lands; the point is to be able
to answer "what is actually done" without reading the diff.

**Status key** — ✅ done and verified · 🟡 partial, gap named · ⬜ not started

Last updated: 2026-08-02

---

## Definition of Done

The spec says a feature is complete only if all six hold. These are not per-feature
checkboxes but standing gates, so they are tracked once:

| Gate | Status | Notes |
|---|---|---|
| Unit tests pass | ✅ | 440 backend and 139 mobile tests green; Ruff and TypeScript checks clean |
| Explainability available | ✅ | `/v1/nodes/{id}/explain`; every inference traces to the entry that produced it |
| Confidence scores included | ✅ | Enforced by CHECK constraint, not convention — an inference without one cannot be inserted |
| Provenance retained | ✅ | `node_provenance` / `edge_provenance` are tables with FKs into `observations` |
| Safety review completed | 🟡 | Crisis path verified three ways against the live model. **Crisis wording is still the user's call** — see `packages/prompts/converse-v0.1.system.md` |
| Documentation updated | 🟡 | Module docstrings are thorough; no ADR yet for the Rust→Python pivot or for FalkorDB vs Graphiti |

---

## Milestone 1 (MVP) — ✅ complete

| # | Feature | Status | Where |
|---|---|---|---|
| 1 | Authentication | ✅ | Argon2id + SHA-256 bearer tokens in a separate `api_tokens` table. Sign-in rate limited per address (hashed, never plaintext), unknown addresses counted too so the lockout is not an existence oracle |
| 2 | Voice journal | ✅ | Hold-to-record → ElevenLabs Scribe → text. Audio is discarded after transcription |
| 3 | Text journal | ✅ | `POST /v1/observations` |
| 4 | Observation pipeline | ✅ | LangGraph `extract → validate → retry`, schema-validated, via OpenRouter |
| 5 | Graph persistence | ✅ | Postgres. Two-tier rule enforced by CHECK constraints |
| 6 | Daily summary | ✅ | `GET /v1/summary/{day}`; reports an empty day as empty rather than nudging |
| 7 | Interactive dashboard | ✅ | `app/today.tsx` |
| 8 | Graph explorer | ✅ | Skia canvas, deterministic seeded force layout |

---

## Milestone 2 — ✅ complete

| Feature | Status | Notes |
|---|---|---|
| Pattern mining | ✅ | `tlon/patterns.py` + `POST /v1/patterns/mine`, background agent, and mobile Patterns screen. Exact normalised matching, ≥3 entries across ≥2 days, confidence never exceeds its weakest input. |
| Memory consolidation | ✅ | `tlon/agents/consolidation.py`. Merges duplicate inferred nodes on exact normalised labels; survivor inherits all provenance, `node_merges` records what was absorbed. Observations are never merged |
| Identity graph | ✅ | User-curated projection API and mobile screen over existing Value/Belief/Need/Activity nodes; selected nodes are protected from consolidation |
| Weekly reports | ✅ | Read-only `GET /v1/summary/week/{week_start}?tz=...`; Monday–Sunday local windows, seven buckets, provenance/source IDs, recurrence counts, and mobile `/week` screen. |
| Experiment engine | ✅ | User-authored drafts, explicit lifecycle, Pattern evidence links, Journal-backed check-ins, qualitative completion, account isolation, soft deletion; browser journey in `scripts/e2e.sh`. |

---

## Milestone 3 — 🟡 in progress

| Feature | Status | Notes |
|---|---|---|
| Multi-agent system | 🟡 | Framework done: registry, per-user runner, scheduler, failure containment. Two agents live (consolidation, patterns) |
| Observability engine | ✅ | `agent_runs` records every attempt — including skips and failures — with trigger, version, and counts. `GET /v1/agents/runs` and mobile Agent activity screen. |
| Temporal graph reasoning | ✅ | `tlon/temporal.py` (32 tests) + `GET /v1/temporal/changes` + a "Changed" lens in Headspace. Two adjacent equal windows; counts only, no direction; refuses to compare a week nobody wrote in |
| Digital twin prototype | 🟡 | `POST /v1/nodes/{id}/judgement` and `GET /v1/self-model` (17 tests). Confirm, reject or withdraw any reading; rejection stops it feeding patterns and temporal changes. **No mobile surface yet** |

Pulled forward because pattern mining already needed a scheduler, and because a
system that draws conclusions unasked needs its audit trail built at the same time
as the thing being audited — not after.

### Background agents

| Agent | Cadence | What it does |
|---|---|---|
| `consolidation` | hourly | Merges duplicate inferred nodes. Runs *before* patterns, since merging changes what recurs |
| `patterns` | 6-hourly | Re-mines patterns, only when something has been written since the last success |

Design notes worth keeping in mind:

- **Off by default** (`AGENTS_ENABLED=false`).
- **Every attempt is logged**, including the ones that did nothing — "nothing ran"
  and "something ran and found nothing" are different answers to someone asking
  why their graph changed.
- **Two distinct skips.** The scheduler's ("nothing new to work on") means it did
  not look; an agent's own ("nothing was duplicated") means it looked and found
  nothing. Manual runs always force, so a button never reports the first.
- **Counts, never content.** The run log must not become a second copy of
  someone's private writing; there is a test asserting it.
- **Users writing in the last 10 minutes are skipped** — merging nodes underneath
  someone looking at them is disorienting.
- **Cadence is measured from the last attempt, not the last success**, so a
  failing agent backs off rather than retrying every tick.

---

## Beyond the spec

Built because the product needed them, not because the spec asked:

| Feature | Status | Notes |
|---|---|---|
| Conversational journalling | ✅ | A therapeutic-style agent; only the person's turns become observations, enforced by a CHECK constraint |
| Agent speaks aloud | ✅ | ElevenLabs TTS. `SPEECH_VOICE_ID` is deliberately not defaulted |
| Skull avatar | ✅ | Profile with occipital bulge, brow ridge, nasion recess, projecting chin and gonial jaw angle, plus an interior cranial vault line. Constellation clipped to the braincase |
| 3D sphere avatar | ✅ | Real 3D projection in Skia, depth-sorted arcs, drag to spin |
| Continuous voice conversation | ✅ | Energy-based VAD (`src/lib/vad.ts`, 24 tests) drives listen → transcribe → reply → speak → listen. Mic shut while the agent talks. Barge-in not implemented |
| Voice/shape sync | ✅ | Server-measured RMS envelope, interpolated by playback position — works identically on web and native |
| Ontology drift check | ✅ | `scripts/check_ontology_sync.py` verifies four definitions of the ontology agree |
| e2e suite | ✅ | `scripts/e2e.sh`, 31 checks, credentials cleared so runs stay deterministic |

---

## Known gaps

Things that are genuinely not done, stated plainly rather than left to be discovered:

1. **CI has never run on GitHub.** Every check is verified locally; the workflow
   itself is unexercised.
2. **CI has never run on GitHub.** Every step is verified locally; the workflow
   itself is unexercised.
3. **No ADR** for two decisions that deserve one: the Rust→Python pivot, and
   FalkorDB vs Graphiti as the graph layer.
4. **Graphiti** is intended as the graph layer at a later milestone; not evaluated.
5. **The judgement flow has no e2e journey.** Confirm/reject is covered by 17
   integration tests but no browser walkthrough, unlike every other feature.
6. **Web storage is weaker than native.** `expo-secure-store` has no web
   implementation, so the web build falls back to localStorage. Test surface only.
