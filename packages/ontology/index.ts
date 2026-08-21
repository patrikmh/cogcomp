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
 * The recurrences an act is among, keyed by the act.
 *
 * This is the other half of foldDrawnFrom. A pattern must never appear under
 * "drawn from this" — it is not a reading of one entry. It can appear under
 * "this act is among", because that is a claim about membership, not origin.
 * Order follows the caller's pattern list, so strongest-among-these stays first.
 */
export function amongOf<T extends { id: string }>(
  weeks: { id: string; kind: string; source_observation_ids: string[] }[][],
  patterns: readonly T[],
): Map<string, T[]> {
  const cited = new Map<string, Set<string>>();
  for (const readings of weeks) {
    for (const reading of readings) {
      if (reading.kind !== "Pattern") continue;
      for (const source of reading.source_observation_ids) {
        const ids = cited.get(source) ?? new Set();
        ids.add(reading.id);
        cited.set(source, ids);
      }
    }
  }
  const index = new Map<string, T[]>();
  for (const [source, ids] of cited) {
    const found = patterns.filter((pattern) => ids.has(pattern.id));
    if (found.length > 0) index.set(source, found);
  }
  return index;
}

/**
 * The recurrences a day's material actually belongs to.
 *
 * A pattern listed because it is the strongest in the whole record is not
 * circling this day. Circling is provenance: the pattern cites one of today's
 * observations. The returned list keeps the caller's order — strongest first
 * when the patterns list is already sorted that way.
 */
/** How many prior weeks a first-time word is judged against. A window of one
 *  week makes every word "first time", which names nothing. Matches the API
 *  default on `GET /v1/vocabulary/{week_start}`. */
export const VOCABULARY_LOOKBACK_WEEKS = 8;

/** One word from a week's vocabulary, with whether it is new in the lookback. */
export interface VocabularyMark {
  word: string;
  firstTime: boolean;
}

/**
 * The person's own words for how they felt, with first-time ones named.
 *
 * The vocabulary module's contract is that new words are named, not scored.
 * A count of "3 of them for the first time" withholds the only part someone
 * could go and read. Order follows `words`; labels in `first_time` that are
 * not on that list are ignored, because the list on screen is the checkable one.
 */
export function vocabularyMarks(week: {
  words: readonly string[];
  first_time: readonly string[];
}): VocabularyMark[] {
  const named = new Set(week.first_time);
  return week.words.map((word) => ({ word, firstTime: named.has(word) }));
}

/** Kinds that count as a word for a state. Matches `tlon.vocabulary.FELT_KINDS`:
 *  emotions and needs name what is felt or wanted; thoughts and beliefs are
 *  what someone is thinking about. */
export const FELT_KINDS = ["Emotion", "Need"] as const;

/** The inner record: what was felt, needed, valued, believed, or thought.
 *  Distinct from people, places, and activities, which are what a day did. */
export const INNER_KINDS = ["Thought", "Emotion", "Need", "Value", "Belief"] as const;

export function isInnerKind(kind: string): boolean {
  return (INNER_KINDS as readonly string[]).includes(kind);
}

/** Readings of the inner week. Patterns stay out: they are recurrences, not a
 *  state someone was in. */
export function innerReadingsOf<T extends { kind: string }>(readings: readonly T[]): T[] {
  return readings.filter((reading) => isInnerKind(reading.kind));
}

/** Readings of the outer week: who, where, what was done. Not patterns. */
export function outerReadingsOf<T extends { kind: string }>(readings: readonly T[]): T[] {
  return readings.filter(
    (reading) => reading.kind !== "Pattern" && reading.kind !== "Theme" && !isInnerKind(reading.kind),
  );
}

/**
 * The reading a vocabulary word opens, if this week drew one.
 *
 * A word with no door is a count nobody can check. Only Emotion and Need
 * match — an Activity that happens to share the label is a different claim.
 * When two felt readings share a label, the surer one is the one to open.
 */
export function feltReadingOf<T extends { id: string; kind: string; label: string; confidence?: number | null }>(
  word: string,
  readings: readonly T[],
): T | undefined {
  const needle = word.trim().toLowerCase();
  const felt = new Set<string>(FELT_KINDS);
  let match: T | undefined;
  for (const reading of readings) {
    if (!felt.has(reading.kind)) continue;
    if (reading.label.trim().toLowerCase() !== needle) continue;
    if (!match || (reading.confidence ?? 0) > (match.confidence ?? 0)) match = reading;
  }
  return match;
}

export function circlingOf<T extends { id: string }>(
  inferred: readonly { id: string; kind: string }[],
  patterns: readonly T[],
): T[] {
  const ids = new Set(
    inferred.filter((reading) => reading.kind === "Pattern").map((reading) => reading.id),
  );
  return patterns.filter((pattern) => ids.has(pattern.id));
}

/** Recurrences a reading is among.
 *
 *  SUPPORTS runs from the reading to the pattern, so the pattern appears as a
 *  neighbour rather than as something "drawn from" the reading. Same matching
 *  as circlingOf; a different claim — membership, not a day's provenance. */
export function amongReadingsOf<T extends { id: string }>(
  neighbours: readonly { id: string; kind: string }[],
  patterns: readonly T[],
): T[] {
  return circlingOf(neighbours, patterns);
}

/** The regions a day's or week's material actually sits in.
 *
 *  Same provenance rule as circlingOf: a theme listed because it is in the
 *  whole record is not this period's region. Theme nodes inherit the entries
 *  their members cite, so they appear on the inferred list only when those
 *  members do. */
export function circlingThemesOf<T extends { id: string }>(
  inferred: readonly { id: string; kind: string }[],
  themes: readonly T[],
): T[] {
  const ids = new Set(
    inferred.filter((reading) => reading.kind === "Theme").map((reading) => reading.id),
  );
  return themes.filter((theme) => ids.has(theme.id));
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
