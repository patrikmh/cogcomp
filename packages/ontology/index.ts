// Graph schema v0.1. See README.md for the reasoning behind these kinds.

export const OBSERVED_NODE_KINDS = ["Observation"] as const;

export const INFERRED_NODE_KINDS = [
  "Thought",
  "Emotion",
  "Need",
  "Value",
  "Belief",
  "Person",
  "Place",
  "Activity",
  "Event",
  "Pattern",
  "Theme",
] as const;

export const EDGE_KINDS = [
  "DERIVED_FROM",
  "EXPRESSES",
  "ABOUT",
  "FELT_TOWARD",
  "TRIGGERED_BY",
  "SUPPORTS",
  "CONTRADICTS",
  "INDICATES",
  "CO_OCCURS_WITH",
  "RELATES_TO",
] as const;

export const EPISTEMIC_STATUSES = [
  "hypothesis",
  "user_confirmed",
  "user_rejected",
] as const;

export type ObservedNodeKind = (typeof OBSERVED_NODE_KINDS)[number];
export type InferredNodeKind = (typeof INFERRED_NODE_KINDS)[number];
export type NodeKind = ObservedNodeKind | InferredNodeKind;
export type EdgeKind = (typeof EDGE_KINDS)[number];
export type EpistemicStatus = (typeof EPISTEMIC_STATUSES)[number];

/** Below this, the UI renders a node as tentative rather than as knowledge. */
export const TENTATIVE_CONFIDENCE_THRESHOLD = 0.5;

/**
 * Attached to every inferred node and every edge. There is no constructor that
 * omits it — an inference you cannot explain is one you should not have stored.
 */
export interface Inference {
  confidence: number;
  epistemicStatus: EpistemicStatus;
  /** Name and version of the producing model or rule, e.g. "extract-v0.1/claude-opus-5". */
  extractor: string;
  /** Observation ids this was derived from. Never empty. */
  provenance: string[];
}

export interface BaseNode {
  id: string;
  userId: string;
  kind: NodeKind;
  createdAt: string;
  deletedAt?: string | null;
}

export interface ObservationNode extends BaseNode {
  kind: "Observation";
  content: string;
  source: "text" | "voice";
  capturedAt: string;
}

export interface InferredNode extends BaseNode, Inference {
  kind: InferredNodeKind;
  label: string;
}

export type GraphNode = ObservationNode | InferredNode;

export interface GraphEdge extends Inference {
  id: string;
  userId: string;
  kind: EdgeKind;
  fromId: string;
  toId: string;
  /** Required when kind is RELATES_TO. */
  note?: string | null;
  createdAt: string;
}

export function isInferred(node: GraphNode): node is InferredNode {
  return node.kind !== "Observation";
}

export function isTentative(inference: Inference): boolean {
  return inference.confidence < TENTATIVE_CONFIDENCE_THRESHOLD;
}

/** One reading, as it appears beside the act it was drawn from. */
export interface Drawn {
  id: string;
  label: string;
  confidence: number;
  tentative: boolean;
}

/**
 * Fold weekly readings into an index of act → what it left behind.
 *
 * Patterns are excluded, and that is the whole point of this being a function
 * with a name. A pattern is a finding *across* acts — it cites many entries and
 * means nothing about any one of them. Listing it under a single entry beside
 * the words "drawn from this" claims something the record does not support, and
 * it is the kind of claim this app exists not to make.
 *
 * It lives here rather than in either client because both clients show these
 * chips, and the exclusion is a statement about the graph rather than about a
 * screen. A second copy is a second place for a Pattern to leak into a claim
 * about one entry.
 */
export function foldDrawnFrom(
  weeks: {
    id: string;
    kind: string;
    label: string;
    confidence: number;
    tentative: boolean;
    source_observation_ids: string[];
  }[][],
): Map<string, Drawn[]> {
  const index = new Map<string, Drawn[]>();
  for (const readings of weeks) {
    for (const reading of readings) {
      if (reading.kind === "Pattern") continue;
      for (const source of reading.source_observation_ids) {
        const list = index.get(source) ?? [];
        if (!list.some((r) => r.id === reading.id)) {
          list.push({
            id: reading.id,
            label: reading.label,
            confidence: reading.confidence,
            tentative: reading.tentative,
          });
        }
        index.set(source, list);
      }
    }
  }
  return index;
}

/**
 * What each detector is waiting for, before it can find anything.
 *
 * These numbers are the backend's thresholds, not round ones chosen to look
 * tidy, and `scripts/check_ontology_sync.py` asserts they still match the Python
 * they are copied from. Without that check this is a screen that confidently
 * tells someone they need four weeks when the detector wants five — the same
 * failure mode as a stale privacy page, and harder to notice.
 */
export const DETECTOR_THRESHOLDS = {
  /** `patterns.MIN_DISTINCT_DAYS` — the same thing on two different days. */
  recurrenceDays: 2,
  /** `periodicity.MIN_DISTINCT_WEEKS` — a weekday shape needs four weeks. */
  calendarWeeks: 4,
  /** `lag.MIN_MATCH_WEEKS` — an ordering needs three. */
  orderingWeeks: 3,
  /** `tension.MIN_OBSERVED_DAYS` — ten days before stated is compared to done. */
  tensionDays: 10,
} as const;

export interface DetectorWait {
  name: string;
  needs: string;
  standing: string;
  ready: boolean;
}

/**
 * The four detectors, and where each one stands for this person.
 *
 * Shared because both clients show it and it is arithmetic over thresholds
 * rather than layout. Stated-vs-recorded is never "ready" on a day count alone:
 * it also needs an intention the person actually stated, which no counter can
 * see. Claiming otherwise would be the app promising a finding it has no way to
 * know is coming.
 */
export function detectorsWaiting(input: {
  days: number;
  weeks: number;
  found: string[];
}): DetectorWait[] {
  const has = (detector: string) => input.found.includes(detector);
  const t = DETECTOR_THRESHOLDS;
  const dayCount = `you have written on ${input.days} ${input.days === 1 ? "day" : "days"}`;
  const weekCount = `you have ${input.weeks} ${input.weeks === 1 ? "week" : "weeks"}`;

  return [
    {
      name: "Recurrence",
      needs: "the same thing written on two different days",
      standing: has("exact-label") ? "found" : dayCount,
      ready: has("exact-label") || input.days >= t.recurrenceDays,
    },
    {
      name: "Calendar shape",
      needs: "writing in four different weeks",
      standing: has("weekday") ? "found" : weekCount,
      ready: has("weekday") || input.weeks >= t.calendarWeeks,
    },
    {
      name: "Ordering",
      needs: "two things recorded apart, across three weeks",
      standing: has("lag") ? "found" : weekCount,
      ready: has("lag") || input.weeks >= t.orderingWeeks,
    },
    {
      name: "Stated vs recorded",
      needs: "something you said you would do, and ten days to check it against",
      standing: has("stated-vs-recorded")
        ? "found"
        : input.days >= t.tensionDays
          ? "waiting on something you said you would do"
          : dayCount,
      ready: has("stated-vs-recorded"),
    },
  ];
}
