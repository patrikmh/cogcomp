import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Kicker, Rule } from "@/components/Marks";
import { MotionSurface } from "@/components/MotionSurface";
import { Seal } from "@/components/Seal";
import { WeekChart } from "@/components/WeekChart";
import { api, type WeeklySummary } from "@/lib/api";
import { deviceTimezone, localToday, mondayOfWeek, shiftWeek } from "@/lib/dates";
import { useSession } from "@/state/session";
import { colors, fonts } from "@/theme";
import { type as scale } from "@tlon/design";
import { Rising } from "@/components/Rise";

/**
 * A week, as a rhythm.
 *
 * What a week has that a day does not is shape — which days you wrote on and
 * which you did not. The prototype draws that as seven columns, each as tall as
 * its day was busy, growing out of a shared baseline in the order the week
 * happened. This client drew seven cells of equal height at varying opacity,
 * which encodes the same number in the one channel a person cannot compare, and
 * then put a turning constellation above them that said nothing at all.
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
  // The week before this one, so the two can be set side by side. A week's
  // shape means little on its own — "four of seven days" is only informative
  // against what the week before held.
  const other = useQuery({
    queryKey: ["summary", "week", shiftWeek(week, -1), tz],
    queryFn: () => api.weeklySummary(token!, shiftWeek(week, -1), tz),
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
      <Rising>
      {/* Which week, over which days, in whose clock — then the pager. The
          kicker says all three because "this week" means nothing without them
          once you have paged back twice. */}
      <View style={styles.nav}>
        <Kicker>{`${current ? "This week" : `Week of ${week}`} · Mon–Sun · ${tz}`}</Kicker>
        <View style={styles.pagers}>
          <MotionSurface
            style={styles.pager}
            onPress={() => setWeek(shiftWeek(week, -1))}
            hitSlop={12}
          >
            <Text style={styles.link}>← PREV</Text>
          </MotionSurface>
          <MotionSurface
            style={styles.pager}
            disabled={current}
            onPress={() => setWeek(shiftWeek(week, 1))}
            hitSlop={12}
          >
            <Text style={[styles.link, current && styles.disabled]}>NEXT →</Text>
          </MotionSurface>
        </View>
      </View>

      {query.isLoading ? (
        <ActivityIndicator color={colors.violet} style={styles.loader} />
      ) : query.isError || !query.data ? (
        <Text style={styles.error}>Could not load this week.</Text>
      ) : (
        <>
          <Body summary={query.data} other={other.data?.entry_count ?? 0} current={current} />
          {/* The words themselves, not a tally of them. This client fetched
              the vocabulary and printed only its description — "13 different
              words for how you felt" — while the words sat unread in the
              response. A count of someone's own language is the one summary
              with nothing in it they could not have counted themselves, and it
              withholds the only part worth showing back. */}
          {(words.data?.weeks.at(-1)?.words ?? []).length > 0 && (
            <Section title="Your own words for it" aside="counted, never interpreted">
              <View style={styles.words}>
                {words.data!.weeks.at(-1)!.words.map((word: string) => (
                  <Text key={word} style={styles.word}>
                    {word}
                  </Text>
                ))}
              </View>
              <Text style={styles.vocabulary}>{words.data!.weeks.at(-1)!.description}</Text>
            </Section>
          )}
        </>
      )}
      </Rising>
    </ScrollView>
  );
}

