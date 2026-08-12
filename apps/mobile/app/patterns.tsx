import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";

import { ScrollView, StyleSheet, Text, View } from "react-native";
import { radii, type as scale } from "@tlon/design";

import { Kicker, Rule } from "@/components/Marks";
import { MotionSurface } from "@/components/MotionSurface";
import { Observatory } from "@/components/Observatory";
import { Rise } from "@/components/Rise";
import { Seal } from "@/components/Seal";
import { Strip } from "@/components/Strip";
import { colors, fonts } from "@/theme";
import { api, type Pattern, type Theme } from "@/lib/api";
import { patternDestination, patternMeta } from "@/lib/patterns";
import { usePreferences } from "@/state/preferences";
import { useSession } from "@/state/session";

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
    },
  });

  if (!token) return null;

  if (!showFindings) {
    // A screen that says what it is not showing, and undoes it in one tap. The
    // person turned this off; nothing here should argue with that, and nothing
    // should make finding the way back a hunt through settings.
    return (
      <Observatory
        eyebrow="What keeps returning"
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
  const current = found.find((p) => p.id === selected) ?? null;

  return (
    // The web's list, not a cloud of points. A finding is a claim with a shape:
    // its seal, what it says, and the fortnight it rests on drawn underneath.
    // A point sized by recurrence said only "this one is bigger".
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Kicker>What keeps returning</Kicker>
      <Text style={styles.title}>Patterns</Text>
      <Text style={styles.sub}>
        {found.length === 0
          ? "Nothing has come back often enough to call a pattern yet."
          : `${found.length} ${found.length === 1 ? "finding" : "findings"}. Counts, not verdicts — each one opens to the entries it counted.`}
      </Text>
      <Rule />

      {found.map((pattern, i) => (
        <Rise key={pattern.id} index={i}>
          <MotionSurface
            style={styles.row}
            onPress={() => router.push(patternDestination(pattern).href)}
            accessibilityRole="button"
            accessibilityLabel={pattern.label}
          >
            <Seal id={pattern.id} size={40} stamp />
            <View style={styles.rowBody}>
              <Text style={styles.label}>{pattern.label}</Text>
              <Kicker>{patternMeta(pattern)}</Kicker>
              {/* The fortnight it rests on. Which days is illustrative; how
                  many is the number in the line above. */}
              <Strip pattern={pattern} />
              {/* No caption under the strip. The line above already states the
                  true count — "8 entries across 7 days" — and the caption I put
                  here restated it from `distinct_days`, which is not capped at
                  fourteen: a finding resting on eighteen days read "18 of 14".
                  The web's captions name the two sides of a two-sided finding
                  and invite a hover, neither of which applies to a touch screen
                  showing one strip. */}
            </View>
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
  row: { flexDirection: "row", gap: 12, alignItems: "flex-start", paddingVertical: 12 },
  rowBody: { flex: 1, gap: 6 },
  label: { color: colors.ink, fontFamily: fonts.sans, fontSize: 16, lineHeight: 23 },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 10 },
  action: { borderWidth: 1, borderColor: colors.line, borderRadius: radii.surface, paddingVertical: 12, paddingHorizontal: 16 },
  actionLabel: { color: colors.inkSoft, fontFamily: fonts.sans, fontSize: 15 },
});
