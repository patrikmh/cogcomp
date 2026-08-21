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
 * Patterns and themes are excluded, and that is the whole point of this being a
 * function with a name. Both are findings *across* acts — they cite many entries
 * and mean nothing about any one of them. Listing either under a single entry
 * beside the words "drawn from this" claims something the record does not
 * support, and it is the kind of claim this app exists not to make.
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
      if (reading.kind === "Pattern" || reading.kind === "Theme") continue;
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

/** What a set of acts gathered, in the order those acts were kept.
 *
 *  A conversation becomes several entries. Folding them back into one walk
 *  is how talking-it-through can lead somewhere instead of ending on a count
 *  of turns. Duplicates stay out: the same need named in two turns is one door. */
export function gatheredOf<T extends { id: string }>(
  observationIds: readonly string[],
  index: ReadonlyMap<string, readonly T[]>,
): T[] {
  const seen = new Set<string>();
  const gathered: T[] = [];
  for (const observationId of observationIds) {
    for (const item of index.get(observationId) ?? []) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      gathered.push(item);
    }
  }
  return gathered;
}

/**
 * The recurrences an act is among, keyed by the act.
 *
 * This is the other half of foldDrawnFrom. A pattern must never appear under
 * "drawn from this" — it is not a reading of one entry. It can appear under
 * "this act is among", because that is a claim about membership, not origin.
 * Order follows the caller's pattern list, so strongest-among-these stays first.
 */
function amongKindOf<T extends { id: string }>(
  weeks: { id: string; kind: string; source_observation_ids: string[] }[][],
  items: readonly T[],
  kind: string,
): Map<string, T[]> {
  const cited = new Map<string, Set<string>>();
  for (const readings of weeks) {
    for (const reading of readings) {
      if (reading.kind !== kind) continue;
      for (const source of reading.source_observation_ids) {
        const ids = cited.get(source) ?? new Set();
        ids.add(reading.id);
        cited.set(source, ids);
      }
    }
  }
  const index = new Map<string, T[]>();
  for (const [source, ids] of cited) {
    const found = items.filter((item) => ids.has(item.id));
    if (found.length > 0) index.set(source, found);
  }
  return index;
}

export function amongOf<T extends { id: string }>(
  weeks: { id: string; kind: string; source_observation_ids: string[] }[][],
  patterns: readonly T[],
): Map<string, T[]> {
  return amongKindOf(weeks, patterns, "Pattern");
}

