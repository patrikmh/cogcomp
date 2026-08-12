import { type as scale } from "@tlon/design";
import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

import { MotionSurface } from "@/components/MotionSurface";
import { Seal } from "@/components/Seal";
import { useReducedMotion } from "@/lib/motion";
import { colors, fonts } from "@/theme";

/**
 * The week's rhythm: seven columns, each as tall as its day was busy.
 *
 * The prototype's chart, to its own numbers. A bar is 22px wide and its height
 * is 14 plus up to 126 more, scaled against the busiest day of *this* week, so
 * the shape is about this week rather than an absolute standard nobody set. Each
 * grows out of the baseline on `pBar` — .45s, cubic-bezier(.2,0,0,1) — starting
 * at 60ms and 30ms apart, left to right, so the week assembles in the order it
 * happened.
 *
 * Empty days stay, drawn as a 4px hairline. A week with two entries in it is a
 * fact about the week; hiding the five blank days would quietly flatter the
 * record, and nothing here suggests anyone should have written more.
 *
 * A written day carries its seal and opens; an empty one is not a button,
 * because there is nothing behind it to open.
 */
const BAR_MS = 450;
const BAR_EASING = Easing.bezier(0.2, 0, 0, 1);
const FIRST_DELAY_MS = 60;
const STAGGER_MS = 30;
const BAR_BASE = 14;
const BAR_RANGE = 126;
const BAR_EMPTY = 4;

export interface WeekDay {
  date: string;
  entry_count: number;
}

export function WeekChart({
  days,
  today,
  onOpen,
}: {
  days: WeekDay[];
  today: string;
  onOpen?: (date: string) => void;
}) {
  const busiest = Math.max(...days.map((d) => d.entry_count), 1);

  return (
    <View style={styles.chart}>
      {days.map((day, i) => {
        const written = day.entry_count > 0;
        const height = written ? Math.round(BAR_BASE + (day.entry_count / busiest) * BAR_RANGE) : BAR_EMPTY;
        const column = (
          <>
            <Text style={styles.count}>{written ? day.entry_count : ""}</Text>
            <View style={styles.sealSlot}>
              {written ? <Seal id={day.date} size={32} /> : null}
            </View>
            <Bar height={height} index={i} />
            <Text style={[styles.day, day.date === today && styles.dayToday]}>
              {weekdayOf(day.date)}
            </Text>
          </>
        );
        return written && onOpen ? (
          <MotionSurface
            key={day.date}
            style={styles.column}
            onPress={() => onOpen(day.date)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${day.date}, ${day.entry_count} ${day.entry_count === 1 ? "act" : "acts"}`}
          >
            {column}
          </MotionSurface>
        ) : (
          <View key={day.date} style={styles.column}>
            {column}
          </View>
        );
      })}
    </View>
  );
}

function Bar({ height, index }: { height: number; index: number }) {
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
      duration: BAR_MS,
      delay: FIRST_DELAY_MS + index * STAGGER_MS,
      easing: BAR_EASING,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [grow, height, index, reduced]);

  return (
    <Animated.View
      style={[
        styles.bar,
        { height },
        {
          // React Native scales about the centre; CSS gives this bar
          // `transform-origin: bottom`. Shifting down, scaling, and shifting
          // back pins the baseline the way the design has it.
          transform: [{ translateY: height / 2 }, { scaleY: grow }, { translateY: -height / 2 }],
        },
      ]}
    />
  );
}

/** Three letters, uppercased by the style — the design's `.w-col .d`. */
function weekdayOf(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString([], { weekday: "short" });
}

const styles = StyleSheet.create({
  chart: {
    flexDirection: "row",
    marginTop: 22,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineStrong,
  },
  column: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 9,
    paddingTop: 16,
    paddingHorizontal: 4,
    paddingBottom: 12,
  },
  count: {
    color: colors.ink,
    fontFamily: fonts.mono,
    fontSize: 20,
    lineHeight: 20,
    minHeight: 20,
  },
  /** Kept at seal height whether or not there is one, so the bars share a
   *  baseline instead of stepping up under the days that have seals. */
  sealSlot: { height: 32, justifyContent: "center" },
  // Grown from the bottom, as `transform-origin:bottom` does on the web.
  bar: {
    width: 22,
    backgroundColor: colors.lineStrong,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  day: {
    color: colors.inkMuted,
    fontFamily: fonts.mono,
    fontSize: scale.kicker.size,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  dayToday: { color: colors.ink },
});
