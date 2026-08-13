import { seed } from "@tlon/design/marks";
import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

import { useReducedMotion } from "@/lib/motion";
import { colors } from "@/theme";

/**
 * An experiment's shape: one cell per day, lit on the days it was checked in.
 *
 * The same argument as a finding's fortnight strip, and the same honesty about
 * it. Which days are lit is illustrative and seeded from the experiment's id,
 * so the arc is stable between visits rather than reshuffling; how many are lit
 * is exact, because the count sits beside it in the row. A drafted experiment
 * lights nothing — it has not started, and a shape implying otherwise would be
 * the app inventing a history.
 *
 * A running arc is lit in the live colour and a finished one in ink, so the
 * list separates what is happening now from what is over without a word.
 *
 * The cells grow out of the baseline on `pBar` — .5s on cubic-bezier(.2,0,0,1),
 * 24ms apart, the design's own numbers for this strip.
 */
const BAR_MS = 500;
const BAR_STAGGER_MS = 24;
const BAR_EASING = Easing.bezier(0.2, 0, 0, 1);
const STRIP_HEIGHT = 34;
/** The detail screen draws the same arc taller — `.x-strip.big` — because there
 *  it is the subject rather than a line in a list. */
const BIG_HEIGHT = 56;
const EMPTY_HEIGHT = 4;

export function Arc({
  id,
  days,
  checkins,
  state,
  big = false,
}: {
  id: string;
  days: number;
  checkins: number;
  /** The app's own vocabulary: draft, active, paused, completed, cancelled. */
  state: string;
  /** The detail screen's taller arc. */
  big?: boolean;
}) {
  const reduced = useReducedMotion();
  const started = state !== "draft";
  const cells = Array.from({ length: Math.max(1, Math.min(days, 42)) }, (_, i) => {
    const rnd = seed(`${id}:${i}`);
    return started && rnd() < checkins / Math.max(1, days);
  });
  const grow = useRef(cells.map(() => new Animated.Value(reduced ? 1 : 0))).current;

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
  }, [grow, id, reduced]);

  return (
    <View
      style={[styles.strip, big && styles.stripBig]}
      accessibilityElementsHidden
    >
      {cells.map((on, i) => (
        <View key={i} style={styles.cell}>
          <Animated.View
            style={[
              styles.bar,
              on ? { height: "100%" } : { height: EMPTY_HEIGHT },
              on && (state === "active" ? styles.running : styles.done),
              on
                ? {
                    transform: [
                      { translateY: (big ? BIG_HEIGHT : STRIP_HEIGHT) / 2 },
                      { scaleY: grow[i]! },
                      { translateY: -(big ? BIG_HEIGHT : STRIP_HEIGHT) / 2 },
                    ],
                  }
                : null,
            ]}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: "row", gap: 3, height: STRIP_HEIGHT, alignItems: "flex-end", marginTop: 14 },
  stripBig: { height: BIG_HEIGHT, marginTop: 18 },
  cell: { flex: 1, minWidth: 0, height: "100%", justifyContent: "flex-end" },
  bar: { width: "100%", borderTopLeftRadius: 2, borderTopRightRadius: 2, backgroundColor: colors.line },
  running: { backgroundColor: colors.cyan },
  done: { backgroundColor: colors.ink },
});
