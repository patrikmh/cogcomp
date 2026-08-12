import { SEAL_VIEWBOX, sealRings } from "@tlon/design/marks";
import { useEffect, useMemo, useRef, useState } from "react";
import { Easing, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { useReducedMotion } from "@/lib/motion";
import { colors } from "@/theme";

/**
 * Every act is stamped with its own seal.
 *
 * The same four contour rings the web draws, from the same function in
 * `packages/design/marks.ts`, and now through the same primitive: an SVG path.
 *
 * It was a Skia canvas per seal, which worked while a screen showed one. The
 * journal shows thirty-two, and thirty-two GPU surfaces exhaust the context —
 * "failed to attach a stencil buffer, rendering will be skipped" — so every seal
 * on the screen came out blank. SVG costs nothing per instance and is what the
 * web uses, which is the better answer for the same reason it was there.
 *
 * The stroke draws itself on over .9s with cubic-bezier(.3,.8,.2,1), matching
 * the web's `jSealDraw`: dasharray and dashoffset against a pathLength of 1, the
 * identical mechanism rather than an approximation of it.
 */
const DRAW_MS = 900;
const DRAW_EASING = Easing.bezier(0.3, 0.8, 0.2, 1);

export function Seal({ id, size = 34, tone = colors.lineStrong }: {
  id: string;
  size?: number;
  tone?: string;
}) {
  const rings = useMemo(() => sealRings(id), [id]);
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
      <Svg width={size} height={size} viewBox={`0 0 ${SEAL_VIEWBOX} ${SEAL_VIEWBOX}`}>
        {rings.map((d, i) => (
          <Path
            key={i}
            d={d}
            fill="none"
            stroke={tone}
            strokeWidth={1.1}
            // pathLength 1 makes the dash arithmetic the same as the web's.
            {...({ pathLength: 1 } as object)}
            strokeDasharray="1"
            strokeDashoffset={1 - drawn}
          />
        ))}
      </Svg>
    </View>
  );
}
