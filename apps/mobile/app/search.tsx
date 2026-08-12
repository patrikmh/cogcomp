import { radii, type as scale } from "@tlon/design";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { Chip, Kicker, Rule } from "@/components/Marks";
import { MotionSurface } from "@/components/MotionSurface";
import { Seal } from "@/components/Seal";
import { api, type ObservationResponse } from "@/lib/api";
import { useDrawnFrom } from "@/lib/drawnFrom";
import { useSession } from "@/state/session";
import { colors, fonts } from "@/theme";

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

  const entries = useQuery({
    queryKey: ["observations", userId],
    queryFn: () => api.listObservations(token!),
    enabled: Boolean(token && userId),
  });
  const drawnFrom = useDrawnFrom(token, userId);

  if (!token) return null;

  const all: ObservationResponse[] = entries.data?.observations ?? [];
  const needle = term.trim().toLowerCase();
  const hits = needle ? all.filter((e) => e.content.toLowerCase().includes(needle)) : [];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Kicker>Find an entry</Kicker>
      <Text style={styles.title}>Your own words, found</Text>
      <Text style={styles.sub}>
        Literal text, newest first. Readings are not searched — they are not your words.
      </Text>

      <TextInput
        style={styles.field}
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

      {hits.map((hit) => {
        const drawn = drawnFrom.get(hit.id) ?? [];
        return (
          <MotionSurface
            key={hit.id}
            style={styles.hit}
            onPress={() => router.push(`/node/${hit.id}`)}
            accessibilityRole="button"
            accessibilityLabel={hit.content}
          >
            <Seal id={hit.id} size={28} />
            <View style={styles.hitBody}>
              <Kicker>{new Date(hit.captured_at).toLocaleDateString()}</Kicker>
              <Text style={styles.hitText}>{highlight(hit.content, needle)}</Text>
              {drawn.length > 0 && (
                <View style={styles.chips}>
                  {drawn.slice(0, 3).map((r) => (
                    <Chip
                      key={r.id}
                      label={r.label}
                      confidence={r.confidence}
                      tentative={r.tentative}
                    />
                  ))}
                </View>
              )}
            </View>
          </MotionSurface>
        );
      })}
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
    parts.push(
      <Text key={key++} style={styles.mark}>
        {rest.slice(at, at + needle.length)}
      </Text>,
    );
    rest = rest.slice(at + needle.length);
  }
  parts.push(rest);
  return parts;
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
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radii.surface,
    color: colors.ink,
    fontFamily: fonts.sans,
    fontSize: scale.body.size,
    padding: 14,
    marginTop: 6,
  },
  count: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: scale.meta.size },
  hit: { flexDirection: "row", gap: 10, alignItems: "flex-start", paddingVertical: 8 },
  hitBody: { flex: 1, gap: 6 },
  hitText: {
    color: colors.ink,
    fontFamily: fonts.sans,
    fontSize: scale.body.size,
    lineHeight: scale.body.line,
  },
  mark: { color: colors.room, backgroundColor: colors.cyan },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
});
