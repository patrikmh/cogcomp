import type { GlyphName } from "@tlon/design/icons";

/**
 * Where a person can go, decided once.
 *
 * The design has two menus and they do different jobs. Along the bottom sit
 * five tabs — the four places you move between while using the app, and a way
 * to everything else. Behind that fifth tab is the whole map, grouped by what
 * each thing is *for*: what you put in, what you look back at, what was found,
 * what you are testing, and the machinery underneath.
 *
 * The grouping is the argument. A flat list of twelve destinations says they
 * are twelve equivalent things; these headings say that looking back at a week
 * and reading the agent log are not the same kind of act, and that the second
 * one is machinery you may audit rather than a place to spend time.
 *
 * Each row carries how much is behind it. A count is not decoration here — it
 * is the difference between a door you open and a door you know is worth
 * opening — and where there is nothing to count, nothing is shown rather than a
 * zero, because "0" reads as a failure and an absence is not one.
 */
export interface Destination {
  href: string;
  label: string;
  glyph: GlyphName;
  /** Which count to show beside it, if any. Resolved where the data is. */
  count?: "headspace" | "journal" | "today" | "week" | "patterns" | "identity" | "experiments" | "agents" | "graph";
}

export interface Group {
  /** The kicker above the group. */
  title: string;
  items: Destination[];
}

/**
 * The bar along the bottom: four places, then everything else.
 *
 * Head leads because "where do things stand" is the question people arrive
 * with. Journal is next because writing is what the app is for. Talk and Today
 * follow, and More is not a destination at all — it opens the map.
 */
export const TABS: (Destination & { glyph: GlyphName })[] = [
  { href: "/headspace", label: "Head", glyph: "headspace" },
  { href: "/", label: "Journal", glyph: "journal" },
  { href: "/talk", label: "Talk", glyph: "talk" },
  { href: "/today", label: "Today", glyph: "today" },
];

export const GROUPS: Group[] = [
  {
    title: "Capture",
    items: [
      { href: "/headspace", label: "Headspace", glyph: "headspace", count: "headspace" },
      { href: "/", label: "Journal", glyph: "journal", count: "journal" },
      { href: "/talk", label: "Talk it through", glyph: "talk" },
    ],
  },
  {
    title: "Looking back",
    items: [
      { href: "/today", label: "Today", glyph: "today", count: "today" },
      { href: "/week", label: "This week", glyph: "week", count: "week" },
      { href: "/search", label: "Find an entry", glyph: "search" },
    ],
  },
  {
    title: "Findings",
    items: [
      { href: "/patterns", label: "Patterns", glyph: "patterns", count: "patterns" },
      { href: "/identity", label: "Identity", glyph: "identity", count: "identity" },
    ],
  },
  {
    title: "Self-authorship",
    items: [{ href: "/experiments", label: "Experiments", glyph: "experiments", count: "experiments" }],
  },
  {
    title: "Machinery",
    items: [
      { href: "/agents", label: "Agent activity", glyph: "agents", count: "agents" },
      { href: "/graph", label: "Graph", glyph: "graph", count: "graph" },
      { href: "/settings", label: "Settings", glyph: "settings" },
    ],
  },
];

/** Everywhere the map leads. Used to prove no screen is stranded. */
export function allDestinations(): Destination[] {
  return GROUPS.flatMap((group) => group.items);
}
