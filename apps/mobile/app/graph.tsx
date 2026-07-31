import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

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

  const graph = useQuery({
    queryKey: ["graph", hideTentative],
    queryFn: () =>
      api.graph(token!, { minConfidence: hideTentative ? 0.5 : undefined }),
    enabled: Boolean(token),
  });

  // The auth gate in _layout redirects before this renders when signed out.
  if (!token) return null;

  if (graph.isLoading) return <ActivityIndicator style={styles.loader} />;
  if (graph.isError || !graph.data) {
    return <Text style={styles.error}>Could not load the graph.</Text>;
  }

  return (
    <Body
      graph={graph.data}
      hideTentative={hideTentative}
      onToggle={() => setHideTentative((v) => !v)}
    />
  );
}

function Body({
  graph,
  hideTentative,
  onToggle,
}: {
  graph: Subgraph;
  hideTentative: boolean;
  onToggle: () => void;
}) {
  if (graph.total_nodes === 0) {
    return (
      <ScrollView contentContainerStyle={styles.screen}>
        <Text style={styles.quiet}>
          Nothing here yet. Entries you write appear as the graph grows.
        </Text>
      </ScrollView>
    );
  }

  const observations = graph.nodes.filter((n) => n.kind === "Observation");
  const inferred = graph.nodes.filter((n) => n.kind !== "Observation");

  const byKind = inferred.reduce<Record<string, number>>((acc, node) => {
    acc[node.kind] = (acc[node.kind] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.stats}>
        <Stat value={observations.length} label="entries" />
        <Stat value={inferred.length} label="drawn from them" />
        <Stat value={graph.edges.length} label="connections" />
      </View>

      {graph.truncated && (
        // Say what is not being shown, rather than letting the numbers imply the
        // graph is smaller than it is.
        <Text style={styles.meta}>
          Showing {graph.returned} of {graph.total_nodes} nodes.
        </Text>
      )}

      <Pressable onPress={onToggle} style={styles.toggle}>
        <Text style={styles.toggleText}>
          {hideTentative ? "☑" : "☐"} Hide tentative guesses
        </Text>
      </Pressable>

      {Object.keys(byKind).length > 0 && (
        <View style={styles.kinds}>
          {Object.entries(byKind)
            .sort((a, b) => b[1] - a[1])
            .map(([kind, count]) => (
              <View key={kind} style={styles.chip}>
                <Text style={styles.chipText}>
                  {kind.toLowerCase()} {count}
                </Text>
              </View>
            ))}
        </View>
      )}

      <Text style={styles.sectionTitle}>What has been noticed</Text>
      {inferred.length === 0 ? (
        <Text style={styles.quiet}>
          {hideTentative
            ? "Nothing confident enough to show."
            : "Nothing drawn from your entries yet."}
        </Text>
      ) : (
        inferred.map((node) => <NodeRow key={node.id} node={node} />)
      )}

      <Text style={styles.footnote}>
        Everything above is a guess drawn from your entries, not a conclusion
        about you. Tap any of them to see which words it came from.
      </Text>
    </ScrollView>
  );
}

function NodeRow({ node }: { node: GraphNode }) {
  // router.push rather than <Link asChild>: asChild renders an anchor on
  // react-native-web and throws when given a Pressable child.
  const router = useRouter();
  return (
    <Pressable
      style={[styles.card, node.tentative && styles.cardTentative]}
      onPress={() => router.push(`/node/${node.id}`)}
    >
      <Text style={styles.cardLabel}>{node.label}</Text>
      <Text style={styles.meta}>
        {node.kind.toLowerCase()}
        {node.confidence !== null &&
          ` · ${Math.round(node.confidence * 100)}% confident`}
        {node.tentative && " · tentative"}
      </Text>
    </Pressable>
  );
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
  screen: { padding: 16, gap: 12, paddingBottom: 40 },
  stats: { flexDirection: "row", gap: 12 },
  stat: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
    gap: 2,
  },
  statValue: { fontSize: 24, fontWeight: "700" },
  statLabel: { fontSize: 11, color: "#71717a", textAlign: "center" },
  toggle: { paddingVertical: 6 },
  toggleText: { fontSize: 14, color: "#3f3f46" },
  kinds: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    backgroundColor: "#f4f4f5",
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  chipText: { fontSize: 12, color: "#3f3f46" },
  sectionTitle: {
    marginTop: 12,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: "#71717a",
  },
  card: {
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  cardTentative: { borderStyle: "dashed", borderColor: "#d4d4d8" },
  cardLabel: { fontSize: 16, lineHeight: 22 },
  meta: { fontSize: 12, color: "#71717a" },
  quiet: { color: "#71717a", marginTop: 16, fontSize: 15 },
  loader: { marginTop: 40 },
  error: { color: "#b91c1c", padding: 16 },
  footnote: { marginTop: 24, fontSize: 12, lineHeight: 18, color: "#a1a1aa" },
});
