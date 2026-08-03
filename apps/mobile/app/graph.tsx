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

import { AtmosphericShell } from "@/components/Atmospheric";
import { MotionSurface } from "@/components/MotionSurface";
import { InferenceLens, MetricBeacon, FieldFrame, LoadingLens, ErrorLens, EmptyLens } from "@/components/SpatialField";
import { api, type GraphNode, type Subgraph } from "@/lib/api";
import { useSession } from "@/state/session";

/**
 * The dashboard: what is in the graph, and a way into any of it.
 *
 * Deliberately not a force-directed picture. A node-and-edge canvas looks
 * impressive and tells you very little at this size — what someone wants from an
 * overview is "what has been noticed, how sure is it, and where did it come
 * from". The Skia explorer belongs on its own screen, for when the graph is large
 * enough that its shape carries information.
 */
export default function GraphScreen() {
  const token = useSession((s) => s.token);
  const [hideTentative, setHideTentative] = useState(false);
  const [focusKind, setFocusKind] = useState<string | null>(null);

  const graph = useQuery({
    queryKey: ["graph", hideTentative],
    queryFn: () =>
      api.graph(token!, { minConfidence: hideTentative ? 0.5 : undefined }),
    enabled: Boolean(token),
  });

  // The auth gate in _layout redirects before this renders when signed out.
  if (!token) return null;

  if (graph.isLoading) return <LoadingLens label="Scanning the signal field…" />;
  if (graph.isError || !graph.data) {
    return <ErrorLens label="Could not load the graph." />;
  }

  return (
    <Body
      graph={graph.data}
      hideTentative={hideTentative}
      onToggle={() => setHideTentative((v) => !v)}
      focusKind={focusKind}
      onFocusKind={setFocusKind}
    />
  );
}

