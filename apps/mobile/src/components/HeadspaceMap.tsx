import {
  arriveAt,
  backOut,
  chainX,
  loop,
  seed,
  whorlRadius,
  type WhorlGroup,
} from "@tlon/design/marks";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWindowDimensions, View } from "react-native";
import Svg, { G, Path } from "react-native-svg";

import { useReducedMotion } from "@/lib/motion";
import { colors } from "@/theme";

/**
 * The record as a survey.
 *
 * The web draws this as a contour terrain in three dimensions; this draws the
 * same survey in plan, which is what a contour map is for. Every rule that
 * decides what the map *says* is shared rather than reimplemented — `whorlRadius`
 * for how big a thing is, `chainX` for where its kind sits, `arriveAt` and
 * `backOut` for when and how it lands. Only the projection differs, so the two
 * clients cannot disagree about the material.
 *
 * Size is a property of what a thing is: a pattern by how often it returns, a
 * reading by how sure the record is, today by how much is in it, you biggest of
 * all and already there. Nothing here is sized by importance, because nothing
 * here decides what is important.
 *
 * Whorls arrive rather than fade in — a back-out overshoot, so a peak is placed.
 */
const RISE_MS = 850;
/** Half-width of the map's own coordinate space; every size is a fraction of it. */
const R = 100;

export interface Whorl {
  id: string;
  label: string;
  group: WhorlGroup;
  weight: number;
  bar: number;
  tentative: boolean;
}

export interface Placed extends Whorl {
  x: number;
  z: number;
  radius: number;
  arrives: number;
}

