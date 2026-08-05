# ADR-0006: PostgreSQL-authoritative Graphiti projection

- Status: accepted
- Date: 2026-08-03

## Context

ADR-0001 reserved FalkorDB for graph traversal while keeping PostgreSQL as the
relational spine and source of truth. Milestone 3 made that boundary concrete:
association mining writes provenance-backed `CO_OCCURS_WITH` edges to PostgreSQL,
and theme detection needs community clustering over those edges.

Graphiti provides FalkorDB integration and community maintenance, but its default
workflow makes decisions Tlön must not inherit:

- telemetry is enabled unless disabled before `graphiti_core` is imported;
- an OpenAI client and reranker are constructed by default;
- `add_triplet()` performs model-assisted semantic node resolution;
- generated community summaries require a language model.

Those defaults conflict with the product's provider choice and with its refusal to
merge a person's distinct words semantically. They would also let a derived store
reinterpret the authoritative graph.

## Decision

PostgreSQL remains the only authoritative graph. FalkorDB is a disposable,
one-directional projection accessed through Graphiti. Projected entities and
edges never write back or mutate their PostgreSQL sources. The application may
persist a cluster result as a new Theme hypothesis, but only through the ordinary
PostgreSQL confidence, provenance, and epistemic-status invariants.

Projection has these rules:

- Tlön node and edge IDs deterministically derive their Graphiti UUIDs, making a
  rebuild idempotent.
- Each user maps to a separate Graphiti `group_id`.
- Only live, non-rejected nodes connected by live `CO_OCCURS_WITH` edges are
  projected. Observations, Pattern nodes, and causal hypotheses do not participate
  in community structure.
- Nodes and edges are saved directly. `Graphiti.add_triplet()` is not used because
  its semantic resolution could merge distinctions PostgreSQL deliberately kept.
- The projection is rebuilt before theme clustering rather than incrementally
  synchronized. Deleting FalkorDB must never lose authoritative information.

Graphiti telemetry defaults off. The Graphiti LLM client and cross-encoder are
replaced with clients that fail explicitly when a model-dependent feature is
requested. A deterministic SHAKE-256 embedder keeps projection and structural
clustering executable without credentials, but carries no semantic meaning.

The only enabled Graphiti capability is structural community clustering. A
community must contain at least three members and is persisted back to PostgreSQL
as a provenance-backed Theme hypothesis. The theme label lists the member labels
instead of generating a summary.

Semantic search, reranking, semantic deduplication, and generated community
summaries remain disabled until each has an explicit provider, reviewable model
configuration, and separate safety decision.

## Consequences

- PostgreSQL backups contain everything needed to reconstruct FalkorDB.
- A FalkorDB outage can prevent theme refreshes but cannot corrupt or lose the
  person's graph.
- Projection work is repeated on each theme run. This is intentionally less
  efficient than incremental synchronization and has only one consistency path.
- Structural clusters inherit the provenance, confidence ceiling, durable
  identity, and user verdict behavior of other derived claims.
- The deterministic embedder must never be used as evidence that semantic search
  works. It exists only to satisfy Graphiti's storage interface.
- Graphiti-dependent pytest cases run against a live FalkorDB (2026-08-04). They
  were previously skipped on the belief that FalkorDB's synchronous cluster probe
  deadlocked inside pytest's running event loop; that is no longer true of the
  pinned client, which builds in milliseconds inside a running loop.
- **The projection must emit at most one edge per pair, and this is load-bearing.**
  Graphiti clusters with label propagation, which does not terminate when a node
  sees the same neighbour across two or more edges — the two communities swap
  forever. A pair, a path of three, a star and a four-cycle all hang on a doubled
  edge; only single-edge shapes converge. The co-occurrence detector already
  writes one row per unordered pair, so this held by construction, but the caller
  is a background agent with no timeout, so it is enforced twice: `_live_edges`
  deduplicates the read with a deterministic `DISTINCT ON`, and the projected
  edge's uuid is derived from the *pair* rather than from a Postgres row id, so
  a second edge between the same two nodes cannot be expressed. The second guard
  is the necessary one — deduplicating each run still let two runs that picked
  different duplicate rows leave two edges behind. Anything that later projects
  a second edge kind must preserve that invariant or bound the clustering call.
- `redis` remains pinned below 8 while FalkorDB 1.6.2 passes an async-only
  connection argument to the synchronous Redis client.

## Alternatives considered

**Make FalkorDB authoritative.** Rejected because provenance, confidence,
epistemic status, account isolation, and deletion semantics are enforced by the
PostgreSQL schema. Duplicating those rules would create two competing answers to
what the graph contains.

**Use Graphiti's normal `add_triplet()` ingestion.** Rejected because model-assisted
node resolution would silently reintroduce semantic merging that consolidation
deliberately refuses.

**Use Graphiti's default OpenAI clients.** Rejected because OpenAI is not the
configured provider and a dependency default must not decide where a person's
graph is sent.

**Implement community detection directly over PostgreSQL.** Viable for the current
small graph, but rejected for this milestone because FalkorDB was already the
chosen traversal projection and Graphiti provides the structural clustering
operation. PostgreSQL remains available as a fallback if the projection stops
being operationally worthwhile.
