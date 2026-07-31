# Tlön – Claude Code Development Specification

> **Status: original mission document, not a live description of the build.**
> This file is the spec Tlön was originally commissioned against. The stack section
> below names Rust and PydanticAI-adjacent choices that were superseded during
> Milestone 1 — see `docs/adr/0001-stack-and-monorepo.md` and
> `docs/adr/0002-python-langgraph-openrouter.md` for what actually shipped and why.
> The **Guiding Principles**, **Milestones**, and **Definition of Done** sections
> remain authoritative; only the **Tech Stack** section has drifted.

## Mission
Build Tlön: a privacy-first Cognitive Operating System that improves mental health one thought at a time.

## Read First
This specification assumes the accompanying Product Specification bundle:
- README.md
- Chapter_01_Vision.md
- Chapter_02_Cognitive_Architecture.md
- Chapter_03_Cognitive_Pipeline.md
- Chapter_04_Observability.md
- Chapter_05_Agent_Architecture.md

## Guiding Principles
- Do not optimize for engagement.
- Optimize for user understanding, agency, and safety.
- Every inference must be explainable.
- Preserve provenance.
- Treat all psychological inferences as hypotheses.
- Never diagnose.

## Tech Stack (initial)
Frontend:
- React Native (Expo initially)
- TypeScript
- Zustand
- React Query
- React Native Skia

Backend:
- Rust
- Axum
- Tokio
- SQLx
- PostgreSQL
- FalkorDB (evaluate against Memgraph/Neo4j)
- Qdrant (optional if graph vectors insufficient)
- Temporal.io
- OpenTelemetry

AI
- Structured extraction model
- Embedding model
- Cross-encoder reranker
- Frontier reasoning model
- JSON-schema outputs

## Monorepo

/apps/mobile
/apps/backend
/packages/ontology
/packages/prompts
/packages/shared
/infrastructure
/docs
/benchmarks

## Milestone 1 (MVP)
1. Authentication
2. Voice journal
3. Text journal
4. Observation pipeline
5. Graph persistence
6. Daily summary
7. Interactive dashboard
8. Graph explorer

## Milestone 2
- Memory consolidation
- Pattern mining
- Identity graph
- Weekly reports
- Experiment engine

## Milestone 3
- Multi-agent system
- Observability engine
- Temporal graph reasoning
- Digital twin prototype

## Coding Standards
- Strong typing.
- Test-first for graph algorithms.
- Architecture Decision Records for major changes.
- Small composable services.
- No hidden prompts.
- Every AI output validated against schema.

## Definition of Done
Features are complete only if:
- Unit tests pass.
- Explainability is available.
- Confidence scores included.
- Provenance retained.
- Safety review completed.
- Documentation updated.

## First Tasks
1. Scaffold monorepo.
2. Docker compose for Postgres + FalkorDB.
3. Rust backend skeleton.
4. React Native app shell.
5. Observation API.
6. Graph schema v0.1.
7. Voice recording.
8. Daily report placeholder.
9. CI/CD.
10. Benchmarks.

This document should evolve alongside the Product Specification and never diverge from it.
