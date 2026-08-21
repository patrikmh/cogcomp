/**
 * What a screen says when there is nothing on it.
 *
 * These are the sentences someone reads most on their first day, and they carry
 * the product's whole posture. Every one states a fact about the record and
 * stops: nothing here is a nudge, a streak, or a suggestion that the person
 * should have written more. An empty day is a fact about the day, not a failure
 * to be corrected, and the copy has to hold that line even when a growth
 * instinct would rather it did not.
 *
 * Shared because the two clients were saying different things about the same
 * absence — one called an empty day "Nothing recorded today", the other
 * "Nothing recorded. The day stays empty until it isn't" — and because one
 * client had two different sentences for the same fact, depending on which
 * screen you happened to be on.
 */
export const EMPTY = {
  /** A day with no acts in it. */
  day: "Nothing recorded. The day stays empty until it isn’t.",
  /** The journal, before the first entry. */
  journal: "Nothing written yet. What you write here stays here.",
  /** No recurrence has met the thresholds. Never "no patterns found": the
   *  detectors have a stated bar and the sentence says so. */
  patterns: "Nothing has come back often enough to call recurring.",
  /** The Patterns screen, where the short fact is not enough: without the bar,
   *  an empty list reads as a broken machine or a verdict about the person. */
  patternsWaiting:
    "Nothing has come back often enough to call a pattern yet — that means the same thing written on at least two different days. The findings about calendar shape and ordering need around four weeks of writing before they will say anything.",
  /** No background run has happened. Distinct from a run that found nothing. */
  agents: "Nothing has run yet.",
  /** The identity composition, before anything is suggested. */
  identity: "Nothing has been suggested yet. This fills in as you write.",
  /** The graph dashboard. */
  graph: "Nothing here yet. Entries you write appear as the graph grows.",
  /** The graph, as points and threads. */
  explore: "Nothing to explore yet. Write an entry and the graph starts here.",
  /** The record as a whole, under the everything lens. */
  everything: "Nothing here yet. It fills in as you write.",
  /** Two windows compared, and nothing moved. Distinct from not being able to
   *  look — that answer says something about the record, this one does not. */
  changed: "Nothing moved between this week and last.",
  /** Not enough written across both windows to compare them at all. */
  notEnough: "Not enough written across both weeks to compare them.",
  /** A region needs three things that keep appearing together, which is a lot
   *  of writing. Saying so is the honest empty. */
  regions: "No group of things has turned up together often enough yet.",
} as const;

export type EmptyName = keyof typeof EMPTY;