/** Regions an act sits in. Same membership rule as amongOf, for Theme nodes. */
export function amongThemesOf<T extends { id: string }>(
  weeks: { id: string; kind: string; source_observation_ids: string[] }[][],
  themes: readonly T[],
): Map<string, T[]> {
  return amongKindOf(weeks, themes, "Theme");
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

/** Felt and thought before people, places, and acts; surest first inside each.
 *
 *  Extraction is surest about the most literal things. Sorting identity or a
 *  week's readings by confidence alone fills the picture with coffee and stairs
 *  and leaves the inner record outside the frame. */
export function innerFirst<
  T extends { kind: string; confidence?: number | null },
>(left: T, right: T): number {
  const innerLeft = isInnerKind(left.kind) ? 0 : 1;
  const innerRight = isInnerKind(right.kind) ? 0 : 1;
  if (innerLeft !== innerRight) return innerLeft - innerRight;
  return (right.confidence ?? 0) - (left.confidence ?? 0);
}

/** Readings of the inner week. Patterns stay out: they are recurrences, not a
 *  state someone was in. */
export function innerReadingsOf<T extends { kind: string }>(readings: readonly T[]): T[] {
  return readings.filter((reading) => isInnerKind(reading.kind));
}

/** Inner readings the record named with this exact word.
 *
 *  Search stays a substring over the person's sentences. This is the other
 *  door: they asked for a word they remember, and the extractor used that
 *  same word for a feeling, a need, a value, a belief, or a thought. An act
 *  named rest is not this claim. Order is surest first. */
export function namedInnerOf<
  T extends {
    id: string;
    kind: string;
    label: string;
    confidence?: number | null;
    tentative?: boolean;
  },
>(needle: string, readings: readonly T[]): T[] {
  const wanted = needle.trim().toLowerCase();
  if (!wanted) return [];
  return readings
    .filter(
      (reading) =>
        isInnerKind(reading.kind) && reading.label.trim().toLowerCase() === wanted,
    )
    .slice()
    .sort(innerFirst);
}

/** Readings of the outer week: who, where, what was done. Not patterns. */
export function outerReadingsOf<T extends { kind: string }>(readings: readonly T[]): T[] {
  return readings.filter(
    (reading) => reading.kind !== "Pattern" && reading.kind !== "Theme" && !isInnerKind(reading.kind),
  );
}

/** How often a reading returned in this window. A week uses days; a day uses acts. */
function returningCount(reading: { cites_days?: number; cites_entries?: number }): number {
  return reading.cites_days ?? reading.cites_entries ?? 0;
}

/** Inner readings that came back in this window.
 *
 *  The daily and weekly recurring lists only name people, places, acts, and
 *  events. A need that returned on four days is then just another item under
 *  felt and thought — the hidden pattern is the return itself. Two days, or
 *  two acts on a day that has no day-count, is the bar; order is most often
 *  first, then the inner-first rule. */
export function returningInnerOf<
  T extends {
    kind: string;
    confidence?: number | null;
    cites_days?: number;
    cites_entries?: number;
  },
>(readings: readonly T[]): T[] {
  return readings
    .filter((reading) => isInnerKind(reading.kind) && returningCount(reading) >= 2)
    .slice()
    .sort((left, right) => {
      const delta = returningCount(right) - returningCount(left);
      return delta !== 0 ? delta : innerFirst(left, right);
    });
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

/** The stored reading a change names, if the graph still holds it.
 *
 *  A temporal change is derived and has no id of its own. Matching kind and
 *  label is how it becomes something you can open rather than a count you can
 *  only read. An Activity that happens to share a Need's label is a different
 *  claim; when two readings share both, the surer one is the door. */
export function namedReadingOf<
  T extends { id: string; kind: string; label: string; confidence?: number | null },
>(kind: string, label: string, readings: readonly T[]): T | undefined {
  const wantedKind = kind.trim();
  const wantedLabel = label.trim().toLowerCase();
  if (!wantedKind || !wantedLabel) return undefined;
  let match: T | undefined;
  for (const reading of readings) {
    if (reading.kind !== wantedKind) continue;
    if (reading.label.trim().toLowerCase() !== wantedLabel) continue;
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

/** A region's members, walked as two rooms.
 *
 *  The inner room is what was felt, needed, valued, believed, or thought. The
 *  outer room is who, where, and what was done. Mixed together they read as
 *  one category the app invented; apart, the region is a place that can be
 *  entered from either side. Order is the caller's. */
export function themeMembersOf<T extends { kind: string }>(members: readonly T[]): {
  inside: T[];
  around: T[];
} {
  return {
    inside: members.filter((member) => isInnerKind(member.kind)),
    around: members.filter((member) => !isInnerKind(member.kind)),
  };
}

/** What moved, walked as two rooms.
 *
 *  A change in rest and a change in coffee are not the same kind of movement.
 *  Mixed they read as one weather report; apart, the inner week can be walked
 *  without the café. Patterns and regions stay out — they have their own doors.
 *  Order is the caller's. */
export function changesOf<T extends { kind: string }>(changes: readonly T[]): {
  inside: T[];
  around: T[];
} {
  return {
    inside: changes.filter((change) => isInnerKind(change.kind)),
    around: changes.filter(
      (change) =>
        change.kind !== "Pattern" && change.kind !== "Theme" && !isInnerKind(change.kind),
    ),
  };
}

/** Matches `tlon.tension.STATED_KINDS`. Beliefs stay out: "I am bad at this"
 *  is not an intention. */
export const STATED_KINDS = ["Value", "Need"] as const;

/** Matches `tlon.tension.RECORDED_KINDS`. */
export const RECORDED_KINDS = ["Activity"] as const;

/** The two sides of a stated-vs-recorded finding.
 *
 *  Neighbours of that pattern are the value or need that was named and the
 *  activity that was recorded. Mixed under "what it is made of" they read as
 *  parts of one thing; apart, they are the gap the detector actually found.
 *  Emotion, thought, and people stay out — they are not this claim. Order is
 *  the caller's. */
export function apartSidesOf<T extends { kind: string }>(neighbours: readonly T[]): {
  named: T[];
  done: T[];
} {
  const named = new Set<string>(STATED_KINDS);
  const done = new Set<string>(RECORDED_KINDS);
  return {
    named: neighbours.filter((neighbour) => named.has(neighbour.kind)),
    done: neighbours.filter((neighbour) => done.has(neighbour.kind)),
  };
}

/** The target of a feeling, and the feelings aimed at this reading.
 *
 *  Only `FELT_TOWARD`. Co-occurrence is companionship; about is subject matter;
 *  triggered-by is a causal hypothesis this UI must not launder. Direction is
 *  the claim: Emotion → person, place, activity, or event. Patterns, themes,
 *  and observations stay out. Order is the neighbour list's. */
export function feltTowardOf<T extends { id: string; kind: string }>(
  nodeId: string,
  neighbours: readonly T[],
  edges: readonly { from_id: string; to_id: string; kind: string }[],
): { toward: T[]; from: T[] } {
  const towardIds = new Set<string>();
  const fromIds = new Set<string>();
  for (const edge of edges) {
    if (edge.kind !== "FELT_TOWARD") continue;
    if (edge.from_id === nodeId) towardIds.add(edge.to_id);
    if (edge.to_id === nodeId) fromIds.add(edge.from_id);
  }
  return {
    toward: keepDirected(neighbours, towardIds),
    from: keepDirected(neighbours, fromIds),
  };
}

/** What a thought or feeling is about, and what is about this reading.
 *
 *  Only `ABOUT`. Felt-toward is a direction of feeling; this is subject matter.
 *  Triggered-by stays out — a cause is not a topic. Patterns, themes, and
 *  observations stay out. Order is the neighbour list's. */
export function aboutOf<T extends { id: string; kind: string }>(
  nodeId: string,
  neighbours: readonly T[],
  edges: readonly { from_id: string; to_id: string; kind: string }[],
): { about: T[]; aboutThis: T[] } {
  const aboutIds = new Set<string>();
  const aboutThisIds = new Set<string>();
  for (const edge of edges) {
    if (edge.kind !== "ABOUT") continue;
    if (edge.from_id === nodeId) aboutIds.add(edge.to_id);
    if (edge.to_id === nodeId) aboutThisIds.add(edge.from_id);
  }
  return {
    about: keepDirected(neighbours, aboutIds),
    aboutThis: keepDirected(neighbours, aboutThisIds),
  };
}

/** Matches extractable `INDICATES`: a thought or feeling may name a need or value. */
export const INDICATING_KINDS = ["Thought", "Emotion"] as const;
export const INDICATED_KINDS = ["Need", "Value"] as const;

/** What a thought or feeling hints at, and what hints at this need or value.
 *
 *  Only `INDICATES`, and only the kinds that edge is allowed to join. A cause
 *  is TRIGGERED_BY and stays out. A subject is ABOUT. A direction of feeling
 *  is FELT_TOWARD. This is a hint someone wrote toward, never a diagnosis.
 *  Order is the neighbour list's. */
export function indicatesOf<T extends { id: string; kind: string }>(
  nodeId: string,
  neighbours: readonly T[],
  edges: readonly { from_id: string; to_id: string; kind: string }[],
): { hints: T[]; hinted: T[] } {
  const hintIds = new Set<string>();
  const hintedIds = new Set<string>();
  for (const edge of edges) {
    if (edge.kind !== "INDICATES") continue;
    if (edge.from_id === nodeId) hintIds.add(edge.to_id);
    if (edge.to_id === nodeId) hintedIds.add(edge.from_id);
  }
  const indicated = new Set<string>(INDICATED_KINDS);
  const indicating = new Set<string>(INDICATING_KINDS);
  return {
    hints: keepDirected(neighbours, hintIds).filter((neighbour) => indicated.has(neighbour.kind)),
    hinted: keepDirected(neighbours, hintedIds).filter((neighbour) =>
      indicating.has(neighbour.kind),
    ),
  };
}

/** Matches extractable `CONTRADICTS`: a thought may sit against a belief or a pattern. */
export const CONTRADICTING_KINDS = ["Thought"] as const;
export const CONTRADICTED_KINDS = ["Belief", "Pattern"] as const;

/** What a thought sits against, and what sits against this belief or pattern.
 *
 *  Only `CONTRADICTS`, and only those kinds. An observation is evidence, not a
 *  second thought. Support is a different claim. This is tension in the record,
 *  never a verdict on the person. Order is the neighbour list's. */
export function contradictsOf<T extends { id: string; kind: string }>(
  nodeId: string,
  neighbours: readonly T[],
  edges: readonly { from_id: string; to_id: string; kind: string }[],
): { against: T[]; againstThis: T[] } {
  const againstIds = new Set<string>();
  const againstThisIds = new Set<string>();
  for (const edge of edges) {
    if (edge.kind !== "CONTRADICTS") continue;
    if (edge.from_id === nodeId) againstIds.add(edge.to_id);
    if (edge.to_id === nodeId) againstThisIds.add(edge.from_id);
  }
  const contradicted = new Set<string>(CONTRADICTED_KINDS);
  const contradicting = new Set<string>(CONTRADICTING_KINDS);
  return {
    against: neighbours.filter(
      (neighbour) => againstIds.has(neighbour.id) && contradicted.has(neighbour.kind),
    ),
    againstThis: neighbours.filter(
      (neighbour) => againstThisIds.has(neighbour.id) && contradicting.has(neighbour.kind),
    ),
  };
}

function keepDirected<T extends { id: string; kind: string }>(
  neighbours: readonly T[],
  ids: Set<string>,
): T[] {
  return neighbours.filter(
    (neighbour) =>
      ids.has(neighbour.id) &&
      neighbour.kind !== "Pattern" &&
      neighbour.kind !== "Theme" &&
      neighbour.kind !== "Observation",
  );
}

/** What keeps arriving with this reading.
 *
 *  Only `CO_OCCURS_WITH`. Triggered-by, about, and supports are different
 *  claims — one of them is causal, one is topical, one is a recurrence — and
 *  mixing them under "travels with" would dress those up as companionship.
 *  Patterns, themes, and observations stay out: those have their own doors. */
export function travelsWithOf<T extends { id: string; kind: string }>(
  nodeId: string,
  neighbours: readonly T[],
  edges: readonly { from_id: string; to_id: string; kind: string }[],
): T[] {
  const partners = new Set<string>();
  for (const edge of edges) {
    if (edge.kind !== "CO_OCCURS_WITH") continue;
    if (edge.from_id === nodeId) partners.add(edge.to_id);
    else if (edge.to_id === nodeId) partners.add(edge.from_id);
  }
  return neighbours.filter(
    (neighbour) =>
      partners.has(neighbour.id) &&
      neighbour.kind !== "Pattern" &&
      neighbour.kind !== "Theme" &&
      neighbour.kind !== "Observation",
  );
}

/** Regions a reading belongs to, by the member names the region is honest about.
 *
 *  The list endpoint does not send member ids, so this matches the reading's
 *  label against those names. Same identity the detectors use: the word, not
 *  a generated heading. A stronger region that does not list this word is not
 *  claimed. Order is the caller's. */
/** Monday-first counts of when something landed.
 *
 *  A weekday finding is a shape in the calendar. A sentence that says "Thursdays"
 *  is not checkable unless the week itself is visible. Date-only strings are
 *  calendar days; instants use this clock. */
export const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function weekdayShapeOf(instants: readonly string[]): {
  weekday: (typeof WEEKDAY_NAMES)[number];
  count: number;
}[] {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const instant of instants) {
    const index = weekdayIndex(instant);
    if (index !== null) counts[index] = (counts[index] ?? 0) + 1;
  }
  return WEEKDAY_NAMES.map((weekday, i) => ({ weekday, count: counts[i]! }));
}

function weekdayIndex(instant: string): number | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(instant)) {
    const [year, month, day] = instant.split("-").map(Number);
    const date = new Date(year!, month! - 1, day!, 12);
    if (Number.isNaN(date.getTime())) return null;
    return (date.getDay() + 6) % 7;
  }
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  return (date.getDay() + 6) % 7;
}

export function regionsOfReading<T extends { members: readonly string[] }>(
  label: string,
  themes: readonly T[],
): T[] {
  const needle = label.trim().toLowerCase();
  if (!needle) return [];
  return themes.filter((theme) =>
    theme.members.some((member) => member.trim().toLowerCase() === needle),
  );
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
  /** `sameday.MIN_MATCH_WEEKS` — a within-day ordering needs three as well. */
  sameDayWeeks: 3,
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
 * The five detectors, and where each one stands for this person.
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
      name: "Ordering, within a day",
      needs: "two things in the same day, across three weeks",
      standing: has("same-day-order") ? "found" : weekCount,
      ready: has("same-day-order") || input.weeks >= t.sameDayWeeks,
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
