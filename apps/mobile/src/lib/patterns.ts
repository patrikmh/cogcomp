import type { Pattern, TemporalChange } from "./api";

/**
 * Folds trivial label differences that are not differences — the same rule the
 * backend's `patterns.normalise` applies, mirrored here so a client-side match
 * can only ever group what the server itself would group.
 */
export function normaliseLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").trim();
}

/**
 * The recent shifts that belong in a thread: a change joins when its
 * normalised label equals one of the thread's subjects. The thread claims
 * nothing new by this — the shift keeps its own phrasing and its own screen.
 */
export function shiftsForSubjects(
  changes: readonly TemporalChange[],
  subjects: readonly string[],
): TemporalChange[] {
  const wanted = new Set(subjects.map(normaliseLabel).filter(Boolean));
  if (wanted.size === 0) return [];
  return changes.filter((change) => wanted.has(normaliseLabel(change.label)));
}

/**
 * How a pattern reads, which depends on what found it.
 *
 * The detectors are not interchangeable. Exact-label recurrence counts entries;
 * the lag detector counts occasions where one thing was written before another;
 * the stated-vs-recorded detector rests on an overlap that did *not* happen.
 * Rendering them all as "4 entries" would state something untrue about most.
 *
 * Takes a structural subset rather than a whole Pattern so a thread member —
 * which carries the same counts without being a row on the flat list — reads
 * exactly like its finding does everywhere else.
 */
type PatternCounts = Pick<
  Pattern,
  "id" | "detector" | "confidence" | "occurrences" | "distinct_days"
>;

export function patternMeta(pattern: PatternCounts): string {
  const confidence = `${Math.round(pattern.confidence * 100)}% confident`;
  if (pattern.detector === "lag" || pattern.detector === "same-day-order") {
    return `${count(pattern.occurrences, "time", "times")} in that order · ${confidence}`;
  }
  if (pattern.detector === "stated-vs-recorded") {
    // Its counts are already in the label — two of them, which is the whole
    // claim. Repeating one here as "18 entries" would put a number next to a
    // finding that is about the absence of a number.
    return `Something you name, and something you do · ${confidence}`;
  }
  return (
    `${count(pattern.occurrences, "entry", "entries")} ` +
    `across ${count(pattern.distinct_days, "day", "days")} · ${confidence}`
  );
}

/**
 * Where tapping a pattern goes.
 *
 * An ordered finding owes the person its occasions — two entries and the gap
 * between them — which the generic explain screen cannot show, because it lists
 * every citation flat and drops the order that is the entire claim.
 */
export function patternDestination(
  pattern: Pick<Pattern, "detector" | "id">,
): { href: string; label: string } {
  if (pattern.detector === "lag" || pattern.detector === "same-day-order") {
    return { href: `/pattern/${pattern.id}`, label: "See what came first →" };
  }
  return { href: `/node/${pattern.id}`, label: "Where this came from →" };
}

function count(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}
