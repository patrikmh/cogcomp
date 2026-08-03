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

import { MotionSurface } from "@/components/MotionSurface";
import { NavOrbit } from "@/components/NavOrbit";
import { RecordButton } from "@/components/RecordButton";
import { ApiError, api, type ObservationResponse } from "@/lib/api";
import { uuidv7 } from "@/lib/ids";
import { lazySkia } from "@/lib/lazySkia";
import { useSession } from "@/state/session";
import { colors } from "@/theme";

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
              <Text style={styles.chipDraft}>NOT SAVED YET</Text>
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
          {/* A lit edge rather than a box. The point it belongs to is glowing in
              the sky above, and the same colour running down the side is what
              connects the two without drawing a line between them. */}
          <View style={styles.spine} />
          <View style={styles.readoutBody}>
            <View style={styles.chips}>
              <Text style={styles.chip}>
                {current.source === "voice" ? "SPOKEN" : "WRITTEN"}
              </Text>
              <Text style={styles.chipQuiet}>{shortTime(current.captured_at)}</Text>
              <Text style={styles.chipQuiet}>
                {entries.length} {entries.length === 1 ? "entry" : "entries"}
              </Text>
            </View>
            <Text style={styles.readoutText} numberOfLines={4}>
              {current.content}
            </Text>
            <Text style={styles.readoutOpen}>What came of this →</Text>
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

      <NavOrbit
        onSignOut={() => {
          // Revoked server-side too, so a copied token cannot outlive sign-out.
          void api.logout(token).catch(() => undefined);
          void signOut();
        }}
      />
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
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.4,
  },
  readoutBody: { flex: 1, gap: 5 },
  chips: { flexDirection: "row", gap: 10, alignItems: "center" },
  chip: {
    color: colors.cyan,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.4,
  },
  chipQuiet: { color: colors.inkMuted, fontSize: 10, letterSpacing: 1.2 },
  readoutOpen: { color: colors.cyan, fontSize: 12, fontWeight: "700" },
  readoutHint: { color: colors.inkMuted, fontSize: 13, lineHeight: 19 },
  readoutText: { color: colors.ink, fontSize: 16, lineHeight: 23 },
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
    borderRadius: 4,
    color: colors.ink,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
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
  buttonLabel: { color: colors.room, fontSize: 16, fontWeight: "700" },
  disabled: { opacity: 0.35 },
  error: { color: colors.danger, fontSize: 13 },
  talk: { paddingVertical: 6 },
  talkLabel: { color: colors.inkSoft, fontSize: 14, fontWeight: "700" },
});
