import { stripSeries } from "@tlon/design/marks";
import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

import { useReducedMotion } from "@/lib/motion";
import { colors } from "@/theme";

/**
 * A fortnight under a finding.
 *
 * Fourteen cells, one per day, lit on the days the finding rests on. Which days
 * is illustrative and the caption says so; how many is exact, because the count
 * sits beside a sentence stating it.
 *
 * The bars grow from the baseline rather than appearing at full height — the
 * web's `pBar`, scaleY 0 to 1 over .5s with cubic-bezier(.2,0,0,1), each cell
 * 26ms after the one before. A finding assembling itself out of its days is the
 * whole argument of the screen made visible.
 */
const BAR_MS = 500;
const BAR_STAGGER_MS = 26;
/** The prototype's curve for a bar growing out of its baseline. */
const BAR_EASING = Easing.bezier(0.2, 0, 0, 1);
/** A day the finding does not rest on: a hairline, and it does not grow —
 *  `.p-cell.dim .p-bar` sets `animation:none` and a 3px height. */
const DIM_HEIGHT = 3;
/** The strip's own height, so a bar can be pinned to its baseline while it
 *  grows — React Native scales about the centre, CSS about the origin. */
const STRIP_HEIGHT = 52;
/** The other half of a pair is drawn shorter as well as differently coloured —
 *  `.p-bar.r` is 55% tall — so a glance separates the two sides by shape and
 *  not by colour alone. */
const SECOND_HEIGHT = "55%";

export function Strip({ pattern }: {
  pattern: { id: string; detector: string; distinct_days: number; occurrences: number };
}) {
  const { lit, second } = stripSeries(pattern);
  const reduced = useReducedMotion();
  // One value per cell, each on its own delay and its own curve. Driving all
  // fourteen from a single linear clock and slicing it up approximated the
  // stagger but flattened the easing, so every bar rose at a constant rate
  // where the design has them ease out of the baseline.
  const grow = useRef(lit.map(() => new Animated.Value(reduced ? 1 : 0))).current;

  useEffect(() => {
    if (reduced) {
      grow.forEach((value) => value.setValue(1));
      return;
    }
    const animation = Animated.parallel(
      grow.map((value, i) => {
        value.setValue(0);
        return Animated.timing(value, {
          toValue: 1,
          duration: BAR_MS,
          delay: i * BAR_STAGGER_MS,
          easing: BAR_EASING,
          useNativeDriver: true,
        });
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [grow, pattern.id, reduced]);

  return (
    <View style={styles.strip} accessibilityElementsHidden>
      {lit.map((on, i) => {
        const other = second[i];
        const dim = !on && !other;
        const scale = grow[i]!;
        return (
          <View key={i} style={styles.cell}>
            <Animated.View
              style={[
                styles.bar,
                dim
                  ? { height: DIM_HEIGHT }
                  : { height: other && !on ? SECOND_HEIGHT : "100%" },
                dim && styles.dim,
                other && !on ? styles.secondSide : null,
                // A hairline day does not grow: there is nothing there to rise.
                // The rest grow out of the baseline rather than out of their
                // own middle, which is what `transform-origin: bottom` does on
                // the web and what React Native's centre-scaling does not.
                dim
                  ? null
                  : {
                      transform: [
                        { translateY: STRIP_HEIGHT / 2 },
                        { scaleY: scale },
                        { translateY: -STRIP_HEIGHT / 2 },
                      ],
                    },
              ]}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: "row", alignItems: "flex-end", gap: 3, height: STRIP_HEIGHT },
  cell: { flex: 1, height: "100%", justifyContent: "flex-end" },
  // Grown from the bottom, as `transform-origin: bottom` does on the web.
  bar: { width: "100%", borderTopLeftRadius: 2, borderTopRightRadius: 2, backgroundColor: colors.ink },
  dim: { backgroundColor: colors.line },
  /** The other half of a pair, never on a day the first side holds. Sand at
   *  three quarters, as the design draws it: the recorded side of a
   *  stated-versus-recorded finding, or the later half of an ordering. */
  secondSide: { backgroundColor: colors.warning, opacity: 0.75 },
});
