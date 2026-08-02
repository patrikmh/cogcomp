import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  Path,
  RadialGradient,
  vec,
} from "@shopify/react-native-skia";
import { useEffect, useRef, useState } from "react";
import { PanResponder, StyleSheet, View } from "react-native";

import { type BlobState, motionFor, withEnergy } from "@/lib/blobShape";
import { MAX_EXTENT, project, toPath } from "@/lib/blobSphere";

/**
 * The sphere — the thing you talk to.
 *
 * A presence rather than a face. A face invites you to read an expression on it,
 * and this thing has no feelings about what you are telling it; a shape can be
 * looked at while you think without implying that it is judging.
 *
 * It is genuinely three-dimensional: `@/lib/blobSphere` rotates real 3D points and
 * projects them, splitting each ring where it crosses the view plane so the far
 * half can be drawn dim and behind. This file only paints, and painting is just
 * "draw the arcs in the order they arrive" — the sort has already happened.
 *
 * You can spin it with a finger. That is not decoration: something that answers
 * to your hand reads as present in a way an animation loop never does, and it
 * gives you something to do while you work out what you want to say.
 *
 * Animation is driven by a timer rather than Skia's `useClock`, which needs
 * reanimated — not in this project's dependency tree.
 */

/** Rendered frames per second. Under 60 on purpose: the motion is slow, so the
 *  extra frames are invisible and the battery cost is not. */
const FPS = 30;

/** Per-ring colour, indexed by the ring's stable `index` so a ring keeps its
 *  colour as it orbits rather than changing hue halfway round. */
const RING_COLOURS = ["#22d3ee", "#a855f7", "#ec4899", "#818cf8", "#67e8f9", "#c084fc"];

/** How far the glow extends past the body, as a multiple of its radius. */
const HALO_SCALE = 1.2;

/** Radians of spin per pixel of flick. Tuned so a flick across the sphere turns
 *  it most of the way round — less and it feels like it is resisting you. */
const DRAG_SENSITIVITY = 0.05;

/** Fraction of drag velocity retained per frame. Below 1 so a flick coasts to a
 *  stop rather than spinning forever. */
const MOMENTUM_DECAY = 0.94;

/** The sphere's own turn rate, in radians per second. Slow: this sits on screen
 *  while someone thinks, and a fast spinner demands attention it has not earned. */
const BASE_SPIN = 0.32;

interface Props {
  state: BlobState;
  size: number;
  /** Pauses the clock. Off-screen there is nothing to animate and every frame is
   *  wasted work. */
  paused?: boolean;
  /** 0–1 loudness of the voice at this instant, from the clip's envelope. This is
   *  what puts the shape in time with the words rather than merely moving while
   *  audio happens to be playing. */
  energy?: number;
}

/** Seconds since mount, ticking at FPS. Paused means frozen, not reset — the
 *  shape is a pure function of time, so resuming picks up where it stopped. */
function useClock(paused: boolean): number {
  const [time, setTime] = useState(0);
  const elapsed = useRef(0);

  useEffect(() => {
    if (paused) return;
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
  }, [paused]);

  return time;
}

/**
 * Extra rotation contributed by dragging, in radians.
 *
 * An offset added to the automatic spin rather than replacing it, so letting go
 * returns the sphere to its own slow turn instead of leaving it stranded wherever
 * your finger stopped.
 */
function useDragSpin(time: number) {
  const [offset, setOffset] = useState(0);
  const velocity = useRef(0);
  const dragging = useRef(false);

  // Momentum, advanced off the render clock rather than its own timer — a paused
  // sphere should not keep coasting invisibly.
  useEffect(() => {
    if (dragging.current || Math.abs(velocity.current) < 0.0005) return;
    velocity.current *= MOMENTUM_DECAY;
    setOffset((current) => current + velocity.current);
  }, [time]);

  const responder = useRef(
    PanResponder.create({
      // Deliberately not claiming the gesture on touch-down: a tap must still
      // reach the parent, which toggles focus mode. Only a clear drag is ours.
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4,
      onPanResponderGrant: () => {
        dragging.current = true;
        velocity.current = 0;
      },
      onPanResponderMove: (_, gesture) => {
        // Horizontal only. The sphere turns about one axis, so vertical drag has
        // nothing to move and pretending otherwise would feel broken.
        setOffset((current) => current + gesture.vx * DRAG_SENSITIVITY);
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

  return { offset, responder };
}

export default function Blob({ state, size, paused = false, energy = 0 }: Props) {
  const time = useClock(paused);
  const motion = withEnergy(motionFor(state), energy);
  const { offset, responder } = useDragSpin(time);

  const centre = size / 2;
  // Sized so the halo still fits at full energy: a loud syllable must not push
  // the glow past the canvas edge, where it would clip into a hard circle.
  const radius = size / 2 / (MAX_EXTENT * HALO_SCALE);

  const spin = BASE_SPIN * motion.speed;
  const arcs = project(
    // The drag offset is converted to time so it rides the same rotation the
    // automatic spin does — dragging nudges the turn rather than fighting it.
    time + (spin === 0 ? 0 : offset / spin),
    { cx: centre, cy: centre, radius },
    { energy, wobble: 0.04 + 0.04 * motion.amplitude, spin },
  );

  return (
    <View
      style={[styles.container, { width: size, height: size }]}
      {...responder.panHandlers}
    >
      <Canvas style={{ width: size, height: size }}>
        {/* The sphere brings its own darkness.
            Everything above is emissive — thin bright strokes that only read as
            light if something dark sits behind them. On a white page without this
            the whole thing washes out to a pale doodle. Faded to transparent at
            the edge so it is a glow rather than a pasted-on hole. */}
        <Circle cx={centre} cy={centre} r={radius * HALO_SCALE}>
          <RadialGradient
            c={vec(centre, centre)}
            r={radius * HALO_SCALE}
            colors={["#0b0718", "#0b0718dd", "#140b2e55", "#14082400"]}
            positions={[0, 0.5, 0.76, 1]}
          />
          <BlurMask blur={12} style="normal" />
        </Circle>

        {/* A wash of colour inside the cage, brightening with the voice. */}
        <Circle cx={centre} cy={centre} r={radius * 0.98}>
          <RadialGradient
            c={vec(centre, centre)}
            r={radius * 1.15}
            colors={["#7c3aed00", "#a855f733", "#ec489944", "#00000000"]}
          />
          <BlurMask blur={18 * motion.glow + 8} style="normal" />
        </Circle>

        {/* Painter's algorithm. `project` already sorted these far to near, so
            drawing them in order gives correct occlusion with no depth buffer —
            and the depth each arc carries becomes the brightness that sells it. */}
        <Group>
          {arcs.map((arc, i) => (
            <Path
              key={`${arc.index}-${i}`}
              path={toPath(arc.points)}
              style="stroke"
              strokeWidth={1.1 + 1.7 * arc.depth}
              strokeCap="round"
              color={RING_COLOURS[arc.index % RING_COLOURS.length]}
              // The far side of the body reads as behind it rather than through
              // it. This one gradient is most of what makes the shape solid.
              opacity={0.14 + 0.8 * arc.depth}
            >
              {/* "solid" keeps the stroke crisp and blurs outward, which is what
                  makes a thin line read as glowing rather than as smudged. */}
              <BlurMask blur={1.5 + 2.5 * arc.depth} style="solid" />
            </Path>
          ))}
        </Group>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", justifyContent: "center" },
});
