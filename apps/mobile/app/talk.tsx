import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { Suspense, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";

import { AtmosphericShell } from "@/components/Atmospheric";
import { FieldFrame } from "@/components/SpatialField";
import { MotionSurface } from "@/components/MotionSurface";
import { useReducedMotion } from "@/lib/motion";
import { Haptics, selectHaptic, tapHaptic } from "@/lib/haptics";
import { RecordButton, type RecordState } from "@/components/RecordButton";
import { ApiError, api, type Conversation } from "@/lib/api";
import type { BlobState } from "@/lib/blobShape";
import { lazySkia } from "@/lib/lazySkia";
import { useContinuousVoice } from "@/lib/useContinuousVoice";
import { useSpokenReply } from "@/lib/useSpokenReply";
import { usePreferences } from "@/state/preferences";
import { useSession } from "@/state/session";
import { colors, fonts } from "@/theme";
import { radii, type as scale } from "@tlon/design";
import { Pill } from "@/components/Marks";

const LazyBlob = lazySkia(() => import("@/components/TalkAvatar"));

/** How the sheet rises — the design's own curve, shared with `MoreSheet`, so a
 *  drawer feels the same however it got there. */
const SHEET_MS = 240;
const SHEET_EASING = Easing.bezier(0.2, 0.8, 0.2, 1);

/** What the continuous loop is doing, in words. The shape alone is not
 *  accessible, and "is it listening?" must never be a question in an app people
 *  use to talk about difficult things. */
const LIVE_LABEL: Record<string, string> = {
  off: "Tap to start talking",
  listening: "Listening — say anything",
  hearing: "Hearing you",
  thinking: "Thinking",
  replying: "Speaking",
};

/**
 * Journalling by talking.
 *
 * The agent's job is to help someone say what they mean, then get out of the
 * way. Only their turns are kept — the agent's are scaffolding, and the screen
 * says so rather than leaving people to assume the whole exchange is recorded.
 *
 * The dot at the centre of the avatar *is* the conversation's one control: tap
 * it to start, tap it again to end. Everything else — voice on/off, the
 * push-to-talk fallback, closing, the transcript — sits in a drawer at the
 * bottom that stays out of the way until asked for, so the thing someone
 * actually came here to do is nearly the whole screen.
 */
export default function TalkScreen() {
  const token = useSession((s) => s.token);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { width, height } = useWindowDimensions();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [crisis, setCrisis] = useState<string[] | null>(null);
  const [recording, setRecording] = useState<RecordState>("idle");
  // What the microphone last failed at, said on screen rather than swallowed.
  const [recordError, setRecordError] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();
  // The drawer of everything that is not the conversation itself. Collapsed by
  // default, so arriving on this screen is arriving at the dot, not a list of
  // buttons.
  const [menuOpen, setMenuOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  // Cleared on a timer rather than tracked from the thread: "has just replied" is
  // a moment, and the last turn stays the agent's long after that moment passes.
  const [justReplied, setJustReplied] = useState(false);
  /** The reply as it is arriving, before the server's copy of it is fetched.
   *  Empty whenever there is nothing in flight. */
  const [streamed, setStreamed] = useState("");
  const [voiceTranscript, setVoiceTranscript] = useState<string | null>(null);
  const stoppedGeneration = useRef(0);
  const recordingGenerations = useRef<number[]>([]);
  const [recordCancel, setRecordCancel] = useState(0);

  const sheetAnim = useRef(new Animated.Value(0)).current;

  // Speaking is an addition to the text, never a replacement: if it is off, or
  // unconfigured, or fails, the reply is still on screen to read.
  const voiceOn = usePreferences((s) => s.voice);
  const setVoice = usePreferences((s) => s.setVoice);
  const voice = useSpokenReply(token, voiceOn);

  const start = useMutation({
    mutationFn: () => api.startConversation(token!),
    onSuccess: (c) => setConversationId(c.id),
  });

  // Pick up where you left off, and only start a new one when there is nothing
  // open to return to.
  //
  // Every arrival used to begin a fresh conversation, so stepping to the journal
  // and back lost the thread — it was still on the server, unclosed, and the
  // screen had no way to show it. It also left an abandoned conversation behind
  // each time, which is why an account used for an afternoon had twenty of them.
  useEffect(() => {
    if (!token || conversationId || start.isPending) return;
    let cancelled = false;
    void (async () => {
      try {
        const { conversations } = await api.listConversations(token);
        const open = conversations.find((c) => c.closed_at === null);
        if (cancelled) return;
        if (open) {
          setConversationId(open.id);
          return;
        }
      } catch {
        // The list is an optimisation, not the feature. If it fails, start one.
      }
      if (!cancelled) start.mutate();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const conversation = useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: () => api.conversation(token!, conversationId!),
    enabled: Boolean(token && conversationId),
  });

  const speak = useMutation({
    mutationFn: async ({ uri, generation }: { uri: string; generation: number }) => {
      const spoken = voice.speakAsItArrives();
      setStreamed("");
      setVoiceTranscript(null);
      try {
        return await api.sayAloudStreaming(
          token!,
          conversationId!,
          uri,
          (transcript) => {
            if (generation === stoppedGeneration.current) setVoiceTranscript(transcript);
          },
          (delta) => {
            if (generation !== stoppedGeneration.current) return;
            setStreamed((sofar) => sofar + delta);
            spoken.feed(delta);
          },
        );
      } finally {
        spoken.end();
      }
    },
    onSuccess: async (reply, variables) => {
      if (variables.generation !== stoppedGeneration.current) return;
      setJustReplied(true);
      if (reply.crisis) setCrisis(reply.crisis_resources);
      await conversation.refetch();
      if (variables.generation === stoppedGeneration.current) {
        setStreamed("");
        setVoiceTranscript(null);
      }
    },
    onError: () => {
      setStreamed("");
      setVoiceTranscript(null);
    },
  });

  const say = useMutation({
    mutationFn: async ({ text, source }: { text: string; source: "text" | "voice" }) => {
      // The reply is read as it is written and spoken a sentence at a time, so
      // the model is still writing the second sentence while the first is
      // already sounding. Ending the feed is in a finally because a reply that
      // fails halfway still has to release whatever was held back.
      const spoken = voice.speakAsItArrives();
      setStreamed("");
      try {
        return await api.sayStreaming(token!, conversationId!, text, source, (delta) => {
          setStreamed((sofar) => sofar + delta);
          spoken.feed(delta);
        });
      } finally {
        spoken.end();
      }
    },
    onSuccess: async (reply) => {
      setJustReplied(true);
      if (reply.crisis) setCrisis(reply.crisis_resources);
      // Cleared only once the stored turn is actually in hand. Dropping it any
      // earlier leaves the thread a line short for the length of a refetch —
      // the reply visibly disappearing just as it finished arriving.
      await queryClient.invalidateQueries({ queryKey: ["conversation", conversationId] });
      setStreamed("");
    },
    onError: () => setStreamed(""),
  });

  const finish = useMutation({
    mutationFn: () => api.closeConversation(token!, conversationId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["observations"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      router.replace("/");
    },
  });

  /**
   * Continuous mode: the conversation runs itself.
   *
   * The microphone stays open, the detector decides when a thought has finished,
   * and the reply is spoken back. `speaking` is passed straight through so the
   * microphone is shut while the agent talks — otherwise its own voice becomes
   * the next turn and the two of them talk to each other indefinitely.
   */
  const live = useContinuousVoice({
    enabled: Boolean(conversationId),
    speaking: voice.speaking || speak.isPending || say.isPending,
    onUtterance: async (uri, generation) => {
      if (generation !== stoppedGeneration.current) return;
      await speak.mutateAsync({ uri, generation });
    },
  });

  useEffect(() => {
    return () => {
      stoppedGeneration.current += 1;
      recordingGenerations.current = [];
      live.stop();
      voice.stop();
    };
  }, [live.stop, voice.stop]);

  useEffect(() => {
    if (!justReplied) return;
    const timer = setTimeout(() => setJustReplied(false), 2600);
    return () => clearTimeout(timer);
  }, [justReplied]);

  // Crisis resources must never be missed, so the drawer opens by itself the
  // moment they appear, however the screen was left when they did.
  useEffect(() => {
    if (crisis !== null) setMenuOpen(true);
  }, [crisis]);

  useEffect(() => {
    if (reducedMotion) {
      sheetAnim.setValue(menuOpen ? 1 : 0);
      return;
    }
    const animation = Animated.timing(sheetAnim, {
      toValue: menuOpen ? 1 : 0,
      duration: SHEET_MS,
      easing: SHEET_EASING,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [menuOpen, reducedMotion, sheetAnim]);

  if (!token) return null;

  const turns: Conversation["turns"] = conversation.data?.turns ?? [];
  const saidSomething = turns.some((t) => t.speaker === "user");
  const lastReply = [...turns].reverse().find((t) => t.speaker !== "user");
  /** The last thing the person said, as it was heard — so someone can talk, get
   *  an answer, and tell whether a word of it was understood, which on a screen
   *  whose entire input is a microphone is the one thing it has to show. */
  const lastHeard = [...turns].reverse().find((t) => t.speaker === "user");

  // Order matters: what the microphone is doing beats what the network is doing,
  // so the blob never looks busy while someone is mid-sentence.
  const blobState: BlobState =
    recording === "recording"
      ? "listening"
      : say.isPending || speak.isPending || recording === "uploading"
        ? "thinking"
        : voice.speaking || justReplied
          ? "speaking"
          : "idle";

  const dotLabel =
    recording === "recording"
      ? "Listening — release to send"
      : recording === "uploading"
        ? "Sending…"
        : LIVE_LABEL[live.state];

  // Bounded so the avatar dominates a phone without swallowing a tablet: never
  // smaller than a presence, never so large it fights the safe area.
  const stageWidth = Math.min(width, 620);
  const dotSize = Math.max(240, Math.min(stageWidth * 0.88, height * 0.5, 440));

  const toggleMenu = () => {
    selectHaptic();
    setMenuOpen((on) => !on);
  };

  const toggleLive = () => {
    if (recording !== "idle") return;
    // Inside the tap, while a gesture still counts: iOS will not play a reply
    // that arrives after the network unless sound has been started once by
    // hand.
    voice.unlock();
    if (live.state === "off") {
      stoppedGeneration.current += 1;
      tapHaptic(Haptics.ImpactFeedbackStyle.Medium);
      void live.start();
    } else {
      tapHaptic(Haptics.ImpactFeedbackStyle.Light);
      stoppedGeneration.current += 1;
      recordingGenerations.current = [];
      setRecordCancel((n) => n + 1);
      live.stop();
      voice.stop();
    }
  };

  const speakError =
    say.isError || speak.isError
      ? say.error instanceof ApiError
        ? say.error.message
        : speak.error instanceof ApiError
          ? speak.error.message
          : "Could not send that — what you said is still saved."
      : null;

  return (
    <AtmosphericShell variant="secondary">
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={90}
      >
        <FieldFrame label="Conversation spatial stage">
          <View style={styles.stage}>
            <MotionSurface
              style={styles.dotSurface}
              onPress={toggleLive}
              disabled={recording !== "idle"}
              accessibilityRole="button"
              accessibilityLabel={
                live.state === "off" ? "Start talking" : "End the conversation"
              }
              accessibilityState={{ selected: live.state !== "off" }}
              accessibilityHint="Double tap to start or stop the conversation."
            >
              <Suspense fallback={<View style={{ height: dotSize }} />}>
                <LazyBlob state={blobState} size={dotSize} energy={voice.level} />
              </Suspense>
              <Text style={styles.dotLabel}>{dotLabel}</Text>
            </MotionSurface>

            <View style={styles.stageBody}>
              {turns.length === 0 && !streamed && !voiceTranscript && !start.isPending ? (
                <Text style={styles.opening}>
                  Say whatever is on your mind. I'll ask a few questions to help
                  you get it down.
                </Text>
              ) : (
                <>
                  {(voiceTranscript || lastHeard) && (
                    <Text style={styles.heard} numberOfLines={2}>
                      {voiceTranscript ?? lastHeard?.content}
                    </Text>
                  )}
                  {(streamed || lastReply) && (
                    <Text style={styles.reply} numberOfLines={5}>
                      {streamed || lastReply?.content}
                    </Text>
                  )}
                </>
              )}
              {(say.isPending || speak.isPending) && (
                <ActivityIndicator style={styles.thinking} color={colors.inkMuted} />
              )}
              {speakError && <Text style={styles.error}>{speakError}</Text>}
              {(live.error || recordError) && (
                <Text style={styles.error}>{live.error ?? recordError}</Text>
              )}
            </View>
          </View>
        </FieldFrame>

        {crisis !== null && (
          // Shown above the drawer, unconditionally — the one thing on this
          // screen that must never be a tap away from being missed.
          <View style={styles.crisis}>
            <Text style={styles.crisisTitle}>If you need someone now</Text>
            {crisis.length > 0 ? (
              crisis.map((line) => (
                <Pill key={line} tone={colors.ink}>
                  {line}
                </Pill>
              ))
            ) : (
              <Text style={styles.crisisLine}>
                Please contact your local emergency services or a crisis line.
              </Text>
            )}
            <Text style={styles.crisisNote}>
              This app is for writing things down. It isn't a substitute for
              talking to a person.
            </Text>
          </View>
        )}

        {/* The drawer. A quiet peek row is always on screen — the grabber, a
            voice status, and the one control the design will not let a menu
            hide — and it opens to everything else.
            Three siblings, not one button wrapping two others: a `<button>`
            nested inside a `<button>` is invalid HTML on web, and Pressable's
            click bubbles, so the inner tap would have fired the outer toggle
            too — voice or crisis by way of trying to open the drawer. */}
        <View style={styles.sheet}>
          <View style={styles.sheetPeek}>
            <View style={styles.handle} />
            <View style={styles.peekRow}>
              <Pressable
                onPress={() => {
                  // Turning it off stops the current sentence too. Waiting for a
                  // reply you have just muted to finish is the opposite of what
                  // you asked for.
                  if (voiceOn) voice.stop();
                  void setVoice(!voiceOn);
                }}
                hitSlop={8}
                accessibilityRole="switch"
                accessibilityState={{ checked: voiceOn }}
              >
                <Text style={styles.peekVoice}>{voiceOn ? "Voice on" : "Voice off"}</Text>
              </Pressable>

              <Pressable
                style={styles.peekChevron}
                onPress={toggleMenu}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={menuOpen ? "Hide options" : "Show options"}
                accessibilityState={{ expanded: menuOpen }}
              >
                <Chevron open={menuOpen} />
                <Text style={styles.peekLabel}>{menuOpen ? "Options" : "More"}</Text>
              </Pressable>

              <MotionSurface
                onPress={() => {
                  stoppedGeneration.current += 1;
                  recordingGenerations.current = [];
                  setRecordCancel((n) => n + 1);
                  live.stop();
                  voice.stop();
                  setCrisis(crisis ?? []);
                }}
                accessibilityRole="button"
                accessibilityLabel="Urgent — show crisis resources and stop"
              >
                <Text style={styles.peekUrgent}>Urgent</Text>
              </MotionSurface>
            </View>
          </View>

          <Animated.View
            style={[
              styles.sheetBody,
              {
                opacity: sheetAnim,
                maxHeight: sheetAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 360],
                }),
              },
            ]}
            pointerEvents={menuOpen ? "auto" : "none"}
          >
            <ScrollView contentContainerStyle={styles.sheetContent}>
              {conversationId && live.state === "off" && (
                <View style={[styles.row, styles.rowStacked]}>
                  <Text style={styles.rowLabel}>Prefer to hold instead?</Text>
                  <RecordButton
                    onPressStart={() => {
                      recordingGenerations.current.push(stoppedGeneration.current);
                      voice.unlock();
                    }}
                    cancelSignal={recordCancel}
                    disabled={say.isPending || speak.isPending || voice.speaking}
                    onRecorded={async (uri) => {
                      const generation = recordingGenerations.current.shift();
                      if (generation === undefined || generation !== stoppedGeneration.current) return;
                      await speak.mutateAsync({ uri, generation });
                    }}
                    onStateChange={setRecording}
                    onError={setRecordError}
                    tone="dark"
                  />
                </View>
              )}

              {voice.unavailable && (
                <Text style={styles.diagnostic}>
                  Spoken replies aren't set up on this server — {voice.lastError}
                </Text>
              )}
              {!voice.unavailable && voice.lastError && (
                <Text style={styles.diagnostic}>
                  Couldn't speak the last reply — {voice.lastError}
                </Text>
              )}

              <Pressable
                style={styles.row}
                onPress={() => setTranscriptOpen(true)}
                accessibilityRole="button"
                disabled={turns.length === 0}
              >
                <Text style={[styles.rowLabel, turns.length === 0 && styles.disabledText]}>
                  View transcript
                </Text>
                <Text style={styles.rowMeta}>
                  {turns.length > 0 ? `${turns.length} turns` : "Nothing yet"}
                </Text>
              </Pressable>

              <MotionSurface
                style={[styles.finish, !saidSomething && styles.disabled]}
                disabled={!saidSomething || finish.isPending}
                onPress={() => {
                  stoppedGeneration.current += 1;
                  recordingGenerations.current = [];
                  setRecordCancel((n) => n + 1);
                  live.stop();
                  voice.stop();
                  finish.mutate();
                }}
              >
                <Text style={styles.finishLabel}>
                  {/* The design says what closing does rather than that it saves:
                      "close · keeps your turns". Which turns are kept is the
                      question someone has while deciding whether to close. */}
                  {finish.isPending ? "Saving…" : "Close conversation · keeps your turns"}
                </Text>
              </MotionSurface>

              <Text style={styles.footnote}>
                Only your turns become entries. The recording is transcribed and
                then discarded, and nothing here is interpreted.
              </Text>
            </ScrollView>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={transcriptOpen}
        transparent
        animationType={reducedMotion ? "none" : "slide"}
        onRequestClose={() => setTranscriptOpen(false)}
      >
        <Pressable
          style={styles.transcriptScrim}
          onPress={() => setTranscriptOpen(false)}
          accessibilityLabel="Close transcript"
        />
        <View style={styles.transcriptSheet}>
          <View style={styles.handle} />
          <Text style={styles.transcriptTitle}>Transcript</Text>
          <ScrollView contentContainerStyle={styles.thread}>
            {turns.map((turn) => (
              <View
                key={turn.id}
                style={[styles.bubble, turn.speaker === "user" ? styles.mine : styles.theirs]}
              >
                <Text style={turn.speaker === "user" ? styles.mineText : styles.theirsText}>
                  {turn.content}
                </Text>
              </View>
            ))}
            {streamed.length > 0 && (
              <View style={[styles.bubble, styles.theirs]}>
                <Text style={styles.theirsText}>{streamed}</Text>
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>
    </AtmosphericShell>
  );
}

/** A minimal chevron, rotated by the sheet's own open state rather than a
 *  second animated value — one thing driving one thing. */
function Chevron({ open }: { open: boolean }) {
  return (
    <View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}>
      <Svg width={12} height={8} viewBox="0 0 12 8">
        <Path
          d="M1 1.5 6 6.5 11 1.5"
          fill="none"
          stroke={colors.inkMuted}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.room },
  stage: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4 },
  dotSurface: { alignItems: "center" },
  dotLabel: {
    marginTop: 14,
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.inkMuted,
    textAlign: "center",
  },
  stageBody: {
    paddingHorizontal: 28,
    paddingTop: 18,
    minHeight: 76,
    alignItems: "center",
    gap: 8,
  },
  opening: {
    color: colors.inkMuted,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  heard: {
    color: colors.inkMuted,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  reply: {
    color: colors.ink,
    fontFamily: fonts.sans,
    fontSize: 17,
    lineHeight: 25,
    textAlign: "center",
  },
  thinking: { marginTop: 2 },
  error: { color: colors.danger, fontFamily: fonts.sans, fontSize: 13, textAlign: "center" },

  crisis: {
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radii.surface,
    padding: 12,
    gap: 6,
    marginBottom: 8,
  },
  crisisTitle: { fontWeight: "700", fontFamily: fonts.sans, fontSize: 15, color: colors.danger },
  crisisLine: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 22, color: colors.ink },
  crisisNote: { fontFamily: fonts.sans, fontSize: 12, color: colors.inkMuted, lineHeight: 18 },

  sheet: { borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.roomRaised },
  sheetPeek: { paddingTop: 8, paddingBottom: 10 },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.lineStrong,
    marginBottom: 8,
  },
  peekRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
  },
  peekVoice: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.inkMuted,
  },
  peekChevron: { flexDirection: "row", alignItems: "center", gap: 6 },
  peekLabel: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.inkMuted,
  },
  peekUrgent: {
    fontFamily: fonts.mono,
    fontSize: scale.kicker.size,
    letterSpacing: scale.kicker.tracking,
    textTransform: "uppercase",
    color: colors.inkMuted,
  },
  sheetBody: { overflow: "hidden" },
  sheetContent: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 24, gap: 16 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    gap: 12,
  },
  // The default row puts a label and a control on one line; the record button
  // has its own text and a pip and does not shrink to make room, so on a
  // narrow phone the two together ran past the edge. Stacked, neither has to.
  rowStacked: { flexDirection: "column", alignItems: "flex-start", gap: 10 },
  rowLabel: { flex: 1, color: colors.ink, fontFamily: fonts.sans, fontSize: 15 },
  rowMeta: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: 12 },
  disabledText: { color: colors.inkMuted },
  diagnostic: {
    color: colors.warning,
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 18,
  },
  finish: {
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radii.surface,
    paddingVertical: 13,
    alignItems: "center",
  },
  finishLabel: {
    color: colors.inkSoft,
    fontFamily: fonts.mono,
    fontSize: scale.kicker.size,
    letterSpacing: scale.kicker.tracking,
    textTransform: "uppercase",
  },
  disabled: { opacity: 0.35 },
  footnote: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.inkMuted,
    textAlign: "center",
    lineHeight: 16,
  },

  transcriptScrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  transcriptSheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "78%",
    backgroundColor: colors.roomRaised,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 10,
  },
  transcriptTitle: {
    textAlign: "center",
    fontFamily: fonts.mono,
    fontSize: scale.kicker.size,
    letterSpacing: scale.kicker.tracking,
    textTransform: "uppercase",
    color: colors.inkMuted,
    marginBottom: 4,
  },
  thread: { padding: 16, gap: 10, paddingBottom: 28 },
  bubble: { borderRadius: radii.surface, padding: 12, maxWidth: "88%" },
  mine: { alignSelf: "flex-end", backgroundColor: colors.ink },
  mineText: { color: colors.room, fontFamily: fonts.sans, fontSize: 16, lineHeight: 22 },
  theirs: { alignSelf: "flex-start", backgroundColor: colors.surfaceBright },
  theirsText: { color: colors.ink, fontFamily: fonts.sans, fontSize: 16, lineHeight: 22 },
});
