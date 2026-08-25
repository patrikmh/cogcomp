# ADR-0008: Candidate label linking — proposing, never merging

- Status: Proposed
- Date: 2026-08-25

## Context

The detectors require near-verbatim repetition: exact-label matching on
normalised text, by deliberate decision (ADR-0007's context records why —
"deciding that 'tired' and 'hollowed out' are the same thing is an
interpretation"). Live testing with an organically written record exposed the
cost. One person wrote about the same experience four Mondays running; extraction
rendered it as `scowl`, `Monday scowl`, `scowling`, and a Thought node besides.
No single normalised label reached any detector floor until extra verbatim
entries were seeded by hand. For real users, whose wording varies naturally,
most genuine recurrences stay invisible — not because the evidence is absent but
because it is filed under four names.

Meanwhile ADR-0007 shipped a real embedder (`LocalOnnxEmbedder`,
bge-small-en-v1.5) inside the API server. It currently powers meaning-based
search only.

So the capability to notice that `Monday scowl` sits near `scowl` now exists in
the codebase, and the failure it could address is the single largest gap between
the product and its goal: finding patterns people cannot find themselves.

## Decision

**Candidate label linking**: when a new reading's embedding lands close (cosine
≥ 0.80, tunable) to an existing reading of a *different* label, and both are
patternable kinds, the system may propose to the person that these might be the
same word returning — and nothing more.

The boundaries are what make this safe:

1. **Proposals are shown, never applied.** No node merging, no relabeling, no
   rewriting of provenance. The stored graph keeps every word exactly as
   extracted. A proposal lives in its own table (`label_links`: user, two node
   ids, similarity, status) until the person answers it.
2. **Only the person can confirm.** A confirmed link makes the detectors treat
   the two labels as one recurrence stream for that user. Rejection sticks,
   like pattern verdicts. Silence changes nothing — unreviewed proposals never
   influence mining.
3. **Explainability travels with the proposal.** The UI must show both words in
   their original entries ("you wrote *scowling* on Aug 4 and *scowl* on Aug
   11"), the similarity as a percentage, and the plain statement that this is a
   guess from word meanings, not a fact.
4. **Merging stays refused.** This ADR does not revisit projection's refusal of
   Graphiti's `add_triplet` semantic merging. Nothing in the stored graph is
   ever combined; linking exists only as arithmetic inside mining, keyed by the
   user's own confirmed links.
5. **Floor unchanged.** Linked labels still need MIN_OBSERVATIONS distinct
   entries across MIN_DISTINCT_DAYS before any finding is claimed. Linking
   widens what counts as evidence; it does not lower how much is needed.

## Consequences

- Detectors gain a second input path: after grouping by `(kind, normalise)`,
  groups joined by confirmed links are folded into one candidate list before
  counting. Unlinked behaviour is byte-for-byte identical to today.
- A new review surface is needed on both clients — the natural home is the
  Patterns screen beside "Still gathering", since both answer "what is almost
  here".
- Embedding cost is nil at query time (readings are embedded during extraction
  once the projection stores name embeddings); the link scan is a per-user
  nearest-neighbour query over FalkorDB vectors already present.
- Risk carried: a wrong confirmation folds two genuinely different experiences
  into one stream. Mitigations: the confirmation is reversible (unlinking
  restores separate streams on the next mine), and the proposal UI shows the
  actual sentences side by side so the person judges their own words, not a
  similarity score alone.
- Deliberately out of scope: cross-user anything, automatic linking above a
  higher confidence threshold, linking across kinds (an Emotion `scowl` and an
  Activity `scowl` remain different findings), and any change to extraction
  itself.

## Status

Proposed, awaiting human approval. Implementation would follow phase discipline:
migration + link-store + mining fold + tests first; proposal surface on clients
second; nothing ships behind feature flags because there is nothing to flag —
without a confirmed link the system behaves exactly as it does today.
