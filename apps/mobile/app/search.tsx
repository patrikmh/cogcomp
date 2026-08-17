import { radii, type as scale } from "@tlon/design";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { Guide } from "@/components/Guide";
import { Chip, Kicker, Rule } from "@/components/Marks";
import { MotionSurface } from "@/components/MotionSurface";
import { ErrorLens } from "@/components/SpatialField";
import { Seal } from "@/components/Seal";
import { api, type ObservationResponse } from "@/lib/api";
import { useDrawnFrom } from "@/lib/drawnFrom";
import { useSession } from "@/state/session";
import { usePreferences } from "@/state/preferences";
import { colors, fonts } from "@/theme";
import { Rise, Rising } from "@/components/Rise";
import { useReducedMotion } from "@/lib/motion";
import { HEADINGS } from "@tlon/copy/headings";

/**
 * Find an entry.
 *
 * A literal substring match over the person's own words, newest first, with the
 * count stated. Deliberately not ranked by relevance: a silent ranking decides
 * for someone what mattered, and this is the one screen whose whole job is to
 * give them back exactly what they wrote.
 *
 * Readings are not searched either. They are the app's words about the entry,
 * not the entry, and mixing them into these results would quietly answer a
 * different question than the one asked.
 */
export default function SearchScreen() {
  const token = useSession((s) => s.token);
  const userId = useSession((s) => s.userId);
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [focused, setFocused] = useState(false);

  const entries = useQuery({
    queryKey: ["observations", userId],
    queryFn: () => api.listObservations(token!),
    enabled: Boolean(token && userId),
  });
  const preferencesReady = usePreferences((s) => s.ready);
  const showFindings = usePreferences((s) => s.findings);
  const findingsVisible = preferencesReady && showFindings;
  const drawnFrom = useDrawnFrom(token, userId, 4, findingsVisible);

  if (!token) return null;
  if (entries.isError) {
    return <ErrorLens label="Could not load your observations." onRetry={() => void entries.refetch()} />;
  }

  const all: ObservationResponse[] = entries.data?.observations ?? [];
  const needle = term.trim().toLowerCase();
  const hits = needle ? all.filter((e) => e.content.toLowerCase().includes(needle)) : [];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Rising>
      <Kicker>{HEADINGS.search.kicker}</Kicker>
      <View style={styles.headingRow}>
        <Text style={styles.title}>{HEADINGS.search.title}</Text>
        <Guide id="search" />
      </View>
      <Text style={styles.sub}>
        Literal text, newest first. Readings are not searched — they are not your words.
      </Text>

      {/* A rule under the words, not a box around them. The design has this as
          a baseline the sentence sits on, darkening to ink on focus; a bordered
          card here reads as a form to fill in rather than as a place to say a
          word you remember. */}
      <TextInput
        style={[styles.field, focused && styles.fieldOn]}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        value={term}
        onChangeText={setTerm}
        placeholder="A word you remember writing"
        placeholderTextColor={colors.inkMuted}
        autoCorrect={false}
        autoCapitalize="none"
      />

      {/* The count, in every state. "No act contains X" is a fact about the
          record; a search that shrugs and shows something adjacent would be
          answering a question nobody asked. */}
      <Text style={styles.count}>
        {entries.isLoading
          ? "Reading the record…"
          : !needle
            ? `${all.length} ${all.length === 1 ? "act" : "acts"} in the record — type to look back through them.`
            : hits.length
              ? `${hits.length} of ${all.length} ${hits.length === 1 ? "act contains" : "acts contain"} “${term.trim()}”.`
              : `No act contains “${term.trim()}”. Nothing was ranked or guessed.`}
      </Text>
      <Rule />

      {hits.map((hit, i) => {
        const drawn = drawnFrom.get(hit.id) ?? [];
        return (
          <Rise key={hit.id} index={i} duration={400} stagger={50} restartKey={needle}>
          <View style={styles.hit}>
            <MotionSurface
              style={styles.hitMain}
              onPress={() => router.push(`/node/${hit.id}`)}
              accessibilityRole="button"
              accessibilityLabel={hit.content}
            >
            <Seal id={hit.id} size={28} />
            <View style={styles.hitBody}>
              {/* Dated as everything else in the record is dated. A bare
                  `toLocaleDateString` gave "8/15/2026" — a machine's date,
                  sitting in a kicker beside a hand-drawn seal, and the only
                  numeric date anywhere in the app. */}
              <Kicker>
                {new Date(hit.captured_at).toLocaleDateString([], {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}
              </Kicker>
              <Text style={styles.hitText}>{highlight(hit.content, needle)}</Text>
              </View>
            </MotionSurface>
              {findingsVisible && drawn.length > 0 && (
                <View style={styles.chips}>
                  {drawn.slice(0, 3).map((r) => (
                    <Chip
                      key={r.id}
                      label={r.label}
                      confidence={r.confidence}
                      tentative={r.tentative}
                      onPress={() => router.push(`/node/${r.id}`)}
                    />
                  ))}
                </View>
              )}
          </View>
          </Rise>
        );
      })}
      </Rising>
    </ScrollView>
  );
}

/** The matched run, marked in place. The surrounding words stay exactly as they
 *  were written — this highlights, it does not summarise. */
function highlight(content: string, needle: string) {
  if (!needle) return content;
  const parts: React.ReactNode[] = [];
  let rest = content;
  let key = 0;
  for (;;) {
    const at = rest.toLowerCase().indexOf(needle);
    if (at < 0) break;
    parts.push(rest.slice(0, at));
    parts.push(<Mark key={key++} text={rest.slice(at, at + needle.length)} />);
    rest = rest.slice(at + needle.length);
  }
  parts.push(rest);
  return parts;
}

/**
 * The matched run, marked as the design marks it.
 *
 * Not an inverted chip: the words stay exactly where they were, in the live
 * colour with a hairline under them, and a pale wash fades in behind — `sMark`,
 * .5s on cubic-bezier(.3,.8,.2,1). A block of inverted text reads as something
 * the app inserted; this reads as the same sentence with a finger under a word.
 */
const MARK_MS = 500;
const MARK_EASING = Easing.bezier(0.3, 0.8, 0.2, 1);
/** The wash the prototype fades to: rgba(254,252,191,.22). */
const MARK_WASH = "rgba(254,252,191,0.22)";

function Mark({ text }: { text: string }) {
  const reduced = useReducedMotion();
  const wash = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) {
      wash.setValue(1);
      return;
    }
    wash.setValue(0);
    const animation = Animated.timing(wash, {
      toValue: 1,
      duration: MARK_MS,
      easing: MARK_EASING,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [reduced, text, wash]);

  return (
    <Animated.Text
      style={[
        styles.mark,
        {
          backgroundColor: wash.interpolate({
            inputRange: [0, 1],
            outputRange: ["rgba(254,252,191,0)", MARK_WASH],
          }),
        },
      ]}
    >
      {text}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.room },
  content: { padding: 20, paddingBottom: 56, gap: 10 },
  title: {
    color: colors.ink,
    fontFamily: fonts.sansBold,
    fontSize: scale.title.size,
    lineHeight: scale.title.line,
    letterSpacing: scale.title.tracking,
  },
  sub: {
    color: colors.inkMuted,
    fontFamily: fonts.sans,
    fontSize: scale.body.size,
    lineHeight: scale.body.line,
  },
  field: {
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    color: colors.ink,
    fontFamily: fonts.sans,
    fontSize: 20,
    lineHeight: 28,
    letterSpacing: -0.2,
    paddingTop: 4,
    paddingHorizontal: 2,
    paddingBottom: 12,
    marginTop: 6,
    // The browser's own focus ring is not this design's focus state.
    outlineStyle: "none",
  } as object,
  fieldOn: { borderBottomColor: colors.ink },
  headingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  count: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: scale.meta.size },
  hit: { gap: 6, paddingVertical: 8 },
  hitMain: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  hitBody: { flex: 1, gap: 6 },
  hitText: {
    color: colors.ink,
    fontFamily: fonts.sans,
    fontSize: scale.body.size,
    lineHeight: scale.body.line,
  },
  mark: {
    color: colors.cyan,
    textDecorationLine: "underline",
    textDecorationColor: "rgba(122,220,200,0.45)",
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
});
