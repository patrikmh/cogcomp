import { Canvas, Path, Skia } from "@shopify/react-native-skia";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";

import type { BlobState } from "@/lib/blobShape";
import { useReducedMotion } from "@/lib/motion";

/**
 * The talk avatar — the design's, drawn in the design's arithmetic.
 *
 * Nine nested contours, each a closed loop whose radius is three harmonics of
 * the angle: 0.45 at three lobes, 0.30 at five, 0.18 at two, each drifting at
 * its own rate and stepped in phase by which ring it is. That is what makes the
 * shape read as one thing breathing rather than as nine rings each doing their
 * own turn.
 *
 * It replaces a projected 3D sphere, which was this client's own and looked
 * nothing like the desktop's — the two screens are the same conversation and
 * should not have disagreed about what listening looks like.
 *
 * Voice opens the shape rather than starting it: at rest the rings still carry
 * .35 of their amplitude, so the avatar is something listening rather than
 * something switched off.
 */

/** Nine, as the design draws them. */
const RINGS = 9;
/** The design lays this out on a 720 box; everything here is in that space and
 *  scaled to whatever size the screen asks for. */
const BOX = 720;
const C = BOX / 2;
/** The design walks 240 segments a ring. Fewer shows as a polygon on the
 *  outermost contour, which is the one drawn heaviest. */
const SEGMENTS = 240;
const FPS = 60;

/** The rings answer what the conversation is doing, as they do on the desktop:
 *  amber while it speaks, otherwise the kept blue. Alpha climbs outward so the
 *  shape has an edge rather than a fade.
 *
 *  The design has a fourth, grey state for having stopped asking. This client's
 *  `BlobState` has no such member — stopping is drawn elsewhere on the screen —
 *  so it is left out rather than invented here. */
function strokeFor(state: BlobState, f: number): string {
  if (state === "speaking") return `rgba(230,185,92,${0.28 + f * 0.5})`;
  return `rgba(167,195,200,${0.3 + f * 0.5})`;
}

/** Seconds since mount. Paused freezes rather than resets: the shape is a pure
 *  function of time, so resuming picks up where it stopped. */
function useSeconds(paused: boolean): number {
  const [seconds, setSeconds] = useState(0);
  const held = useRef(0);
  useEffect(() => {
    if (paused) return;
    const started = Date.now() - held.current * 1000;
    let alive = true;
    const id = setInterval(() => {
      if (!alive) return;
      held.current = (Date.now() - started) / 1000;
      setSeconds(held.current);
    }, 1000 / FPS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [paused]);
  return seconds;
}

export function TalkAvatar({
  state,
  size,
  energy = 0.32,
  paused = false,
}: {
  state: BlobState;
  size: number;
  /** 0–1, how loud it is at this instant. */
  energy?: number;
  paused?: boolean;
}) {
  const reduced = useReducedMotion();
  const t = useSeconds(paused || reduced);
  const scale = size / BOX;

  const rings = [];
  for (let k = 0; k < RINGS; k++) {
    const f = k / (RINGS - 1);
    const base = 90 + f * 186;
    const amp = (18 + f * 48) * (0.35 + energy);
    const path = Skia.Path.Make();
    for (let i = 0; i <= SEGMENTS; i++) {
      const th = (i / SEGMENTS) * Math.PI * 2;
      const r =
        base +
        amp * 0.45 * Math.sin(th * 3 + t * 0.7 + k * 0.6) +
        amp * 0.3 * Math.sin(th * 5 - t * 1.1 + k * 0.9) +
        amp * 0.18 * Math.sin(th * 2 + t * 0.4 - k * 0.4);
      const x = (C + Math.cos(th) * r) * scale;
      // The design flattens the shape a little, so it sits rather than floats.
      const y = (C + Math.sin(th) * r * 0.94) * scale;
      if (i) path.lineTo(x, y);
      else path.moveTo(x, y);
    }
    path.close();
    rings.push({ k, path, stroke: strokeFor(state, f), width: k === RINGS - 1 ? 2.4 : 1.5 });
  }

  const dot = Skia.Path.Make();
  dot.addCircle(C * scale, C * scale, (20 + energy * 28) * scale);

  return (
    <View style={{ width: size, height: size }}>
      <Canvas style={{ width: size, height: size }}>
        {rings.map(({ k, path, stroke, width }) => (
          <Path key={k} path={path} style="stroke" strokeWidth={width} color={stroke} />
        ))}
        {/* You, at the centre of the conversation. The one filled thing, so the
            rings read as around something. */}
        <Path
          path={dot}
          color={state === "speaking" ? "#e6b95c" : "#c6e070"}
          opacity={state === "idle" ? 0.5 : 0.9}
        />
      </Canvas>
    </View>
  );
}

export default TalkAvatar;
