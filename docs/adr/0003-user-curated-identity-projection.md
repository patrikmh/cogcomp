# ADR-0003: User-curated identity projection

- Status: accepted
- Date: 2026-08-02

## Context

Identity is useful as a way to revisit durable themes, but an automatically
asserted identity would turn uncertain extraction into a claim about the person.
The graph already contains provenance-backed `Value`, `Belief`, `Need`, and
`Activity` nodes with confidence and epistemic status.

## Decision

Identity is a user-curated projection over those existing nodes. It has no new
ontology kind. A selection is stored per user and node with `selected` or
`removed` status. Removal is a tombstone, so history and deliberate reselection
remain visible. Selection status is separate from `epistemic_status` and never
changes confidence, extractor, provenance, or confirmation semantics.

Only live eligible nodes can be selected. The projection returns selected nodes
and edges whose two endpoints are selected, while the existing explain endpoint
remains the explanation path. Active selections are protected from consolidation,
including a transaction-time recheck; removed selections may consolidate.

The mobile presentation uses hypothesis/tentative language, exposes explain
links, and keeps selection and removal under the user's control. It does not use
trait, diagnostic, or other clinical framing.

## Consequences

- Users decide which existing graph material belongs in their identity view.
- Tombstones add durable rows and require a user/node uniqueness constraint.
- Consolidation must consult identity selections as a protection boundary.
- Identity can evolve without changing the graph ontology or provenance model.