function Body({
  summary,
  other,
  current,
}: {
  summary: WeeklySummary;
  /** Acts in the week before this one, for the comparison. */
  other: number;
  current: boolean;
}) {
  const router = useRouter();


  const acts = summary.entry_count;
  const both = Math.max(acts, other, 1);
  const vs =
    acts === other
      ? "as many acts as the week before"
      : `${Math.abs(acts - other)} ${acts > other ? "more" : "fewer"} than the week before`;

  return (
    <>
      <Text style={styles.title}>Writing on {summary.active_days} of 7 days</Text>
      <Text style={styles.tally}>
        {acts} {acts === 1 ? "act" : "acts"} · {vs}
      </Text>

      {/* Two weeks side by side, as lengths. Counts only — no verdict about
          which of them was the better week. */}
      <View style={styles.vs}>
        <View style={styles.vsRow}>
          <Text style={styles.vsName}>{current ? "this week" : "that week"}</Text>
          <View style={styles.vsTrack}>
            <View style={[styles.vsFill, { width: `${Math.round((acts / both) * 100)}%` }]} />
          </View>
          <Text style={styles.vsCount}>{acts} acts</Text>
        </View>
        <View style={styles.vsRow}>
          <Text style={styles.vsName}>the week before</Text>
          <View style={styles.vsTrack}>
            <View style={[styles.vsFill, styles.vsFillOther, { width: `${Math.round((other / both) * 100)}%` }]} />
          </View>
          <Text style={styles.vsCount}>{other} acts</Text>
        </View>
      </View>

      <View style={styles.sectionRow}>
        <Kicker heading>The rhythm</Kicker>
        <View style={styles.ruleFill}>
          <Rule />
        </View>
        <Text style={styles.aside}>written days open</Text>
      </View>

      <WeekChart
        days={summary.days}
        today={localToday()}
        onOpen={() => router.push("/today")}
      />
      <Text style={styles.peek}>
        Written days open. Empty days stay visible: a quiet week is not a lapse.
      </Text>

      {summary.entry_count === 0 ? (
        // Stated plainly, with no nudge to write. A week with nothing in it is a
        // fact about the week, not a failure to be corrected.
        <Text style={styles.empty}>Nothing recorded.</Text>
      ) : (
        <>
          <Text style={styles.count}>
            {summary.entry_count} {summary.entry_count === 1 ? "entry" : "entries"} ·{" "}
            {summary.active_days} active {summary.active_days === 1 ? "day" : "days"}
          </Text>

          <Section title="What you wrote" aside="kept verbatim">
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
            <Section title="What kept returning" aside="strongest first">
              {summary.recurring.map((item) => (
                <Text key={`${item.kind}-${item.label}`} style={styles.body}>
                  {item.label} <Text style={styles.meta}>in {item.entries} entries</Text>
                </Text>
              ))}
            </Section>
          )}

          <Inferences
            title="What they left behind"
            aside="surest first"
            items={summary.inferred.filter((x) => !x.tentative)}
          />
          {/* Kept in its own section rather than mixed in and greyed out: a
              low-confidence guess beside a confident one reads as equally true
              however it is styled. */}
          <Inferences
            title="Still forming"
            aside="tentative — they may not hold"
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

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  /** How the section is ordered, or what it holds — at the far end of the
   *  rule, where the design puts it. */
  aside?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionRow}>
        <Kicker heading>{title}</Kicker>
        <View style={styles.ruleFill}>
          <Rule />
        </View>
        {aside ? <Text style={styles.aside}>{aside}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function Inferences({
  title,
  aside,
  items,
}: {
  title: string;
  aside?: string;
  items: WeeklySummary["inferred"];
}) {
  const router = useRouter();
  if (items.length === 0) return null;
  return (
    <Section title={title} aside={aside}>
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
  words: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  word: {
    color: colors.inkSoft,
    fontFamily: fonts.mono,
    fontSize: scale.meta.size,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 2,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  pagers: { flexDirection: "row", gap: 8 },
  /** Ghosted: paging is not what the screen is for. */
  pager: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 3,
    paddingVertical: 7,
    paddingHorizontal: 11,
  },
  title: {
    color: colors.ink,
    fontFamily: fonts.sansBold,
    fontSize: scale.title.size,
    lineHeight: scale.title.line,
    letterSpacing: scale.title.tracking,
    marginTop: 12,
  },
  tally: {
    color: colors.inkMuted,
    fontFamily: fonts.mono,
    fontSize: 10.5,
    lineHeight: 17,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginTop: 10,
  },
  vs: { gap: 9, marginTop: 18 },
  vsRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  vsName: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: scale.meta.size, width: 92 },
  vsTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.surfaceBright, overflow: "hidden" },
  vsFill: { height: 8, borderRadius: 4, backgroundColor: colors.cyan },
  /** The other week is drawn quieter: it is context, not the subject. */
  vsFillOther: { backgroundColor: colors.lineStrong },
  vsCount: { color: colors.inkSoft, fontFamily: fonts.mono, fontSize: scale.meta.size, width: 54, textAlign: "right" },
  sectionRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 30 },
  ruleFill: { flex: 1 },
  aside: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: scale.meta.size },
  peek: {
    marginTop: 12,
    minHeight: 20,
    color: colors.inkMuted,
    fontFamily: fonts.mono,
    fontSize: scale.kicker.size,
    lineHeight: 18,
    letterSpacing: 0.4,
  },
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
