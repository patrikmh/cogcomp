import { radii, type as scale } from "@tlon/design";
import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { MotionSurface } from "@/components/MotionSurface";

import { useReducedMotion } from "@/lib/motion";

import { colors, fonts } from "@/theme";

/**
 * The small typographic marks the design is made of.
 *
 * Each is one thing, and each exists in the web client already — this is the
 * same vocabulary rather than a mobile dialect of it. Kept together because
 * they are only meaningful as a set: a kicker with no rule under it and a chip
 * with no confidence in it are just text.
 */

/**
 * Mono, uppercase, widely spaced. Labels a section without competing with it.
 *
 * Not a heading by default, which it was for a while. Most kickers are metadata
 * — "Written · 15:30", "pattern · 8 entries · 95% confident" — and announcing
 * those as headings fills a screen reader's heading list with things nobody
 * would navigate by. `heading` marks the ones that genuinely title a section,
 * and they come in at level 2 rather than sharing level 1 with the screen's own
 * title.
 */
export function Kicker({ children, tone = colors.inkMuted, heading = false }: {
  children: React.ReactNode;
  tone?: string;
  /** This kicker titles a section, rather than describing one thing. */
  heading?: boolean;
}) {
  return (
    <Text
      style={[styles.kicker, { color: tone }]}
      accessibilityRole={heading ? "header" : undefined}
      aria-level={heading ? 2 : undefined}
    >
      {children}
    </Text>
  );
}

/** The hairline that closes a kicker off from what follows it. */
export function Rule() {
  return <View style={styles.rule} />;
}

/**
 * A reading, and how sure the record is of it.
 *
 * The confidence is not decoration and never rounds away: it is the difference
 * between "the water · 0.65" and a claim presented as fact. Tentative readings
 * are drawn hollow with a dashed edge, the same signal the web uses.
 */
export function Chip({ label, confidence, tentative = false, onPress }: {
  label: string;
  confidence: number;
  tentative?: boolean;
  /** Opens the reading, where it can be agreed with or refused. A reading shown
   *  beside the words it was drawn from is the one moment someone can judge it
   *  cheaply — they are already looking at the evidence. Asked for anywhere else
   *  it is a backlog, and a hundred of them is a backlog nobody will ever work
   *  through. */
  onPress?: () => void;
}) {
  const body = (
    <Text style={[styles.chipText, tentative && styles.chipTextTentative]} numberOfLines={1}>
      {label} · {confidence.toFixed(2)}
    </Text>
  );
  if (!onPress) {
    return <View style={[styles.chip, tentative && styles.chipTentative]}>{body}</View>;
  }
  return (
    <MotionSurface
      style={[styles.chip, tentative && styles.chipTentative]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, drawn with ${Math.round(confidence * 100)} per cent confidence. Open to agree or disagree.`}
    >
      {body}
    </MotionSurface>
  );
}

/**
 * A bordered label with no number in it.
 *
 * The same mark as a chip, minus the confidence — for things that are named
 * rather than measured: a kind, a count, a phone number you can ring. The web
 * uses `.pill` for exactly these and it would be wrong to give them a
 * confidence they do not have.
 */
export function Pill({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return (
    <View style={[styles.chip, tone ? { borderColor: tone } : null]}>
      <Text style={[styles.chipText, tone ? { color: tone } : null]}>{children}</Text>
    </View>
  );
}

/**
 * How sure the record is, drawn rather than only stated.
 *
 * The web's `.meter` — 180 by 3, on a track, filled to the confidence and sand
 * rather than live when the reading is tentative. It fills over .7s with
 * `sMeter`, so the bar arrives at its value instead of being found at it, which
 * is the difference between a number reported and a number asserted.
 */
export function Meter({ confidence, tentative = false, threshold = false }: {
  confidence: number;
  tentative?: boolean;
  /** The half-way mark, drawn as the web's `.meter u` does. Where the line
   *  between "noticed" and "less sure about" actually falls, rather than a rule
   *  the reader is asked to remember. */
  threshold?: boolean;
}) {
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
      duration: 700,
      delay: 150,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [grow, confidence, reduced]);

  const width = grow.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`],
  });

  return (
    <View
      style={styles.track}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(confidence * 100) }}
    >
      <Animated.View
        style={[styles.fill, tentative && styles.fillTentative, { width }]}
      />
      {threshold ? <View style={styles.threshold} /> : null}
    </View>
  );
}

/**
 * The line an act hangs from, with the time it was written.
 *
 * Vertical rule, a dot at the act, and the clock in mono beside it — the shape
 * the web journal uses to say "these happened in this order" without numbering
 * anything.
 */
export function Spine({ time, lit = false }: { time: string; lit?: boolean }) {
  return (
    <View style={styles.spine}>
      <Text style={styles.spineTime}>{time}</Text>
      <View style={styles.spineRail}>
        <View style={[styles.spineDot, lit && styles.spineDotLit]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  kicker: {
    fontFamily: fonts.monoMedium,
    fontSize: scale.kicker.size,
    lineHeight: scale.kicker.line,
    letterSpacing: scale.kicker.tracking,
    textTransform: "uppercase",
  },
  rule: { height: 1, backgroundColor: colors.line, marginTop: 8, marginBottom: 12 },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.chip,
    paddingHorizontal: 8,
    paddingVertical: 5,
    alignSelf: "flex-start",
    maxWidth: "100%",
  },
  chipTentative: { borderStyle: "dashed" },
  chipText: { color: colors.inkSoft, fontFamily: fonts.mono, fontSize: scale.meta.size },
  chipTextTentative: { color: colors.warning },
  track: { width: 180, maxWidth: "100%", height: 3, borderRadius: 3, backgroundColor: colors.track },
  fill: { height: 3, borderRadius: 3, backgroundColor: colors.cyan },
  fillTentative: { backgroundColor: colors.warning },
  threshold: { position: "absolute", left: "50%", top: -4, bottom: -4, width: 1, backgroundColor: colors.inkMuted },
  spine: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  spineTime: {
    color: colors.inkMuted,
    fontFamily: fonts.mono,
    fontSize: scale.meta.size,
    lineHeight: scale.meta.line,
    minWidth: 40,
    textAlign: "right",
  },
  spineRail: { width: 1, alignSelf: "stretch", backgroundColor: colors.line, alignItems: "center" },
  spineDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.line,
    marginTop: 6,
    marginLeft: -2,
  },
  spineDotLit: { backgroundColor: colors.ink },
});
