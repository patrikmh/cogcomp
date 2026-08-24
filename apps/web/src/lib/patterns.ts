import type { Pattern, TemporalChange } from "./api";

/**
 * Folds trivial label differences that are not differences — the same rule the
 * backend's `patterns.normalise` applies, mirrored here so a client-side match
 * can only ever group what the server itself would group. No stemming, no
 * synonyms: those are interpretation.
 */
export function normaliseLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").trim();
}

/**
 * The recent shifts that belong in a thread.
 *
 * A change joins a thread when its normalised label equals one of the thread's
 * subjects — nothing more clever than that. The shift is not promoted to a
 * stored finding and the thread claims nothing new; the card just stops making
 * a person cross-reference two screens to notice that a thread is also the
 * place where something recently moved.
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
 * Where tapping a pattern goes.
 *
 * The detectors are not interchangeable, and neither are the screens. Only the
 * ordering detectors — lag across days, same-day-order within one — can keep
 * the ordering screen's promise of the actual occasions behind the claim.
 * Everything else opens the explain screen, where the evidence, its days, and
 * its composition are shown flat but honestly.
 */
export function patternDestination(
  pattern: Pick<Pattern, "detector" | "id">,
): { href: string; label: string } {
  if (pattern.detector === "lag") {
    return { href: `/pattern/${pattern.id}`, label: "See what came first →" };
  }
  if (pattern.detector === "same-day-order") {
    return { href: `/pattern/${pattern.id}`, label: "See what came first →" };
  }
  return { href: `/node/${pattern.id}`, label: "Where this came from →" };
}
