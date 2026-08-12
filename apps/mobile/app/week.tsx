import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Suspense, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { Kicker, Rule } from "@/components/Marks";
import { MotionSurface } from "@/components/MotionSurface";
import { Seal } from "@/components/Seal";
import { api, type WeeklySummary } from "@/lib/api";
import { deviceTimezone, localToday, mondayOfWeek, shiftWeek } from "@/lib/dates";
import { lazySkia } from "@/lib/lazySkia";
import { useSession } from "@/state/session";
import { colors, fonts } from "@/theme";
import { type as scale } from "@tlon/design";

const LazyConstellation = lazySkia(() => import("@/components/Constellation"));

/**
 * A week, as a rhythm.
 *
 * What a week has that a day does not is shape — which days you wrote on and
 * which you did not. That was previously buried in seven date headings, most of
 * them followed by "0". Here it is the first thing on the screen: seven cells,
 * each as bright as it was busy.
 *
 * Empty days stay visible rather than being filtered out. A week with two entries
 * in it is a fact about the week, and hiding the five blank days would quietly
 * flatter the record. They are drawn dim, never as a gap to be filled — nothing
 * here suggests you should have written more.
 */
export default function WeekScreen() {
  const token = useSession((s) => s.token);
  const tz = deviceTimezone();
  const [week, setWeek] = useState(() => mondayOfWeek(localToday()));
  const current = week === mondayOfWeek(localToday());

  const query = useQuery({
    queryKey: ["summary", "week", week, tz],
    queryFn: () => api.weeklySummary(token!, week, tz),
    enabled: Boolean(token),
  });
  // Not a finding: these are the person's own words counted back to them, the
  // way the entry count is. It stays when patterns are switched off.
  const words = useQuery({
    queryKey: ["vocabulary", week, tz],
    queryFn: () => api.vocabulary(token!, week, tz, 1),
    enabled: Boolean(token),
  });

  if (!token) return null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.nav}>
        <MotionSurface onPress={() => setWeek(shiftWeek(week, -1))} hitSlop={12}>
          <Text style={styles.link}>← Previous</Text>
        </MotionSurface>
        <Text style={styles.date}>{week}</Text>
        <MotionSurface
          disabled={current}
          onPress={() => setWeek(shiftWeek(week, 1))}
          hitSlop={12}
        >
          <Text style={[styles.link, current && styles.disabled]}>Next →</Text>
        </MotionSurface>
      </View>

      {query.isLoading ? (
        <ActivityIndicator color={colors.violet} style={styles.loader} />
      ) : query.isError || !query.data ? (
        <Text style={styles.error}>Could not load this week.</Text>
      ) : (
        <>
          <Body summary={query.data} />
          {/* Placed under the week rather than above it: what you wrote comes
              first, and this is a remark about it. */}
          {words.data?.weeks.at(-1) && (
            <Text style={styles.vocabulary}>{words.data.weeks.at(-1)!.description}</Text>
          )}
        </>
      )}
    </ScrollView>
  );
}

