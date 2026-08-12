import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  Line,
  Path,
  RadialGradient,
  Skia,
  vec,
} from "@shopify/react-native-skia";
import { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, View } from "react-native";

import {
  type Datum,
  type Projected,
  linkPairs,
  pick,
  place,
  project,
  opacityFor,
  radiusOf,
  ringPoints,
} from "@/lib/orbital";
import {
  flowArcPaths,
  headClipPath,
  headPath,
  neuralTracePaths,
  skullCentre,
} from "@/lib/headSilhouette";
import { useReducedMotion } from "@/lib/motion";
import { colors } from "@/theme";
import { toneFor } from "@tlon/design";

/**
 * A set of things, as an object you can turn.
 *
 * This is the app's one visual primitive. Entries, inferences, patterns, agent
 * runs — every screen is about a collection, and every collection is drawn the
 * same way: points on a slowly turning sphere, near ones bright and large, far
 * ones dim and small. Learn to read it once and every screen is legible.
 *
 * It replaces lists, and that is the point. A list of forty inferences is forty
 * lines of text nobody reads; the same forty as a constellation is one object,
 * and the detail for exactly one of them appears when you point at it. The screen
 * holds one thing at a time instead of everything at once.
 *
 * Geometry is in `@/lib/orbital`, pure and tested. This file only paints and
 * handles the finger.
 */

/**
 * What colour a point is drawn in.
 *
 * This was a map of eleven kinds to eleven colours. The design has no per-kind
 * palette anywhere — colour marks what is *known* about a thing, not what kind
 * of thing it is — so it defers to `toneFor`, which both clients share. The
 * argument is still a kind name because every caller passes one; what changed
 * is that only "Observation" now means anything to it.
 */
export function toneColour(tone: string, tentative = false): string {
  return toneFor({ kind: tone, tentative });
}

/** Rendered frames per second. Slow motion, so extra frames are invisible while
 *  the battery cost is not. */
const FPS = 30;

/** Generous next to the drawn radius — fingers are not cursors. */
const TAP_TOLERANCE = 26;

const SPIN = 0.14;
const DRAG_SENSITIVITY = 0.055;
const MOMENTUM_DECAY = 0.93;

/** Palette by tone. Keys are node kinds, plus a few the other screens use.
 *  Anything unknown falls back rather than throwing — a new kind should look
 *  plain, not crash the screen. */

interface Props {
  data: Datum[];
  links?: { from: string; to: string }[];
  size: number;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  /** Base point radius in pixels, before weight and depth. */
  dotSize?: number;
  /**
   * A point that breathes rather than sitting still.
   *
   * Used for a thought that is being written but not yet saved. It is in the sky
   * because that is where it is going, and it pulses because it is not there
   * yet — the moment it stops pulsing is the moment it became a real entry.
   */
  pulseId?: string | null;
  /**
   * Draw the scene inside the outline of a head.
   *
   * The claim this product makes is that these are your own thoughts reflected
   * back. A graph turning in a void does not say that; the same graph turning
   * inside a head says it with no copy at all.
   */
  frame?: "none" | "head";
}

/** Seconds since mount. Frozen rather than reset when motion is reduced, so the
 *  scene is still a legible object — just a still one. */
function useClock(still: boolean): number {
  const [time, setTime] = useState(0);
  const elapsed = useRef(0);

  useEffect(() => {
    if (still) return;
    let frame = 0;
    let last = Date.now();
    const tick = () => {
      const now = Date.now();
      elapsed.current += (now - last) / 1000;
      last = now;
      setTime(elapsed.current);
      frame = setTimeout(tick, 1000 / FPS) as unknown as number;
    };
    frame = setTimeout(tick, 1000 / FPS) as unknown as number;
    return () => clearTimeout(frame);
  }, [still]);

  return time;
}

