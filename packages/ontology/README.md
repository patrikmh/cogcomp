# Graph Schema v0.1

The ontology is the contract between extraction, persistence, and explanation.
If a node cannot be explained, it does not belong in the graph.

## The two-tier rule

Every node is either **observed** or **inferred**. There is no third category.

- **Observed** nodes are raw user input. Exactly one kind: `Observation`. Immutable
  once written. Never produced by a model. These are the roots of all provenance.
- **Inferred** nodes are everything else. Each one is a *hypothesis* about the user,
  produced by a model from one or more observations. Each carries confidence and
  points back at the observations that produced it.

The consequence: from any inferred node you can always answer "why do you think this?"
by walking `DERIVED_FROM` edges back to the user's own words. This is not a nice-to-have.
A node with no path to an `Observation` is a bug, and the schema is built so that such
a node cannot be constructed.

## Node kinds

### Observed

| Kind | Meaning |
|---|---|
| `Observation` | A single captured journal entry — text typed, or voice transcribed. Carries the raw content and capture metadata. |

### Inferred

| Kind | Meaning | Example |
|---|---|---|
| `Thought` | A discrete proposition the user expressed. | "I'll never finish this project" |
| `Emotion` | An affective state, with valence and intensity. | anxiety, intensity 0.7 |
| `Need` | An underlying need surfacing in the material. | rest, autonomy, connection |
| `Value` | Something the user treats as mattering. | honesty, craftsmanship |
| `Belief` | A durable generalization the user holds. | "asking for help is weakness" |
| `Person` | A person referenced. | a named colleague |
| `Place` | A location referenced. | the office |
| `Activity` | Something the user does. | running, code review |
| `Event` | A bounded occurrence in time. | a specific argument on a specific day |
| `Pattern` | A recurring structure across observations. Milestone 2. | "sleep debt precedes self-criticism" |

`Pattern` is defined now because edges reference it, but nothing produces `Pattern`
nodes in Milestone 1.

## Edge kinds

| Kind | From → To | Meaning |
|---|---|---|
| `DERIVED_FROM` | any inferred → `Observation` | Provenance. Mandatory, at least one per inferred node. |
| `EXPRESSES` | `Observation` → `Thought` \| `Emotion` | The observation voiced this. |
| `ABOUT` | `Thought` \| `Emotion` \| `Event` → `Person` \| `Place` \| `Activity` \| `Event` | Subject matter. |
| `FELT_TOWARD` | `Emotion` → `Person` \| `Place` \| `Activity` \| `Event` | Target of an affective state. |
| `TRIGGERED_BY` | `Emotion` \| `Thought` → `Event` \| `Activity` \| `Thought` | Hypothesized antecedent. |
| `SUPPORTS` | `Observation` \| `Thought` → `Belief` \| `Pattern` | Evidence for. |
| `CONTRADICTS` | `Observation` \| `Thought` → `Belief` \| `Pattern` | Evidence against. |
| `INDICATES` | `Thought` \| `Emotion` → `Need` \| `Value` | Hypothesized underlying driver. |
| `CO_OCCURS_WITH` | any inferred → any inferred | Statistical adjacency, no causal claim. Milestone 2. |
| `RELATES_TO` | any → any | Escape hatch. Requires a `note`. Use sparingly; a graph full of `RELATES_TO` is an ontology that needs extending. |

`TRIGGERED_BY` is the most dangerous edge in the schema — it encodes a causal claim
from correlational evidence. It is always a hypothesis, and the UI must never render
it as established fact.

## Required properties

Every node:

| Property | Type | Notes |
|---|---|---|
| `id` | UUIDv7 | Client-generated for observations, server-generated for inferred nodes. Time-ordered. |
| `user_id` | UUID | Every node is user-scoped. No cross-user traversal, ever. |
| `kind` | enum | From the tables above. |
| `created_at` | timestamptz | |
| `deleted_at` | timestamptz? | Soft delete. Tombstones replicate through sync. |

Every **inferred** node additionally:

| Property | Type | Notes |
|---|---|---|
| `confidence` | float 0.0–1.0 | The extractor's calibrated confidence. Never omitted, never defaulted to 1.0. |
| `epistemic_status` | enum | `hypothesis` \| `user_confirmed` \| `user_rejected`. Defaults to `hypothesis`. Only the user can move it. |
| `extractor` | string | Name and version of the producing model or rule, e.g. `extract-v0.1/claude-opus-5`. Makes bad batches identifiable and revocable. |
| `provenance` | UUID[] | Non-empty. Observation ids this node was derived from. |

Every **edge** carries `confidence`, `extractor`, and `provenance` on the same terms.
An edge is an inference too.

## Confidence

Confidence is the extractor's own calibrated estimate, not a similarity score and not
a post-hoc rationalization. Three rules:

1. **Never default.** A missing confidence is an error, not a `1.0`.
2. **Never multiply up.** When a node is derived from another inferred node, its
   confidence cannot exceed the minimum of its inputs.
3. **Surface it.** Anything below `0.5` renders as tentative in the UI, or not at all.
   The user should never meet a low-confidence guess presented as knowledge.

## What this schema refuses to represent

There are no diagnostic categories. No `Disorder`, no `Symptom`, no severity scales,
no screening instrument scores. This is a deliberate structural constraint rather than
a policy note: the vocabulary needed to accidentally imply a diagnosis is simply absent,
so extraction cannot emit one and the UI cannot render one.

The nearest legitimate representations are `Pattern` (a recurring structure, described
in the user's own terms) and `Emotion` (a state at a moment, not a trait). Neither
aggregates into a label about the person.

## Versioning

This is `v0.1`. Node and edge kinds are additive-only within a major version. Removing
or narrowing a kind requires an ADR and a migration that rewrites affected nodes rather
than dropping them — historical inferences stay interpretable under the schema that
produced them, which is what `extractor` is for.
