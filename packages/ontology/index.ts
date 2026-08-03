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
