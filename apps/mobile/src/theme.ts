import { StyleSheet } from "react-native";

import { colors as shared, radii, type as scale } from "@tlon/design";

/**
 * Shared visual language: Tlön is a quiet dark room with small emissive signals.
 *
 * The palette comes from `packages/design`, which both this app and the web
 * client read. It used to live here as its own set of hexes, which is how two
 * clients of one product drift into looking like two products.
 *
 * The radii and the type scale come from there too. They used to be restated
 * here as literals that happened to agree, which is how a shared source stops
 * being one — the 3px was right and nothing was holding it right.
 *
 * The names on the left are this app's; the values on the right are the
 * product's. Where a name has no counterpart in the shared set it maps to the
 * nearest one rather than inventing a colour — a screen needing a hue that the
 * design does not have is a design question, not a constant.
 */
export const colors = {
  room: shared.room,
  roomRaised: shared.surface,
  surface: shared.surface,
  surfaceBright: shared.surface2,
  /** The bar behind a filled meter. Darker than a surface: a meter's ground is
   *  a groove in the page, not a card sitting on it. */
  track: shared.track,
  line: shared.line,
  lineStrong: shared.line2,
  ink: shared.ink,
  inkSoft: shared.dim,
  inkMuted: shared.faint,
  /** Live and confident. Named for its old hue; the value is the product's. */
  cyan: shared.live,
  violet: shared.kept,
  pink: shared.pattern,
  danger: shared.rust,
  warning: shared.sand,
  // Compatibility aliases for the experiment route's existing visual tokens.
  muted: shared.faint,
  panel: shared.surface,
  coral: shared.rust,
} as const;

/**
 * The two faces, by the name the font loader registers them under.
 *
 * React Native picks a face by family name and ignores `fontWeight` once a
 * family is named, so a weight is a different family here rather than a
 * property — which is why these are spelled out instead of derived.
 */
export const fonts = {
  sans: "IBMPlexSans_400Regular",
  /** The design's workhorse emphasis: tabs, row headings, rail labels. Between
   *  regular and semibold, and not interchangeable with either — 600 reads as
   *  a heading where the design wanted a label. */
  sansMedium: "IBMPlexSans_500Medium",
  sansSemi: "IBMPlexSans_600SemiBold",
  sansBold: "IBMPlexSans_700Bold",
  mono: "IBMPlexMono_400Regular",
  /** The design uses 500-weight mono exactly once: the guide's "?" trigger.
   *  Everything else in mono is 400, kickers included. */
  monoMedium: "IBMPlexMono_500Medium",
} as const;

export const theme = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.room },
  scroll: { backgroundColor: colors.room },
  content: { padding: 18, gap: 12, paddingBottom: 44 },
  title: {
    color: colors.ink, fontFamily: fonts.sansBold, fontSize: scale.title.size,
    lineHeight: scale.title.line, letterSpacing: scale.title.tracking,
  },
  body: {
    color: colors.ink, fontFamily: fonts.sans,
    fontSize: scale.body.size, lineHeight: scale.body.line,
  },
  meta: {
    color: colors.inkMuted, fontFamily: fonts.mono,
    fontSize: scale.meta.size, lineHeight: scale.meta.line,
  },
  /** The design's kicker: mono, uppercase, and spaced so it reads as an
   *  instrument marking rather than as shouting. */
  sectionTitle: {
    color: colors.inkMuted, fontFamily: fonts.mono, fontSize: scale.kicker.size,
    lineHeight: scale.kicker.line, letterSpacing: scale.kicker.tracking,
    textTransform: "uppercase",
  },
  surface: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    borderRadius: radii.surface, padding: 14, gap: 6,
  },
  primary: {
    backgroundColor: colors.violet, borderRadius: radii.surface, paddingVertical: 13,
    alignItems: "center",
  },
  primaryLabel: {
    color: colors.room, fontFamily: fonts.sansBold, fontSize: scale.body.size,
  },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineStrong,
    borderRadius: radii.surface, color: colors.ink, padding: 14,
    fontFamily: fonts.sans, fontSize: scale.body.size,
  },
});

export function statusColor(status: string) {
  if (status === "succeeded") return colors.cyan;
  if (status === "failed") return colors.danger;
  if (status === "skipped") return colors.warning;
  return colors.inkSoft;
}
