import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { Chip, Kicker, Meter, Rule, Spine } from "@/components/Marks";
import { MotionSurface } from "@/components/MotionSurface";
import { Rise, Rising } from "@/components/Rise";
import { Seal } from "@/components/Seal";
import { api, type DailySummary } from "@/lib/api";
import { deviceTimezone, localToday, shiftDay } from "@/lib/dates";
import { useDrawnFrom } from "@/lib/drawnFrom";
import { usePreferences } from "@/state/preferences";
import { useSession } from "@/state/session";
import { colors, fonts } from "@/theme";
import { type as scale } from "@tlon/design";
import { Guide } from "@/components/Guide";

/**
 * One day, as it happened.
 *
 * The web opens this with the acts themselves, kept verbatim, each with its
 * time, its seal and what was drawn from it — the same shape the journal uses,
 * because an act is an act wherever it is read. This client opened with a
 * turning cloud of dots instead, which put the day's own words below the fold
 * and said nothing about any of them except how confident something was.
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
      <Rising>
      <View style={styles.nav}>
        {/* Named days, not "previous" and "next": the button says where it
            goes, so moving through the week never needs a mental subtraction.
            The web client has said this for as long as it has had the screen. */}
        <MotionSurface style={styles.pager} onPress={() => setDay(shiftDay(day, -1))} hitSlop={12}>
          <Text style={styles.navLink}>← {weekdayOf(shiftDay(day, -1))}</Text>
        </MotionSurface>
        <View style={styles.dayRow}>
          <Text style={styles.date}>{isToday ? "Today" : day}</Text>
          {/* Beside the day rather than a heading: this screen has none,
              because the day names itself. */}
          <Guide id="today" />
        </View>
        <MotionSurface
          style={styles.pager}
          onPress={() => setDay(shiftDay(day, 1))}
          hitSlop={12}
          // There is nothing recorded in the future.
          disabled={isToday}
        >
          <Text style={[styles.navLink, isToday && styles.disabled]}>
            {weekdayOf(shiftDay(day, 1))} →
          </Text>
        </MotionSurface>
      </View>

      {summary.isLoading ? (
        <ActivityIndicator color={colors.violet} style={styles.loader} />
      ) : summary.isError || !summary.data ? (
        <Text style={styles.error}>Could not load this day.</Text>
      ) : (
        <SummaryBody summary={summary.data} day={day} />
      )}
      </Rising>
    </ScrollView>
  );
}

