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

import { Chip, Kicker, Rule } from "@/components/Marks";
import { MotionSurface } from "@/components/MotionSurface";
import { Rise } from "@/components/Rise";
import { Seal } from "@/components/Seal";
import { api, type DailySummary } from "@/lib/api";
import { deviceTimezone, localToday, shiftDay } from "@/lib/dates";
import { lazySkia } from "@/lib/lazySkia";
import { useSession } from "@/state/session";
import { colors, fonts } from "@/theme";
import { type as scale } from "@tlon/design";

const LazyConstellation = lazySkia(() => import("@/components/Constellation"));

/**
 * One day, as an object.
 *
 * The day is drawn first: what you wrote and everything drawn from it, in one
 * turning shape. Entries are filled and heavy, guesses hollow and slight, and
 * pointing at any of them reads it out. That is the whole day in a glance rather
 * than four stacked lists.
 *
 * The two named groups below survive on purpose. Separating what was noticed from
 * what is only suspected is not clutter — it is the one distinction this product
 * exists to keep, and a guess sitting beside a certainty reads as equally true
 * however it is styled. So the picture got shorter and the epistemics stayed.
 * What went was the kicker, the title, the subtitle, and the framed rail.
 */
export default function TodayScreen() {
  const token = useSession((s) => s.token);
  const [day, setDay] = useState(localToday());
  const tz = deviceTimezone();

  const summary = useQuery({
    queryKey: ["summary", day, tz],
    queryFn: () => api.dailySummary(token!, day, tz),
    enabled: Boolean(token),
  });

  // The auth gate in _layout redirects before this renders when signed out.
  if (!token) return null;

  const isToday = day === localToday();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.nav}>
        <MotionSurface onPress={() => setDay(shiftDay(day, -1))} hitSlop={12}>
          <Text style={styles.navLink}>← Previous</Text>
        </MotionSurface>
        <Text style={styles.date}>{isToday ? "Today" : day}</Text>
        <MotionSurface
          onPress={() => setDay(shiftDay(day, 1))}
          hitSlop={12}
          // There is nothing recorded in the future.
          disabled={isToday}
        >
          <Text style={[styles.navLink, isToday && styles.disabled]}>Next →</Text>
        </MotionSurface>
      </View>

      {summary.isLoading ? (
        <ActivityIndicator color={colors.violet} style={styles.loader} />
      ) : summary.isError || !summary.data ? (
        <Text style={styles.error}>Could not load this day.</Text>
      ) : (
        <SummaryBody summary={summary.data} />
      )}
    </ScrollView>
  );
}

