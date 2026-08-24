import { type as scale } from "@tlon/design";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { MotionSurface } from "@/components/MotionSurface";
import { api, type GraphNode } from "@/lib/api";
import { heldFirst } from "@/lib/drawnFrom";
import { colors, fonts } from "@/theme";

/**
 * What a finding is made of, linked to the readings behind it.
 *
 * A finding nobody can decompose is a finding nobody can argue with. A
 * recurrence is not a fact about a person, it is a count over readings that
 * were themselves drawn from entries — and unless the readings are named and
 * reachable, the count is the end of the chain rather than a step in it.
 *
 * The confidence travels with each chip, as the design has it. A finding is
 * made of readings the app is more and less sure of, and a chip that hides that
 * makes them all look equally solid.
 */
/** How many chips fit before the row becomes a wall. */
const SHOWN = 6;

export function Composition({
  token,
  patternId,
}: {
  token: string;
  patternId: string;
}) {
  const router = useRouter();
  const composition = useQuery({
    queryKey: ["neighbours", patternId],
    queryFn: () => api.neighbours(token, patternId),
    enabled: Boolean(token && patternId),
  });
  const made: (GraphNode & { cites_entries?: number })[] = [
    ...(composition.data?.neighbours ?? []),
  ].sort(heldFirst);

  return (
    <View style={styles.row}>
      <Text style={styles.label}>Drawn from</Text>
      {made.length === 0 ? (
        <Text style={[styles.chip, styles.gone]}>nothing drawn from entries yet</Text>
      ) : (
        made.slice(0, SHOWN).map((reading) => (
          <MotionSurface
            key={reading.id}
            onPress={() => router.push(`/node/${reading.id}`)}
            accessibilityRole="button"
            accessibilityLabel={reading.label}
          >
            <Text style={[styles.chip, reading.tentative && styles.gone]}>
              {reading.label} · {(reading.confidence ?? 0).toFixed(2)}
            </Text>
          </MotionSurface>
        ))
      )}
      {/* What is not shown, said rather than dropped. The design's findings are
          made of one or two readings and the row never overflows there; a real
          one can be made of a dozen, and a list that silently keeps the first
          six looks complete. */}
      {made.length > SHOWN && (
        <Text style={styles.more}>{`+${made.length - SHOWN} more`}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12, alignItems: "center" },
  label: {
    color: colors.inkMuted,
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  chip: {
    color: colors.inkMuted,
    fontFamily: fonts.mono,
    fontSize: scale.kicker.size,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 2,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  /** A reading the record is no longer sure of: dotted and dimmed, as the
   *  design draws `.c.gone`. */
  gone: { borderStyle: "dotted", opacity: 0.6 },
  more: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.6 },
});
