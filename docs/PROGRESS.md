# Progress against the spec

Tracked against `PRODUCT_SPEC.md`. Updated as work lands; the point is to be able
to answer "what is actually done" without reading the diff.

**Status key** — ✅ done and verified · 🟡 partial, gap named · ⬜ not started

Last updated: 2026-08-04

---

## Definition of Done

The spec says a feature is complete only if all six hold. These are not per-feature
checkboxes but standing gates, so they are tracked once:

| Gate | Status | Notes |
|---|---|---|
| Unit tests pass | ✅ | 680 backend tests and 241 mobile tests green; `apps/web` typechecks and builds, nothing skipped; the nine live Graphiti tests now run against a real FalkorDB. Ruff clean; mobile checks remain part of the app workflow |
| Explainability available | ✅ | `/v1/nodes/{id}/explain`; every inference traces to the entry that produced it |
| Confidence scores included | ✅ | Enforced by CHECK constraint, not convention — an inference without one cannot be inserted |
| Provenance retained | ✅ | `node_provenance` / `edge_provenance` are tables with FKs into `observations` |
| Safety review completed | 🟡 | Crisis path verified three ways against the live model. **Crisis wording is still the user's call** — see `packages/prompts/converse-v0.1.system.md` |
| Documentation updated | ✅ | ADR-0002 records the Rust→Python pivot; ADR-0006 records the PostgreSQL-authoritative Graphiti/FalkorDB projection |

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
| Pattern mining | ✅ | Exact-label recurrence, strict weekday periodicity, and conservative lag ordering through `POST /v1/patterns/mine` and the background agent. Detector identity, provenance, dormancy, and user verdicts remain separate. |
| Memory consolidation | ✅ | `tlon/agents/consolidation.py`. Merges duplicate inferred nodes on exact normalised labels; survivor inherits all provenance, `node_merges` records what was absorbed. Observations are never merged |
| Identity graph | ✅ | User-curated projection API and mobile screen over existing Value/Belief/Need/Activity nodes; selected nodes are protected from consolidation |
| Weekly reports | ✅ | Read-only `GET /v1/summary/week/{week_start}?tz=...`; Monday–Sunday local windows, seven buckets, provenance/source IDs, recurrence counts, and mobile `/week` screen. |
| Experiment engine | ✅ | Lifecycle transitions answer with the same full object a read returns, so a completed experiment shows its outcome without a reload. User-authored drafts, explicit lifecycle, Pattern evidence links, Journal-backed check-ins, qualitative completion, account isolation, soft deletion; browser journey in `scripts/e2e.sh`. |

---

## Milestone 3 — ✅ complete

| Feature | Status | Notes |
|---|---|---|
| Multi-agent system | ✅ | Explicit registry, per-user runner, scheduler, failure containment, and four ordered agents: consolidation, patterns, co-occurrence, themes |
| Observability engine | ✅ | `agent_runs` records every attempt — including skips and failures — with trigger, version, and counts. `GET /v1/agents/runs` and mobile Agent activity screen. |
| Temporal graph reasoning | ✅ | `tlon/temporal.py` (32 tests) + `GET /v1/temporal/changes` + a "Changed" lens in Headspace. Two adjacent equal windows; counts only, no direction; refuses to compare a week nobody wrote in |
| Digital twin prototype | ✅ | `POST /v1/nodes/{id}/judgement`, `GET /v1/self-model`, and mobile verdict controls. Confirm, reject, or withdraw any reading; rejection stops it feeding patterns, temporal changes, and graph projection. The e2e journey covers rejection and withdrawal. |

Pulled forward because pattern mining already needed a scheduler, and because a
system that draws conclusions unasked needs its audit trail built at the same time
as the thing being audited — not after.

### Background agents