function SummaryBody({ summary }: { summary: DailySummary }) {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const [picked, setPicked] = useState<string | null>(null);

  if (summary.entry_count === 0) {
    // Stated plainly, with no nudge to write. A day with nothing in it is a fact
    // about the day, not a failure to be corrected.
    return <Text style={styles.empty}>Nothing recorded.</Text>;
  }

  const confident = summary.inferred.filter((i) => !i.tentative);
  const tentative = summary.inferred.filter((i) => i.tentative);
  const size = Math.min(width * 0.8, height * 0.32, 290);

  const points = [
    ...summary.observations.map((observation) => ({
      id: observation.id,
      // Entries are the fixed points everything else hangs off, so they are the
      // heaviest things in the day regardless of any score.
      weight: 1,
      tone: "Observation",
      tentative: false,
      label: observation.content,
      kind: "entry",
    })),
    ...summary.inferred.map((item) => ({
      id: item.id,
      weight: item.confidence,
      tone: item.kind as string,
      tentative: item.tentative,
      label: item.label,
      kind: item.kind.toLowerCase(),
    })),
  ];
  const current = points.find((p) => p.id === picked) ?? null;

  return (
    <>
      <View style={styles.sky}>
        <Suspense fallback={<View style={{ height: size }} />}>
          <LazyConstellation
            data={points.map(({ id, weight, tone, tentative: guess }) => ({
              id,
              weight,
              tone,
              tentative: guess,
            }))}
            size={size}
            selected={picked}
            onSelect={setPicked}
            dotSize={7}
          />
        </Suspense>
      </View>

      {current ? (
        <MotionSurface
          style={styles.readout}
          onPress={() => router.push(`/node/${current.id}`)}
          accessibilityRole="button"
        >
          <Text style={styles.readoutMeta}>
            {current.kind}
            {current.tentative ? " · tentative" : ""}
          </Text>
          <Text style={styles.readoutText} numberOfLines={3}>
            {current.label}
          </Text>
        </MotionSurface>
      ) : (
        <Text style={styles.count}>
          {summary.entry_count} {summary.entry_count === 1 ? "entry" : "entries"}
        </Text>
      )}

      <Section title="What you wrote">
        {summary.observations.map((observation, i) => (
          <Rise key={observation.id} index={i}>
          <MotionSurface
            style={styles.wrote}
            onPress={() => router.push(`/node/${observation.id}`)}
          >
            <Seal id={observation.id} size={28} />
            <Text style={[styles.body, styles.wroteText]}>{observation.content}</Text>
          </MotionSurface>
          </Rise>
        ))}
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

      {confident.length > 0 && (
        <Section title="Noticed">
          {confident.map((item) => (
            <Inference key={item.id} item={item} />
          ))}
        </Section>
      )}

      {tentative.length > 0 && (
        <Section title="Less sure about">
          {/* A separate section rather than mixed in and greyed out. A
              low-confidence guess sitting next to a confident one reads as
              equally true no matter how it is styled. */}
          {tentative.map((item) => (
            <Inference key={item.id} item={item} tentative />
          ))}
        </Section>
      )}

      <Text style={styles.footnote}>
        Everything under “Noticed” and “Less sure about” is a guess drawn from your
        entries, not a conclusion about you. Tap one to see which words it came
        from.
      </Text>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      {/* Kicker and rule, as the web has them. This was a green sans label,
          which read as a heading competing with the words underneath rather
          than as a marking on the side of the instrument. */}
      <Kicker heading>{title}</Kicker>
      <Rule />
      {children}
    </View>
  );
}

function Inference({
  item,
  tentative = false,
}: {
  item: DailySummary["inferred"][number];
  tentative?: boolean;
}) {
  const router = useRouter();
  return (
    <MotionSurface onPress={() => router.push(`/node/${item.id}`)} style={styles.reading}>
      <Chip label={item.label} confidence={item.confidence} tentative={tentative || item.tentative} />
    </MotionSurface>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.room },
  content: { paddingHorizontal: 20, paddingBottom: 44, paddingTop: 10, gap: 8 },
  nav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  navLink: { color: colors.inkSoft, fontFamily: fonts.sans, fontSize: 14, fontWeight: "700" },
  disabled: { opacity: 0.3 },
  date: { color: colors.ink, fontFamily: fonts.sans, fontSize: 16, fontWeight: "700" },
  sky: { alignItems: "center", justifyContent: "center" },
  loader: { marginTop: 40 },
  error: { color: colors.danger, fontFamily: fonts.sans, fontSize: 14 },
  empty: { color: colors.inkMuted, fontFamily: fonts.sans, fontSize: 15, paddingTop: 24 },
  count: { color: colors.inkMuted, fontFamily: fonts.sans, fontSize: 13 },
  readout: { gap: 3, paddingBottom: 2 },
  readoutMeta: {
    color: colors.cyan,
    fontFamily: fonts.monoMedium, fontSize: scale.kicker.size,
    letterSpacing: scale.kicker.tracking,
    textTransform: "uppercase",
  },
  readoutText: { color: colors.ink, fontFamily: fonts.sans, fontSize: 16, lineHeight: 23 },
  wrote: { flexDirection: "row", gap: 10, alignItems: "flex-start", paddingVertical: 4 },
  wroteText: { flex: 1 },
  reading: { paddingVertical: 3 },
  section: { gap: 6, paddingTop: 12 },
  sectionTitle: {
    color: colors.cyan,
    fontFamily: fonts.monoMedium, fontSize: scale.kicker.size,
    letterSpacing: scale.kicker.tracking,
    textTransform: "uppercase",
  },
  body: { color: colors.ink, fontFamily: fonts.sans, fontSize: 15, lineHeight: 22 },
  quiet: { color: colors.inkSoft },
  meta: { color: colors.inkMuted, fontFamily: fonts.sans, fontSize: 12 },
  footnote: { color: colors.inkMuted, fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, paddingTop: 16 },
});
