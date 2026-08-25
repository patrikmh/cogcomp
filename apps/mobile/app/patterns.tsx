import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";

import { ScrollView, StyleSheet, Text, View } from "react-native";
import { radii, type as scale } from "@tlon/design";

import { Kicker, Meter, Rule } from "@/components/Marks";
import { deviceTimezone } from "@/lib/dates";
import { SECTIONS, asideOf } from "@tlon/copy/sections";
import { MotionSurface } from "@/components/MotionSurface";
import { Observatory } from "@/components/Observatory";
import { Rise } from "@/components/Rise";
import { Seal } from "@/components/Seal";
import { STRIP_CELLS, daysOfFortnight } from "@tlon/design/marks";

import { Composition } from "@/components/Composition";
import { ErrorLens } from "@/components/SpatialField";
import { Strip } from "@/components/Strip";
import { StripLegend } from "@/components/StripLegend";
import { colors, fonts } from "@/theme";
import { api, type GatheringCandidate, type Pattern, type PatternThread, type TemporalChange, type Theme } from "@/lib/api";
import { normaliseLabel, patternDestination, patternMeta, shiftsForSubjects } from "@/lib/patterns";
import { usePreferences } from "@/state/preferences";
import { useSession } from "@/state/session";
import { HEADINGS } from "@tlon/copy/headings";
import { EMPTY as EMPTY_COPY } from "@tlon/copy/empty";

/**
 * What keeps returning.
 *
 * Recurrence is the one thing a pattern *is*, so it is what drives the picture:
 * a pattern that came up in eight entries is a bigger point than one that came up
 * in three. That is the whole legend, and it needs no key.
 *
 * The count travels with the label everywhere it appears. A pattern shown without
 * "in 4 entries across 3 days" is an assertion about someone; shown with it, it
 * is an observation they can check.
 */
