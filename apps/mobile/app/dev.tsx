import { useRouter } from "expo-router";
import { useEffect } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { MotionSurface } from "@/components/MotionSurface";
import { usePreferences } from "@/state/preferences";
import { useSession } from "@/state/session";
import { colors, fonts } from "@/theme";

/**
 * The developer menu.
 *
 * Everything here inspects the machine rather than helping anyone think. That is
 * not a reason to remove it — the agent run log is what makes background
 * inference accountable, and a person who wants to audit what ran deserves to —
 * but it is a reason not to put it in the way of someone opening a journal.
 *
 * Reachable only with the switch on. Navigating here with it off sends you back
 * rather than showing a locked door, because a locked door is an invitation and
 * this is not hidden for security.
 */
const SURFACES: { href: string; label: string; note: string; tone: string }[] = [
  {
    href: "/agents",
    label: "Run log",
    note: "Every background run, including the ones that did nothing.",
    tone: colors.cyan,
  },
  {
    href: "/graph",
    label: "Graph readout",
    note: "Counts and filters over everything extracted.",
    tone: colors.violet,
  },
  {
    href: "/experiments",
    label: "Experiments",
    note: "Self-authored trials and their outcomes.",
    tone: colors.warning,
  },
];

export default function DevScreen() {
  const router = useRouter();
  const token = useSession((s) => s.token);
  const developer = usePreferences((s) => s.developer);
  const ready = usePreferences((s) => s.ready);

  useEffect(() => {
    // Only once preferences have loaded, or this bounces on every cold start
    // before the stored value has been read.
    if (ready && !developer) router.replace("/settings");
  }, [ready, developer, router]);

  if (!token || !developer) return null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {SURFACES.map((surface) => (
        <MotionSurface
          key={surface.href}
          style={styles.row}
          onPress={() => router.push(surface.href)}
          accessibilityRole="link"
        >
          <View style={[styles.dot, { backgroundColor: surface.tone }]} />
          <View style={styles.copy}>
            <Text style={styles.label}>{surface.label}</Text>
            <Text style={styles.note}>{surface.note}</Text>
          </View>
        </MotionSurface>
      ))}

      <Text style={styles.footnote}>
        These read the system, not you. Turn them off in Settings.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.room },
  content: { padding: 20, gap: 2, paddingBottom: 40 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 16 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  copy: { flex: 1, gap: 3 },
  label: { color: colors.ink, fontFamily: fonts.sans, fontSize: 16, fontWeight: "600" },
  note: { color: colors.inkMuted, fontFamily: fonts.sans, fontSize: 12, lineHeight: 17 },
  footnote: { color: colors.inkMuted, fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, paddingTop: 24 },
});
