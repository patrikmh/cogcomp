# Experiment engine

The Experiment engine is a user-controlled, private workflow for bounded
self-observation. It does not diagnose, prescribe, score, generate an
interpretation, or create reminders and streaks.

## User contract

A draft contains user-authored `title`, first-person `hypothesis` (starting with
`I wonder whether`), `action`, and `success_criterion`, plus a local `start_date`,
`duration_days` (1–42), IANA `timezone`, and `cadence` (`daily`, `weekly`, or
`end_only`). The UI displays the authored wording without rewriting it.

The lifecycle is explicit and revisioned:

```text
draft  → active  → completed
  │       ↕  └──→ cancelled
  └────→ cancelled
       paused
```

Only the user starts, pauses, resumes, completes, cancels, or deletes an
experiment. Completion requires an attached final Journal observation and one
qualitative assessment: `met`, `partly_met`, `not_met`, or `unclear`. The outcome
shows the assessment and that the final check-in was selected by the user; there
is no computed score or generated interpretation.

## Evidence and check-ins

A draft may link a live, same-user non-observation graph node (currently the
Pattern UI offers eligible Pattern nodes). The link is provenance-backed and its
existing explanation remains available through the normal evidence-chain screen.

A check-in is created first as an ordinary Journal Observation, then attached by
observation ID. It is never copied into an experiment-only raw-content store.
The same observation therefore appears in the Journal and in the experiment's
attached check-ins. A failed attachment can be retried without duplicating the
observation.

## API contract

All endpoints require the authenticated user's bearer token. Records and linked
nodes are scoped to that user; another account receives an empty list or `404`
for the first account's records.

- `POST /v1/experiments` — create an idempotent draft. The optional
  `X-Request-Fingerprint` must match the canonical payload.
- `GET /v1/experiments` and `GET /v1/experiments/{id}` — list or fetch the
  aggregate, including links, check-ins, and outcome.
- `PATCH /v1/experiments/{id}?revision=N` — edit a draft.
- `POST /v1/experiments/{id}/start|pause|resume|cancel` — transition with
  `{ "revision": N }`.
- `POST /v1/experiments/{id}/checkins` — attach an existing same-user
  observation with `{ "revision": N, "observation_id": "..." }`.
- `POST /v1/experiments/{id}/complete` — transition with revision, assessment,
  and `final_checkin_observation_id`.
- `POST`/`DELETE /v1/experiments/{id}/links[/node-id]` — manage a provenance-backed
  evidence link while the experiment is a draft.
- `DELETE /v1/experiments/{id}?revision=N` — soft-delete the aggregate.

Mutations use aggregate revisions and return a conflict rather than silently
overwriting a concurrent change. Deleted experiments and links are retained as
soft-deleted records for auditability.

## Safety boundary

This is self-observation, not medical treatment. Entered medical content is not
interpreted or endorsed. The engine has no extractor or agent path, and all
explanations for linked evidence continue to identify their source observations.
