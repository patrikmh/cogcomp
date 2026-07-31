# ADR-0002: Python backend, LangGraph extraction, OpenRouter model access

- Status: Accepted
- Date: 2026-07-31
- Supersedes: ADR-0001 (stack portion only; the pattern decisions still hold)

## Context

ADR-0001 chose Rust/Axum for the backend and direct Anthropic API access for
extraction. A working Milestone 1 slice was built and verified on that stack: the
observation API, the graph schema, user isolation, and the explain endpoint.

Two things changed the calculus:

1. **Model access should go through OpenRouter**, not a single provider. That makes
   the extractor provider-agnostic and lets model choice be a config value rather
   than a code change.
2. **The agent layer should be LangGraph.** Milestone 3 calls for a multi-agent
   system, an observability engine, and temporal graph reasoning. LangGraph's
   state machine, checkpointing, and human-in-the-loop interrupts are the shape of
   that work.

Both are Python-first. With extraction in Python, a Rust backend would mean a
permanent cross-language boundary in the middle of the cognitive pipeline — the part
of the system most likely to change.

## Decision

Move the backend to Python (FastAPI). Extraction runs as a LangGraph state machine.
All model calls go through OpenRouter's OpenAI-compatible API.

**The database is unchanged.** `0001_init.sql` is carried over verbatim. This is the
point that made the migration cheap: the invariants that matter — the two-tier rule,
the confidence range, the absent diagnostic vocabulary, referential provenance — are
Postgres CHECK constraints and foreign keys, not application code. They were verified
against a live database under the Rust implementation and hold identically under
Python. A rewrite of the application layer cannot weaken them.

What is lost: Rust's newtype constructors made an invalid `Confidence` or an empty
`Provenance` unconstructible at compile time. Pydantic validators enforce the same
rules, but at runtime. The database remains the real backstop either way.

## Consequences

- One language across the backend, the extraction pipeline, and the agent layer.
- LangGraph is carried from Milestone 1 even though Milestone 1's extraction is a
  single-shot call. The cost is a dependency and some structure that a plain function
  would not need; the benefit is that the retry/validate loop is already a graph when
  Milestone 3 adds nodes to it.
- OpenRouter adds a hop and a vendor between us and the model. In exchange, switching
  models is an environment variable, and no provider SDK is compiled into the app.
- The `apps/_superseded/` directory holds the Rust implementation. It is dead code
  kept only because this working tree is not under version control; delete it once
  the Python backend is trusted.

## Carried over from ADR-0001

Unchanged: thin routes with a service layer, client-generated UUIDv7 ids for offline
capture, soft deletes as tombstones, user-scoped queries everywhere, and raw
observations kept immutable with inferences stored as separate provenance-linked
nodes.

## Alternatives considered

**Python extraction sidecar, Rust backend retained.** Would have preserved the
verified Rust implementation and kept graph writes in one place. Rejected because it
puts a network boundary inside the cognitive pipeline and forces the ontology to be
maintained in two languages.

**PydanticAI instead of LangGraph.** A closer fit for Milestone 1's single-shot,
schema-validated extraction, and already familiar from the adjacent Varv project.
Rejected in favour of not migrating the agent framework mid-project, on the same
reasoning ADR-0001 used to avoid a mid-project language migration.
