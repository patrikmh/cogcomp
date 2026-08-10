import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { MotionSurface } from "@/components/MotionSurface";
import { Observatory, Readout } from "@/components/Observatory";
import { api } from "@/lib/api";
import { deviceTimezone, localToday } from "@/lib/dates";
import { type Lens, lensesFor, resolveLens } from "@/lib/lenses";
import { usePreferences } from "@/state/preferences";
import { useSession } from "@/state/session";
import { colors } from "@/theme";

/**
 * Headspace — where things stand.
 *
 * The one screen that answers "what is in my head" without making anyone assemble
 * it from four others. Today, everything, and what keeps returning are the same
 * object seen through three lenses; changing lens repopulates the head rather
 * than navigating somewhere else, so you never lose the thread.
 *
 * The lenses are ordered by how far they reach back — today, then everything,
 * then only what recurred. That ordering is the argument: a day is a fact, the
 * whole graph is a record, and a pattern is a claim. Each step takes you further
 * from what you actually wrote, and the screen makes that distance visible rather
 * than presenting all three as equally solid.
 */



export default function HeadspaceScreen() {
  const token = useSession((s) => s.token);
  const userId = useSession((s) => s.userId);
  const router = useRouter();
  const showFindings = usePreferences((s) => s.findings);
  const [chosen, setChosen] = useState<Lens>("today");
  // Someone who turns findings off while looking at one must not be left on a
  // lens that no longer exists.
  const lens = resolveLens(chosen, showFindings);
  const [selected, setSelected] = useState<string | null>(null);

  const tz = deviceTimezone();
  const day = localToday();

  const today = useQuery({
    queryKey: ["summary", day, tz],
    queryFn: () => api.dailySummary(token!, day, tz),
    enabled: Boolean(token),
  });
  const graph = useQuery({
    queryKey: ["graph", "headspace", userId],
    queryFn: () => api.graph(token!, { limit: 200 }),
    enabled: Boolean(token),
  });
  const patterns = useQuery({
    queryKey: ["patterns", userId],
    queryFn: () => api.listPatterns(token!),
    // Not fetched at all when findings are off. Asking the server for
    // conclusions the person has said they do not want to see would make the
    // switch a piece of stagecraft.
    enabled: Boolean(token) && showFindings,
  });
  const model = useQuery({
    queryKey: ["self-model", userId],
    queryFn: () => api.selfModel(token!),
    enabled: Boolean(token),
  });
  const changed = useQuery({
    queryKey: ["temporal", userId, tz],
    queryFn: () => api.temporalChanges(token!, tz),
    // Not fetched at all when findings are off. Asking the server for
    // conclusions the person has said they do not want to see would make the
    // switch a piece of stagecraft.
    enabled: Boolean(token) && showFindings,
  });
  const themes = useQuery({
    queryKey: ["themes", userId],
    queryFn: () => api.listThemes(token!),
    // Not fetched at all when findings are off. Asking the server for
    // conclusions the person has said they do not want to see would make the
    // switch a piece of stagecraft.
    enabled: Boolean(token) && showFindings,
  });

  if (!token) return null;

  const points = pointsFor(lens, today.data, graph.data, patterns.data, changed.data, themes.data);
  const current = points.find((p) => p.id === selected) ?? null;
  const loading =
    (lens === "today" && today.isLoading) ||
    (lens === "all" && graph.isLoading) ||
    (lens === "patterns" && patterns.isLoading) ||
    (lens === "regions" && themes.isLoading) ||
    (lens === "changed" && changed.isLoading);

  return (
    <View style={styles.screen}>
      {/* How much of this you have actually weighed in on.
          A portrait made entirely of unexamined guesses is a rumour, and it
          should say so rather than presenting them with the same face as the
          things you agreed with. */}
      {model.data && model.data.unreviewed + model.data.confirmed + model.data.rejected > 0 && (
        <View style={styles.reviewed}>
          <View style={styles.reviewedTrack}>
            <View
              style={[
                styles.reviewedFill,
                { width: `${Math.round(model.data.reviewed_fraction * 100)}%` },
              ]}
            />
          </View>
          <Text style={styles.reviewedLabel}>
            {model.data.confirmed + model.data.rejected} of{" "}
            {model.data.confirmed + model.data.rejected + model.data.unreviewed} readings
            reviewed
          </Text>
        </View>
      )}

      {!showFindings && (
        // Stated where the lenses used to be, so the absence reads as a choice
        // rather than as an empty app. Nothing has been deleted, and the
        // sentence says so.
        <Text style={styles.findingsOff}>
          Patterns, regions and changes are turned off. Everything you write is
          still kept, and they are here when you want them — Settings.
        </Text>
      )}

      <View style={styles.lenses}>
        {lensesFor(showFindings).map((option) => (
          <MotionSurface
            key={option.id}
            style={[styles.lens, lens === option.id && styles.lensOn]}
            onPress={() => {
              setChosen(option.id);
              // The previous selection is not in the new lens, and a readout
              // describing something no longer on screen is worse than none.
              setSelected(null);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: lens === option.id }}
          >
            <Text style={[styles.lensLabel, lens === option.id && styles.lensLabelOn]}>
              {option.label}
            </Text>
          </MotionSurface>
        ))}
      </View>

      <Observatory
        data={points.map(({ id, weight, tone, tentative, status }) => ({
          id,
          weight,
          tone,
          tentative,
          status,
        }))}
        links={lens === "all" ? edgesOf(graph.data) : undefined}
        selected={selected}
        onSelect={setSelected}
        dotSize={lens === "patterns" ? 10 : 7}
        loading={loading}
        empty={
          lens === "changed" && changed.data?.not_enough_material
            ? // "Could not look" and "looked and nothing moved" are different
              // answers, and only one of them says anything about the person.
              "Not enough written across both weeks to compare them."
            : EMPTY[lens]
        }
        hint={hintFor(lens, points.length)}
        secondaryAction={
          // Only under the lens it belongs to. The Patterns screen says more
          // about a recurrence than a point can — how many entries and days it
          // rests on, and, for an ordered finding, the occasions themselves —
          // and until now nothing in the app led there from the place someone
          // was actually looking at their recurrences.
          lens === "patterns" && points.length > 0
            ? { label: "Open patterns", onPress: () => router.push("/patterns") }
            : undefined
        }
        detail={
          current && (
            <Readout
              tone={current.kind}
              label={current.label}
              meta={current.meta}
              tentative={current.tentative}
              openLabel={lens === "regions" ? "See what is in it →" : undefined}
              onOpen={
                lens === "changed"
                  ? undefined
                  : lens === "regions"
                    ? () => router.push(`/theme/${current.id}`)
                    : () => router.push(`/node/${current.id}`)
              }
            />
          )
        }
      />
    </View>
  );
}

