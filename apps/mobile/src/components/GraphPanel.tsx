import { toneFor } from "@tlon/design";
import { seed } from "@tlon/design/marks";
import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Line } from "react-native-svg";

import { colors } from "@/theme";

/**
 * The graph, as points and threads.
 *
 * Position carries no meaning and the screen says so: each node sits where its
 * own id puts it, so the same graph settles the same way every time and nobody
 * can read significance into adjacency. The edges carry the relationships.
 *
 * This client used to draw the same graph as points floating inside a head
 * silhouette. The head implied the record was a picture of a mind, which is a
 * claim the app does not get to make, and the sphere it rotated on implied
 * proximity meant something. The web's panel makes neither claim, and both
 * clients now read positions from the same `seed`, so a node sits in the same
 * place in both.
 *
 * Entries are left out, as on the web — they are the acts the readings hang off
 * rather than nodes in the same sense, and including them buries the structure
 * this screen exists to show.
 */
const PANEL = { width: 800, height: 540 };

export interface GraphNode {
  id: string;
  label: string;
  kind: string;
  tentative?: boolean;
}

export function GraphPanel({
  nodes,
  edges,
  onSelect,
}: {
  nodes: GraphNode[];
  edges: { from: string; to: string }[];
  onSelect?: (node: GraphNode) => void;
}) {
  const drawn = useMemo(() => nodes.filter((n) => n.kind !== "Observation"), [nodes]);
  const at = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const node of drawn) {
      const rnd = seed(node.id);
      map.set(node.id, { x: 60 + rnd() * 680, y: 60 + rnd() * 420 });
    }
    return map;
  }, [drawn]);

  return (
    <View style={styles.panel}>
      <Svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${PANEL.width} ${PANEL.height}`}
        accessibilityLabel="The graph, as points and threads"
      >
        {edges.map((edge, i) => {
          const a = at.get(edge.from);
          const b = at.get(edge.to);
          if (!a || !b) return null;
          return (
            <Line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={colors.line} />
          );
        })}

        {/* No standing labels. The design drew six points and could name them
            all; a real graph holds a hundred, and a hundred names laid over each
            other is less legible than none. The name arrives on tap, in the
            caption below, where there is room for it. */}
        {drawn.map((node) => {
          const p = at.get(node.id)!;
          return (
            <Circle
              key={node.id}
              cx={p.x}
              cy={p.y}
              // Hollow when tentative, filled when the record stands behind it.
              r={node.tentative ? 8 : 11}
              fill={node.tentative ? "none" : toneFor({ kind: node.kind })}
              stroke={node.tentative ? toneFor({ tentative: true }) : "none"}
              strokeWidth={2}
              onPress={onSelect ? () => onSelect(node) : undefined}
            />
          );
        })}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  // The panel the web's stylesheet draws: a bordered ground of its own, so the
  // graph reads as a plate rather than as marks loose on the page.
  panel: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    borderRadius: 3,
    aspectRatio: PANEL.width / PANEL.height,
    width: "100%",
    overflow: "hidden",
  },
});
