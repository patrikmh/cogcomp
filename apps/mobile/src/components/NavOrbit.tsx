import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { MotionSurface } from "@/components/MotionSurface";
import { usePreferences } from "@/state/preferences";
import { colors } from "@/theme";

/**
 * Where else you can go.
 *
 * Rendered as lit points rather than text links — small enough to stop competing
 * with the entries above them, each still carrying its word. The words stay: a
 * row of unlabelled glowing dots is a puzzle, and a screen reader would find
 * nothing at all.
 */

/**
 * Where a person goes, in the order they would want it.
 *
 * Down from eight to four. The run log and the experiment engine moved behind
 * the developer switch and sign-out moved into Settings — none of them is
 * something you reach for while trying to write down a thought. The graph and
 * patterns became lenses inside Headspace, because they were never separate
 * places so much as separate ways of looking at the same material.
 */
const DESTINATIONS: { href: string; label: string; tone: string }[] = [
  // First, because "where do things stand" is the question people arrive with.
  { href: "/headspace", label: "Headspace", tone: colors.pink },
  { href: "/today", label: "Today", tone: colors.cyan },
  { href: "/week", label: "Week", tone: colors.cyan },
  { href: "/identity", label: "Identity", tone: colors.violet },
];

export function NavOrbit(_: { onSignOut?: () => void }) {
  const router = useRouter();
  const developer = usePreferences((s) => s.developer);

  return (
    <View style={styles.row}>
      {DESTINATIONS.map((destination) => (
        <MotionSurface
          key={destination.href}
          style={styles.station}
          onPress={() => router.push(destination.href)}
          accessibilityRole="link"
        >
          <View style={[styles.dot, { backgroundColor: destination.tone }]} />
          <Text style={styles.label}>{destination.label}</Text>
        </MotionSurface>
      ))}
      <MotionSurface
        style={styles.station}
        onPress={() => router.push("/settings")}
        accessibilityRole="link"
      >
        <View style={[styles.dot, styles.dotQuiet]} />
        <Text style={[styles.label, styles.quiet]}>Settings</Text>
      </MotionSurface>

      {developer && (
        <MotionSurface
          style={styles.station}
          onPress={() => router.push("/dev")}
          accessibilityRole="link"
        >
          <View style={[styles.dot, styles.dotQuiet]} />
          <Text style={[styles.label, styles.quiet]}>Dev</Text>
        </MotionSurface>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  station: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 34 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotQuiet: { backgroundColor: colors.lineStrong },
  label: { color: colors.inkSoft, fontSize: 13, fontWeight: "600" },
  quiet: { color: colors.inkMuted },
});
