import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";

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
import { Strip } from "@/components/Strip";
import { StripLegend } from "@/components/StripLegend";
import { colors, fonts } from "@/theme";
import { api, type Pattern, type Theme } from "@/lib/api";
import { patternDestination, patternMeta } from "@/lib/patterns";
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
  const [selected, setSelected] = useState<string | null>(null);
  const showFindings = usePreferences((s) => s.findings);
  const setFindings = usePreferences((s) => s.setFindings);

  const patterns = useQuery({
    queryKey: ["patterns", userId],
    queryFn: () => api.listPatterns(token!),
    enabled: Boolean(token && userId) && showFindings,
  });

  const themes = useQuery({
    queryKey: ["themes", userId],
    queryFn: () => api.listThemes(token!),
    // Same condition as the patterns above: with findings off, the app does not
    // ask the server for conclusions the person has said they do not want.
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

  const found: Pattern[] = patterns.data ?? [];
  const busiest = Math.max(...found.map((p) => p.occurrences), 1);
  // Days against the fortnight, which is what the design divides by: its
  // fixtures all read `busiest: 14`, and 14 is the same window the strip under
  // each finding draws. Sizing against the busiest finding instead would make
  // the strongest one always full, which says nothing — every record has a
  // strongest. Sizing against occurrences would compare days to mentions.
  const fortnight = STRIP_CELLS;
  const current = found.find((p) => p.id === selected) ?? null;

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
          ? EMPTY_COPY.patterns
          : `${found.length} ${found.length === 1 ? "finding" : "findings"}. Counts, not verdicts — each one opens to the entries it counted.`}
      </Text>

      {/* Named and ruled, as Today and Week name their sections and as the
          design names this one. The rule was here on its own, which drew the
          line without saying what it divided or that the findings below it are
          ordered. The copy for it was written and never wired up. */}
      <View style={styles.sectionRow}>
        <Kicker heading>{SECTIONS.returning.title}</Kicker>
        <View style={styles.ruleFill}>
          <Rule />
        </View>
        <Text style={styles.aside}>{asideOf("returning", true)}</Text>
      </View>

      {found.map((pattern, i) => (
        <Rise key={pattern.id} index={i}>
          <MotionSurface
            style={styles.row}
            onPress={() => router.push(patternDestination(pattern).href)}
            accessibilityRole="button"
            accessibilityLabel={pattern.label}
          >
            {/* How strong this finding is, as a length behind the row: the
                design's `.p-pow`, sized against the busiest finding in the
                record and not against any absolute standard. A number says
                five days; this says five days *compared to what*, which is the
                only frame the record can honestly offer. */}
            <View
              style={[
                styles.power,
                { width: `${Math.round(Math.min(pattern.distinct_days / fortnight, 1) * 100)}%` },
              ]}
              pointerEvents="none"
            />
            {/* Seal, what the finding is, and how strong it is — three columns
                across, as the design sets `.p-top`. The meter used to sit under
                the meta inside the text column, which read as another line of
                description rather than as the measure of the row. */}
            <View style={styles.top}>
              <Seal id={pattern.id} size={40} stamp />
              <View style={styles.rowBody}>
                <Text style={styles.label}>{pattern.label}</Text>
                <Kicker>{patternMeta(pattern)}</Kicker>
              </View>
              {/* The same figure as a length, at the end of the row where the
                  design puts it. "70% confident" is a phrase people skim; a bar
                  visibly two thirds full is not, and a finding sits beside
                  readings that are metered the same way. */}
              <View style={styles.met}>
                <Meter confidence={pattern.confidence} tentative={pattern.tentative} />
                {/* Days over the fortnight — but only while the finding fits
                    inside one. A record older than two weeks produces findings
                    resting on more days than the window has, and "18 / 14" is
                    the same nonsense a caption here once printed. Past the
                    window the count stands on its own. */}
                <Text style={styles.metCount}>
                  {daysOfFortnight(pattern.distinct_days).replace(" of ", " / ")}
                </Text>
              </View>
            </View>
            {/* The fortnight it rests on, full width beneath the row rather
                than indented past the seal — the design's `.p-stripwrap` is a
                sibling of `.p-top`, not a child of its text column. Which days
                is illustrative; how many is the number above. */}
            <Strip pattern={pattern} />
              {/* What the strip is showing. A two-sided finding draws its
                  halves in ink and sand, and nothing said which was which —
                  two colours and no way to learn what they mean is worse than
                  one colour, because it looks like it is telling you something. */}
              <StripLegend pattern={pattern} />
              {/* What the finding is made of. A recurrence is a count over
                  readings, not a fact about a person, and unless those readings
                  are named and reachable the count is the end of the chain
                  rather than a step in it. */}
              <Composition token={token!} patternId={pattern.id} />
              {/* No caption under the strip. The line above already states the
                  true count — "8 entries across 7 days" — and the caption I put
                  here restated it from `distinct_days`, which is not capped at
                  fourteen: a finding resting on eighteen days read "18 of 14".
                  The web's captions name the two sides of a two-sided finding
                  and invite a hover, neither of which applies to a touch screen
                  showing one strip. */}
          </MotionSurface>
        </Rise>
      ))}

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
                    {`${theme.member_count} things · held since ${new Date(theme.first_seen_at).toLocaleDateString()}`}
                  </Kicker>
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
        >
          <Text style={styles.actionLabel}>
            {found.length > 0 ? "Open experiments" : "What each detector is waiting for"}
          </Text>
        </MotionSurface>
      </View>
    </ScrollView>
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
    gap: 12,
    alignItems: "flex-start",
    paddingVertical: 12,
    position: "relative",
    overflow: "hidden",
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
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
  met: { flexDirection: "column", alignItems: "flex-end", gap: 7 },
  metCount: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: scale.meta.size },
  label: { color: colors.ink, fontFamily: fonts.sans, fontSize: 16, lineHeight: 23 },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 10 },
  action: { borderWidth: 1, borderColor: colors.line, borderRadius: radii.surface, paddingVertical: 12, paddingHorizontal: 16 },
  actionLabel: { color: colors.inkSoft, fontFamily: fonts.sans, fontSize: 15 },
});