function Body({ summary }: { summary: WeeklySummary }) {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const [picked, setPicked] = useState<string | null>(null);

  const busiest = Math.max(...summary.days.map((d) => d.entry_count), 1);
  const size = Math.min(width * 0.78, height * 0.3, 280);

  const points = [
    ...summary.days.flatMap((day) =>
      day.observations.map((observation) => ({
        id: observation.id,
        label: observation.content,
        kind: "entry",
        meta: day.date,
        weight: 1,
        tone: "Observation",
        tentative: false,
      })),
    ),
    ...summary.inferred.map((item) => ({
      id: item.id,
      label: item.label,
      kind: item.kind.toLowerCase(),
      meta: `${Math.round(item.confidence * 100)}% confident`,
      weight: item.confidence,
      tone: item.kind as string,
      tentative: item.tentative,
    })),
  ];
  const selected = points.find((p) => p.id === picked) ?? null;

  return (
    <>
      {/* Seven buckets, always all seven. */}
      <View style={styles.spine}>
        {summary.days.map((day) => (
          <View key={day.date} style={styles.cell}>
            <View
              style={[
                styles.bar,
                day.entry_count > 0 && styles.barActive,
                {
                  // Relative to the busiest day of this week, so the shape is
                  // about this week rather than an absolute scale.
                  opacity:
                    day.entry_count === 0
                      ? 0.14
                      : 0.35 + 0.65 * (day.entry_count / busiest),
                },
              ]}
            />
            <Text style={styles.cellDay}>{day.date.slice(8)}</Text>
            <Text style={styles.cellCount}>{day.entry_count}</Text>
          </View>
        ))}
      </View>

      {summary.entry_count === 0 ? (
        // Stated plainly, with no nudge to write. A week with nothing in it is a
        // fact about the week, not a failure to be corrected.
        <Text style={styles.empty}>Nothing recorded.</Text>
      ) : (
        <>
          <View style={styles.sky}>
            <Suspense fallback={<View style={{ height: size }} />}>
              <LazyConstellation
                data={points.map(({ id, weight, tone, tentative }) => ({
                  id,
                  weight,
                  tone,
                  tentative,
                }))}
                size={size}
                selected={picked}
                onSelect={setPicked}
                dotSize={7}
                frame="head"
              />
            </Suspense>
          </View>

          {selected ? (
            <MotionSurface
              style={styles.readout}
              onPress={() => router.push(`/node/${selected.id}`)}
              accessibilityRole="button"
            >
              <Text style={styles.readoutMeta}>
                {selected.kind}
                {selected.meta ? ` · ${selected.meta}` : ""}
                {selected.tentative ? " · tentative" : ""}
              </Text>
              <Text style={styles.readoutText} numberOfLines={3}>
                {selected.label}
              </Text>
            </MotionSurface>
          ) : (
            <Text style={styles.count}>
              {summary.entry_count} {summary.entry_count === 1 ? "entry" : "entries"} ·{" "}
              {summary.active_days} active {summary.active_days === 1 ? "day" : "days"}
            </Text>
          )}

          <Section title="What you wrote">
            {summary.days.flatMap((day) =>
              day.observations.map((observation) => (
                <MotionSurface
                  key={observation.id}
                  style={styles.wrote}
                  onPress={() => router.push(`/node/${observation.id}`)}
                >
                  <Seal id={observation.id} size={28} />
                  <Text style={[styles.body, styles.wroteText]}>{observation.content}</Text>
                </MotionSurface>
              )),
            )}
          </Section>

          {summary.recurring.length > 0 && (
            <Section title="Came up more than once">
              {summary.recurring.map((item) => (
                <Text key={`${item.kind}-${item.label}`} style={styles.body}>
                  {item.label} <Text style={styles.meta}>in {item.entries} entries</Text>
                </Text>
              ))}
            </Section>
          )}

          <Inferences
            title="Noticed"
            items={summary.inferred.filter((x) => !x.tentative)}
          />
          {/* Kept in its own section rather than mixed in and greyed out: a
              low-confidence guess beside a confident one reads as equally true
              however it is styled. */}
          <Inferences
            title="Less sure about"
            items={summary.inferred.filter((x) => x.tentative)}
          />

          <Text style={styles.footnote}>
            Readings are hypotheses drawn from your own words, not conclusions about
            you. Tap one to see its source entries.
          </Text>
        </>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      {/* The same head as every other section in both clients. */}
      <Kicker heading>{title}</Kicker>
      <Rule />
      {children}
    </View>
  );
}

function Inferences({
  title,
  items,
}: {
  title: string;
  items: WeeklySummary["inferred"];
}) {
  const router = useRouter();
  if (items.length === 0) return null;
  return (
    <Section title={title}>
      {items.map((item) => (
        <MotionSurface key={item.id} onPress={() => router.push(`/node/${item.id}`)}>
          <Text style={[styles.body, item.tentative && styles.quiet]}>
            {item.label}{" "}
            <Text style={styles.meta}>
              {item.kind.toLowerCase()} · {Math.round(item.confidence * 100)}% confident ·
              explain
            </Text>
          </Text>
        </MotionSurface>
      ))}
    </Section>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.room },
  content: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 48, gap: 8 },
  nav: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  link: { color: colors.inkSoft, fontFamily: fonts.sans, fontSize: 14, fontWeight: "700" },
  disabled: { opacity: 0.3 },
  date: { color: colors.ink, fontFamily: fonts.sans, fontSize: 16, fontWeight: "700" },
  spine: { flexDirection: "row", gap: 6, paddingVertical: 14 },
  cell: { flex: 1, alignItems: "center", gap: 5 },
  bar: { width: "100%", height: 34, borderRadius: 3, backgroundColor: colors.lineStrong },
  barActive: { backgroundColor: colors.cyan },
  cellDay: { color: colors.inkMuted, fontFamily: fonts.sans, fontSize: 11 },
  cellCount: { color: colors.inkSoft, fontFamily: fonts.sans, fontSize: 12, fontWeight: "700" },
  sky: { alignItems: "center", justifyContent: "center" },
  vocabulary: {
    color: colors.inkMuted,
    fontFamily: fonts.sans, fontSize: 13,
    lineHeight: 19,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  loader: { marginTop: 40 },
  error: { color: colors.danger, fontFamily: fonts.sans, fontSize: 14 },
  empty: { color: colors.inkMuted, fontFamily: fonts.sans, fontSize: 15, paddingTop: 20 },
  count: { color: colors.inkMuted, fontFamily: fonts.sans, fontSize: 13 },
  readout: { gap: 3 },
  readoutMeta: {
    color: colors.cyan,
    fontFamily: fonts.monoMedium, fontSize: scale.kicker.size,
    letterSpacing: scale.kicker.tracking,
    textTransform: "uppercase",
  },
  readoutText: { color: colors.ink, fontFamily: fonts.sans, fontSize: 16, lineHeight: 23 },
  wrote: { flexDirection: "row", gap: 10, alignItems: "flex-start", paddingVertical: 4 },
  wroteText: { flex: 1 },
  section: { gap: 6, paddingTop: 14 },
  heading: {
    color: colors.cyan,
    fontFamily: fonts.monoMedium, fontSize: scale.kicker.size,
    letterSpacing: scale.kicker.tracking,
    textTransform: "uppercase",
  },
  body: { color: colors.ink, fontFamily: fonts.sans, fontSize: 15, lineHeight: 22 },
  quiet: { color: colors.inkSoft },
  meta: { color: colors.inkMuted, fontFamily: fonts.sans, fontSize: 12 },
  footnote: { color: colors.inkMuted, fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, paddingTop: 18 },
});