interface Point {
  id: string;
  label: string;
  kind: string;
  meta?: string;
  weight: number;
  tone: string;
  tentative: boolean;
  status?: string | null;
}

const EMPTY: Record<Lens, string> = {
  today: "Nothing recorded today.",
  all: "Nothing here yet. It fills in as you write.",
  patterns: "Nothing has come back often enough to call recurring.",
  // Not "no regions found": a region needs three things that keep appearing
  // together, which is a lot of writing, and saying so is the honest empty.
  regions: "No group of things has turned up together often enough yet.",
  // Two possible reasons, and they mean different things — resolved below.
  changed: "Nothing moved between this week and last.",
};

function hintFor(lens: Lens, count: number): string {
  if (count === 0) return "";
  if (lens === "changed") {
    return `${count} ${count === 1 ? "thing" : "things"} moved since last week. Counts only — what it means is yours.`;
  }
  if (lens === "patterns") {
    return `${count} ${count === 1 ? "thing" : "things"} recurred. Bigger means more often.`;
  }
  if (lens === "regions") {
    return `${count} ${count === 1 ? "region" : "regions"}. Bigger holds more things — tap to see what is in one.`;
  }
  if (lens === "all") {
    return `${count} in view. Filled is what you wrote, hollow is a guess.`;
  }
  return `${count} in today. Drag to turn it, tap to read one.`;
}

/** Which points the head holds for this lens. Kept out of the component so the
 *  three shapes can be compared side by side. */
