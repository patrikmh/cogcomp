import type { Pattern } from "./api";

/**
 * How a pattern reads, which depends on what found it.
 *
 * The detectors are not interchangeable. Exact-label recurrence counts entries;
 * the lag detector counts occasions where one thing was written before another;
 * the stated-vs-recorded detector rests on an overlap that did *not* happen.
 * Rendering them all as "4 entries" would state something untrue about most.
 */
export function patternMeta(pattern: Pattern): string {
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
export function patternDestination(pattern: Pattern): { href: string; label: string } {
  if (pattern.detector === "lag") {
    return { href: `/pattern/${pattern.id}`, label: "See what came first →" };
  }
  return { href: `/node/${pattern.id}`, label: "Where this came from →" };
}

function count(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}
