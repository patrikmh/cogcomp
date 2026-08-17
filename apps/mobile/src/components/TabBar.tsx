import { type as scale } from "@tlon/design";
import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Glyph } from "@/components/Glyph";
import { MoreSheet } from "@/components/MoreSheet";
import { TABS } from "@/lib/destinations";
import { api, type GraphNode } from "@/lib/api";
import { deviceTimezone, localToday, mondayOfWeek } from "@/lib/dates";
import { useSession } from "@/state/session";
import { usePreferences } from "@/state/preferences";
import { colors, fonts } from "@/theme";

/**
 * The bar along the bottom: four places, and the way to everything else.
 *
 * The design's five tabs, with its own glyphs. This client had six flat
 * destinations marked by coloured dots, which spent colour — the one channel
 * this product reserves for what is *known* about something — on saying which
 * tab you were looking at, and could not grow past six without becoming a
 * scrollable strip of dots.
 *
 * The counts behind More are read here, once, rather than in the sheet: the
 * sheet is opened rarely and the numbers are already in cache from the screens
 * that fetched them, so opening it costs nothing and shows the same figures the
 * screens themselves show.
 */
export function TabBar() {
  const [showMore, setShowMore] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const token = useSession((s) => s.token);
  const userId = useSession((s) => s.userId);
  const tz = deviceTimezone();
  const showFindings = usePreferences((s) => s.findings);
  const preferencesReady = usePreferences((s) => s.ready);
  const findingsVisible = preferencesReady && showFindings;

  const graph = useQuery({
    queryKey: ["graph", "headspace", userId, findingsVisible],
    queryFn: () => api.graph(token!, { limit: 200 }),
    enabled: Boolean(token) && showMore && findingsVisible,
  });
  const entries = useQuery({
    queryKey: ["observations", userId],
    queryFn: () => api.listObservations(token!),
    enabled: Boolean(token) && showMore,
  });
  const today = useQuery({
    queryKey: ["summary", localToday(), tz, findingsVisible],
    queryFn: () => api.dailySummary(token!, localToday(), tz, findingsVisible),
    enabled: Boolean(token) && showMore && preferencesReady,
  });
  const week = useQuery({
    queryKey: ["week", mondayOfWeek(localToday()), tz, findingsVisible],
    queryFn: () => api.weeklySummary(token!, mondayOfWeek(localToday()), tz, findingsVisible),
    enabled: Boolean(token) && showMore && preferencesReady,
  });
  const patterns = useQuery({
    queryKey: ["patterns", userId],
    queryFn: () => api.listPatterns(token!),
    enabled: Boolean(token) && showMore && findingsVisible,
  });
  const runs = useQuery({
    queryKey: ["agent-runs"],
    queryFn: () => api.listAgentRuns(token!),
    enabled: Boolean(token) && showMore && findingsVisible,
  });

  const nodes: GraphNode[] = graph.data?.nodes ?? [];
  const visibleNodes = findingsVisible
    ? nodes
    : nodes.filter((node) => node.kind === "Observation");
  const counts = {
    headspace: findingsVisible ? some(visibleNodes.length) : undefined,
    journal: some(entries.data?.observations.length),
    today: some(today.data?.entry_count),
    week: week.data ? `${week.data.active_days} / 7` : undefined,
    patterns: findingsVisible ? some(patterns.data?.length) : undefined,
    identity: findingsVisible
      ? some(nodes.filter((n) => n.kind !== "Observation" && n.kind !== "Pattern").length)
      : undefined,
    agents: findingsVisible ? some(runs.data?.length) : undefined,
    graph: findingsVisible ? some(visibleNodes.length) : undefined,
  };

  return (
    <>
      <View accessibilityRole="toolbar" accessibilityLabel="Where to go" style={styles.bar}>
        {TABS.map((tab) => {
          const here = pathname === tab.href;
          return (
            // A Pressable rather than a Link: `Link asChild` renders an anchor
            // around the child on web, and the anchor — not the Pressable —
            // becomes the flex child, so four of the five tabs ignored their
            // width and crowded into the left of the bar.
            <Pressable
              key={tab.href}
              accessibilityRole="link"
              accessibilityState={{ selected: here }}
              onPress={() => router.push(tab.href)}
              style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
            >
              <Glyph name={tab.glyph} size={19} tone={here ? colors.cyan : colors.inkMuted} />
              <Text style={[styles.label, here && styles.labelHere]}>{tab.label}</Text>
            </Pressable>
          );
        })}

        {/* Not a destination: it opens the map. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="More places to go"
          accessibilityState={{ expanded: showMore }}
          onPress={() => setShowMore(true)}
          style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
        >
          <View style={styles.moreGlyph}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={styles.moreDot} />
            ))}
          </View>
          <Text style={[styles.label, showMore && styles.labelHere]}>More</Text>
        </Pressable>
      </View>

      <MoreSheet
        open={showMore}
        onClose={() => setShowMore(false)}
        counts={counts}
        here={pathname}
      />
    </>
  );
}

/** A count, or nothing at all. Never "0": an absence is not a failure, and a
 *  row that reads "Patterns 0" invites someone to go and fix it. */
function some(n: number | undefined): string | undefined {
  return n ? String(n) : undefined;
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.room,
    paddingTop: 5,
    paddingBottom: 4,
  },
  // flexGrow with an explicit zero basis: React Native's `flex: 1` shorthand
  // does not set one on web, so the five tabs sized themselves to their labels
  // and crowded into the left of the bar.
  tab: { flexGrow: 1, flexBasis: 0, minWidth: 0, alignItems: "center", gap: 3 },
  pressed: { opacity: 0.6 },
  label: {
    color: colors.inkMuted,
    fontFamily: fonts.mono,
    fontSize: 8.5,
    letterSpacing: 0.68,
    textTransform: "uppercase",
  },
  labelHere: { color: colors.cyan },
  /** The design's four squares, drawn rather than typeset like the rest. */
  moreGlyph: { width: 22, height: 22, flexDirection: "row", flexWrap: "wrap", gap: 4, padding: 4 },
  moreDot: { width: 5, height: 5, borderRadius: 1, backgroundColor: colors.inkMuted },
});
