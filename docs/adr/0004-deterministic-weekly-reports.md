# 0004: Deterministic weekly reports

- Status: accepted
- Date: 2026-03-16

## Decision

Weekly reports are assembled on demand from the authenticated user's observations
and provenance-backed graph inferences. A requested `week_start` must be a Monday;
the window is local Monday midnight through the next local Monday midnight using the
caller/device IANA timezone. Calendar arithmetic is used so both DST directions are
correct.

Reports contain user words before clearly separated hypotheses, confidence and source
IDs, and counted recurrence only when an entity occurs in at least two distinct
entries. There is no generated prose, diagnosis, score, trend, persistence, or
engagement prompt.

## Consequences

The same inputs always produce the same explainable report, and deleted observations
are absent. Timezone is explicit in the API, so clients must include it in cache keys.
No report table or migration is needed.
