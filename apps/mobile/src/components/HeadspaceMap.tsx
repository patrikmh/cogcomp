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
import { View } from "react-native";
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
  height = 300,
  onSelect,
}: {
  whorls: Whorl[];
  height?: number;
  onSelect?: (whorl: Whorl) => void;
}) {
  const reduced = useReducedMotion();
  const [elapsed, setElapsed] = useState(reduced ? 99 : 0);

  const placed = useMemo(() => place(whorls), [whorls]);
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
  }, [placed, reduced]);

  return (
    <View
      accessibilityLabel={`A survey of the record: ${whorls.length} whorls, sized by what each one is`}
    >
      <Svg width="100%" height={height} viewBox={box}>
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
                    fill="none"
                    stroke={w.tentative ? colors.inkMuted : colors.ink}
                    strokeWidth={i === 0 ? 1.2 : 0.9}
                    strokeOpacity={w.tentative ? 0.5 : 0.35 + 0.5 * (1 - i / 6)}
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

  return whorls.map((w) => {
    const radius = whorlRadius(w.group, R, w.weight, w.bar);
    const jitter = seed(w.id + "z");
    if (w.group === "pattern") {
      const i = patterns.indexOf(w);
      return {
        ...w,
        radius,
        x: chainX(i, patterns.length, R * 0.7),
        z: -R * 0.5 + (jitter() - 0.5) * R * 0.2,
        arrives: arriveAt("pattern", i),
      };
    }
    if (w.group === "reading") {
      const i = readings.indexOf(w);
      const span = R * 0.85 * Math.max(1, Math.sqrt(readings.length / 7));
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
 * The camera, fitted to the material rather than to a guess.
 *
 * The web frames the whole massif whatever the record holds; this computes the
 * same bounding box and hands it to the viewBox, so a record with two patterns
 * and one with twenty both fill the frame.
 */
export function fit(placed: Placed[]): string {
  if (!placed.length) return `0 0 ${R * 2} ${R * 2}`;
  const pad = R * 0.12;
  const minX = Math.min(...placed.map((w) => w.x - w.radius)) - pad;
  const maxX = Math.max(...placed.map((w) => w.x + w.radius)) + pad;
  const minZ = Math.min(...placed.map((w) => w.z - w.radius)) - pad;
  const maxZ = Math.max(...placed.map((w) => w.z + w.radius)) + pad;
  return `${minX} ${minZ} ${maxX - minX} ${maxZ - minZ}`;
}

/** Contour levels: taller ground gets more lines, as on any survey. */
function contoursOf(w: Placed): number[] {
  const count = Math.max(2, Math.min(6, Math.round(w.radius / 11)));
  return Array.from({ length: count }, (_, i) => 1 - (i * 0.62) / count);
}

/** Stable per-whorl squash, so a thing keeps its shape between visits. */
function squashOf(id: string): number {
  return 0.82 + seed(id + "s")() * 0.2;
}
