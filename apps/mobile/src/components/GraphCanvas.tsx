import { Canvas, Circle, Group, Line, vec } from "@shopify/react-native-skia";
import { StyleSheet, View } from "react-native";

import type { GraphNode } from "@/lib/api";
import type { LayoutEdge, LayoutNode } from "@/lib/forceLayout";
import { colors } from "@/theme";
import { toneFor } from "@tlon/design";

const NODE_RADIUS = 9;
const OBSERVATION_RADIUS = 12;
/** Observations are the fixed points; inferences take their kind's colour.
 *  Tentative ones are drawn hollow rather than tinted, because a colour shift
 *  reads as a different category and an outline reads as "not filled in yet". */

/**
 * The Skia canvas.
 *
 * Split from the screen so that on web it can be lazy-loaded after CanvasKit
 * has initialised — importing Skia components before the WASM is ready throws
 * "Cannot read properties of undefined (reading 'Matrix')".
 *
 * Rendering only. Hit-testing lives in the screen, on an overlay outside this
 * subtree: putting a Pressable anywhere inside it breaks under
 * react-native-web with a null `rangeMin`.
 */
export default function GraphCanvas({
  nodes,
  edges,
  nodeData,
  selected,
  width,
  height,
}: {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  nodeData: Map<string, GraphNode>;
  selected: string | null;
  width: number;
  height: number;
}) {
  const byId = new Map<string, LayoutNode>(nodes.map((n) => [n.id, n]));

  return (
    <View style={[styles.wrap, { width, height }]}>
      <Canvas style={{ width, height }}>
        <Group>
          {edges.map((edge, index) => {
            const a = byId.get(edge.from);
            const b = byId.get(edge.to);
            if (!a || !b) return null;
            const touchesSelection =
              selected !== null && (edge.from === selected || edge.to === selected);
            return (
              <Line
                key={index}
                p1={vec(a.x, a.y)}
                p2={vec(b.x, b.y)}
                color={touchesSelection ? colors.ink : colors.line}
                strokeWidth={touchesSelection ? 2 : 1}
              />
            );
          })}

          {nodes.map((node) => {
            const data = nodeData.get(node.id);
            if (!data) return null;
            const radius = node.isObservation ? OBSERVATION_RADIUS : NODE_RADIUS;
            return (
              <Group key={node.id}>
                {node.id === selected && (
                  <Circle
                    cx={node.x}
                    cy={node.y}
                    r={radius + 5}
                    color={colors.ink}
                    style="stroke"
                    strokeWidth={2}
                  />
                )}
                <Circle
                  cx={node.x}
                  cy={node.y}
                  r={radius}
                  color={toneFor({ kind: data.kind, tentative: data.tentative })}
                  // A tentative guess is drawn hollow. It should not look as
                  // settled as something the person actually wrote.
                  style={data.tentative ? "stroke" : "fill"}
                  strokeWidth={2}
                />
              </Group>
            );
          })}
        </Group>
      </Canvas>

    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.room },
});
