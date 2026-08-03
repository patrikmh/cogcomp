# ADR 0005: User-authored experiments

- **Status:** Accepted
- **Date:** 2025-02-14

## Context
Users need a private way to test a question against their own observations without
turning the product into a coach, diagnostician, or autonomous agent.

## Decision
Experiments are relational application records, not ontology nodes. The user owns
the title, hypothesis, action, criterion, schedule, lifecycle transitions, ordinary
journal check-ins, and qualitative outcome. Optional links point only to live,
 same-user graph nodes with provenance. Links and experiments are soft deleted;
mutations use aggregate revisions and client request fingerprints.

## Consequences
The database enforces ownership and lifecycle shape, while pure domain rules validate
bounded text, dates, cadence, and IANA timezones. The mobile `/experiments` screen
creates drafts and opens `/experiment/{id}` for the full lifecycle. The API is
revisioned and authenticated:

- `POST`/`GET /v1/experiments` create and list user-owned aggregates;
- `GET`/`PATCH`/`DELETE /v1/experiments/{id}` fetch, edit drafts, or soft-delete;
- `/start`, `/pause`, `/resume`, `/cancel`, and `/complete` are explicit
  revisioned transitions;
- `/links` accepts only a live same-user provenance-backed graph node; and
- `/checkins` attaches an existing same-user Journal Observation by ID.

Completion has no computed score: it requires a final attached observation and one
of four user-selected assessments (`met`, `partly_met`, `not_met`, `unclear`). A
check-in is written to the ordinary observation store before attachment, so it is
visible in both Journal and Experiment views without a second raw-content copy.
No extractor, agent, diagnosis, prescription, streak, reminder, or generated
interpretation path is involved. A separate account cannot list or fetch another
account's experiment, links, check-ins, or patterns.