export default function PatternsScreen() {
  const token = useSession((s) => s.token);
  const userId = useSession((s) => s.userId);
  const router = useRouter();
  const queryClient = useQueryClient();
  const showFindings = usePreferences((s) => s.findings);
  const setFindings = usePreferences((s) => s.setFindings);

  const patterns = useQuery({
    queryKey: ["patterns", userId],
    queryFn: () => api.listPatterns(token!),
    enabled: Boolean(token && userId) && showFindings,
  });

  const gathering = useQuery({
    queryKey: ["gathering", userId],
    queryFn: () => api.listGathering(token!),
    enabled: Boolean(token && userId) && showFindings,
  });

  const themes = useQuery({
    queryKey: ["themes", userId],
    queryFn: () => api.listThemes(token!),
    // Same condition as the patterns above: with findings off, the app does not
    // ask the server for conclusions the person has said they do not want.
    enabled: Boolean(token && userId) && showFindings,
  });

  const threads = useQuery({
    queryKey: ["threads", userId],
    queryFn: () => api.listThreads(token!),
    // Same gate as the patterns and regions below: with findings off, the app
    // does not ask the server for a view of conclusions it is not showing.
    enabled: Boolean(token && userId) && showFindings,
  });
  const changes = useQuery({
    queryKey: ["temporal", deviceTimezone()],
    queryFn: () => api.temporalChanges(token!, deviceTimezone()),
    enabled: Boolean(token && userId) && showFindings,
  });

  const mine = useMutation({
    mutationFn: () => api.minePatterns(token!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["patterns", userId] });
      void queryClient.invalidateQueries({ queryKey: ["graph"] });
      // Mining produces regions as well as recurrences, and this screen shows
      // both now. Without this, "Look again" refreshed half of what it found.
      void queryClient.invalidateQueries({ queryKey: ["themes", userId] });
    },
  });

  if (!token) return null;

  if (!showFindings) {
    // A screen that says what it is not showing, and undoes it in one tap. The
    // person turned this off; nothing here should argue with that, and nothing
    // should make finding the way back a hunt through settings.
    return (
      <Observatory
        eyebrow={HEADINGS.patterns.kicker}
        title={HEADINGS.patterns.title}
        data={[]}
        selected={null}
        onSelect={() => undefined}
        detail={null}
        empty="Patterns are turned off. Everything you have written is still kept, and nothing here has been deleted."
        action={{ label: "Show patterns again", onPress: () => void setFindings(true) }}
      />
    );
  }

  if (patterns.isError) return <ErrorLens label="Could not load patterns." onRetry={() => void patterns.refetch()} />;

  const found: Pattern[] = patterns.data ?? [];
  const held = found.filter((p) => !p.tentative).sort((a, b) => b.distinct_days - a.distinct_days);
  const forming = found.filter((p) => p.tentative);
  // Days against the fortnight, which is what the design divides by: its
  // fixtures all read `busiest: 14`, and 14 is the same window the strip under
  // each finding draws. Sizing against the busiest finding instead would make
  // the strongest one always full, which says nothing — every record has a
  // strongest. Sizing against occurrences would compare days to mentions.
  const fortnight = STRIP_CELLS;

  return (
    // The web's list, not a cloud of points. A finding is a claim with a shape:
    // its seal, what it says, and the fortnight it rests on drawn underneath.
    // A point sized by recurrence said only "this one is bigger".
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* The design's way round: the kicker names the screen, the title says
          what the screen claims. This had them inverted, so the heading was the
          word "Patterns" — which the tab bar already says — and the claim was
          demoted to a label. */}
      {/* The zone belongs here as it does on Today and Week. This screen counts
          days — "3 of 14 writing days" — and which clock decides where a day
          ends decides what it counted. */}
      <Kicker>{`${HEADINGS.patterns.kicker} · ${deviceTimezone()}`}</Kicker>
      <Text style={styles.title}>{HEADINGS.patterns.title}</Text>
      <Text style={styles.sub}>
        {found.length === 0
          ? EMPTY_COPY.patternsWaiting
          : `${held.length} held. Counts, not verdicts — each one opens to the entries it counted.`}
      </Text>

      {/* Named and ruled, as Today and Week name their sections and as the
          design names this one. The rule was here on its own, which drew the
          line without saying what it divided or that the findings below it are
          ordered. The copy for it was written and never wired up. */}
      {/* Threads: findings that rest on the same thing, grouped. The grouping
          is arithmetic — members share an evidence word — so each member keeps
          its own claim and its own way in. Shown above the flat list because a
          group of rows that all rest on one word reads as unrelated facts. */}
      {(threads.data ?? []).length > 0 && (
        <>
          <View style={styles.sectionRow}>
            <Kicker heading>One thing, several directions</Kicker>
            <View style={styles.ruleFill}>
              <Rule />
            </View>
            <Text style={styles.aside}>grouped only by shared evidence words</Text>
          </View>
          {(threads.data ?? []).map((thread: PatternThread, i: number) => {
            const shifts = shiftsForSubjects(changes.data?.changes ?? [], thread.subjects);
            return (
              <Rise key={thread.subjects.join("\u0000")} index={i}>
                <View style={styles.row}>
                  <Text style={styles.label}>{thread.subjects.join(" · ")}</Text>
                  <Kicker>{`${thread.members.filter((m) => !m.tentative).length} held of ${thread.members.length} findings`}</Kicker>
                  <View style={styles.threadMembers}>
                    {thread.members.map((member) => (
                      <MotionSurface
                        key={member.id}
                        style={styles.threadMember}
                        onPress={() => router.push(patternDestination(member).href)}
                        accessibilityRole="button"
                        accessibilityLabel={member.label}
                      >
                        <Text
                          style={[
                            styles.threadMemberLabel,
                            member.tentative ? styles.ghost : null,
                          ]}
                        >
                          {member.label}
                        </Text>
                        <Kicker>{patternMeta(member)}</Kicker>
                      </MotionSurface>
                    ))}
                    {shifts.map((shift: TemporalChange) => (
                      <MotionSurface
                        key={`${shift.kind}:${shift.label}`}
                        style={styles.threadMember}
                        onPress={() => router.push("/week")}
                        accessibilityRole="button"
                        accessibilityLabel={shift.description}
                      >
                        <Text
                          style={[
                            styles.threadMemberLabel,
                            shift.confidence < 0.5 ? styles.ghost : null,
                          ]}
                        >
                          {shift.description}
                        </Text>
                        <Kicker>changed lately · this week vs last</Kicker>
                      </MotionSurface>
                    ))}
                  </View>
                </View>
              </Rise>
            );
          })}
        </>
      )}

      {held.length > 0 && (
        <>
          <View style={styles.sectionRow}>
            <Kicker heading>{SECTIONS.returning.title}</Kicker>
            <View style={styles.ruleFill}>
              <Rule />
            </View>
            <Text style={styles.aside}>{asideOf("returning", true)}</Text>
          </View>
          {held.map((pattern, i) => (
            <Finding key={pattern.id} pattern={pattern} index={i} token={token!} fortnight={fortnight} />
          ))}
        </>
      )}

      {(gathering.data?.candidates ?? []).length > 0 && (
        <>
          <View style={styles.sectionRow}>
            <Kicker heading>Still gathering</Kicker>
            <View style={styles.ruleFill}>
              <Rule />
            </View>
            <Text style={styles.aside}>not a finding yet — one entry short</Text>
          </View>
          {(gathering.data?.candidates ?? []).map((c: GatheringCandidate) => (
            <MotionSurface key={`${c.kind}:${c.label}`} style={styles.ghost}>
              <View style={{ padding: 12, gap: 4 }}>
                <Text style={[styles.label, styles.ghost]}>{c.label}</Text>
                <Kicker>{`${c.observations} entries on ${c.distinct_days} days · a finding needs ${c.observations_needed} across ${c.days_needed}`}</Kicker>
              </View>
            </MotionSurface>
          ))}
        </>
      )}

      {forming.length > 0 && (
        <>
          <View style={styles.sectionRow}>
            <Kicker heading>{SECTIONS.forming.title}</Kicker>
            <View style={styles.ruleFill}>
              <Rule />
            </View>
            <Text style={styles.aside}>{asideOf("forming", true)}</Text>
          </View>
          {forming.map((pattern, i) => (
            <Finding
              key={pattern.id}
              pattern={pattern}
              index={held.length + i}
              token={token!}
              fortnight={fortnight}
            />
          ))}
        </>
      )}

      {/* Regions, where the web and the design both put them: beside the other
          findings rather than behind a lens of their own. A region is a group
          that keeps turning up together, which is the same kind of claim as a
          recurrence and belongs on the same page as one. */}
      {(themes.data ?? []).length > 0 && (
        <>
          <View style={styles.sectionRow}>
            <Kicker heading>Regions</Kicker>
            <View style={styles.ruleFill}>
              <Rule />
            </View>
            <Text style={styles.aside}>groups, not pairs</Text>
          </View>
          {themes.data!.map((theme: Theme, i: number) => (
            <Rise key={theme.id} index={found.length + i}>
              <MotionSurface
                style={styles.row}
                onPress={() => router.push(`/theme/${theme.id}`)}
                accessibilityRole="button"
                accessibilityLabel={theme.label}
              >
                <Seal id={theme.id} size={40} stamp />
                <View style={styles.rowBody}>
                  <Text style={styles.label}>{theme.label}</Text>
                  <Kicker>
                    {`${theme.member_count} things · held since ${new Date(theme.first_seen_at).toLocaleDateString()}${theme.epistemic_status === "user_rejected" ? " · you rejected this" : ""}`}
                  </Kicker>
                  {theme.summary ? (
                    <Text style={styles.aside}>
                      {`${theme.summary} — written by a model from these words`}
                    </Text>
                  ) : null}
                </View>
              </MotionSurface>
            </Rise>
          ))}
        </>
      )}

      <View style={styles.actions}>
        <MotionSurface
          style={styles.action}
          onPress={() => mine.mutate()}
          disabled={mine.isPending}
          accessibilityRole="button"
        >
          <Text style={styles.actionLabel}>{mine.isPending ? "Looking…" : "Look again"}</Text>
        </MotionSurface>
        <MotionSurface
          style={styles.action}
          onPress={() => router.push(found.length > 0 ? "/experiments" : "/first")}
          accessibilityRole="button"
          accessibilityLabel={found.length > 0 ? "Open experiments" : "What each detector is waiting for"}
        >
          <Text style={styles.actionLabel}>
            {found.length > 0 ? "Open experiments" : "What each detector is waiting for"}
          </Text>
        </MotionSurface>
      </View>
    </ScrollView>
  );
}

