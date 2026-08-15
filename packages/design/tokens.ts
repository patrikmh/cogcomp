/**
 * The visual language, in one place.
 *
 * Lifted from the design prototype's `:root` block (Open Design project
 * 7f66d608, `tlon.html`). Both clients read from here — the web app through
 * `tokens.css`, the mobile app by importing this module — so the two cannot
 * drift into being two different-looking products.
 *
 * A quiet room the colour of dark water, with small emissive signals. Colour
 * appears only where something is live, kept, or wrong; everything structural
 * is a step on the ink ramp.
 */

export const colors = {
  /** Page ground. Black with green in it, not neutral black. */
  room: "#0a0d0c",
  surface: "#111716",
  surface2: "#161e1d",
  /** The bar behind a filled meter. */
  track: "#1a2221",
  line: "#232c2b",
  line2: "#33403e",

  /** Three steps of text, and no more. */
  ink: "#eef1ec",
  dim: "#9aa6a2",
  faint: "#5f6b68",

  /** Live, confident, the thing under your cursor. */
  live: "#c6e070",
  /** A reading you have kept. */
  kept: "#a7c3c8",
  /** A pattern — a claim across time. */
  pattern: "#e6b95c",
  /** Tentative: below the confidence threshold, drawn hollow. */
  sand: "#d8c79a",
  /** Destructive, failed, rejected. */
  rust: "#c4603c",
} as const;

export const fonts = {
  sans: '"IBM Plex Sans", system-ui, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
} as const;

/**
 * Radii are tight and deliberate: 3px on anything that holds content, 2px on
 * chips, and full round only on switches. Nothing here is a soft card.
 */
export const radii = { surface: 3, chip: 2, pill: 999 } as const;

export const type = {
  body: { size: 16, line: 23, weight: "400" },
  /** `h1` in the design: 25/28, tracked -.01em. The line height was 30 here,
   *  which opens a two-line title by two pixels more than the design sets and
   *  is visible on every screen that wraps its heading. */
  //  Tracking is stated in pixels because React Native has no `em`; the design
  //  sets -.01em on a 25px title, which is -0.25 and not the -0.4 this carried.
  title: { size: 25, line: 28, weight: "700", tracking: -0.25 },
  /** `h2`: 16/22 at 600. This was 17/24 — a size the design does not use for a
   *  heading at all, which made every section heading a point larger than the
   *  body it sat above rather than the same size in a heavier weight. */
  heading: { size: 16, line: 22, weight: "600" },
  meta: { size: 12, line: 17, weight: "400" },
  /** Uppercase mono labels. The letter-spacing is what makes them read as
   *  instrument markings rather than as shouting. */
  //  .14em on 11px is 1.54. This said 1.8, which is a sixth wider than the
  //  design sets and adds up across a word of uppercase mono.
  //  ...and the design draws it at 400 on a line-height of 1, not 500 on 14.
  //  Mono is 400 everywhere in the design bar the guide's "?" trigger, so a
  //  medium kicker made every instrument marking in the app a weight heavy.
  kicker: { size: 11, line: 11, weight: "400", tracking: 1.54 },
} as const;

export type ColorToken = keyof typeof colors;

/**
 * What colour a node is drawn in.
 *
 * Colour in this design marks what is *known* about something, never what kind
 * of thing it is. There is no per-kind palette anywhere in the prototype: a
 * reading is `kept` once the record stands behind it, `sand` while it is only
 * offered or still tentative, `faint` once it has been taken back, and an act —
 * something you actually wrote — is `ink`, because it is not a claim at all.
 *
 * The mobile client used to give each of eleven kinds its own colour, which is
 * a different idea about what colour is for: it made Thought and Emotion
 * distinguishable at a glance and made confident and doubtful indistinguishable,
 * which is the wrong way round for an app whose whole argument is that you can
 * see how sure it is.
 */
export function toneFor(node: {
  kind?: string;
  tentative?: boolean;
  kept?: boolean;
  removed?: boolean;
}): string {
  if (node.removed) return colors.faint;
  if (node.tentative) return colors.sand;
  // An act is the fixed point everything else hangs off, and it makes no claim.
  if (node.kind === "Observation") return colors.ink;
  return colors.kept;
}