export function HeadspaceMap({
  whorls,
  onSelect,
}: {
  whorls: Whorl[];
  onSelect?: (whorl: Whorl) => void;
}) {
  const reduced = useReducedMotion();
  // The stage the constellation used to fill, filled by the same arithmetic —
  // a map drawn in a 300px band on an 844px screen reads as a widget rather
  // than as the ground the screen is about.
  const { width, height } = useWindowDimensions();
  const stage = Math.min(width * 0.92, height * 0.58, 480);
  const [elapsed, setElapsed] = useState(reduced ? 99 : 0);

  // What the map is, rather than which array carried it. A caller that rebuilds
  // its list on every render — which any screen deriving whorls from query data
  // does — would otherwise restart the arrival clock on every render, and
  // nothing that arrives after the first beat would ever be seen.
  const signature = whorls.map((w) => `${w.id}:${w.group}:${w.weight}:${w.bar}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const placed = useMemo(() => place(whorls), [signature]);
  const box = useMemo(() => fit(placed), [placed]);

  useEffect(() => {
    if (reduced) {
      setElapsed(99);
      return;
    }
    setElapsed(0);
    const started = Date.now();
    let alive = true;
    let frame = 0;
    const tick = () => {
      if (!alive) return;
      setElapsed((Date.now() - started) / 1000);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
    };
  }, [signature, reduced]);

  // The canvas takes the map's own proportions rather than a square's, so a
  // wide survey is not a band floating in a tall empty box.
  const [, , boxW, boxH] = box.split(" ").map(Number) as [number, number, number, number];
  const drawnHeight = Math.min(stage, (stage * boxH) / boxW);

  return (
    <View
      accessibilityLabel={`A survey of the record: ${whorls.length} whorls, sized by what each one is`}
    >
      <Svg width={stage} height={drawnHeight} viewBox={box}>
        {placed.map((w) => {
          const k = reduced
            ? 1
            : backOut(Math.max(0, Math.min((elapsed - w.arrives) / (RISE_MS / 1000), 1)));
          if (k <= 0) return null;
          return (
            <G
              key={w.id}
              // `loop` draws around (140,140) on its own 280 box; the whorl is
              // moved to its place on the map rather than redrawn there.
              transform={`translate(${w.x - 140} ${w.z - 140})`}
              onPress={onSelect ? () => onSelect(w) : undefined}
            >
              <G scale={k} originX={140} originY={140} opacity={Math.min(1, k)}>
                {contoursOf(w).map((level, i) => (
                  <Path
                    key={i}
                    d={loop(w.id + i, w.radius * level, squashOf(w.id))}
                    // The outermost contour carries a faint mass so overlapping
                    // whorls read as ground rather than as tangled line. Lines
                    // alone are legible one at a time and illegible in a range,
                    // which is the whole picture on this screen.
                    fill={i === 0 ? colors.ink : "none"}
                    fillOpacity={i === 0 ? (w.tentative ? 0.03 : 0.06) : 0}
                    stroke={w.tentative ? colors.inkMuted : colors.ink}
                    strokeWidth={i === 0 ? 1.2 : 0.8}
                    strokeOpacity={w.tentative ? 0.45 : 0.9 - i * 0.18}
                    strokeDasharray={w.tentative ? "2 3" : undefined}
                  />
                ))}
              </G>
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

/**
 * Where each whorl sits, and when.
 *
 * Patterns run in a chain across the top, readings in a chain below, today off
 * to one side, you at the fixed point — the web's arrangement, from the web's
 * `chainX`. The readings' span grows with their count so a real record keeps the
 * density the map was drawn at instead of compressing into one mass.
 */
export function place(whorls: Whorl[]): Placed[] {
  const of = (group: WhorlGroup) => whorls.filter((w) => w.group === group);
  const patterns = of("pattern");
  const readings = of("reading");
  const patternSpan = spanFor(patterns, R * 0.7);

  return whorls.map((w) => {
    const radius = whorlRadius(w.group, R, w.weight, w.bar);
    const jitter = seed(w.id + "z");
    if (w.group === "pattern") {
      const i = patterns.indexOf(w);
      return {
        ...w,
        radius,
        x: chainX(i, patterns.length, patternSpan),
        z: -R * 0.5 + (jitter() - 0.5) * R * 0.2,
        arrives: arriveAt("pattern", i),
      };
    }
    if (w.group === "reading") {
      const i = readings.indexOf(w);
      const span = spanFor(readings, R * 0.85 * Math.max(1, Math.sqrt(readings.length / 7)));
      return {
        ...w,
        radius,
        x: chainX(i, readings.length, span) + (seed(w.id + "x")() - 0.5) * R * 0.14,
        z: R * 0.7 + (jitter() - 0.5) * R * 0.5,
        arrives: arriveAt("reading", i),
      };
    }
    if (w.group === "today") {
      return { ...w, radius, x: R * 0.6, z: R * 0.14, arrives: arriveAt("today", 0) };
    }
    return { ...w, radius, x: 0, z: R * 0.08, arrives: 0 };
  });
}

/**
 * How wide a chain has to be before its whorls stop swallowing each other.
 *
 * The web's span is the design's, and it is right for the web: seen in
 * perspective, overlapping contours read as one range of peaks. Drawn in plan
 * they read as a tangle, so a chain widens when its own whorls are too big for
 * it. This is the projection's problem and it is solved here rather than in the
 * shared rules, which decide what the map means and not how it is drawn.
 */
function spanFor(chain: { group: WhorlGroup; weight: number; bar: number }[], design: number) {
  if (chain.length < 2) return design;
  const mean =
    chain.reduce((sum, w) => sum + whorlRadius(w.group, R, w.weight, w.bar), 0) / chain.length;
  return Math.max(design, mean * (chain.length - 1) * 0.5);
}

/**
 * The camera, fitted to the material rather than to a guess.
 *
 * The web frames the whole massif whatever the record holds; this computes the
 * same bounding box and hands it to the viewBox, so a record with two patterns
 * and one with twenty both fill the frame.
 */
export function fit(placed: Placed[]): string {
  if (!placed.length) return `0 0 ${R * 2} ${R * 2}`;
  const pad = R * 0.06;
  const bounds = placed.map(drawnBounds);
  const minX = Math.min(...bounds.map((b) => b.minX)) - pad;
  const maxX = Math.max(...bounds.map((b) => b.maxX)) + pad;
  const minZ = Math.min(...bounds.map((b) => b.minZ)) - pad;
  const maxZ = Math.max(...bounds.map((b) => b.maxZ)) + pad;
  return `${minX} ${minZ} ${maxX - minX} ${maxZ - minZ}`;
}

/**
 * Where a whorl's outermost contour actually lands.
 *
 * Its radius is only the base the harmonics are applied to — the drawn shape is
 * always somewhat smaller and never circular, so framing by radius leaves slack
 * on every side and the map floats in its own stage. Reading the path is exact
 * and costs one pass over ninety-seven points.
 */
function drawnBounds(w: Placed) {
  const numbers = loop(w.id + "0", w.radius, squashOf(w.id))
    .slice(1, -1)
    .split(/[ML]/)
    .filter(Boolean)
    .map((pair) => pair.trim().split(" ").map(Number));
  const dx = w.x - 140;
  const dz = w.z - 140;
  const xs = numbers.map(([x]) => x! + dx);
  const zs = numbers.map(([, z]) => z! + dz);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}

/** Contour levels: taller ground gets more lines, as on any survey. */
function contoursOf(w: Placed): number[] {
  // Three rings at most. A survey reads by its outlines; more rings than that
  // in a range this dense is texture, and texture is what made it a scribble.
  const count = Math.max(2, Math.min(3, Math.round(w.radius / 18)));
  return Array.from({ length: count }, (_, i) => 1 - i * 0.28);
}

/** Stable per-whorl squash, so a thing keeps its shape between visits. */
function squashOf(id: string): number {
  return 0.82 + seed(id + "s")() * 0.2;
}
