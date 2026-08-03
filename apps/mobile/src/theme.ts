import { StyleSheet } from "react-native";

/** Shared visual language: Tlön is a quiet dark room with small emissive signals. */
export const colors = {
  room: "#08080c",
  roomRaised: "#0e0e16",
  surface: "#12121c",
  surfaceBright: "#181827",
  line: "#29293b",
  lineStrong: "#454563",
  ink: "#f1f0f8",
  inkSoft: "#b5b3c7",
  // Muted, but still readable on both the room and raised surfaces.
  inkMuted: "#a09db4",
  cyan: "#67e8f9",
  violet: "#a78bfa",
  pink: "#f0abfc",
  danger: "#fb7185",
  warning: "#fbbf24",
  // Compatibility aliases for the experiment route's existing visual tokens.
  muted: "#a09db4",
  panel: "#12121c",
  coral: "#fb7185",
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
