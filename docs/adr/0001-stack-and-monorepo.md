# ADR-0001: Stack and monorepo layout

- Status: Accepted
- Date: 2026-07-31

## Context

Tlön is a new build. An adjacent project (`audhd`, the Varv day-companion) already
solves a structurally similar problem: capture raw user input, classify it with AI
agents, persist it under a per-user scope, and render a graph of the result.

Varv is Python (FastAPI + SQLModel + pydantic-ai, SQLite) with a React + Vite web
frontend. The Tlön product specification calls for Rust (Axum + SQLx + Postgres +
FalkorDB) with a React Native (Expo) client. The two stacks share no code.

## Decision

Build Tlön on the specification stack. Treat Varv as a source of **architectural
patterns only**, not code.

Patterns carried over from Varv:

- **Thin routes, fat services.** Route handlers validate and delegate; all business
  logic lives in a service layer. Keeps handlers testable and swappable.
- **Client-generated UUIDs.** The client mints the id so journal capture works
  offline and syncs later without id reconciliation.
- **Soft deletes.** `deleted_at` rather than row removal, so deletions replicate
  through sync as tombstones instead of silently vanishing.
- **User-scoped everything.** Every table carries `user_id`; every query filters on
  it; deletion cascades. Enforced at both the database and API layer.
- **Test layout.** Unit tests beside the service, integration tests exercising the
  full route stack against a real database.

Patterns deliberately *not* carried over:

- Varv's agent classification writes results directly onto domain rows. Tlön keeps
  raw observations immutable and writes inferences as separate, provenance-linked
  graph nodes. This is what makes explainability possible.

## Consequences

- No code reuse. Every layer is written fresh; first working feature is slower.
- Rust gives us compile-time enforcement of the confidence/provenance invariants —
  a derived node that cannot be constructed without provenance cannot be persisted
  without it. In Python those invariants would be runtime assertions.
- Two graph stores in play conceptually (Postgres for the relational spine, FalkorDB
  for graph traversal). Postgres is the source of truth; FalkorDB is a projection
  and must be rebuildable from Postgres alone.
- Expo means the graph explorer needs Skia rather than the d3/SVG approach Varv used.

## Alternatives considered

**Port Varv's FastAPI spine, move to Rust at Milestone 2.** Fastest path to a working
observation pipeline, and ~60% of the existing structure transfers. Rejected because a
mid-project language migration would land exactly when the graph algorithms — the part
most in need of stability — are being written.

**Rust backend with the existing React web frontend.** Would have made `IdeaGraph.jsx`
reusable as the graph explorer immediately. Rejected because the product is mobile-first;
a web client would become a second surface to maintain rather than a shortcut.
