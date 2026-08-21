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

import { SECTIONS, asideOf } from "@tlon/copy/sections";

import { Kicker, Rule } from "@/components/Marks";
import { ErrorLens } from "@/components/SpatialField";
import { MotionSurface } from "@/components/MotionSurface";
import { Seal } from "@/components/Seal";
import { WeekChart } from "@/components/WeekChart";
import { api, type IdentityNode, type Pattern, type Theme, type WeeklySummary } from "@/lib/api";
import {
  circlingOf,
  circlingThemesOf,
  feltReadingOf,
  feltThoughtOf,
  heldReadingsOf,
  namedRecurrenceOf,
  outerReadingsOf,
  namedOnlyDaysOf,
  quietHoldsOf,
  returningInnerOf,
  unplacedReadingsOf,
  unnamedDaysOf,
  VOCABULARY_LOOKBACK_WEEKS,
  vocabularyMarks,
} from "@/lib/drawnFrom";
import { patternDestination } from "@/lib/patterns";
import { deviceTimezone, localToday, mondayOfWeek, shiftWeek } from "@/lib/dates";
import { useSession } from "@/state/session";
import { usePreferences } from "@/state/preferences";
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
  const userId = useSession((s) => s.userId);
  const router = useRouter();
  const tz = deviceTimezone();
  const [week, setWeek] = useState(() => mondayOfWeek(localToday()));
  const current = week === mondayOfWeek(localToday());
  const showFindings = usePreferences((s) => s.findings);
  const preferencesReady = usePreferences((s) => s.ready);
  const findingsVisible = preferencesReady && showFindings;

  const query = useQuery({
    queryKey: ["summary", "week", week, tz, findingsVisible],
    queryFn: () => api.weeklySummary(token!, week, tz, findingsVisible),
    enabled: Boolean(token) && preferencesReady,
  });
  // The week before this one, so the two can be set side by side. A week's
  // shape means little on its own — "four of seven days" is only informative
  // against what the week before held.
  const other = useQuery({
    queryKey: ["summary", "week", shiftWeek(week, -1), tz, findingsVisible],
    queryFn: () => api.weeklySummary(token!, shiftWeek(week, -1), tz, findingsVisible),
    enabled: Boolean(token) && preferencesReady,
  });
  // Not a finding: these are the person's own words counted back to them, the
  // way the entry count is. It stays when patterns are switched off.
  const words = useQuery({
    queryKey: ["vocabulary", week, tz, VOCABULARY_LOOKBACK_WEEKS],
    queryFn: () => api.vocabulary(token!, week, tz, VOCABULARY_LOOKBACK_WEEKS),
    enabled: Boolean(token) && findingsVisible,
  });
  const patterns = useQuery({
    queryKey: ["patterns", userId],
    queryFn: () => api.listPatterns(token!),
    enabled: Boolean(token && userId) && findingsVisible,
  });
  const themes = useQuery({
    queryKey: ["themes", userId],
    queryFn: () => api.listThemes(token!),
    enabled: Boolean(token && userId) && findingsVisible,
  });
  const identity = useQuery({
    queryKey: ["identity", userId],
    queryFn: () => api.identity(token!),
    enabled: Boolean(token && userId) && findingsVisible,
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
            accessibilityRole="button"
            accessibilityLabel="Previous week"
          >
            <Text style={styles.link}>← PREV</Text>
          </MotionSurface>
          <MotionSurface
            style={styles.pager}
            disabled={current}
            onPress={() => setWeek(shiftWeek(week, 1))}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Next week"
          >
            <Text style={[styles.link, current && styles.disabled]}>NEXT →</Text>
          </MotionSurface>
        </View>
      </View>

      {query.isLoading ? (
        <ActivityIndicator color={colors.violet} style={styles.loader} />
      ) : query.isError || !query.data ? (
        <ErrorLens label="Could not load this week." onRetry={() => void query.refetch()} />
      ) : (
        <>
          <Body
            summary={query.data}
            other={other.data?.entry_count ?? 0}
            current={current}
            findingsVisible={findingsVisible}
            circlingList={
              findingsVisible
                ? circlingOf(query.data.inferred ?? [], patterns.data ?? [])
                : []
            }
            regionList={
              findingsVisible
                ? circlingThemesOf(query.data.inferred ?? [], themes.data ?? [])
                : []
            }
            quietList={
              findingsVisible
                ? quietHoldsOf(identity.data?.nodes ?? [], query.data.inferred ?? [])
                : []
            }
            aloneList={
              findingsVisible
                ? unplacedReadingsOf(
                    (query.data.inferred ?? []).filter(
                      (item: WeeklySummary["inferred"][number]) =>
                        item.kind !== "Pattern" && item.kind !== "Theme",
                    ),
                    themes.data ?? [],
                  )
                : []
            }
          />
          {/* The words themselves, not a tally of them. This client fetched
              the vocabulary and printed only its description — "13 different
              words for how you felt" — while the words sat unread in the
              response. A count of someone's own language is the one summary
              with nothing in it they could not have counted themselves, and it
              withholds the only part worth showing back. */}
          {findingsVisible && (words.data?.weeks.at(-1)?.words ?? []).length > 0 && (
            <Section title={SECTIONS.words.title} aside={asideOf("words", true)}>
              <View style={styles.words}>
                {vocabularyMarks(words.data!.weeks.at(-1)!).map((mark) => {
                  const reading = feltReadingOf(mark.word, query.data.inferred ?? []);
                  const label = `${mark.word}${mark.firstTime ? " · first time" : ""}`;
                  return reading ? (
                    <MotionSurface
                      key={mark.word}
                      style={styles.word}
                      onPress={() => router.push(`/node/${reading.id}`)}
                      accessibilityRole="button"
                      accessibilityLabel={`${label} — where this word was drawn from`}
                    >
                      <Text style={styles.wordLabel}>{label}</Text>
                    </MotionSurface>
                  ) : (
                    <Text key={mark.word} style={styles.word}>
                      {label}
                    </Text>
                  );
                })}
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
  findingsVisible,
  circlingList,
  regionList,
  quietList,
  aloneList,
}: {
  summary: WeeklySummary;
  /** Acts in the week before this one, for the comparison. */
  other: number;
  current: boolean;
  findingsVisible: boolean;
  circlingList: Pattern[];
  regionList: Theme[];
  quietList: IdentityNode[];
  aloneList: WeeklySummary["inferred"];
}) {
  const router = useRouter();


  const acts = summary.entry_count;
  const both = Math.max(acts, other, 1);
  // Summary responses contain both the person's observations and derived
  // readings. Keep the former available while hiding cached/current findings.
  const recurring = findingsVisible ? summary.recurring : [];
  const inferred = findingsVisible
    ? summary.inferred.filter((item) => item.kind !== "Pattern" && item.kind !== "Theme")
    : [];
  const unsaid = findingsVisible ? unnamedDaysOf(summary.days, summary.inferred) : [];
  const asked = findingsVisible ? namedOnlyDaysOf(summary.days, summary.inferred) : [];
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
          <Text style={styles.vsName}>last week</Text>
          <View style={styles.vsTrack}>
            <View style={[styles.vsFill, styles.vsFillOther, { width: `${Math.round((other / both) * 100)}%` }]} />
          </View>
          <Text style={styles.vsCount}>{other} acts</Text>
        </View>
      </View>

      <View style={styles.sectionRow}>
        <Kicker heading>{SECTIONS.rhythm.title}</Kicker>
        <View style={styles.ruleFill}>
          <Rule />
        </View>
        <Text style={styles.aside}>{asideOf("rhythm", true)}</Text>
      </View>

      <WeekChart
        days={summary.days}
        today={localToday()}
        onOpen={(date) => router.push(`/today?date=${date}`)}
      />
      <Text style={styles.peek}>
        Written days open. Empty days stay visible: a quiet week is not a lapse.
      </Text>

      {unsaid.length > 0 && (
        <Section title={SECTIONS.unsaid.title} aside={asideOf("unsaid", true)}>
          {unsaid.map((day) => (
            <MotionSurface
              key={day.date}
              style={styles.wrote}
              onPress={() => router.push(`/today?date=${day.date}`)}
              accessibilityRole="button"
              accessibilityLabel={`${day.date} — open this day`}
            >
              <Text style={styles.body}>
                {new Date(`${day.date}T12:00:00`).toLocaleDateString([], {
                  weekday: "long",
                  day: "numeric",
                  month: "short",
                })}
              </Text>
              <Text style={styles.meta}>
                {day.observations.length}{" "}
                {day.observations.length === 1 ? "act" : "acts"} · written, nothing inner
              </Text>
            </MotionSurface>
          ))}
        </Section>
      )}

      {asked.length > 0 && (
        <Section title={SECTIONS.asked.title} aside={asideOf("asked", true)}>
          {asked.map((day) => (
            <MotionSurface
              key={day.date}
              style={styles.wrote}
              onPress={() => router.push(`/today?date=${day.date}`)}
              accessibilityRole="button"
              accessibilityLabel={`${day.date} — named, no act written, open this day`}
            >
              <Text style={styles.body}>
                {new Date(`${day.date}T12:00:00`).toLocaleDateString([], {
                  weekday: "long",
                  day: "numeric",
                  month: "short",
                })}
              </Text>
              <Text style={styles.meta}>
                {day.observations.length}{" "}
                {day.observations.length === 1 ? "act" : "acts"} · the record, not the day
              </Text>
            </MotionSurface>
          ))}
        </Section>
      )}

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

          <Section title={SECTIONS.acts.title} aside={asideOf("acts", true)}>
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

          {recurring.length > 0 && (
            <Section title={SECTIONS.again.title} aside={asideOf("again", true)}>
              {recurring.map((item) => {
                const door = namedRecurrenceOf(item, inferred);
                return (
                  <MotionSurface
                    key={`${item.kind}-${item.label}`}
                    style={styles.wrote}
                    onPress={door ? () => router.push(`/node/${door.id}`) : undefined}
                    accessibilityRole={door ? "button" : undefined}
                    accessibilityLabel={`${item.label} — in ${item.entries} entries`}
                  >
                    <Text style={styles.body}>
                      {item.label}{" "}
                      <Text style={styles.meta}>
                        {item.kind.toLowerCase()} · {item.entries} entries · {item.days}{" "}
                        {item.days === 1 ? "day" : "days"}
                      </Text>
                    </Text>
                  </MotionSurface>
                );
              })}
            </Section>
          )}

          {circlingList.length > 0 && (
            <Section title={SECTIONS.circling.title} aside="this week belongs to">
              {circlingList.map((pattern) => (
                <MotionSurface
                  key={pattern.id}
                  style={styles.circle}
                  onPress={() => router.push(patternDestination(pattern).href)}
                  accessibilityRole="button"
                  accessibilityLabel={`${pattern.label} — open this pattern`}
                >
                  <Text style={styles.circleLabel}>{pattern.label}</Text>
                  <Text style={styles.circleMeta}>
                    {pattern.distinct_days} of {pattern.occurrences} days
                  </Text>
                  <Text style={styles.circleGo}>the pattern →</Text>
                </MotionSurface>
              ))}
            </Section>
          )}

          {regionList.length > 0 && (
            <Section title={SECTIONS.regions.title} aside={asideOf("regions", true)}>
              {regionList.map((theme) => (
                <MotionSurface
                  key={theme.id}
                  style={styles.circle}
                  onPress={() => router.push(`/theme/${theme.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`${theme.label} — open this region`}
                >
                  <Text style={styles.circleLabel}>{theme.label}</Text>
                  <Text style={styles.circleMeta}>{theme.member_count} things</Text>
                  <Text style={styles.circleGo}>the region →</Text>
                </MotionSurface>
              ))}
            </Section>
          )}
          <Inferences
            title={SECTIONS.alone.title}
            aside={asideOf("alone", true)}
            items={aloneList}
          />

          <Inferences
            title={SECTIONS.inside.title}
            aside={asideOf("inside", true)}
            items={feltThoughtOf(inferred).filter((x) => !x.tentative)}
          />
          <Inferences
            title={SECTIONS.holds.title}
            aside={asideOf("holds", true)}
            items={heldReadingsOf(inferred).filter((x) => !x.tentative)}
          />
          {quietList.length > 0 && (
            <Section title={SECTIONS.quiet.title} aside={asideOf("quiet", true)}>
              {quietList.map((reading) => (
                <MotionSurface
                  key={reading.id}
                  style={styles.circle}
                  onPress={() => router.push(`/node/${reading.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`${reading.label} — held, not written this week, open this reading`}
                >
                  <Text style={styles.circleLabel}>{reading.label}</Text>
                  <Text style={styles.circleMeta}>{reading.kind.toLowerCase()}</Text>
                </MotionSurface>
              ))}
            </Section>
          )}
          <Inferences
            title={SECTIONS.cameBack.title}
            aside={asideOf("cameBack", true)}
            items={returningInnerOf(inferred)}
          />
          <Inferences
            title={SECTIONS.kept.title}
            aside={asideOf("kept", true)}
            items={outerReadingsOf(inferred).filter((x) => !x.tentative)}
          />
          {/* Rooms stay under Still forming so a faint guess is never read as kept. */}
          {inferred.some((item) => item.tentative) && (
            <Section title={SECTIONS.forming.title} aside={asideOf("forming", true)}>
              <Inferences
                title={SECTIONS.inside.title}
                aside={asideOf("inside", true)}
                items={feltThoughtOf(inferred).filter((item) => item.tentative)}
              />
              <Inferences
                title={SECTIONS.holds.title}
                aside={asideOf("holds", true)}
                items={heldReadingsOf(inferred).filter((item) => item.tentative)}
              />
              <Inferences
                title={SECTIONS.around.title}
                aside={asideOf("around", true)}
                items={outerReadingsOf(inferred).filter((item) => item.tentative)}
              />
            </Section>
          )}

          {findingsVisible && (
            <Text style={styles.footnote}>
              Readings are hypotheses drawn from your own words, not conclusions about
              you. Tap one to see its source entries.
            </Text>
          )}
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
  wordLabel: {
    color: colors.inkSoft,
    fontFamily: fonts.mono,
    fontSize: scale.meta.size,
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
  // Uppercase and letter-spaced, as the design sets `.w-vs-row > .mono`. Left
  // in sentence case these two labels read as body text beside their bars
  // rather than as the axis they are.
  vsName: {
    color: colors.inkSoft,
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase",
    width: 92,
  },
  vsTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.track, overflow: "hidden" },
  vsFill: { height: 8, borderRadius: 4, backgroundColor: colors.ink },
  /** The other week is drawn quieter: it is context, not the subject. */
  vsFillOther: { backgroundColor: colors.lineStrong },
  vsCount: { color: colors.ink, fontFamily: fonts.mono, fontSize: scale.meta.size, width: 54, textAlign: "right" },
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
  nav: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    // Wraps, as the design's row wraps: the week and its zone are a long line
    // on a phone, and without this the pagers were squeezed against them
    // instead of dropping to their own line.
    flexWrap: "wrap",
    gap: 8,
  },
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
    fontFamily: fonts.mono, fontSize: scale.kicker.size,
    letterSpacing: scale.kicker.tracking,
    textTransform: "uppercase",
  },
  readoutText: { color: colors.ink, fontFamily: fonts.sans, fontSize: 16, lineHeight: 23 },
  wrote: { flexDirection: "row", gap: 10, alignItems: "flex-start", paddingVertical: 4 },
  wroteText: { flex: 1 },
  circle: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 12,
    paddingVertical: 10,
  },
  circleLabel: { color: colors.ink, fontFamily: fonts.sans, fontSize: 15, flexShrink: 1 },
  circleMeta: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: scale.meta.size },
  circleGo: { marginLeft: "auto", color: colors.cyan, fontFamily: fonts.mono, fontSize: scale.meta.size },
  section: { gap: 6, paddingTop: 14 },
  heading: {
    color: colors.cyan,
    fontFamily: fonts.mono, fontSize: scale.kicker.size,
    letterSpacing: scale.kicker.tracking,
    textTransform: "uppercase",
  },
  body: { color: colors.ink, fontFamily: fonts.sans, fontSize: 15, lineHeight: 22 },
  quiet: { color: colors.inkSoft },
  meta: { color: colors.inkMuted, fontFamily: fonts.sans, fontSize: 12 },
  footnote: { color: colors.inkMuted, fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, paddingTop: 18 },
});
