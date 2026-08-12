import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Suspense, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

import { Chip, Kicker } from "@/components/Marks";
import { MotionSurface } from "@/components/MotionSurface";
import { Seal } from "@/components/Seal";
import { RecordButton } from "@/components/RecordButton";
import { ApiError, api, type ObservationResponse } from "@/lib/api";
import { useDrawnFrom } from "@/lib/drawnFrom";
import { uuidv7 } from "@/lib/ids";
import { lazySkia } from "@/lib/lazySkia";
import { useSession } from "@/state/session";
import { colors, fonts } from "@/theme";
import { radii } from "@tlon/design";

const LazyConstellation = lazySkia(() => import("@/components/Constellation"));

/** Stands in for the entry being written, which has no id yet. */
const DRAFT = "__draft__";

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
  const { width, height } = useWindowDimensions();
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState<string | null>(null);

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
      // Cleared so the selection falls back to the newest entry — you see what
      // you just wrote, rather than watching it join a list.
      setPicked(null);
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
      setPicked(null);
      void queryClient.invalidateQueries({ queryKey: ["observations", userId] });
    },
  });

  // The auth gate in _layout redirects before this renders when signed out.
  if (!token) return null;

  const entries: ObservationResponse[] = observations.data?.observations ?? [];
  const drafting = draft.trim().length > 0;
  const size = Math.min(width * 0.86, height * 0.42, 380);
  // Nothing picked means the newest, so the screen always has something to say.
  const current = entries.find((e) => e.id === picked) ?? entries[0] ?? null;
  const drawn = current ? (drawnFrom.get(current.id) ?? []) : [];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {entries.length > 0 && (
        <View style={styles.sky}>
          <Suspense fallback={<View style={{ height: size }} />}>
            <LazyConstellation
              data={[
                // The unsaved draft is already in the sky, pulsing, where it is
                // about to land. Writing stops being a form you submit and starts
                // being a thing arriving.
                ...(drafting
                  ? [{ id: DRAFT, weight: 1, tone: "Observation", tentative: true }]
                  : []),
                ...entries.map((entry, index) => ({
                  id: entry.id,
                  // Newest largest. Recency is the only ranking an entry has —
                  // nothing here judges which of your thoughts mattered more.
                  weight: 1 - Math.min(index / Math.max(entries.length, 8), 0.72),
                  tone: "Observation",
                })),
              ]}
              size={size}
              selected={drafting ? DRAFT : (current?.id ?? null)}
              onSelect={setPicked}
              dotSize={6}
              frame="head"
              pulseId={drafting ? DRAFT : null}
            />
          </Suspense>
        </View>
      )}

      {drafting ? (
        <View style={styles.readout}>
          <View style={[styles.spine, styles.spineDraft]} />
          <View style={styles.readoutBody}>
            <View style={styles.chips}>
              <Kicker tone={colors.warning}>Not saved yet</Kicker>
              <Text style={styles.chipQuiet}>
                {draft.trim().split(/\s+/).length}{" "}
                {draft.trim().split(/\s+/).length === 1 ? "word" : "words"}
              </Text>
            </View>
            {/* Deliberately not repeating the draft — it is in the field
                directly below, and printing it twice is the exact clutter this
                screen is trying to lose. The chips say what the field cannot:
                that this is not saved, and how much of it there is. */}
            <Text style={styles.readoutHint}>
              Pulsing in your sky until you keep it.
            </Text>
          </View>
        </View>
      ) : current ? (
        <MotionSurface
          style={styles.readout}
          onPress={() => router.push(`/node/${current.id}`)}
          accessibilityRole="button"
        >
          {/* The act's own seal, from the same geometry the web client draws —
              the same id makes the same mark in both, which is what lets you
              recognise an entry before reading it. */}
          <Seal id={current.id} size={34} />
          <View style={styles.readoutBody}>
            <View style={styles.chips}>
              <Kicker>
                {current.source === "voice" ? "Spoken" : "Written"} ·{" "}
                {shortTime(current.captured_at)}
              </Kicker>
            </View>
            <Text style={styles.readoutText} numberOfLines={4}>
              {current.content}
            </Text>
            {/* What the entry actually produced, rather than a link offering to
                go and find out. The web client has shown these since it was
                ported; this said "What came of this →" and made you tap to learn
                that the answer was sometimes nothing. */}
            {drawn.length > 0 ? (
              <>
                <Kicker>Drawn from this</Kicker>
                <View style={styles.drawn}>
                  {drawn.slice(0, 4).map((reading) => (
                    <Chip
                      key={reading.id}
                      label={reading.label}
                      confidence={reading.confidence}
                      tentative={reading.tentative}
                    />
                  ))}
                </View>
              </>
            ) : (
              <Text style={styles.readoutOpen}>Nothing drawn from this yet →</Text>
            )}
          </View>
        </MotionSurface>
      ) : null}

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
  spine: { width: 2, borderRadius: 1, backgroundColor: colors.cyan, opacity: 0.7 },
  spineDraft: { backgroundColor: colors.violet },
  chipDraft: {
    color: colors.violet,
    fontFamily: fonts.sans, fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.4,
  },
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
  readoutOpen: { color: colors.cyan, fontFamily: fonts.sans, fontSize: 12, fontWeight: "700" },
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
