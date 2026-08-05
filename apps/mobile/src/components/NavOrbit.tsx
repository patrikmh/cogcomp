import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { MotionSurface } from "@/components/MotionSurface";
import { orbitDestinations } from "@/lib/destinations";
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
 *
 * The list itself lives in `@/lib/destinations`, shared with the dock, so the
 * app cannot offer one set of destinations here and a different set two screens
 * away.
 */
export function NavOrbit(_: { onSignOut?: () => void }) {
  const router = useRouter();
  const developer = usePreferences((s) => s.developer);
  const destinations = orbitDestinations(developer);

  return (
    <View style={styles.row}>
      {destinations.map((destination) => (
        <MotionSurface
          key={destination.href}
          style={styles.station}
          onPress={() => router.push(destination.href)}
          accessibilityRole="link"
        >
          <View style={[styles.dot, { backgroundColor: destination.tone }]} />
          <Text style={[styles.label, destination.quiet && styles.quiet]}>
            {destination.label}
          </Text>
        </MotionSurface>
      ))}
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
  label: { color: colors.inkSoft, fontSize: 13, fontWeight: "600" },
  quiet: { color: colors.inkMuted },
});