function Body({
  graph,
  hideTentative,
  onToggle,
  focusKind,
  onFocusKind,
}: {
  graph: Subgraph;
  hideTentative: boolean;
  onToggle: () => void;
  focusKind: string | null;
  onFocusKind: (kind: string | null) => void;
}) {
  const router = useRouter();

  if (graph.total_nodes === 0) {
    return <AtmosphericShell variant="secondary"><ScrollView contentContainerStyle={styles.screen}><EmptyLens label="Nothing here yet. Entries you write appear as the graph grows." /></ScrollView></AtmosphericShell>;
  }

  const observations = graph.nodes.filter((n) => n.kind === "Observation");
  const inferred = graph.nodes.filter((n) => n.kind !== "Observation");
  const visibleInferred = focusKind ? inferred.filter((node) => node.kind === focusKind) : inferred;

  const byKind = inferred.reduce<Record<string, number>>((acc, node) => {
    acc[node.kind] = (acc[node.kind] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <AtmosphericShell variant="secondary">
      <ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.instrumentHeader}>
        <Text style={styles.kicker}>SIGNAL INSTRUMENT</Text>
        <Text style={styles.title}>What is in the field?</Text>
        <Text style={styles.intro}>A readable measure of the ideas your entries have made visible.</Text>
      </View>
      <FieldFrame label="Graph metric beacon field"><View style={styles.stats}>
        <MetricBeacon value={observations.length} label="source entries" />
        <MetricBeacon value={inferred.length} label="readings" tone={"#a78bfa"} />
        <MetricBeacon value={graph.edges.length} label="links" tone={"#f0abfc"} />
      </View></FieldFrame>

      {graph.truncated && (
        // Say what is not being shown, rather than letting the numbers imply the
        // graph is smaller than it is.
        <Text style={styles.meta}>
          Showing {graph.returned} of {graph.total_nodes} nodes.
        </Text>
      )}

      <MotionSurface style={styles.explore} onPress={() => router.push("/explore")}>
        <Text style={styles.exploreLabel}>Explore the graph →</Text>
      </MotionSurface>

      <MotionSurface onPress={onToggle} style={styles.toggle}>
        <Text style={styles.toggleText}>
          {hideTentative ? "☑" : "☐"} Hide tentative guesses
        </Text>
      </MotionSurface>

      {Object.keys(byKind).length > 0 && (
        <View style={styles.kinds}>
          <MotionSurface
            accessibilityRole="button"
            accessibilityState={{ selected: !focusKind }}
            onPress={() => onFocusKind(null)}
            style={[styles.chip, !focusKind && styles.chipActive]}
          >
            <Text style={styles.chipText}>all signals</Text>
          </MotionSurface>
          {Object.entries(byKind).sort((a, b) => b[1] - a[1]).map(([kind, count]) => (
            <MotionSurface
              key={kind}
              accessibilityRole="button"
              accessibilityState={{ selected: focusKind === kind }}
              onPress={() => onFocusKind(focusKind === kind ? null : kind)}
              style={[styles.chip, focusKind === kind && styles.chipActive]}
            >
              <Text style={styles.chipText}>{kind.toLowerCase()} {count}</Text>
            </MotionSurface>
          ))}
        </View>
      )}

      <Text style={styles.sectionTitle}>What has been noticed</Text>
      {visibleInferred.length === 0 ? (
        <Text style={styles.quiet}>{hideTentative ? "Nothing confident enough to show." : "Nothing drawn from your entries yet."}</Text>
      ) : (
        visibleInferred.map((node) => <NodeRow key={node.id} node={node} />)
      )}

      <Text style={styles.footnote}>
        Everything above is a guess drawn from your entries, not a conclusion
        about you. Tap any of them to see which words it came from.
      </Text>
      </ScrollView>
    </AtmosphericShell>
  );
}

function NodeRow({ node }: { node: GraphNode }) {
  // router.push rather than <Link asChild>: asChild renders an anchor on
  // react-native-web and throws when given a Pressable child.
  const router = useRouter();
  return <InferenceLens label={node.label} tentative={node.tentative} meta={`${node.kind.toLowerCase()}${node.confidence !== null ? ` · ${Math.round(node.confidence * 100)}% confident` : ""}${node.tentative ? " · tentative" : ""}`} onPress={() => router.push(`/node/${node.id}`)} />;
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#08080c", padding: 20, gap: 14, paddingBottom: 44 },
  instrumentHeader: { gap: 6, paddingVertical: 8 },
  kicker: { color: "#67e8f9", fontSize: 11, fontWeight: "700", letterSpacing: 1.8 },
  title: { color: "#f1f0f8", fontSize: 28, fontWeight: "700", letterSpacing: -0.7 },
  intro: { color: "#b5b3c7", fontSize: 14, lineHeight: 20 },
  stats: { flexDirection: "row", gap: 12 },
  stat: {
    flex: 1,
    backgroundColor: "#12121c",
    borderWidth: 1,
    borderColor: "#29293b",
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
    gap: 2,
  },
  statValue: { fontSize: 24, fontWeight: "700", color: "#f1f0f8" },
  statLabel: { fontSize: 11, color: "#a09db4", textAlign: "center" },
  explore: {
    borderWidth: 1,
    backgroundColor: "#181827",
    borderColor: "#f1f0f8",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  exploreLabel: { fontSize: 15, fontWeight: "600", color: "#f1f0f8" },
  toggle: { paddingVertical: 6 },
  toggleText: { fontSize: 14, color: "#b5b3c7" },
  kinds: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    backgroundColor: "#181827",
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  chipText: { fontSize: 12, color: "#b5b3c7" },
  chipActive: { borderWidth: 1, borderColor: "#67e8f9" },
  sectionTitle: {
    marginTop: 12,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: "#a09db4",
  },
  card: {
    backgroundColor: "#12121c",
    borderLeftWidth: 3,
    borderLeftColor: "#67e8f9",

    borderWidth: 1,
    borderColor: "#29293b",
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  cardTentative: { borderStyle: "dashed", borderColor: "#454563" },
  cardLabel: { fontSize: 16, lineHeight: 22, color: "#f1f0f8" },
  meta: { fontSize: 12, color: "#a09db4" },
  quiet: { color: "#a09db4", marginTop: 16, fontSize: 15 },
  loader: { marginTop: 40 },
  error: { color: "#fb7185", padding: 16 },
  footnote: { marginTop: 24, fontSize: 12, lineHeight: 18, color: "#a09db4" },
});
