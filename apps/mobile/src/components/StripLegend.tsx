import { STRIP_CELLS, daysOfFortnight } from "@tlon/design/marks";
import { StyleSheet, Text, View } from "react-native";

import { colors, fonts } from "@/theme";

/**
 * What the strip above it is showing, in one line.
 *
 * A two-sided finding draws its halves in ink and sand, and until now nothing
 * said which half was which. A reader could see two colours and no way to learn
 * what they meant — which is worse than one colour, because it looks like it is
 * telling you something.
 *
 * The design puts a swatch beside each name and states the claim the shape is
 * making: an ordering's two sides never share an entry; a stated-versus-recorded
 * finding's two sides never overlap. That sentence is the finding. The design
 * ends each with "Hover a day", which a phone cannot do, so this ends where the
 * fact ends.
 */
export function StripLegend({
  pattern,
}: {
  pattern: { detector: string; label: string; distinct_days: number; occurrences: number };
}) {
  const parts = pattern.label.split(/,\s*then\s*|\s*·\s*/);

  if (pattern.detector === "lag" || pattern.detector === "same-day-order") {
    return (
      <Text style={styles.line}>
        <Swatch tone={colors.ink} />
        {parts[0] ?? "the first"} · <Swatch tone={colors.lineStrong} />
        {parts[1] ?? "the second"} — they never share an entry.
      </Text>
    );
  }

  if (pattern.detector === "stated-vs-recorded") {
    return (
      <Text style={styles.line}>
        <Swatch tone={colors.ink} />
        stated on {Math.max(0, pattern.occurrences - pattern.distinct_days)} ·{" "}
        <Swatch tone={colors.warning} />
        recorded on {pattern.distinct_days} — the two never overlap.
      </Text>
    );
  }

  return (
    <Text style={styles.line}>
      {`${pattern.label} came up on ${daysOfFortnight(pattern.distinct_days)} writing days.`}
    </Text>
  );
}

/** The design's 8px square, inline with the words it labels. */
function Swatch({ tone }: { tone: string }) {
  return <Text style={[styles.swatch, { color: tone }]}>■ </Text>;
}

const styles = StyleSheet.create({
  line: {
    marginTop: 10,
    color: colors.inkSoft,
    fontFamily: fonts.mono,
    fontSize: 11.5,
    lineHeight: 17,
  },
  swatch: { fontSize: 9 },
});
