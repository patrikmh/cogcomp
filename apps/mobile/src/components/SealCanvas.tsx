import { SEAL_VIEWBOX, sealRings } from "@tlon/design/marks";
import { Canvas, Group, Path, Skia } from "@shopify/react-native-skia";
import { useMemo } from "react";
import { View } from "react-native";

import { colors } from "@/theme";

/**
 * The seal itself, drawn with Skia.
 *
 * Separate from `Seal.tsx` because on web CanvasKit's WASM has to finish loading
 * before a module that touches `Skia` is even evaluated — importing it eagerly
 * fails with "Cannot read properties of undefined (reading 'Path')" at the first
 * render. `Seal.tsx` is the loader; this is the drawing.
 *
 * The same four contour rings the web client draws, from the same function in
 * `packages/design/marks.ts` — not a mobile interpretation of them. An entry's
 * seal is how you recognise it before reading a word, so it has to be the same
 * mark in both clients or it is not doing that job at all.
 *
 * Skia parses the SVG path data directly, which is what makes the geometry
 * genuinely shareable rather than something to reimplement per renderer.
 */
export default function SealCanvas({ id, size = 34, tone = colors.lineStrong }: {
  id: string;
  size?: number;
  tone?: string;
}) {
  const paths = useMemo(() => {
    return sealRings(id)
      .map((d) => Skia.Path.MakeFromSVGString(d))
      .filter((p): p is NonNullable<typeof p> => p !== null);
  }, [id]);

  const scale = size / SEAL_VIEWBOX;

  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Canvas style={{ width: size, height: size }}>
        <Group transform={[{ scale }]}>
          {paths.map((path, i) => (
            <Path
              key={i}
              path={path}
              style="stroke"
              // Scaled back up so the line stays hairline at any size, as the
              // web's 1.1 on a 64 viewBox does.
              strokeWidth={1.1 / scale}
              color={tone}
            />
          ))}
        </Group>
      </Canvas>
    </View>
  );
}
