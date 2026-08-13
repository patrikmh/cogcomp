import {
  COMPOSITION_VIEWBOX,
  loop,
  loopsOf,
  ringRadius,
} from "@tlon/design/marks";
import { useEffect, useMemo, useRef, useState } from "react";
import { Easing, View } from "react-native";
import Svg, { Circle, G, Path } from "react-native-svg";

import { useReducedMotion } from "@/lib/motion";
import { colors } from "@/theme";

/**
 * What has been noticed about you, as rings.
 *
 * Not a profile. Each ring is a reading the record holds — the surer ones sit
 * closer, the tentative ones drift out and lose detail, and the dense core is
 * you. Nothing here is generated and no name is assigned.
 *
 * The same composition the web draws, from the same geometry: `loop` places the
 * contours, `loopsOf` decides how many each ring gets, and the two clients space
 * them identically because `ringRadius` is shared rather than copied, and
 * because neither passes a squash — the design lets `loop` draw its own from
 * the same generator that shapes the harmonics. This replaces a head silhouette with points floating inside it, which
 * was this client's own idea and said nothing the rings do not.
 *
 * The motion is the web's as well: each ring strokes itself on over 1100ms with
 * cubic-bezier(.22,.61,.36,1), staggered 95ms outward after a 140ms beat, and
 * then the whole thing breathes — a 1.2% scale on a slow sine, so the picture is
 * alive without moving. The core is left out of the drawing-on, because you were
 * already there before anything was noticed about you.
 */
const DRAW_MS = 1100;
const DRAW_EASING = Easing.bezier(0.22, 0.61, 0.36, 1);
const FIRST_DELAY_MS = 140;
const STAGGER_MS = 95;

export interface Ring {
  id: string;
  label: string;
  kind: string;
  confidence: number;
  kept: boolean;
  tentative: boolean;
  removed: boolean;
}

export function IdentityComposition({
  rings,
  size = 280,
  onSelect,
}: {
  rings: Ring[];
  size?: number;
  onSelect?: (ring: Ring) => void;
}) {
  const reduced = useReducedMotion();
  const [progress, setProgress] = useState(reduced ? 1 : 0);
  const [breath, setBreath] = useState(1);
  const started = useRef(0);

  useEffect(() => {
    if (reduced) {
      setProgress(1);
      setBreath(1);
      return;
    }
    setProgress(0);
    started.current = Date.now();
    let alive = true;
    let frame = 0;
    const tick = () => {
      if (!alive) return;
      const elapsed = Date.now() - started.current;
      setProgress(Math.min(elapsed / (DRAW_MS + FIRST_DELAY_MS + rings.length * STAGGER_MS), 1));
      setBreath(1 + Math.sin((elapsed / 1000) * 0.5) * 0.012);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
    };
  }, [rings.length, reduced]);

  /** How far ring `i` has drawn itself, 0 to 1, on its own delay. */
  const drawnAt = (i: number) => {
    if (reduced) return 1;
    const elapsed = progress * (DRAW_MS + FIRST_DELAY_MS + rings.length * STAGGER_MS);
    const mine = elapsed - (FIRST_DELAY_MS + i * STAGGER_MS);
    return DRAW_EASING(Math.max(0, Math.min(mine / DRAW_MS, 1)));
  };

  const paths = useMemo(
    () =>
      rings.map((ring, i) =>
        loopsOf(ring).map((k) => ({
          key: `${ring.id}-${k}`,
          d: loop(ring.id + k, ringRadius(i, k)),
          ring,
          i,
        })),
      ),
    [rings],
  );

  return (
    <View accessibilityLabel="What has been noticed about you, as rings">
      <Svg
        width={size}
        height={size}
        viewBox={`0 0 ${COMPOSITION_VIEWBOX} ${COMPOSITION_VIEWBOX}`}
      >
        <G
          scale={breath}
          originX={COMPOSITION_VIEWBOX / 2}
          originY={COMPOSITION_VIEWBOX / 2}
        >
          {paths.flat().map(({ key, d, ring, i }) => (
            <Path
              key={key}
              d={d}
              fill="none"
              stroke={strokeFor(ring)}
              strokeWidth={ring.tentative || ring.removed ? 1 : 1.1}
              strokeOpacity={ring.removed ? 0.4 : ring.tentative ? 0.55 : 1}
              strokeDasharray={ring.removed ? "2 4" : "1"}
              {...({ pathLength: 1 } as object)}
              strokeDashoffset={ring.removed ? 0 : 1 - drawnAt(i)}
              onPress={onSelect ? () => onSelect(ring) : undefined}
            />
          ))}

          {/* You, at the centre: inked heavier than anything drawn around it,
              and already there rather than arriving. */}
          {["you-core", "you-core2", "you-core3"].map((key, k) => (
            <Path
              key={key}
              d={loop(key, [9, 15, 22][k]!, [0.92, 0.9, 0.94][k]!)}
              fill="none"
              stroke={colors.ink}
              strokeWidth={1.3}
              strokeOpacity={0.92}
            />
          ))}
          <Circle
            cx={COMPOSITION_VIEWBOX / 2}
            cy={COMPOSITION_VIEWBOX / 2}
            r={2.2}
            fill={colors.ink}
          />
        </G>
      </Svg>
    </View>
  );
}

/** Colour marks what is known, never what kind of thing it is. */
function strokeFor(ring: Ring): string {
  if (ring.removed) return colors.inkMuted;
  if (ring.tentative) return colors.inkMuted;
  if (ring.kept) return colors.violet;
  return colors.warning;
}
