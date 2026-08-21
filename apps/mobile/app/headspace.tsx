import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { readingBudget } from "@tlon/design/marks";

import { type Whorl } from "@/components/HeadspaceMap";
import { HeadspaceStage } from "@/components/HeadspaceStage";
import { Guide } from "@/components/Guide";
import { Kicker } from "@/components/Marks";
import { MotionSurface } from "@/components/MotionSurface";
import { Observatory, Readout } from "@/components/Observatory";
import { api, type DailySummary, type GraphEdge, type GraphNode } from "@/lib/api";
import { deviceTimezone, localToday } from "@/lib/dates";
import { type Lens, lensesFor, resolveLens } from "@/lib/lenses";
import { usePreferences } from "@/state/preferences";
import { useSession } from "@/state/session";
import { colors, fonts } from "@/theme";
import { type as scale } from "@tlon/design";
import { HEADINGS } from "@tlon/copy/headings";
import { EMPTY as EMPTY_COPY } from "@tlon/copy/empty";
import { changesOf, conflictedOf, feltThoughtOf, heldReadingsOf, innerFirst, isInnerKind, namedReadingOf, outerReadingsOf, returningInnerOf, returningOuterOf, untestedOf } from "@/lib/drawnFrom";
import { SECTIONS, asideOf } from "@tlon/copy/sections";

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
  const preferencesReady = usePreferences((s) => s.ready);
  const findingsVisible = preferencesReady && showFindings;
  const [chosen, setChosen] = useState<Lens>("today");
  // Someone who turns findings off while looking at one must not be left on a
  // lens that no longer exists.
  const lens = resolveLens(chosen, findingsVisible);
  const [selected, setSelected] = useState<string | null>(null);

  const tz = deviceTimezone();
  const day = localToday();

  const today = useQuery({
    queryKey: ["summary", day, tz, findingsVisible],
    queryFn: () => api.dailySummary(token!, day, tz, findingsVisible),
    enabled: Boolean(token) && preferencesReady,
  });
  const graph = useQuery({
    queryKey: ["graph", "headspace", userId, findingsVisible],
    queryFn: () => api.graph(token!, { limit: 200 }),
    enabled: Boolean(token) && findingsVisible,
  });
  const patterns = useQuery({
    queryKey: ["patterns", userId],
    queryFn: () => api.listPatterns(token!),
    // Not fetched at all when findings are off. Asking the server for
    // conclusions the person has said they do not want to see would make the
    // switch a piece of stagecraft.
    enabled: Boolean(token) && findingsVisible,
  });
  const model = useQuery({
    queryKey: ["self-model", userId],
    queryFn: () => api.selfModel(token!),
    enabled: Boolean(token) && findingsVisible,
  });
  const changed = useQuery({
    queryKey: ["temporal", userId, tz],
    queryFn: () => api.temporalChanges(token!, tz),
    // Not fetched at all when findings are off. Asking the server for
    // conclusions the person has said they do not want to see would make the
    // switch a piece of stagecraft.
    enabled: Boolean(token) && findingsVisible,
  });
  const themes = useQuery({
    queryKey: ["themes", userId],
    queryFn: () => api.listThemes(token!),
    // Not fetched at all when findings are off. Asking the server for
    // conclusions the person has said they do not want to see would make the
    // switch a piece of stagecraft.
    enabled: Boolean(token) && findingsVisible,
  });

  if (!token) return null;

  // Queries retain data in memory when findings are switched off. Hide cached
  // conclusions from every renderer as well as disabling future requests.
  const visiblePatterns = findingsVisible ? patterns.data : undefined;
  const visibleToday = findingsVisible
    ? today.data
    : today.data && { ...today.data, inferred: [] };
  const visibleGraph = findingsVisible
    ? graph.data
    : graph.data && {
        ...graph.data,
        // Observations are the person's own record and remain available. Every
        // other node is derived and must disappear when findings are off.
        nodes: graph.data.nodes.filter((node: GraphNode) => node.kind === "Observation"),
        edges: graph.data.edges.filter((edge: GraphEdge) =>
          graph.data.nodes.some((node: GraphNode) => node.id === edge.from_id && node.kind === "Observation") &&
          graph.data.nodes.some((node: GraphNode) => node.id === edge.to_id && node.kind === "Observation"),
        ),
      };
  const points = pointsFor(lens, visibleToday, visibleGraph, visiblePatterns, findingsVisible ? changed.data : undefined, findingsVisible ? themes.data : undefined);
  const circling = visiblePatterns?.length ?? 0;
  const whorls = whorlsFor(lens, points);
  const current = points.find((p) => p.id === selected) ?? null;
  const graphNodes = visibleGraph?.nodes ?? [];
  const graphEdges = visibleGraph?.edges ?? [];
  const pulled: GraphNode[] =
    findingsVisible && lens === "all" ? conflictedOf(graphNodes, graphEdges) : [];
  const unargued: GraphNode[] =
    findingsVisible && lens === "all" ? untestedOf(graphNodes, graphEdges) : [];
  const dayReadings: DailySummary["inferred"] =
    findingsVisible && lens === "today" ? visibleToday?.inferred ?? [] : [];
  const dayFelt = feltThoughtOf(dayReadings);
  const dayHolds = heldReadingsOf(dayReadings);
  const dayAround = outerReadingsOf(dayReadings);
  const loading =
    (lens === "today" && today.isLoading) ||
    (lens === "all" && graph.isLoading) ||
    (lens === "patterns" && patterns.isLoading) ||
    (lens === "changed" && changed.isLoading);

  return (
    <View style={styles.screen}>
      {/* How much of this you have actually weighed in on.
          A portrait made entirely of unexamined guesses is a rumour, and it
          should say so rather than presenting them with the same face as the
          things you agreed with. */}
      {findingsVisible && model.data && model.data.unreviewed + model.data.confirmed + model.data.rejected > 0 && (
        // Tappable, and it goes where the judging happens. The bar stated that
        // forty-five readings had never been agreed with and then offered
        // nothing to do about it — the one number on the screen that is a
        // reproach, with no way to answer it. Identity draws the readings as
        // rings and opens each one to a confirm or a reject.
        <MotionSurface
          onPress={() => router.push("/identity")}
          accessibilityRole="button"
          accessibilityLabel="Review the readings drawn about you"
          style={styles.reviewed}
        >
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
            reviewed{model.data.unreviewed > 0 ? " — open to answer them" : ""}
          </Text>
        </MotionSurface>
      )}

      {!findingsVisible && (
        // Stated where the lenses used to be, so the absence reads as a choice
        // rather than as an empty app. Nothing has been deleted, and the
        // sentence says so.
        <Text style={styles.findingsOff}>
          Patterns, regions and changes are turned off. Everything you write is
          still kept, and they are here when you want them — Settings.
        </Text>
      )}

      {/* Kicker, then the lens you are looking through as the heading, then
          what it shows. The design titles this screen with the lens rather than
          with the word "Headspace" — which the tab bar already says — so the
          heading changes as you change what you are looking at. */}
      <Kicker>{HEADINGS.headspace.kicker}</Kicker>
      <View style={styles.headingRow}>
        <Text style={styles.title}>{LENS_LABEL[lens]}</Text>
        {/* Lens-aware: what this screen is doing depends on which lens is on. */}
        <Guide id="headspace" lens={LENS_LABEL[lens]} />
      </View>
      <Text style={styles.note}>{LENS_NOTE[lens]}</Text>

      {/* The design's tabs: names on a rule, the one you are on inked and
          underlined, each carrying how much is behind it. This was a row of
          bordered pills, which read as filter chips — a thing you toggle — when
          a lens is not a filter but a way of looking at the same record. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.lenses}
        contentContainerStyle={styles.lensesRow}
      >
        {lensesFor(findingsVisible).map((option) => {
          const on = lens === option.id;
          const count = countFor(option.id, points, visibleToday, visiblePatterns, findingsVisible ? themes.data : undefined, findingsVisible ? changed.data : undefined);
          return (
            <MotionSurface
              key={option.id}
              style={[styles.lens, on && styles.lensOn]}
              onPress={() => {
                setChosen(option.id);
                // The previous selection is not in the new lens, and a readout
                // describing something no longer on screen is worse than none.
                setSelected(null);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.lensLabel, on && styles.lensLabelOn]}>{option.label}</Text>
              {count !== undefined && <Text style={styles.lensCount}>{count}</Text>}
            </MotionSurface>
          );
        })}
      </ScrollView>

      <Observatory
        // The web draws this screen as a contour survey, and so does this one:
        // the head with points floating inside it was this client's own
        // invention and said nothing the survey does not. `stage` is the seam
        // Identity already uses for the same reason.
        stage={
          points.length > 0 && !loading ? (
            <HeadspaceStage
              whorls={whorls}
              onSelect={(whorl: Whorl) =>
                whorl.id === "you" ? router.push("/identity") : setSelected(whorl.id)
              }
            />
          ) : undefined
        }
        data={points.map(({ id, weight, tone, tentative, status }) => ({
          id,
          weight,
          tone,
          tentative,
          status,
        }))}
        links={lens === "all" ? edgesOf(visibleGraph) : undefined}
        selected={selected}
        onSelect={setSelected}
        dotSize={lens === "patterns" ? 10 : 7}
        loading={loading}
        empty={
          lens === "changed" && changed.data?.not_enough_material
            ? // "Could not look" and "looked and nothing moved" are different
              // answers, and only one of them says anything about the person.
              EMPTY_COPY.notEnough
            : EMPTY[lens]
        }
        hint={hintFor(lens, points.length, whorls.length, points)}
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
              sealId={current.id}
            label={current.label}
              meta={current.meta}
              tentative={current.tentative}
              onOpen={
                // A change is derived and has no id. Open the stored reading
                // it names, when the graph still holds one — otherwise the
                // readout is the whole of it.
                lens === "changed"
                  ? (() => {
                      const door = namedReadingOf(
                        current.tone,
                        current.label,
                        visibleGraph?.nodes ?? [],
                      );
                      return door ? () => router.push(`/node/${door.id}`) : undefined;
                    })()
                  : () => router.push(`/node/${current.id}`)
              }
            />
          )
        }
      />

      {lens === "today" && (dayFelt.length > 0 || dayHolds.length > 0 || dayAround.length > 0) && (
        <View style={styles.pulled}>
          <BeliefList
            name="inside"
            items={dayFelt}
            meta="named, not a verdict"
            onOpen={(id) => router.push(`/node/${id}`)}
          />
          <BeliefList
            name="holds"
            items={dayHolds}
            meta="not a mood"
            onOpen={(id) => router.push(`/node/${id}`)}
          />
          <BeliefList
            name="around"
            items={dayAround}
            meta="what the days did"
            onOpen={(id) => router.push(`/node/${id}`)}
          />
        </View>
      )}

      {(pulled.length > 0 || unargued.length > 0) && (
        <View style={styles.pulled}>
          <BeliefList
            name="pulled"
            items={pulled}
            meta="both in the record"
            onOpen={(id) => router.push(`/node/${id}`)}
          />
          <BeliefList
            name="unargued"
            items={unargued}
            meta="held, not tested"
            onOpen={(id) => router.push(`/node/${id}`)}
          />
        </View>
      )}

      {/* What you are looking at, when, and what is moving in it — the design's
          one-line rail under the map. */}
      <Text style={styles.rail}>
        {`Headspace · ${new Date().toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}${
          circling ? ` · ${circling} ${circling === 1 ? "pattern" : "patterns"} circling` : ""
        }`}
      </Text>
    </View>
  );
}