function SummaryBody({ summary, day }: { summary: DailySummary; day: string }) {
  const router = useRouter();
  const token = useSession((state) => state.token);
  const userId = useSession((state) => state.userId);
  const showFindings = usePreferences((state) => state.findings);
  const drawnFrom = useDrawnFrom(token, userId);

  // The recurrences today's material belongs to. The count goes in the line
  // under the heading — "three patterns circling" is a fact about the day, not
  // a separate topic — and the first one gets the link at the end of the day.
  const patterns = useQuery({
    queryKey: ["patterns", userId],
    queryFn: () => api.listPatterns(token!),
    enabled: Boolean(token) && showFindings,
  });
  const circlingList = patterns.data ?? [];
  const circling = circlingList[0];

  if (summary.entry_count === 0) {
    // Stated plainly, with no nudge to write. A day with nothing in it is a fact
    // about the day, not a failure to be corrected.
    return <Text style={styles.empty}>Nothing recorded. The day stays empty until it isn’t.</Text>;
  }

  const confident = summary.inferred.filter((i) => !i.tentative);
  const tentative = summary.inferred.filter((i) => i.tentative);

  return (
    <>
      <Text style={styles.sub}>
        Not objects in space — a heterogeneous series of independent acts.{" "}
        {new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: "long" })}, as it
        happened.
      </Text>
      {/* What the day holds, counted. The web states this before anything is
          drawn, so the shape of the day is known before it is read. */}
      <Text style={styles.tally}>
        {`${summary.entry_count} ${summary.entry_count === 1 ? "act" : "acts"} · ${
          summary.inferred.length
        } ${summary.inferred.length === 1 ? "reading" : "readings"} drawn${
          circlingList.length > 0
            ? ` · ${circlingList.length} ${circlingList.length === 1 ? "pattern" : "patterns"} circling`
            : ""
        }`}
      </Text>

      {/* Kicker, rule and aside on one line, as the web sets them: the rule
          takes the space between what the section is and what it promises. */}
      <View style={styles.sectionRow}>
        <Kicker heading>The acts</Kicker>
        <View style={styles.ruleFill}>
          <Rule />
        </View>
        <Text style={styles.aside}>kept verbatim</Text>
      </View>
      {summary.observations.map((observation, i) => (
        <Rise key={observation.id} index={i}>
          <MotionSurface
            style={styles.entry}
            onPress={() => router.push(`/node/${observation.id}`)}
            accessibilityRole="button"
            accessibilityLabel={observation.content}
          >
            <Spine time={shortTime(observation.captured_at)} lit={i === 0} />
            <View style={styles.act}>
              <Seal id={observation.id} size={34} />
              <View style={styles.actBody}>
                <Text style={styles.body}>{observation.content}</Text>
                {(drawnFrom.get(observation.id)?.length ?? 0) > 0 ? (
                  <View style={styles.chipRow}>
                    <Kicker>Drawn from this</Kicker>
                    <View style={styles.chips}>
                      {drawnFrom.get(observation.id)!.slice(0, 4).map((r) => (
                        <Chip
                          key={r.id}
                          label={r.label}
                          confidence={r.confidence}
                          tentative={r.tentative}
                        />
                      ))}
                    </View>
                  </View>
                ) : (
                  <Text style={styles.meta}>nothing drawn from this yet</Text>
                )}
              </View>
            </View>
          </MotionSurface>
        </Rise>
      ))}

      {confident.length > 0 && (
        <Section title="What they left behind" aside="surest first">
          {confident.map((item) => (
            <Inference key={item.id} item={item} />
          ))}
        </Section>
      )}

      {tentative.length > 0 && (
        <Section title="Less sure" aside="unobserved, they grow vague">
          {/* A separate section rather than mixed in and greyed out. A
              low-confidence guess sitting next to a confident one reads as
              equally true no matter how it is styled. */}
          {tentative.map((item) => (
            <Inference key={item.id} item={item} tentative />
          ))}
        </Section>
      )}

      {/* What today's material is part of, and the way to it. This was a list
          of labels under "Came up more than once" with no route out: you could
          see that something had come up twice and had nowhere to go with it.
          The design ends the day here, on a link to the recurrence. */}
      {circling && (
        <Section title="Circling">
          <MotionSurface
            style={styles.circle}
            onPress={() => router.push("/patterns")}
            accessibilityRole="button"
            accessibilityLabel={`${circling.label} — open patterns`}
          >
            <Text style={styles.circleLabel}>{circling.label}</Text>
            <Text style={styles.circleMeta}>
              {circling.distinct_days} of {circling.occurrences} days
            </Text>
            <Text style={styles.circleGo}>the pattern →</Text>
          </MotionSurface>
        </Section>
      )}

      {/* Only where there is something for it to be about. A note explaining
          two sections that are not on the screen describes a screen the person
          is not looking at. */}
      {summary.inferred.length > 0 && (
        <Text style={styles.footnote}>
          Everything under “What they left behind” and “Less sure” is a guess drawn from your
          entries, not a conclusion about you. Tap one to see which words it came
          from.
        </Text>
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
  /** The design sets a short phrase at the far end of the rule saying how the
   *  section is ordered or what it holds. */
  aside?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      {/* Kicker and rule, as the web has them. This was a green sans label,
          which read as a heading competing with the words underneath rather
          than as a marking on the side of the instrument. */}
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

/**
 * A reading, as the design draws one: its seal, what it says, what kind of
 * thing it is and how many entries it rests on, and a meter for how sure the
 * record is.
 *
 * This was a bare chip. A chip is right beside an act — it is a pointer to
 * something drawn from the words above it — but in a list of its own it says
 * only a label and a number, with no seal to recognise it by and no meter to
 * read the confidence off. The two places had the same content and one of them
 * was doing none of the work.
 */
function Inference({
  item,
  tentative = false,
}: {
  item: DailySummary["inferred"][number];
  tentative?: boolean;
}) {
  const router = useRouter();
  const unsure = tentative || item.tentative;
  const cites = item.cites_entries ?? 0;
  return (
    <MotionSurface
      onPress={() => router.push(`/node/${item.id}`)}
      style={styles.reading}
      accessibilityRole="button"
      accessibilityLabel={item.label}
    >
      <Seal id={item.id} size={34} />
      <View style={styles.readingMain}>
        <Text style={[styles.readingLabel, unsure && styles.readingLabelFaint]}>{item.label}</Text>
        <Text style={styles.readingMeta}>
          {item.kind.toLowerCase()}
          {cites ? ` · ${cites} ${cites === 1 ? "entry" : "entries"}` : ""}
        </Text>
      </View>
      <View style={styles.readingSide}>
        <Meter confidence={item.confidence} tentative={unsure} />
      </View>
    </MotionSurface>
  );
}

/** Just the clock time. The day is named at the top of the screen, so the date
 *  on every act would be the same date repeated. */
/** Three letters, uppercased by the style — which day the pager goes to. */
function weekdayOf(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: "short" });
}

function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const styles = StyleSheet.create({
  circle: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 2,
  },
  circleLabel: { color: colors.ink, fontFamily: fonts.sansSemi, fontSize: scale.body.size },
  circleMeta: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: scale.meta.size },
  circleGo: { marginLeft: "auto", color: colors.cyan, fontFamily: fonts.mono, fontSize: scale.meta.size },
  reading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingVertical: 13,
    paddingHorizontal: 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  readingMain: { flex: 1, minWidth: 0, gap: 5 },
  readingLabel: { color: colors.ink, fontFamily: fonts.sansSemi, fontSize: scale.body.size },
  readingLabelFaint: { color: colors.inkSoft },
  readingMeta: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: scale.meta.size },
  readingSide: { flexDirection: "row", alignItems: "center", gap: 12, flexShrink: 0, width: 96 },
  dayRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  /** Ghosted, because navigation is not the point of the screen. */
  pager: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 3,
    paddingVertical: 7,
    paddingHorizontal: 11,
  },
  sub: {
    color: colors.inkMuted,
    fontFamily: fonts.sans,
    fontSize: scale.body.size,
    lineHeight: scale.body.line,
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
  aside: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: scale.meta.size },
  entry: { flexDirection: "row", gap: 10, alignItems: "flex-start", paddingVertical: 6 },
  act: { flexDirection: "row", gap: 10, flex: 1, alignItems: "flex-start" },
  actBody: { flex: 1, gap: 6 },
  sectionRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  ruleFill: { flex: 1 },
  chipRow: { gap: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  screen: { flex: 1, backgroundColor: colors.room },
  content: { paddingHorizontal: 20, paddingBottom: 44, paddingTop: 10, gap: 8 },
  nav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  navLink: {
    color: colors.inkMuted,
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
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