| Agent | Cadence | What it does |
|---|---|---|
| `consolidation` | hourly | Merges duplicate inferred nodes. Runs *before* patterns, since merging changes what recurs |
| `patterns` | 6-hourly | Re-mines exact-label, strict weekday, and conservative lag patterns, only when something has been written since the last success |
| `cooccurrence` | daily | Measures associations with support floors and lift, after consolidation and patterns |
| `themes` | daily | Rebuilds the disposable FalkorDB projection and clusters association communities |

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
| Words for how you felt | ✅ | `GET /v1/vocabulary/{week_start}` and a line on the Week screen: how many different words someone used for a state, across how many entries, and which were used for the first time. The only reading here about capacity rather than content, and the only one that can honestly go up — putting words to states is a skill that improves with practice. Counts travel with the entries that produced them, so a quiet week can never read as decline, and the words themselves are listed because a count nobody can check is a score |
| Findings can be switched off | ✅ | Patterns, regions and changes can be turned off while capture keeps working and nothing is deleted — the counterpart to "silence is never punished". Reviews of mood monitoring report that being shown recurring negative material harms some people some of the time, and this app has no clinician in the loop to notice. The queries stop firing too, so the switch is not stagecraft |
| Local calendars | ✅ | Every capture path records the IANA zone it was written in (`observations.timezone`, `conversation_turns.timezone`); the weekday and lag detectors count days in the writer's own calendar and only say `(UTC)` when some of their evidence predates that |
| Voice/shape sync | ✅ | Server-measured RMS envelope, interpolated by playback position — works identically on web and native |
| Association mining | ✅ | Deterministic lift over shared entries; emits adjacency only, never causality |
| Within-day ordering | ✅ | The only detector that reads the clock rather than the calendar, and the only one that refuses backfilled entries — a day reconstructed later is recall, and recall is pulled toward peaks and endings, which is exactly what distorts the order of two moments (`MAX_RECALL_DELAY`, six hours): something written earlier in the day than something else, repeatedly. Needs two different entries at least ten minutes apart — one sitting split in two is a writing habit, not a sequence — four days across three weeks, and three days in four showing the order. Suppressed when the pair runs both ways. Reports a median gap, so one very long day cannot stretch it |
| Stated-vs-recorded | ✅ | The first detector built on an absence: something named as a value or need, and something recorded as done, that stay apart in the record where independence predicted three or more shared days. Reports two counts and the overlap — never *should*, *but*, or *despite*. Beliefs are excluded so a self-criticism is never read as a goal someone is failing; days nobody wrote enlarge the denominator, so silence can only make it quieter |
| Lag/precedence mining | ✅ | Conservative 1–3 day findings persist as detector-specific Pattern nodes with durable identity, verdicts, dormancy, pair-count occurrences, flat provenance, and exact directed observation matches. It reports ordering only and suppresses fixed schedules, same-day pairs, common bystanders, missing-day guesses, and bidirectional ambiguity. `GET /v1/patterns/{id}/ordering` and the `/pattern/[id]` screen show the occasions themselves — each pair of entries with the gap named — so the sentence can be checked rather than taken on trust |
| Theme clustering | ✅ | Graphiti communities over the disposable FalkorDB projection; structure only, three-member floor, PostgreSQL persistence. Regions are readable at last: `GET /v1/themes`, `GET /v1/themes/{id}` with members and the associations that formed them, a Regions lens in Headspace, and a `/theme/[id]` screen. The projection emits one edge per *pair* — keyed on the pair rather than on a row id, so a duplicate association cannot be expressed in the graph store at all. Graphiti's label propagation does not terminate when a node sees the same neighbour twice, and the caller is an agent with no timeout |
| Ontology drift check | ✅ | `scripts/check_ontology_sync.py` verifies four definitions of the ontology agree |
| e2e suite | ✅ | `scripts/e2e.sh` drives the real app in a real browser; 104 checks, all passing, credentials cleared so runs stay deterministic. Not immune to a cold web bundle: a first run after a rebuild has been seen to fail the Skia canvas and the first explain-screen click, then pass unchanged on a re-run. Treat a single red run as unconfirmed |

---

## Clients

| Client | Stack | State |
|---|---|---|
| `apps/web` | Vite + React + TypeScript | The Open Design UX (`tlon.html`) ported and wired to the live API. All data-backed routes work; the three.js Headspace and TTS playback are the next pass |
| `apps/mobile` | Expo / React Native Web | The original client, still what `scripts/e2e.sh` drives. Retheming to the shared palette landed; structural rework (seals, contour rings, the rail) has not |

Both read their palette from `packages/design`, so the two cannot drift into
looking like two products. Metro needs `apps/mobile/metro.config.js` to resolve
that package — `@tlon/ontology` never did, because it is only imported as a
type and is erased before the bundler sees it.

---

## Known gaps

Things that are genuinely not done, stated plainly rather than left to be discovered:

1. **CI has never run on GitHub.** Every check is verified locally; the workflow
   itself is unexercised.
2. **Entries written before 2026-08-04 have no timezone.** The column exists and
   every capture path now fills it, but historical rows are unknown rather than
   assumed to be UTC — so a claim resting on any of them still says `(UTC)`, and
   will keep saying so until its evidence has aged out of the recency window.
3. **Semantic graph features are disabled.** Search, reranking, semantic
   deduplication, and generated theme summaries need a real embedder/model and a
   separate safety decision.
4. **Web storage is weaker than native.** `expo-secure-store` has no web
   implementation, so the web build falls back to localStorage. Test surface only.
