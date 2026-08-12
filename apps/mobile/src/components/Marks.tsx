import { radii, type as scale } from "@tlon/design";
import { StyleSheet, Text, View } from "react-native";

import { colors, fonts } from "@/theme";

/**
 * The small typographic marks the design is made of.
 *
 * Each is one thing, and each exists in the web client already — this is the
 * same vocabulary rather than a mobile dialect of it. Kept together because
 * they are only meaningful as a set: a kicker with no rule under it and a chip
 * with no confidence in it are just text.
 */

/** Mono, uppercase, widely spaced. Labels a section without competing with it. */
export function Kicker({ children, tone = colors.inkMuted }: {
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <Text style={[styles.kicker, { color: tone }]} accessibilityRole="header">
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
export function Chip({ label, confidence, tentative = false }: {
  label: string;
  confidence: number;
  tentative?: boolean;
}) {
  return (
    <View style={[styles.chip, tentative && styles.chipTentative]}>
      <Text style={[styles.chipText, tentative && styles.chipTextTentative]} numberOfLines={1}>
        {label} · {confidence.toFixed(2)}
      </Text>
    </View>
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
  chipTentative: { borderColor: colors.warning, borderStyle: "dashed" },
  chipText: { color: colors.inkSoft, fontFamily: fonts.mono, fontSize: scale.meta.size },
  chipTextTentative: { color: colors.warning },
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
