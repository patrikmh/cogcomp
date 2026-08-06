/**
 * The lenses on Headspace, and which of them are findings.
 *
 * Two of these show what you wrote; three show what the system concluded about
 * you across time. That line is the one a person can switch off — see
 * `findings` in `@/state/preferences` — so it lives here as data rather than as
 * a condition scattered through the screen.
 *
 * The order is an argument about distance from the words themselves: a day is a
 * fact, the whole graph is a record, a recurrence is a claim, a region is a
 * claim built on claims, and a change is a comparison between two windows.
 * Each step is further from what was actually written, and the row makes that
 * distance visible rather than presenting all five as equally solid.
 */
export type Lens = "today" | "all" | "patterns" | "regions" | "changed";

export interface LensOption {
  id: Lens;
  label: string;
  /** True when this lens shows a conclusion drawn across time rather than
   *  something the person wrote. */
  finding: boolean;
}

export const LENSES: LensOption[] = [
  { id: "today", label: "Today", finding: false },
  { id: "all", label: "Everything", finding: false },
  { id: "patterns", label: "Recurring", finding: true },
  { id: "regions", label: "Regions", finding: true },
  { id: "changed", label: "Changed", finding: true },
];

/** The lenses to offer. With findings off, only what the person wrote. */
export function lensesFor(showFindings: boolean): LensOption[] {
  return showFindings ? LENSES : LENSES.filter((lens) => !lens.finding);
}

/**
 * The lens to land on, given what is available.
 *
 * Someone who turns findings off while looking at one must not be left staring
 * at an empty screen, or worse, at a lens that no longer exists.
 */
export function resolveLens(selected: Lens, showFindings: boolean): Lens {
  const available = lensesFor(showFindings);
  return available.some((lens) => lens.id === selected) ? selected : "today";
}