function Finding({
  pattern,
  index,
  token,
  fortnight,
}: {
  pattern: Pattern;
  index: number;
  token: string;
  fortnight: number;
}) {
  const router = useRouter();
  return (
    <Rise index={index}>
      <View style={styles.row}>
        {/* The card is a layout container, not a button. Keeping only its
            header interactive avoids putting the independently clickable
            Composition links inside another pressable on web. */}
        <View
          style={[
            styles.power,
            { width: `${Math.round(Math.min(pattern.distinct_days / fortnight, 1) * 100)}%` },
          ]}
          pointerEvents="none"
        />
        <MotionSurface
          style={styles.header}
          onPress={() => router.push(patternDestination(pattern).href)}
          accessibilityRole="button"
          accessibilityLabel={pattern.label}
        >
          <View style={styles.top}>
            <Seal id={pattern.id} size={40} stamp />
            <View style={styles.rowBody}>
              <Text style={styles.label}>{pattern.label}</Text>
              <Kicker>{patternMeta(pattern)}</Kicker>
            </View>
            <View style={styles.met}>
              <Meter confidence={pattern.confidence} tentative={pattern.tentative} />
              <Text style={styles.metCount}>
                {daysOfFortnight(pattern.distinct_days).replace(" of ", " / ")}
              </Text>
            </View>
          </View>
        </MotionSurface>
        <Strip pattern={pattern} />
        <StripLegend pattern={pattern} />
        <Composition token={token} patternId={pattern.id} />
      </View>
    </Rise>
  );
}

