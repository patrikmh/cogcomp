import { StyleSheet } from "react-native";

import { colors as shared } from "@tlon/design";

/**
 * Shared visual language: Tlön is a quiet dark room with small emissive signals.
 *
 * The palette comes from `packages/design`, which both this app and the web
 * client read. It used to live here as its own set of hexes, which is how two
 * clients of one product drift into looking like two products.
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
  title: { color: colors.ink, fontSize: 25, fontWeight: "700", letterSpacing: -0.4 },
  body: { color: colors.ink, fontSize: 16, lineHeight: 23 },
  meta: { color: colors.inkMuted, fontSize: 12 },
  sectionTitle: {
    color: colors.cyan, fontSize: 12, fontWeight: "700", letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  surface: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
    borderRadius: 3, padding: 14, gap: 6,
  },
  primary: {
    backgroundColor: colors.violet, borderRadius: 3, paddingVertical: 13,
    alignItems: "center",
  },
  primaryLabel: { color: colors.room, fontSize: 16, fontWeight: "700" },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineStrong,
    borderRadius: 3, color: colors.ink, padding: 14, fontSize: 16,
  },
});

export function statusColor(status: string) {
  if (status === "succeeded") return colors.cyan;
  if (status === "failed") return colors.danger;
  if (status === "skipped") return colors.warning;
  return colors.inkSoft;
}