function pointsFor(
  lens: Lens,
  today: Awaited<ReturnType<typeof api.dailySummary>> | undefined,
  graph: Awaited<ReturnType<typeof api.graph>> | undefined,
  patterns: Awaited<ReturnType<typeof api.listPatterns>> | undefined,
  changed: Awaited<ReturnType<typeof api.temporalChanges>> | undefined,
  themes: Awaited<ReturnType<typeof api.listThemes>> | undefined,
): Point[] {
  if (lens === "regions") {
    if (!themes) return [];
    const largest = Math.max(...themes.map((theme) => theme.member_count), 1);
    return themes.map((theme) => ({
      id: theme.id,
      // The membership is the name. Nothing here invents a heading for a region
      // of someone's life.
      label: theme.label,
      kind: "region",
      meta: `${theme.member_count} things · ${Math.round(theme.confidence * 100)}% confident`,
      weight: theme.member_count / largest,
      tone: "Theme",
      tentative: theme.tentative,
    }));
  }
  if (lens === "changed") {
    if (!changed) return [];
    return changed.changes.map((change) => ({
      // Changes are derived, not stored, so they have no node id. The label and
      // kind identify them well enough to select one, and there is nothing to
      // navigate to — the readout is the whole of it.
      id: `${change.kind}:${change.label}`,
      label: change.label,
      kind: change.shift,
      meta: change.description,
      // Bigger the further it moved.
      weight: Math.min(Math.abs(change.recent_days - change.earlier_days) / 7 + 0.3, 1),
      tone: change.kind,
      // Something that has gone quiet is drawn hollow — it is an absence, and
      // an absence should not look like a presence.
      tentative: change.shift === "absent",
    }));
  }
  if (lens === "today") {
    if (!today) return [];
    return [
      ...today.observations.map((observation) => ({
        id: observation.id,
        label: observation.content,
        kind: "entry",
        // Entries are the fixed points everything else hangs off.
        weight: 1,
        tone: "Observation",
        tentative: false,
      })),
      ...today.inferred.map((item) => ({
        id: item.id,
        label: item.label,
        kind: item.kind.toLowerCase(),
        meta: `${Math.round(item.confidence * 100)}% confident`,
        weight: item.confidence,
        tone: item.kind as string,
        tentative: item.tentative,
      })),
    ];
  }

  if (lens === "patterns") {
    if (!patterns) return [];
    const busiest = Math.max(...patterns.map((p) => p.occurrences), 1);
    return patterns.map((pattern) => ({
      id: pattern.id,
      label: pattern.label,
      kind: "pattern",
      meta: `${pattern.occurrences} ${pattern.occurrences === 1 ? "entry" : "entries"}`,
      // Relative to this person's own strongest, not an absolute scale that
      // would mean nothing to them.
      weight: pattern.occurrences / busiest,
      tone: "Pattern",
      tentative: pattern.tentative,
    }));
  }

  if (!graph) return [];
  return graph.nodes.map((node) => ({
    id: node.id,
    label: node.label,
    kind: node.kind.toLowerCase(),
    meta:
      node.confidence !== null
        ? `${Math.round(node.confidence * 100)}% confident`
        : undefined,
    weight: node.kind === "Observation" ? 1 : (node.confidence ?? 0.5),
    tone: node.kind,
    tentative: Boolean(node.tentative),
    status: node.epistemic_status,
  }));
}

function edgesOf(graph: Awaited<ReturnType<typeof api.graph>> | undefined) {
  return (graph?.edges ?? []).map((edge) => ({ from: edge.from_id, to: edge.to_id }));
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.room },
  findingsOff: {
    color: colors.inkMuted,
    fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: 4,
    paddingBottom: 6,
  },
  lenses: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  reviewed: { paddingHorizontal: 20, paddingTop: 14, gap: 6 },
  reviewedTrack: {
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.line,
    overflow: "hidden",
  },
  reviewedFill: { height: 4, borderRadius: 999, backgroundColor: colors.cyan },
  reviewedLabel: { color: colors.inkMuted, fontSize: 11 },
  lens: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
  },
  lensOn: { borderColor: colors.cyan, backgroundColor: colors.surfaceBright },
  lensLabel: { color: colors.inkMuted, fontSize: 13, fontWeight: "700" },
  lensLabelOn: { color: colors.ink },
});
