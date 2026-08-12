import { StyleSheet, Text, View } from "react-native";

import { colors, fonts } from "@/theme";

/**
 * What the composition is made of, counted.
 *
 * Four figures under the rings — kept, tentative, kinds, removed — and one
 * sentence saying what "kept" buys you. The picture shows the shape of the
 * record; these say its size, and the sentence says why the distinction is
 * worth making at all: a kept reading is protected from consolidation, and a
 * removed one leaves a tombstone so the fact that it was removed survives.
 *
 * Tentative and removed are drawn faint, as the design draws them, because
 * they are counts of things the record is *not* asserting.
 */
export function IdentitySummary({
  kept,
  tentative,
  kinds,
  removed,
}: {
  kept: number;
  tentative: number;
  kinds: number;
  removed: number;
}) {
  return (
    <>
      <View style={styles.row} accessibilityRole="summary">
        <Cell n={kept} label="Kept" />
        <Cell n={tentative} label="Tentative" faint />
        <Cell n={kinds} label="Kinds" />
        <Cell n={removed} label="Removed" faint />
      </View>
      <Text style={styles.note}>
        Kept readings are protected from consolidation — they will not be absorbed into
        another node. Removed ones stay as a tombstone so the record that they were removed
        is never lost.
      </Text>
    </>
  );
}

function Cell({ n, label, faint = false }: { n: number; label: string; faint?: boolean }) {
  return (
    <View style={styles.cell}>
      <Text style={[styles.figure, faint && styles.figureFaint]}>{n}</Text>
      <Text style={styles.label}>{label.toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "center", marginTop: 14, paddingHorizontal: 20 },
  cell: { flex: 1, alignItems: "center", paddingHorizontal: 4, paddingVertical: 2 },
  figure: { color: colors.ink, fontFamily: fonts.sansSemi, fontSize: 18, lineHeight: 18 },
  figureFaint: { color: colors.inkMuted },
  label: {
    color: colors.inkMuted,
    fontFamily: fonts.mono,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.6,
    marginTop: 4,
  },
  note: {
    marginTop: 22,
    paddingHorizontal: 20,
    textAlign: "center",
    color: colors.inkMuted,
    fontFamily: fonts.mono,
    fontSize: 10,
    lineHeight: 16,
  },
});
