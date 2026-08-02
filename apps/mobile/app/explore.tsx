import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Suspense, lazy, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { api, type GraphNode, type Subgraph } from "@/lib/api";
import {
  type LayoutEdge,
  type LayoutNode,
  initialiseNodes,
  nodeAt,
  settle,
} from "@/lib/forceLayout";
import { useSession } from "@/state/session";

/** Generous next to the drawn radius — fingers are not cursors. */
const TAP_RADIUS = 26;

/**
 * Created once, at module scope, and deliberately not inside the component.
 *
 * A lazy component's identity has to be stable. Building it per render — which
 * Skia's `WithSkiaWeb` and its `getComponent` prop quietly encourage — remounts
 * the canvas on every state change, so selecting a node destroys the canvas you
 * selected it on and the screen falls back to a spinner forever. The tap was
 * working the whole time; the re-render was eating it.
 *
 * On web, CanvasKit's WASM must finish loading before any Skia component is
 * evaluated, hence awaiting it before the import.
 */
const LazyGraphCanvas = lazy(async () => {
  if (Platform.OS === "web") {
    const { LoadSkiaWeb } = await import(
      "@shopify/react-native-skia/lib/module/web"
    );
    await LoadSkiaWeb();
  }
  return import("@/components/GraphCanvas");
});

/**
 * The graph explorer.
 *
 * The layout is computed once and settled, not animated. The simulation is
 * deterministic, so there is nothing to watch converge — and a graph that
 * rearranges itself every time you open it destroys the spatial memory that
 * makes an explorer worth having at all.
 */
export default function ExploreScreen() {
  const token = useSession((s) => s.token);
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const [selected, setSelected] = useState<string | null>(null);

  const graph = useQuery({
    queryKey: ["graph", "explore"],
    queryFn: () => api.graph(token!, { limit: 200 }),
    enabled: Boolean(token),
  });

  const canvasHeight = Math.max(height - 220, 300);
  const subgraph: Subgraph | undefined = graph.data;

  const layout = useMemo<{ nodes: LayoutNode[]; edges: LayoutEdge[] }>(() => {
    if (!subgraph) return { nodes: [], edges: [] };
    const options = { width, height: canvasHeight };
    const nodes = initialiseNodes(subgraph.nodes, options);
    const edges: LayoutEdge[] = subgraph.edges.map((edge) => ({
      from: edge.from_id,
      to: edge.to_id,
    }));
    settle(nodes, edges, options);
    return { nodes, edges };
  }, [subgraph, width, canvasHeight]);

  if (!token) return null;
  if (graph.isLoading) return <ActivityIndicator style={styles.loader} />;
  // Narrowed through the local const rather than graph.data, which TypeScript
  // re-widens across statements.
  if (graph.isError || !subgraph) {
    return <Text style={styles.error}>Could not load the graph.</Text>;
  }
  if (subgraph.nodes.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          Nothing to explore yet. Write an entry and the graph starts here.
        </Text>
      </View>
    );
  }

  const nodeData = new Map<string, GraphNode>(
    subgraph.nodes.map((node) => [node.id, node]),
  );
  const selectedNode = selected ? nodeData.get(selected) : null;

  return (
    <View style={styles.screen}>
      <View style={{ width, height: canvasHeight }}>
        <Suspense fallback={<ActivityIndicator style={styles.loader} />}>
          <LazyGraphCanvas
            nodes={layout.nodes}
            edges={layout.edges}
            nodeData={nodeData}
            selected={selected}
            width={width}
            height={canvasHeight}
          />
        </Suspense>

        {/* Hit-testing lives here rather than inside the canvas: an overlay is a
            sibling of the Skia subtree, so it does not depend on Skia's own
            event handling, which differs between native and react-native-web. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={(event) => {
            const native = event.nativeEvent as unknown as Record<string, number>;
            // react-native-web gives offsetX/offsetY; native gives location*.
            const x = native.locationX ?? native.offsetX ?? 0;
            const y = native.locationY ?? native.offsetY ?? 0;
            const hit = nodeAt(layout.nodes, x, y, TAP_RADIUS);
            // Tapping empty space clears, so there is always a way out.
            setSelected(hit?.id ?? null);
          }}
        />
      </View>

      <View style={styles.panel}>
        {selectedNode ? (
          <Pressable onPress={() => router.push(`/node/${selectedNode.id}`)}>
            <Text style={styles.selectedKind}>
              {selectedNode.kind.toLowerCase()}
              {selectedNode.confidence !== null &&
                ` · ${Math.round(selectedNode.confidence * 100)}% confident`}
              {selectedNode.tentative && " · tentative"}
            </Text>
            <Text style={styles.selectedLabel} numberOfLines={3}>
              {selectedNode.label}
            </Text>
            <Text style={styles.open}>Where this came from →</Text>
          </Pressable>
        ) : (
          <>
            <Text style={styles.hint}>
              Filled circles are your entries and confident readings. Hollow ones
              are tentative guesses. Tap any of them.
            </Text>
            {subgraph.truncated && (
              <Text style={styles.hint}>
                Showing {subgraph.returned} of {subgraph.total_nodes} nodes.
              </Text>
            )}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  loader: { marginTop: 40 },
  error: { color: "#b91c1c", padding: 16 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  emptyText: { color: "#71717a", textAlign: "center", fontSize: 15, lineHeight: 22 },
  panel: {
    borderTopWidth: 1,
    borderTopColor: "#e4e4e7",
    padding: 16,
    gap: 4,
    minHeight: 110,
  },
  selectedKind: {
    fontSize: 12,
    color: "#71717a",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    fontWeight: "700",
  },
  selectedLabel: { fontSize: 16, lineHeight: 22 },
  open: { marginTop: 6, color: "#3f3f46", fontWeight: "600" },
  hint: { fontSize: 12, color: "#a1a1aa", lineHeight: 18 },
});