export default function Constellation({
  data,
  links = [],
  size,
  selected = null,
  onSelect,
  dotSize = 7,
  frame = "none",
  pulseId = null,
}: Props) {
  const reduced = useReducedMotion();
  const time = useClock(reduced);
  const [drag, setDrag] = useState(0);
  const velocity = useRef(0);
  const dragging = useRef(false);

  // Momentum rides the render clock rather than a timer of its own, so a scene
  // that has stopped animating does not keep coasting invisibly.
  useEffect(() => {
    if (dragging.current || Math.abs(velocity.current) < 0.0004) return;
    velocity.current *= MOMENTUM_DECAY;
    setDrag((current) => current + velocity.current);
  }, [time]);

  const inHead = frame === "head";
  // Inside a head the scene sits in the cranium, which is neither the centre of
  // the box nor as large as it — a profile is mostly jaw below the midpoint.
  const skull = skullCentre({ size });
  const centre = inHead ? skull.cx : size / 2;
  const centreY = inHead ? skull.cy : size / 2;
  // Leaves room for the perspective-widened near face and the glow around a
  // selected point, so nothing lands where it cannot be tapped.
  const radius = inHead ? skull.radius : (size / 2) * 0.62;

  // These are static geometry for a given frame and size. Keeping their string
  // identities stable avoids reparsing them while the constellation turns.
  const outline = useMemo(
    () => (inHead ? headPath({ size }) : ""),
    [inHead, size],
  );
  const flowArcs = useMemo(
    () => (inHead ? flowArcPaths({ size }) : []),
    [inHead, size],
  );
  const neuralTraces = useMemo(
    () => (inHead ? neuralTracePaths({ size }) : []),
    [inHead, size],
  );
  // A null path would blank the canvas silently, so only apply a parsed clip.
  const clip = useMemo(
    () => (inHead ? Skia.Path.MakeFromSVGString(headClipPath({ size })) : null),
    [inHead, size],
  );

  const placed = place(data);
  const projected = project(placed, time, { cx: centre, cy: centreY, radius }, {
    spin: reduced ? 0 : SPIN,
    drag,
  });
  const pairs = linkPairs(projected, links);

  // Two crossing great circles. Without a horizon a handful of points reads as
  // dots in a void, and the rotation means nothing because there is no surface
  // being rotated. Split at the halfway mark so the far half can be drawn dimmer
  // than the near one, which is what makes it a sphere rather than an ellipse.
  const rings = [0.0, 1.15].map((tilt) =>
    ringPoints(time, { cx: centre, cy: centreY, radius }, {
      tilt,
      spin: reduced ? 0 : SPIN,
      drag,
    }),
  );

  const responder = useRef(
    PanResponder.create({
      // A tap must reach the press handler below rather than being swallowed
      // here, so only a clear drag is claimed.
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4,
      onPanResponderGrant: () => {
        dragging.current = true;
        velocity.current = 0;
      },
      onPanResponderMove: (_, gesture) => {
        setDrag((current) => current + gesture.vx * DRAG_SENSITIVITY);
        velocity.current = gesture.vx * DRAG_SENSITIVITY;
      },
      onPanResponderRelease: (_, gesture) => {
        dragging.current = false;
        velocity.current = gesture.vx * DRAG_SENSITIVITY;
      },
      onPanResponderTerminate: () => {
        dragging.current = false;
      },
    }),
  ).current;

  const projectedRef = useRef<Projected[]>(projected);
  projectedRef.current = projected;

  return (
    <View
      style={[styles.wrap, { width: size, height: size }]}
      {...responder.panHandlers}
      onStartShouldSetResponder={() => true}
      onResponderRelease={(event) => {
        const native = event.nativeEvent as unknown as Record<string, number>;
        // react-native-web reports offset*; native reports location*.
        const x = native.locationX ?? native.offsetX ?? 0;
        const y = native.locationY ?? native.offsetY ?? 0;
        const hit = pick(projectedRef.current, x, y, TAP_TOLERANCE);
        // Tapping empty space clears, so there is always a way out.
        onSelect?.(hit?.id ?? null);
      }}
    >
      <Canvas style={{ width: size, height: size }}>
        {/* The room the object sits in. Emissive points only read as light if
            something dark is behind them. */}
        <Circle cx={centre} cy={centreY} r={inHead ? size * 0.42 : size / 2}>
          <RadialGradient
            c={vec(centre, centreY)}
            r={inHead ? size * 0.42 : size / 2}
            colors={["#160e2e", "#0d0a1c99", "#08080c00"]}
          />
          <BlurMask blur={22} style="normal" />
        </Circle>

        {/* Everything below is clipped to the skull, so the thoughts are inside
            the head rather than drawn on top of a picture of one. */}
        <Group clip={clip ?? undefined}>
        {/* Quiet inner currents sit behind the constellation and never compete
            with its points, links, or horizons. */}
        <Group>
          {flowArcs.map((path, i) => (
            <Path
              key={`flow-${i}`}
              path={path}
              style="stroke"
              strokeWidth={[1, 0.85, 0.7][i]}
              strokeCap="round"
              color="#c4b5fd"
              opacity={[0.18, 0.12, 0.07][i]}
            />
          ))}
          {neuralTraces.map((path, i) => (
            <Path
              key={`trace-${i}`}
              path={path}
              style="stroke"
              strokeWidth={i === 0 ? 0.7 : 0.6}
              strokeCap="round"
              color="#c4b5fd"
              opacity={[0.13, 0.09, 0.06, 0.04][i]}
            />
          ))}
        </Group>

        {/* The horizon. */}
        <Group>
          {rings.map((ring, r) =>
            ring.map((point, i) => {
              const next = ring[(i + 1) % ring.length]!;
              return (
                <Line
                  key={`${r}-${i}`}
                  p1={vec(point.sx, point.sy)}
                  p2={vec(next.sx, next.sy)}
                  color="#8b7fd4"
                  strokeWidth={0.7 + point.depth * 0.9}
                  opacity={0.05 + 0.16 * point.depth}
                />
              );
            }),
          )}
        </Group>

        {/* Relationships next, so points sit on top of their own threads. */}
        <Group>
          {pairs.map((pair, i) => (
            <Line
              key={i}
              p1={vec(pair.from.sx, pair.from.sy)}
              p2={vec(pair.to.sx, pair.to.sy)}
              color="#8b7fd4"
              strokeWidth={0.6 + pair.depth}
              opacity={0.08 + 0.3 * pair.depth}
            />
          ))}
        </Group>

        {/* Painter's algorithm — `project` already sorted these far to near, so
            drawing in order occludes correctly with no depth buffer. */}
        <Group>
          {projected.map((point) => {
            const pulsing = point.id === pulseId;
            // Slow enough to read as breathing rather than blinking.
            const breath = pulsing ? 1 + 0.28 * Math.sin(time * 3.4) : 1;
            const r = radiusOf(point, dotSize) * breath;
            // Sureness is the thing colour carries now, so it has to be passed.
            const colour = toneColour(point.tone, point.tentative);
            const isSelected = point.id === selected;
            return (
              <Group key={point.id}>
                {pulsing && (
                  <Circle
                    cx={point.sx}
                    cy={point.sy}
                    r={r * 2.6}
                    color={colour}
                    opacity={0.16}
                  >
                    <BlurMask blur={10} style="normal" />
                  </Circle>
                )}
                {isSelected && (
                  <Circle cx={point.sx} cy={point.sy} r={r * 3.2} color={colour} opacity={0.22}>
                    <BlurMask blur={12} style="normal" />
                  </Circle>
                )}
                <Circle
                  cx={point.sx}
                  cy={point.sy}
                  r={r}
                  color={colour}
                  // Hollow for a guess, filled for something observed. The same
                  // rule the rest of the app uses, so it needs no legend.
                  style={point.tentative && !isSelected ? "stroke" : "fill"}
                  strokeWidth={1.4}
                  // Depth, then judgement. A rejected reading stays findable if
                  // you go looking without competing with anything current.
                  opacity={
                    isSelected
                      ? 1
                      : (0.25 + 0.7 * point.depth) * opacityFor(point.status)
                  }
                >
                  <BlurMask blur={1 + 2.5 * point.depth} style="solid" />
                </Circle>
              </Group>
            );
          })}
        </Group>
        </Group>

        {inHead && (
          <>
            {/* Structure gets a restrained halo and a precise line, so it stays
                legible without competing with the constellation. */}
            <Path
              path={outline}
              style="stroke"
              strokeWidth={2.8}
              strokeCap="round"
              color={colors.violet}
              opacity={0.16}
            >
              <BlurMask blur={5} style="solid" />
            </Path>
            <Path
              path={outline}
              style="stroke"
              strokeWidth={1.25}
              strokeCap="round"
              color="#c4b5fd"
              opacity={0.52}
            />
          </>
        )}
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center" },
});
