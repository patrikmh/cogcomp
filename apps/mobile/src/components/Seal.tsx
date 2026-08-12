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

/**
 * A finding's seal arrives instead of drawing itself — `pSeal`, .7s on
 * cubic-bezier(.2,0,0,1): up from .6 scale and -8°, to full size and .8 opacity.
 *
 * The difference is the claim. An act's seal draws on because the act was
 * written, stroke by stroke; a finding was not written by anyone, it was struck
 * from what was already there, so its seal lands as a stamp.
 */
const STAMP_MS = 700;
const STAMP_EASING = Easing.bezier(0.2, 0, 0, 1);
const STAMP_FROM_SCALE = 0.6;
const STAMP_FROM_TURN = -8;
const STAMP_OPACITY = 0.8;

export function Seal({ id, size = 34, tone = colors.lineStrong, stamp = false }: {
  id: string;
  size?: number;
  tone?: string;
  /** Draw it as a finding's seal: stamped on, not stroked on. */
  stamp?: boolean;
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
      const t = Math.min((Date.now() - started.current) / (stamp ? STAMP_MS : DRAW_MS), 1);
      setDrawn(stamp ? STAMP_EASING(t) : DRAW_EASING(t));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
    };
  }, [id, reduced, stamp]);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={
        stamp
          ? {
              opacity: drawn * STAMP_OPACITY,
              transform: [
                { scale: STAMP_FROM_SCALE + (1 - STAMP_FROM_SCALE) * drawn },
                { rotate: `${STAMP_FROM_TURN * (1 - drawn)}deg` },
              ],
            }
          : undefined
      }
    >
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
            // A stamped seal is whole from the first frame; it arrives as a
            // mark rather than being written.
            strokeDashoffset={stamp ? 0 : 1 - drawn}
          />
        ))}
      </Svg>
    </View>
  );
}
