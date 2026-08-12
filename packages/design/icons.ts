/**
 * The navigation glyphs, taken verbatim from the design.
 *
 * Each is a set of shapes on a 24×24 grid, stroked — never filled except where
 * a dot is meant to be solid. They are data rather than components so both
 * clients can draw them: the web as inline `<svg>`, the mobile client through
 * react-native-svg, from these same numbers.
 *
 * They are drawn, not typeset, and they are not from an icon set. A target for
 * where things stand, ruled lines for the journal, a speech bubble for talking
 * it through, a dial for today, a comb for the week. Swapping any of them for
 * the nearest icon-font equivalent would lose the one thing they have, which is
 * that they were drawn for these particular ideas.
 */
export interface Glyph {
  /** Circles: [cx, cy, r] — solid when the design fills them. */
  circles?: { cx: number; cy: number; r: number; solid?: boolean }[];
  /** Stroked paths, as SVG path data. */
  paths?: string[];
}

export const GLYPH_VIEWBOX = 24;

export const GLYPHS = {
  /** Where things stand: rings closing on a point. */
  headspace: {
    circles: [
      { cx: 12, cy: 12, r: 8.2 },
      { cx: 12, cy: 12, r: 4.6 },
      { cx: 12, cy: 12, r: 1.3, solid: true },
    ],
  },
  /** The journal: ruled lines, the last two short, as a page fills. */
  journal: { paths: ["M5 5.5h14", "M5 10h14", "M5 14.5h9", "M5 19h11"] },
  /** Talk it through. */
  talk: { paths: ["M4 6.5h16v9.5h-9l-4 3.8v-3.8H4z"] },
  /** Today: one dial, one point. */
  today: {
    circles: [
      { cx: 12, cy: 12, r: 6.4 },
      { cx: 12, cy: 12, r: 1.4, solid: true },
    ],
  },
  /** The week: a comb of days between two rules. */
  week: { paths: ["M3 9h18", "M3 15h18", "M7 6.5v5", "M12 6.5v5", "M17 6.5v5"] },
  /** Find an entry. */
  search: { circles: [{ cx: 10.5, cy: 10.5, r: 6 }], paths: ["M15 15l5 5"] },
  /** Patterns: the same wave, twice. */
  patterns: { paths: ["M2.5 12c3.2-6 6.3 6 9.5 0s6.3 6 9.5 0"] },
  /** Identity: a mass with two fixed points above it. */
  identity: {
    circles: [
      { cx: 12, cy: 13.5, r: 6.2 },
      { cx: 9.4, cy: 4.2, r: 1.1, solid: true },
      { cx: 14.6, cy: 4.2, r: 1.1, solid: true },
    ],
  },
  /** Experiments: one line that forks. */
  experiments: { paths: ["M12 3v7", "M12 10c0 5.5-6 5-6 11", "M12 10c0 5.5 6 5 6 11"] },
  /** Agent activity: a trace with one spike in it. */
  agents: { paths: ["M2.5 12h4l2.2-5.5 4.3 11 2.2-5.5h6.3"] },
  /** The graph: three nodes and the threads between them. */
  graph: {
    circles: [
      { cx: 6, cy: 6.5, r: 2.2 },
      { cx: 18, cy: 9, r: 2.2 },
      { cx: 9.5, cy: 18, r: 2.2 },
    ],
    paths: ["M8 7.6l7.8 1", "M7.2 8.5l1.4 7.3", "M16.4 10.8l-5 5.6"],
  },
  /** Settings: three rules with a slider on each. */
  settings: {
    circles: [
      { cx: 9, cy: 7, r: 1.8, solid: true },
      { cx: 15, cy: 12, r: 1.8, solid: true },
      { cx: 7, cy: 17, r: 1.8, solid: true },
    ],
    paths: ["M4 7h16", "M4 12h16", "M4 17h16"],
  },
} satisfies Record<string, Glyph>;

export type GlyphName = keyof typeof GLYPHS;
