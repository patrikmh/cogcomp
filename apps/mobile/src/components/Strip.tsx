import { STRIP_CELLS, stripSeries } from "@tlon/design/marks";
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

export function Strip({ pattern }: {
  pattern: { id: string; detector: string; distinct_days: number; occurrences: number };
}) {
  const { lit, second } = stripSeries(pattern);
  const reduced = useReducedMotion();
  const grow = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) {
      grow.setValue(1);
      return;
    }
    grow.setValue(0);
    const animation = Animated.timing(grow, {
      toValue: 1,
      duration: BAR_MS + STRIP_CELLS * BAR_STAGGER_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [grow, pattern.id, reduced]);

  return (
    <View style={styles.strip} accessibilityElementsHidden>
      {lit.map((on, i) => {
        const other = second[i];
        const height = on || other ? "100%" : "22%";
        // Each cell's own slice of the run, eased inside it — the stagger the
        // web gets from animation-delay.
        const start = (i * BAR_STAGGER_MS) / (BAR_MS + STRIP_CELLS * BAR_STAGGER_MS);
        const end = start + BAR_MS / (BAR_MS + STRIP_CELLS * BAR_STAGGER_MS);
        const scale = grow.interpolate({
          inputRange: [0, start, Math.min(end, 1), 1],
          outputRange: [0, 0, 1, 1],
          extrapolate: "clamp",
        });
        return (
          <View key={i} style={styles.cell}>
            <Animated.View
              style={[
                styles.bar,
                { height },
                !on && !other && styles.dim,
                other && !on ? styles.secondSide : null,
                { transform: [{ scaleY: scale }] },
              ]}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: "row", alignItems: "flex-end", gap: 2, height: 26 },
  cell: { flex: 1, height: "100%", justifyContent: "flex-end" },
  // Grown from the bottom, as `transform-origin: bottom` does on the web.
  bar: { width: "100%", borderTopLeftRadius: 2, borderTopRightRadius: 2, backgroundColor: colors.ink },
  dim: { backgroundColor: colors.line },
  /** The other half of a pair, never on a day the first side holds. */
  secondSide: { backgroundColor: colors.lineStrong },
});
