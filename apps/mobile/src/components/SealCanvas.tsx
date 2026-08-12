import { SEAL_VIEWBOX, sealRings } from "@tlon/design/marks";
import { Canvas, Group, Path, Skia } from "@shopify/react-native-skia";
import { useEffect, useMemo, useRef, useState } from "react";
import { Easing, View } from "react-native";

import { useReducedMotion } from "@/lib/motion";
import { colors } from "@/theme";

/** The web strokes a seal on over .9s with cubic-bezier(.3,.8,.2,1) — see
 *  `jSealDraw` and `.j-stream .j-seal path` in tlon.css. Same duration, same
 *  curve, so an entry arrives the same way in both clients. */
const DRAW_MS = 900;
const DRAW_EASING = Easing.bezier(0.3, 0.8, 0.2, 1);

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

  // The seal draws itself on, as the web's does. Skia trims a path with `end`,
  // which is the same idea as animating stroke-dashoffset against a pathLength
  // of 1 — the stroke arrives rather than appearing.
  const reduced = useReducedMotion();
  const [drawn, setDrawn] = useState(reduced ? 1 : 0);
  const started = useRef(0);

  useEffect(() => {
    if (reduced) {
      setDrawn(1);
      return;
    }
    setDrawn(0);
    started.current = Date.now();
    let alive = true;
    let frame = 0;
    const tick = () => {
      if (!alive) return;
      const t = Math.min((Date.now() - started.current) / DRAW_MS, 1);
      setDrawn(DRAW_EASING(t));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
    };
  }, [id, reduced]);

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
              end={drawn}
            />
          ))}
        </Group>
      </Canvas>
    </View>
  );
}
