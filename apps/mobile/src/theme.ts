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

export const theme = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.room },
  scroll: { backgroundColor: colors.room },
  content: { padding: 18, gap: 12, paddingBottom: 44 },
  title: {
    color: colors.ink, fontSize: scale.title.size, lineHeight: scale.title.line,
    fontWeight: "700", letterSpacing: scale.title.tracking,
  },
  body: { color: colors.ink, fontSize: scale.body.size, lineHeight: scale.body.line },
  meta: { color: colors.inkMuted, fontSize: scale.meta.size, lineHeight: scale.meta.line },
  sectionTitle: {
    color: colors.cyan, fontSize: 12, fontWeight: "700", letterSpacing: 1.4,
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
  primaryLabel: { color: colors.room, fontSize: scale.body.size, fontWeight: "700" },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineStrong,
    borderRadius: radii.surface, color: colors.ink, padding: 14, fontSize: scale.body.size,
  },
});

export function statusColor(status: string) {
  if (status === "succeeded") return colors.cyan;
  if (status === "failed") return colors.danger;
  if (status === "skipped") return colors.warning;
  return colors.inkSoft;
}