/** How much is behind a lens, or nothing where there is nothing to count. */
function countFor(
  id: Lens,
  points: Point[],
  today: Awaited<ReturnType<typeof api.dailySummary>> | undefined,
  patterns: Awaited<ReturnType<typeof api.listPatterns>> | undefined,
  themes: Awaited<ReturnType<typeof api.listThemes>> | undefined,
  changed: Awaited<ReturnType<typeof api.temporalChanges>> | undefined,
): number | undefined {
  const n =
    id === "today"
      ? today?.inferred.length
      : id === "patterns"
        ? patterns?.length
        : id === "changed"
            ? changed?.changes.length
            : points.length;
  return n || undefined;
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

/** What the heading says you are looking at. */
const LENS_LABEL: Record<Lens, string> = {
  today: "Today",
  all: "Everything",
  patterns: "Recurring",
  changed: "Changed",
};

/** One line under it, describing the lens rather than the record — the count
 *  and the caveats belong to the map below and are stated there. */
const LENS_NOTE: Record<Lens, string> = {
  today: "What has been drawn since midnight. Tap a whorl to open it.",
  all: "Everything the record holds. Tap a whorl to open it.",
  patterns: "What keeps returning, sized by how often. Tap one to open it.",
  changed: "What moved between this week and last.",
};

/** The lens's own empty, from the shared sentences. Two clients saying
 *  different things about the same absence is how "nothing recorded today" and
 *  "nothing recorded — the day stays empty until it isn't" came to describe the
 *  same day depending on which one you opened. */
const EMPTY: Record<Lens, string> = {
  today: EMPTY_COPY.day,
  all: EMPTY_COPY.everything,
  patterns: EMPTY_COPY.patterns,
  // Two possible reasons, and they mean different things — resolved below.
  changed: EMPTY_COPY.changed,
};

function hintFor(lens: Lens, count: number, drawn: number, points: Point[]): string {
  if (count === 0) return "";
  if (lens === "changed") {
    const rooms = changesOf(points.map((point) => ({ kind: point.tone })));
    return `${rooms.inside.length} felt and thought · ${rooms.around.length} around you. Counts only — what it means is yours.`;
  }
  if (lens === "patterns") {
    const cameBack = points.filter((point) => isInnerKind(point.tone)).length;
    const again = points.filter(
      (point) => point.tone !== "Pattern" && !isInnerKind(point.tone),
    ).length;
    if (cameBack || again) {
      return `${cameBack} came back · ${again} more than once · ${count - cameBack - again} patterns. Counts, not verdicts.`;
    }
    return `${count} ${count === 1 ? "thing" : "things"} recurred. Bigger means more often.`;
  }
  if (lens === "all") {
    // When the map cannot hold everything it says so. A survey that silently
    // draws a fifth of the record and captions it as the whole is a worse lie
    // than a survey that draws less.
    const held = drawn - 1 < count ? `${drawn - 1} of ${count} drawn — the rest are still kept. ` : "";
    return `${held}Bigger is more; dashed is less sure.`;
  }
  // Nothing turns any more: the map is a survey drawn in plan, and telling
  // someone to drag it was a leftover from the object that used to be here.
  return `${count} in today. Bigger is more; tap one to read it.`;
}

/**
 * The lens's points, as whorls on the survey.
 *
 * A recurrence is a massif and everything else is ground: patterns take the
 * upper chain and are sized by how often they came back, the rest take the lower
 * chain and are sized by how sure the record is. Under "Everything" the point of
 * view is on the map too, at the centre and larger than anything drawn around
 * it — tapping it opens identity, because that is what it is.
 */
function whorlsFor(lens: Lens, points: Point[]): Whorl[] {
  const you: Whorl[] =
    lens === "all"
      ? [{ id: "you", label: "you", group: "you", weight: 1, bar: 0, tentative: false }]
      : [];
  // The web's budget, from the web's constant. A record of a hundred and
  // thirty-nine readings drawn in full is not a survey of anything — the camera
  // frames the lot, every whorl shrinks, and the massifs that are the point of
  // the map stop reading as massifs. Patterns are never dropped.
  const patterns = points.filter((p) => p.tone === "Pattern");
  const rest = points.filter((p) => p.tone !== "Pattern");
  const placed =
    lens === "all" || lens === "changed" || lens === "patterns"
      ? [...rest].sort((left, right) =>
          innerFirst(
            { kind: left.tone, confidence: left.weight },
            { kind: right.tone, confidence: right.weight },
          ),
        )
      : rest;
  return [
    ...you,
    ...[...patterns, ...placed.slice(0, readingBudget(patterns.length))].map((point) => ({
      id: point.id,
      label: point.label,
      group: (lens === "patterns" || point.kind === "Pattern"
        ? "pattern"
        : "reading") as Whorl["group"],
      weight: point.weight,
      bar: point.weight,
      tentative: point.tentative,
      meta: point.meta,
    })),
  ];
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
    const found = patterns.map((pattern) => ({
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
    const nodes = graph?.nodes ?? [];
    const returned = [...returningInnerOf(nodes), ...returningOuterOf(nodes)].map((node) => ({
      id: node.id,
      label: node.label,
      kind: node.kind.toLowerCase(),
      meta: node.cites_entries
        ? `${node.cites_entries} ${node.cites_entries === 1 ? "entry" : "entries"}`
        : undefined,
      weight: node.confidence ?? 0.5,
      tone: node.kind,
      tentative: Boolean(node.tentative),
    }));
    return [...found, ...returned];
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

function BeliefList({
  name,
  items,
  meta,
  onOpen,
}: {
  name: "pulled" | "unargued" | "inside" | "holds" | "around";
  items: { id: string; kind: string; label: string }[];
  meta: string;
  onOpen: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <>
      <Kicker heading>{SECTIONS[name].title}</Kicker>
      <Text style={styles.pulledAside}>{asideOf(name, true)}</Text>
      {items.map((reading) => (
        <MotionSurface
          key={reading.id}
          onPress={() => onOpen(reading.id)}
          accessibilityRole="button"
          accessibilityLabel={`${reading.label} — ${meta}, open this reading`}
        >
          <Text style={styles.pulledLabel}>{reading.label}</Text>
          <Text style={styles.pulledMeta}>
            {reading.kind.toLowerCase()} · {meta}
          </Text>
        </MotionSurface>
      ))}
    </>
  );
}

function edgesOf(graph: Awaited<ReturnType<typeof api.graph>> | undefined) {
  return (graph?.edges ?? []).map((edge) => ({ from: edge.from_id, to: edge.to_id }));
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.room },
  findingsOff: {
    color: colors.inkMuted,
    fontFamily: fonts.sans, fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: 4,
    paddingBottom: 6,
  },
  headingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingRight: 12 },
  title: {
    paddingHorizontal: 20,
    color: colors.ink,
    fontFamily: fonts.sansBold,
    fontSize: scale.title.size,
    lineHeight: scale.title.line,
    letterSpacing: scale.title.tracking,
  },
  note: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 12,
    color: colors.inkMuted,
    fontFamily: fonts.sans,
    fontSize: scale.body.size,
    lineHeight: scale.body.line,
  },
  rail: {
    paddingHorizontal: 20,
    paddingBottom: 6,
    color: colors.inkMuted,
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  lensCount: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: 12, marginLeft: 7 },
  // The design's `.tabs`: a rule under the whole row, names sitting on it.
  lenses: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.line, marginBottom: 20 },
  lensesRow: { flexDirection: "row", gap: 12, paddingHorizontal: 20 },
  reviewed: { paddingHorizontal: 20, paddingTop: 14, gap: 6 },
  reviewedTrack: {
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.line,
    overflow: "hidden",
  },
  reviewedFill: { height: 4, borderRadius: 999, backgroundColor: colors.cyan },
  reviewedLabel: { color: colors.inkMuted, fontFamily: fonts.sans, fontSize: 11 },
  lens: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    paddingTop: 10,
    paddingBottom: 9,
    // The underline sits on the row's own rule, so the lens you are on marks
    // the rule rather than floating above it.
    borderBottomWidth: 1,
    borderBottomColor: "transparent",
    marginBottom: -1,
  },
  lensOn: { borderBottomColor: colors.pink },
  lensLabel: {
    color: colors.inkMuted,
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    lineHeight: 14,
  },
  lensLabelOn: { color: colors.ink },
  pulled: { paddingHorizontal: 20, paddingBottom: 10, gap: 6, maxHeight: 200 },
  pulledAside: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.8 },
  pulledLabel: { color: colors.ink, fontFamily: fonts.sansMedium, fontSize: 14, lineHeight: 20 },
  pulledMeta: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: 11 },
});
