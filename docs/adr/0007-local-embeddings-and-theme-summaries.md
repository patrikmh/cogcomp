# ADR-0007: Local embeddings for semantic search, model-written theme summaries

- Status: Accepted
- Date: 2026-08-25

## Context

PROGRESS.md names four semantic graph features as disabled pending "a real
embedder/model and a separate safety decision": search reranking, semantic
deduplication, generated theme summaries, and meaning-based search. Each is a
different decision wearing the same label, and they do not stand or fall
together.

The graph stack was built anticipating this day. `graphiti_client.py` ships a
`DeterministicEmbedder` — a SHAKE-256 hash standing in for a learned model,
384 dimensions, "so a later switch to a real embedder does not require
rewriting what is already stored". `RefusingLLMClient` and
`RefusingCrossEncoder` block Graphiti's own LLM paths by raising, and
projection refuses Graphiti's `add_triplet` because its semantic node merging
"rewrites what someone said".

Meanwhile extraction already sends every entry's full text to a hosted model.
That disclosure sits on the login screen. The question is therefore not
whether words reach a model, but whether *search* needs them to reach one, and
what a model may be allowed to write.

## Decision

**1. The embedder runs locally, inside the API server.** Semantic search uses
`fastembed` (ONNX runtime, no PyTorch) with `BAAI/bge-small-en-v1.5` — 384
dimensions, exactly the width the projection was designed around. Entry text
embedded for search never leaves the server. No new credential exists to leak,
rotate, or misroute; the deployment gains ~100 MB of model weights instead of
a third-party data flow.

`fastembed` is an optional dependency (`embeddings` extra). The provider is
chosen by configuration (`EMBEDDING_PROVIDER=deterministic|local`, default
deterministic), mirroring how the stub transcriber and stub extractor work:
the pipeline stays runnable everywhere, and choosing the real thing is an
explicit act. Configuring `local` without the extra installed fails loudly at
startup rather than falling back silently — a search that quietly stopped
being semantic looks healthy in every other respect.

**2. Theme summaries are written by the existing chat model, from member
labels only.** After a themes run holds a region ("work, dread and 2 more"),
one short sentence describing what the members share is generated through the
same OpenRouter path extraction uses. Two constraints hold it down:

- **Labels only, never entries.** The prompt receives the theme's member
  labels — already-derived single words — not journal text. The summary can
  reveal nothing the theme's own heading does not.
- **Marked as written, kept provisional.** A summary carries its generator
  (`summary_model`) beside it, renders as a sentence beneath the honest
  membership label rather than replacing it, and can be deleted without
  touching the cluster. The membership list remains the finding; the sentence
  is a lens on it.

**3. Semantic deduplication stays refused.** Over-merging rewrites what
someone said, and no embedding similarity threshold changes that. If near-
duplicate readings ever need surfacing, they will be *suggested* to the person
for judgment, never merged silently. Not built here.

**4. Reranking stays refused.** A cross-encoder over private text buys
relevance polish the local bi-encoder mostly delivers for a reading-only
journal. `RefusingCrossEncoder` remains.

**5. Switching embedders re-embeds everything, safely.** FalkorDB holds the
projection with no disk by design; `themes_agent` rebuilds it from Postgres on
every run. Flipping `EMBEDDING_PROVIDER` therefore self-heals within a daily
cycle, with no migration: vectors are derived data, never source.

## Consequences

- Search can rank by meaning while entry text stays server-side; the client
  search screens gain a clearly-labelled "close in meaning" section beside
  their literal match list, which keeps saying "Nothing was ranked or
  guessed" about itself.
- The Docker image grows by roughly the ONNX runtime plus model weights.
- First boot (or first themes run) after enabling `local` downloads the model
  once into the container layer; cold starts read it from disk.
- Deterministic-mode deployments keep working unchanged: tests, CI, and any
  installation that never opts in never touch fastembed.
- Theme summaries add one chat call per changed theme per run — bounded by
  theme count, not entry count.
