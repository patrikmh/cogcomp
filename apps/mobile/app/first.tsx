import { radii, type as scale } from "@tlon/design";
import { detectorsWaiting } from "@tlon/ontology";
import { useQuery } from "@tanstack/react-query";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { Kicker, Rule } from "@/components/Marks";
import { api, type ObservationResponse, type Pattern } from "@/lib/api";
import { localToday, mondayOfWeek } from "@/lib/dates";
import { useSession } from "@/state/session";
import { colors, fonts } from "@/theme";

/**
 * The first fortnight.
 *
 * Some findings need more days than anyone has written yet, and the honest thing
 * is to say which and how many rather than leaving the screens quietly empty.
 * Nothing here is a nudge to write more: it is a statement of what each detector
 * is waiting for, so an empty Patterns screen reads as "not yet" rather than as
 * "nothing about you was worth finding".
 *
 * The arithmetic is in `@tlon/ontology` with the thresholds it uses, and
 * `scripts/check_ontology_sync.py` asserts those still match the Python they
 * came from — a screen that tells someone they need four weeks when the detector
 * wants five is worse than one that says nothing.
 */
export default function FirstScreen() {
  const token = useSession((s) => s.token);
  const userId = useSession((s) => s.userId);

  const entries = useQuery({
    queryKey: ["observations", userId],
    queryFn: () => api.listObservations(token!),
    enabled: Boolean(token && userId),
  });
  const patterns = useQuery({
    queryKey: ["patterns", userId],
    queryFn: () => api.listPatterns(token!),
    enabled: Boolean(token && userId),
  });

  if (!token) return null;

  const written: ObservationResponse[] = entries.data?.observations ?? [];
  const days = new Set(written.map((o) => o.captured_at.slice(0, 10)));
  const weeks = new Set([...days].map((d) => mondayOfWeek(d)));
  const found = (patterns.data ?? []).map((p: Pattern) => p.detector);

  const waiting = detectorsWaiting({ days: days.size, weeks: weeks.size, found });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Kicker>First fortnight · new</Kicker>
      <Text style={styles.title}>The machinery is filling</Text>
      <Text style={styles.sub}>
        Some findings need more days than you have written. Nothing is owed — this is what
        each detector is waiting for.
      </Text>
      <Rule />

      {waiting.map((w) => (
        // Hollow until it can fire, which is the same signal the web uses and
        // the same one a tentative reading carries: dashed means not yet.
        <View key={w.name} style={[styles.card, !w.ready && styles.hollow]}>
          <Kicker tone={w.ready ? colors.cyan : colors.warning}>
            {w.name} · {w.standing}
          </Kicker>
          <Text style={styles.needs}>{w.needs}</Text>
        </View>
      ))}

      <Text style={styles.footnote}>
        Today is {localToday()}. Nothing here is generated to fill the space — a detector
        with nothing to say says nothing.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.room },
  content: { padding: 20, paddingBottom: 56, gap: 10 },
  title: {
    color: colors.ink,
    fontFamily: fonts.sansBold,
    fontSize: scale.title.size,
    lineHeight: scale.title.line,
    letterSpacing: scale.title.tracking,
  },
  sub: {
    color: colors.inkMuted,
    fontFamily: fonts.sans,
    fontSize: scale.body.size,
    lineHeight: scale.body.line,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.surface,
    padding: 14,
    gap: 8,
  },
  hollow: { backgroundColor: "transparent", borderStyle: "dashed", borderColor: colors.warning },
  needs: {
    color: colors.inkSoft,
    fontFamily: fonts.sans,
    fontSize: scale.body.size,
    lineHeight: scale.body.line,
  },
  footnote: {
    color: colors.inkMuted,
    fontFamily: fonts.mono,
    fontSize: scale.meta.size,
    lineHeight: scale.meta.line,
    marginTop: 6,
  },
});