const styles = StyleSheet.create({
  sectionRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14 },
  ruleFill: { flex: 1 },
  aside: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: scale.meta.size },
  screen: { flex: 1, backgroundColor: colors.room },
  content: { padding: 20, paddingBottom: 56, gap: 10 },
  title: {
    color: colors.ink, fontFamily: fonts.sansBold, fontSize: scale.title.size,
    lineHeight: scale.title.line, letterSpacing: scale.title.tracking,
  },
  sub: { color: colors.inkMuted, fontFamily: fonts.sans, fontSize: scale.body.size, lineHeight: scale.body.line },
  row: {
    flexDirection: "column",
    // Explicit, so the strip — which has no width of its own, only cells that
    // flex — inherits the row's full width instead of resolving to zero.
    alignItems: "stretch",
    gap: 12,
    paddingVertical: 12,
    position: "relative",
    overflow: "hidden",
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  header: { alignSelf: "stretch" },
  power: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.lineStrong,
    opacity: 0.5,
  },
  /** Seal, text, measure — across. The strip is a sibling of this, not a child
   *  of its text column, so it runs the full width beneath. */
  top: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  rowBody: { flex: 1, gap: 6, minWidth: 0 },
  /** Narrow on purpose. `Meter`'s track is 180 wide with `maxWidth: "100%"`,
   *  so given a column of its own it claimed 180 and crushed the text beside it
   *  to three wrapped lines; constrained here it shrinks to fit instead. */
  met: { width: 96, alignItems: "flex-end", gap: 7 },
  metCount: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: scale.meta.size },
  label: { color: colors.ink, fontFamily: fonts.sansMedium, fontSize: 17, lineHeight: 23, letterSpacing: -0.085 },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 10 },
  action: { borderWidth: 1, borderColor: colors.line, borderRadius: radii.surface, paddingVertical: 12, paddingHorizontal: 16 },
  actionLabel: { color: colors.inkSoft, fontFamily: fonts.sans, fontSize: 15 },
  threadMembers: { gap: 6 },
  threadMember: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.surface,
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 2,
  },
  threadMemberLabel: {
    color: colors.inkSoft,
    fontFamily: fonts.sans,
    fontSize: scale.body.size,
    lineHeight: scale.body.line,
  },
  ghost: { opacity: 0.55 },
});
