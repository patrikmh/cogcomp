import { colors } from "@/theme";

/**
 * Where a person can go, decided once.
 *
 * There are two menus — the orbit on the Journal and the dock on detail
 * screens — and until now each held its own hard-coded list. They drifted: the
 * orbit had been cut from eight destinations to four while the dock still
 * offered the three that were deliberately demoted, so the same app told you
 * two different things about itself depending on which screen you were on.
 *
 * Both now compose this list. A destination that should appear in one menu and
 * not the other is a decision expressed here, in one place, rather than a
 * difference nobody meant.
 */
export interface Destination {
  href: string;
  label: string;
  tone: string;
  /** A corner you go to on purpose and rarely. Rendered dimmer, never omitted. */
  quiet?: boolean;
}

export const JOURNAL: Destination = { href: "/", label: "Journal", tone: colors.cyan };

/**
 * The four places worth reaching from anywhere, in the order someone wants them.
 *
 * Headspace first, because "where do things stand" is the question people
 * arrive with. Then the two time windows, then the slowest-moving view of all.
 * Graph, Patterns and Activity are deliberately absent: they are machinery or
 * lenses onto material these four already show.
 */
export const CORE: Destination[] = [
  { href: "/headspace", label: "Headspace", tone: colors.pink },
  { href: "/today", label: "Today", tone: colors.cyan },
  { href: "/week", label: "Week", tone: colors.cyan },
  { href: "/identity", label: "Identity", tone: colors.violet },
];

export const SETTINGS: Destination = {
  href: "/settings",
  label: "Settings",
  tone: colors.lineStrong,
  quiet: true,
};

export const DEVELOPER: Destination = {
  href: "/dev",
  label: "Dev",
  tone: colors.lineStrong,
  quiet: true,
};

/**
 * The Journal's menu: everywhere, plus the quiet corners.
 *
 * Settings is here rather than in the dock because you go there on purpose and
 * rarely; Dev only when the switch is on.
 */
export function orbitDestinations(developer: boolean): Destination[] {
  return developer ? [...CORE, SETTINGS, DEVELOPER] : [...CORE, SETTINGS];
}

/**
 * The dock on detail screens: the way back to writing, then the same four.
 *
 * Journal leads because the dock appears on screens you reached by following
 * something, and the most likely next move is returning to where you write.
 */
export function dockDestinations(): Destination[] {
  return [JOURNAL, ...CORE];
}
