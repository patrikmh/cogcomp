import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { AtmosphericShell } from "@/components/Atmospheric";
import { Seal } from "@/components/Seal";
import { MotionSurface } from "@/components/MotionSurface";
import { ErrorLens, LoadingLens } from "@/components/SpatialField";
import { DETECTOR_LABEL } from "@tlon/copy/detectors";

import { api, type Occasion, type Ordering, type Pattern, type Written } from "@/lib/api";
import { useSession } from "@/state/session";
import { colors, fonts } from "@/theme";
import { radii } from "@tlon/design";
import { type as scale } from "@tlon/design";
import { Guide } from "@/components/Guide";

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
  const userId = useSession((s) => s.userId);

  const ordering = useQuery({
    queryKey: ["ordering", id],
    queryFn: () => api.patternOrdering(token!, id!),
    enabled: Boolean(token && id),
  });
  // The ordering endpoint carries the occasions and the gap between them, but
  // not how many days the finding rests on or which detector made it. Those
  // live on the pattern, and the design states both under the title — so the
  // pattern is read too rather than the numbers being left out or invented.
  const patterns = useQuery({
    queryKey: ["patterns", userId],
    queryFn: () => api.listPatterns(token!),
    enabled: Boolean(token),
  });
  const pattern = (patterns.data ?? []).find((p: Pattern) => p.id === id);

  if (!token) return null;

  if (ordering.isLoading) return <LoadingLens label="Reading the order…" />;
  if (ordering.isError || !ordering.data) {
    return <ErrorLens label="This pattern has no ordered evidence." />;
  }

  return <Body ordering={ordering.data} pattern={pattern} />;
}

function Body({ ordering, pattern }: { ordering: Ordering; pattern?: Pattern }) {
  const router = useRouter();
  const { lag_days, occasions } = ordering;
  const gap = `${lag_days} ${lag_days === 1 ? "day" : "days"}`;

  return (
    <AtmosphericShell variant="secondary">
      <ScrollView contentContainerStyle={styles.screen}>
        {/* The design names the detector in the kicker — "Pattern · lag" —
            so the reader knows which machine made the claim before reading it,
            and says "still forming" where the finding has not settled. */}
        {/* The design names the detector that made the claim, and says when a
            finding has not settled. */}
        <Text style={styles.kicker}>
          {`Pattern · ${pattern ? DETECTOR_LABEL[pattern.detector] ?? pattern.detector : "what came first"}${
            pattern?.tentative ? " · still forming" : ""
          }`}
        </Text>
        <View style={styles.headingRow}>
          <Text style={[styles.headline, styles.headlineFill]}>{ordering.label}</Text>
          <Guide id="pattern" />
        </View>

        {/* The design puts a count and a caveat here — "N of M days · sized
            against your own busiest fortnight, no absolute scale". This screen
            is served by the ordering endpoint, which carries the occasions and
            the gap but neither day count, so the caveat is stated without a
            number rather than with an invented one. */}
        {/* "Sized against your own busiest fortnight, no absolute scale" is
            the design's caveat and it earns its place: a count with no stated
            frame invites comparison to a standard nobody set. */}
        <Text style={styles.tally}>
          {pattern
            ? `${pattern.distinct_days} of ${pattern.occurrences} days · sized against your own busiest fortnight, no absolute scale`
            : `${occasions.length} ${occasions.length === 1 ? "occasion" : "occasions"} · counted in your own record, no absolute scale`}
        </Text>

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
          {/* The act's seal, as the web puts one on every evidence row. This is
              the screen arguing that two things happened in an order, so being
              able to recognise *which* acts it is arguing from matters more here
              than anywhere. */}
          <Seal id={entry.id} size={28} />
          <View style={styles.entryBody}>
            <Text style={styles.entryText}>{entry.content}</Text>
            <Text style={styles.meta}>
              {new Date(entry.captured_at).toLocaleString()} · {entry.source}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  tally: {
    color: colors.inkMuted,
    fontFamily: fonts.mono,
    fontSize: 10.5,
    lineHeight: 17,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginTop: 10,
  },
  headingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  headlineFill: { flex: 1 },
  screen: { backgroundColor: colors.room, padding: 20, gap: 14, paddingBottom: 48 },
  kicker: { color: colors.cyan, fontFamily: fonts.mono, fontSize: 11, fontWeight: "700", letterSpacing: 1.8 },
  headline: { fontFamily: fonts.sans, fontSize: 20, lineHeight: 28, fontWeight: "600", color: colors.ink },
  lead: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 22, color: colors.inkSoft },
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
    fontFamily: fonts.mono, fontSize: scale.kicker.size,
    textTransform: "uppercase",
    letterSpacing: scale.kicker.tracking,
    color: colors.inkMuted,
  },
  // The gap is the whole claim, so it is rendered as a step between the two
  // entries rather than as text attached to either of them.
  gap: {
    fontFamily: fonts.sans, fontSize: 12,
    color: colors.cyan,
    borderLeftWidth: 3,
    borderLeftColor: colors.line,
    paddingLeft: 12,
    paddingVertical: 4,
    marginLeft: 10,
  },
  entryBody: { flex: 1, gap: 4 },
  // A row with the act's seal rather than a block with a coloured bar down its
  // side. The seal says *which* act; a cyan bar only said "an act".
  entry: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 6,
  },
  entryText: { fontFamily: fonts.sans, fontSize: 16, lineHeight: 23, color: colors.ink },
  meta: { fontFamily: fonts.sans, fontSize: 12, color: colors.inkMuted },
  open: {
    marginTop: 18,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
  },
  openLabel: { color: colors.inkSoft, fontFamily: fonts.sans, fontSize: 15, fontWeight: "700" },
  footnote: { marginTop: 12, fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, color: colors.inkMuted },
});
