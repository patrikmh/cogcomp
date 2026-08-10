import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { AtmosphericShell } from "@/components/Atmospheric";
import { MotionSurface } from "@/components/MotionSurface";
import { ErrorLens, LoadingLens } from "@/components/SpatialField";
import { api, type Occasion, type Ordering, type Written } from "@/lib/api";
import { useSession } from "@/state/session";
import { colors } from "@/theme";
import { radii } from "@tlon/design";

/**
 * "You wrote this, and then a day later you wrote that."
 *
 * The lag detector states an ordering in a sentence — "sleeping badly came up
 * 1 day before foggy · 4 times". A sentence like that is the kind of thing a
 * person cannot argue with unless they can see what it was counting, so this
 * screen shows the occasions themselves: each pair of entries, in the order
 * they were written, with the gap named.
 *
 * It says *before*, never *because*. The detector measures precedence over
 * calendar days and nothing else, and this screen is the last place where that
 * distinction could quietly be lost.
 */
export default function PatternOrderingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const token = useSession((s) => s.token);

  const ordering = useQuery({
    queryKey: ["ordering", id],
    queryFn: () => api.patternOrdering(token!, id!),
    enabled: Boolean(token && id),
  });

  if (!token) return null;

  if (ordering.isLoading) return <LoadingLens label="Reading the order…" />;
  if (ordering.isError || !ordering.data) {
    return <ErrorLens label="This pattern has no ordered evidence." />;
  }

  return <Body ordering={ordering.data} />;
}

function Body({ ordering }: { ordering: Ordering }) {
  const router = useRouter();
  const { lag_days, occasions } = ordering;
  const gap = `${lag_days} ${lag_days === 1 ? "day" : "days"}`;

  return (
    <AtmosphericShell variant="secondary">
      <ScrollView contentContainerStyle={styles.screen}>
        <Text style={styles.kicker}>WHAT CAME FIRST</Text>
        <Text style={styles.headline}>{ordering.label}</Text>

        {/* Said before the evidence rather than in a footnote. Someone reading a
            list of "this, then that" will supply a cause if nobody says not to. */}
        <Text style={styles.lead}>
          These entries were written {gap} apart, {occasions.length}{" "}
          {occasions.length === 1 ? "time" : "times"}. That is an order, not a
          reason — nothing here says one brought the other on.
        </Text>

        {occasions.map((occasion) => (
          <Occurrence key={occasion.source_day} occasion={occasion} gap={gap} />
        ))}

        {ordering.utc_fallback && (
          // Shown only when it is true. Repeating a caveat under evidence that
          // does not need it teaches people to skip it under evidence that does.
          <Text style={styles.footnote}>
            Some of these entries never recorded the timezone they were written
            in, so their days were counted in UTC. Near midnight a gap may read
            as one day more or less than it felt.
          </Text>
        )}

        <MotionSurface
          style={styles.open}
          onPress={() => router.push(`/node/${ordering.pattern_id}`)}
          accessibilityRole="button"
        >
          <Text style={styles.openLabel}>How this was produced →</Text>
        </MotionSurface>
      </ScrollView>
    </AtmosphericShell>
  );
}

/** One occasion: what was written first, then what was written after. */
function Occurrence({ occasion, gap }: { occasion: Occasion; gap: string }) {
  return (
    <View style={styles.occasion}>
      <Side day={occasion.source_day} label="First" entries={occasion.before} />
      <Text style={styles.gap}>{gap} later</Text>
      <Side day={occasion.target_day} label="Then" entries={occasion.after} />
    </View>
  );
}

function Side({
  day,
  label,
  entries,
}: {
  day: string;
  label: string;
  entries: Written[];
}) {
  return (
    <View style={styles.side}>
      <Text style={styles.sideLabel}>
        {label} · {day}
      </Text>
      {entries.map((entry) => (
        <View
          key={entry.id}
          style={styles.entry}
          accessibilityLabel={`${label}, ${day}: ${entry.content}`}
        >
          <Text style={styles.entryText}>{entry.content}</Text>
          <Text style={styles.meta}>
            {new Date(entry.captured_at).toLocaleString()} · {entry.source}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.room, padding: 20, gap: 14, paddingBottom: 48 },
  kicker: { color: colors.cyan, fontSize: 11, fontWeight: "700", letterSpacing: 1.8 },
  headline: { fontSize: 20, lineHeight: 28, fontWeight: "600", color: colors.ink },
  lead: { fontSize: 15, lineHeight: 22, color: colors.inkSoft },
  occasion: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.surface,
    padding: 12,
    gap: 8,
    marginTop: 6,
  },
  side: { gap: 6 },
  sideLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: colors.inkMuted,
  },
  // The gap is the whole claim, so it is rendered as a step between the two
  // entries rather than as text attached to either of them.
  gap: {
    fontSize: 12,
    color: colors.cyan,
    borderLeftWidth: 3,
    borderLeftColor: colors.line,
    paddingLeft: 12,
    paddingVertical: 4,
    marginLeft: 10,
  },
  entry: {
    marginLeft: 10,
    borderLeftWidth: 3,
    borderLeftColor: colors.cyan,
    paddingLeft: 12,
    paddingVertical: 6,
    gap: 4,
  },
  entryText: { fontSize: 16, lineHeight: 23, color: colors.ink },
  meta: { fontSize: 12, color: colors.inkMuted },
  open: {
    marginTop: 18,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
  },
  openLabel: { color: colors.inkSoft, fontSize: 15, fontWeight: "700" },
  footnote: { marginTop: 12, fontSize: 12, lineHeight: 18, color: colors.inkMuted },
});
