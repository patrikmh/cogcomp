import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Suspense, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { Chip, Kicker } from "@/components/Marks";
import { Rise } from "@/components/Rise";
import { MotionSurface } from "@/components/MotionSurface";
import { Seal } from "@/components/Seal";
import { RecordButton } from "@/components/RecordButton";
import { ApiError, api, type ObservationResponse } from "@/lib/api";
import { useDrawnFrom } from "@/lib/drawnFrom";
import { uuidv7 } from "@/lib/ids";
import { useSession } from "@/state/session";
import { colors, fonts } from "@/theme";
import { radii } from "@tlon/design";

/**
 * The journal.
 *
 * Two things live here and they are not equal: writing something down, and
 * looking at what you have written. Writing wins — the field is under your thumb,
 * with nothing stacked above it explaining what a journal is.
 *
 * What you have written is the sky above it. Every entry is a point, the newest
 * largest, and the newest is already selected — so saving something shows it back
 * to you rather than dropping it into a list. Tapping any point reads it out;
 * tapping the readout goes to what was drawn from it.
 *
 * The previous version opened with a kicker, a title, a subtitle and a framed
 * decorative field before reaching the input, then listed every entry below. All
 * of that was explaining a screen that stops needing explanation once it shows
 * less at once.
 */
export default function JournalScreen() {
  const token = useSession((s) => s.token);
  const userId = useSession((s) => s.userId);
  const signOut = useSession((s) => s.signOut);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");

  const observations = useQuery({
    queryKey: ["observations", userId],
    queryFn: () => api.listObservations(token!),
    enabled: Boolean(token && userId),
  });

  const drawnFrom = useDrawnFrom(token, userId);

  const capture = useMutation({
    mutationFn: (content: string) =>
      api.createObservation(token!, {
        id: uuidv7(),
        content,
        source: "text",
        capturedAt: new Date().toISOString(),
      }),
    onSuccess: () => {
      setDraft("");
      void queryClient.invalidateQueries({ queryKey: ["observations", userId] });
    },
  });

  const captureVoice = useMutation({
    mutationFn: (uri: string) =>
      api.createVoiceObservation(token!, {
        id: uuidv7(),
        uri,
        capturedAt: new Date().toISOString(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["observations", userId] });
    },
  });

  // The auth gate in _layout redirects before this renders when signed out.
  if (!token) return null;

  const entries: ObservationResponse[] = observations.data?.observations ?? [];
  const drafting = draft.trim().length > 0;
  // Grouped by the day they were written, newest first — the web's `groups`.
  const days = entries.reduce<{ day: string; list: ObservationResponse[] }[]>((acc, entry) => {
    const day = dayLabel(entry.captured_at);
    const group = acc.find((g) => g.day === day);
    if (group) group.list.push(entry);
    else acc.push({ day, list: [entry] });
    return acc;
  }, []);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* The stream, as the web has it: a head with the entries floating
          inside it was this client's own idea and not the product's. Days are
          headed and ruled, each act carries its seal, its time and what was
          drawn from it. */}
      <View style={styles.head}>
        <Kicker>Journal</Kicker>
        <Text style={styles.count}>
          {observations.isSuccess
            ? `${entries.length} ${entries.length === 1 ? "act" : "acts"} kept`
            : ""}
        </Text>
      </View>

      {entries.length === 0 && observations.isSuccess ? (
        <Text style={styles.empty}>Nothing written yet. What you write here stays here.</Text>
      ) : (
        days.map((group, gi) => (
          <View key={group.day}>
            <View style={styles.day}>
              <Kicker heading>{group.day}</Kicker>
              <View style={styles.rule} />
            </View>
            {group.list.map((entry, i) => (
              <Rise key={entry.id} index={gi * 2 + i}>
                <MotionSurface
                  style={styles.entry}
                  onPress={() => router.push(`/node/${entry.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={entry.content}
                >
                  <Text style={styles.time}>{shortTime(entry.captured_at)}</Text>
                  {/* A hairline with a dot on it, filled on the latest act and
                      hollow on the rest — the design's `.j-spine`. This was a
                      2px cyan bar, which spent the colour this product reserves
                      for what is live on saying "here is a list". */}
                  <View style={styles.spine}>
                    <View style={styles.spineLine} />
                    <View style={[styles.spineDot, gi === 0 && i === 0 && styles.spineDotLatest]} />
                  </View>
                  <View style={styles.act}>
                    <Seal id={entry.id} size={gi === 0 && i === 0 ? 58 : 52} />
                    <View style={styles.actBody}>
                      {gi === 0 && i === 0 && <Kicker>Latest · saved</Kicker>}
                      <Text style={styles.entryText}>{entry.content}</Text>
                      {(drawnFrom.get(entry.id)?.length ?? 0) > 0 ? (
                        <View style={styles.chipRow}>
                          <Kicker>Drawn from this</Kicker>
                          <View style={styles.chips}>
                            {drawnFrom.get(entry.id)!.slice(0, 4).map((r) => (
                              <Chip
                                key={r.id}
                                label={r.label}
                                confidence={r.confidence}
                                tentative={r.tentative}
                              />
                            ))}
                          </View>
                        </View>
                      ) : (
                        <Text style={styles.readoutOpen}>nothing drawn from this yet</Text>
                      )}
                    </View>
                  </View>
                </MotionSurface>
              </Rise>
            ))}
          </View>
        ))
      )}

      {/* Looking for something you wrote starts from where your words are. */}
      {entries.length > 0 && (
        <MotionSurface
          onPress={() => router.push("/search")}
          accessibilityRole="button"
          hitSlop={8}
        >
          <Text style={styles.findLink}>Find an entry →</Text>
        </MotionSurface>
      )}

      <TextInput
        style={[styles.input, drafting && styles.inputActive]}
        value={draft}
        onChangeText={setDraft}
        placeholder="What's on your mind?"
        placeholderTextColor={colors.inkMuted}
        multiline
        editable={!capture.isPending}
      />

      {/* One control rather than three stacked. With nothing written the only
          sensible action is to speak; once there are words the only sensible
          action is to keep them. Showing both at once asked a question that
          answers itself. */}
      {drafting ? (
        <MotionSurface
          style={[styles.button, capture.isPending && styles.disabled]}
          disabled={capture.isPending}
          onPress={() => capture.mutate(draft)}
        >
          <Text style={styles.buttonLabel}>
            {capture.isPending ? "Saving…" : "Save"}
          </Text>
        </MotionSurface>
      ) : (
        <RecordButton
          tone="dark"
          disabled={capture.isPending}
          onRecorded={async (uri) => {
            await captureVoice.mutateAsync(uri);
          }}
        />
      )}

      {capture.isError && (
        <Text style={styles.error}>
          {capture.error instanceof ApiError
            ? capture.error.message
            : "Could not save. Your text is still here — try again."}
        </Text>
      )}

      {captureVoice.isError && (
        <Text style={styles.error}>
          {captureVoice.error instanceof ApiError
            ? captureVoice.error.message
            : "Could not save that recording."}
        </Text>
      )}

      <MotionSurface style={styles.talk} onPress={() => router.push("/talk")}>
        <Text style={styles.talkLabel}>Talk it through instead</Text>
      </MotionSurface>

    </ScrollView>
  );
}

/** Just the clock time. The date is almost always today, and when it is not the
 *  constellation has already said so by drawing the point small. */
function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.room },
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 10, paddingTop: 8 },
  sky: { alignItems: "center", justifyContent: "center" },
  readout: { flexDirection: "row", gap: 12, paddingVertical: 4 },
  spine: { width: 22, alignSelf: "stretch" },
  spineLine: {
    position: "absolute",
    left: "50%",
    top: 24,
    bottom: 0,
    width: 1,
    backgroundColor: colors.line,
  },
  spineDot: {
    position: "absolute",
    left: 8,
    top: 25,
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.room,
  },
  spineDotLatest: { borderColor: colors.ink, backgroundColor: colors.ink },
  spineDraft: { backgroundColor: colors.violet },
  chipDraft: {
    color: colors.violet,
    fontFamily: fonts.sans, fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.4,
  },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  count: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: 12 },
  empty: { color: colors.inkMuted, fontFamily: fonts.sans, fontSize: 15, lineHeight: 22, paddingVertical: 10 },
  day: { flexDirection: "row", alignItems: "baseline", gap: 14, marginTop: 30, marginBottom: 4 },
  rule: { flex: 1, height: 1, backgroundColor: colors.line },
  // Time down the left, a hairline spine, then the act — the web's j-entry.
  entry: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 8 },
  // Right-aligned against the spine, dropped to meet the first line of the act
  // rather than the top of its seal — the design's `.j-time`.
  time: {
    color: colors.inkMuted,
    fontFamily: fonts.mono,
    fontSize: 10,
    lineHeight: 15,
    letterSpacing: 0.6,
    minWidth: 40,
    textAlign: "right",
    paddingTop: 20,
  },
  act: { flex: 1, flexDirection: "row", gap: 10, alignItems: "flex-start" },
  actBody: { flex: 1, gap: 6 },
  entryText: { color: colors.inkSoft, fontFamily: fonts.sans, fontSize: 15.5, lineHeight: 24 },
  chipRow: { gap: 6 },
  readoutBody: { flex: 1, gap: 5 },
  drawn: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chips: { flexDirection: "row", gap: 10, alignItems: "center" },
  chip: {
    color: colors.cyan,
    fontFamily: fonts.sans, fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.4,
  },
  chipQuiet: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.2 },
  findLink: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: 12, paddingVertical: 6 },
  readoutOpen: {
    color: colors.inkMuted,
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  readoutHint: { color: colors.inkMuted, fontFamily: fonts.sans, fontSize: 13, lineHeight: 19 },
  readoutText: { color: colors.ink, fontFamily: fonts.sans, fontSize: 16, lineHeight: 23 },
  input: {
    backgroundColor: colors.roomRaised,
    // Only the left edge is lit, and it is the same cyan as the point the entry
    // will become. The field reads as the mouth of the sky above it rather than
    // as a form control that happens to be nearby.
    borderLeftWidth: 2,
    borderLeftColor: colors.lineStrong,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderTopColor: colors.line,
    borderRightColor: colors.line,
    borderBottomColor: colors.line,
    borderRadius: radii.surface,
    color: colors.ink,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: fonts.sans, fontSize: 17,
    lineHeight: 24,
    minHeight: 96,
    textAlignVertical: "top",
  },
  inputActive: { borderLeftColor: colors.violet, backgroundColor: colors.surface },
  button: {
    backgroundColor: colors.violet,
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: "center",
  },
  buttonLabel: { color: colors.room, fontFamily: fonts.sans, fontSize: 16, fontWeight: "700" },
  disabled: { opacity: 0.35 },
  error: { color: colors.danger, fontFamily: fonts.sans, fontSize: 13 },
  talk: { paddingVertical: 6 },
  talkLabel: { color: colors.inkSoft, fontFamily: fonts.sans, fontSize: 14, fontWeight: "700" },
});

/** Today, Yesterday, or the date — the web's `dayLabelOf`, in this client's
 *  words. Grouping by a raw ISO day would be accurate and unreadable. */
function dayLabel(iso: string): string {
  const day = iso.slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  // The design names the day *and* dates it — "Today · Wednesday 4 February".
  // "Today" alone is unambiguous only while you are reading it today; scrolled
  // back a week it is the one heading that cannot be checked against anything.
  const dated = new Date(iso).toLocaleDateString([], {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  if (day === today) return `Today · ${dated}`;
  if (day === yesterday) return `Yesterday · ${dated}`;
  return dated;
}
