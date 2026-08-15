import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { Suspense, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AtmosphericShell } from "@/components/Atmospheric";
import { FieldFrame } from "@/components/SpatialField";
import { MotionSurface } from "@/components/MotionSurface";
import { useReducedMotion } from "@/lib/motion";
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

/** Big enough to be a presence, small enough that the thread is still the page.
 *  In focus mode it is scaled up rather than replaced. */
const BLOB_SIZE = 190;
const FOCUS_BLOB_SIZE = 300;

/**
 * What the blob is doing, in words.
 *
 * Present because the shape alone is not accessible, and because a thing that
 * changes on screen without saying why is unsettling rather than companionable.
 * Deliberately plain: it reports state, it does not perform a personality.
 */
/** What the continuous loop is doing, in words. The shape alone is not
 *  accessible, and "is it listening?" must never be a question in an app people
 *  use to talk about difficult things. */
const LIVE_LABEL: Record<string, string> = {
  off: "Start talking",
  listening: "Listening — say anything",
  hearing: "Hearing you",
  thinking: "Thinking",
  replying: "Speaking",
};

const STAGE_LABEL: Record<BlobState, string> = {
  // No longer offers the spin. The avatar is the design's flat contour drawing
  // now, and there is nothing to turn — a hint that names a gesture the screen
  // does not answer is worse than no hint.
  idle: "Tap to see the transcript",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

/**
 * Journalling by talking.
 *
 * The agent's job is to help someone say what they mean, then get out of the
 * way. Only their turns are kept — the agent's are scaffolding, and the screen
 * says so rather than leaving people to assume the whole exchange is recorded.
 */
export default function TalkScreen() {
  const token = useSession((s) => s.token);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [crisis, setCrisis] = useState<string[] | null>(null);
  const [recording, setRecording] = useState<RecordState>("idle");
  // What the microphone last failed at, said on screen rather than swallowed.
  const [recordError, setRecordError] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();
  // Focus is the default. The sphere is the interface — the transcript is there
  // for when you want to check what you said, not the thing you sit and read
  // while talking.
  const [focus, setFocus] = useState(true);
  // Cleared on a timer rather than tracked from the thread: "has just replied" is
  // a moment, and the last turn stays the agent's long after that moment passes.
  const [justReplied, setJustReplied] = useState(false);

  const scrollRef = useRef<ScrollView>(null);

  // Speaking is an addition to the text, never a replacement: if it is off, or
  // unconfigured, or fails, the reply is still on screen to read.
  const voiceOn = usePreferences((s) => s.voice);
  const setVoice = usePreferences((s) => s.setVoice);
  const voice = useSpokenReply(token, voiceOn);


  const start = useMutation({
    mutationFn: () => api.startConversation(token!),
    onSuccess: (c) => setConversationId(c.id),
  });

  // Start one on arrival; leaving without saying anything creates nothing that
  // shows up anywhere.
  useEffect(() => {
    if (token && !conversationId && !start.isPending) start.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const conversation = useQuery({
    queryKey: ["conversation", conversationId],
    queryFn: () => api.conversation(token!, conversationId!),
    enabled: Boolean(token && conversationId),
  });

  const speak = useMutation({
    mutationFn: (uri: string) => api.sayAloud(token!, conversationId!, uri),
    onSuccess: (reply) => {
      setJustReplied(true);
      voice.say(reply.reply);
      if (reply.crisis) setCrisis(reply.crisis_resources);
      // Refetched directly rather than invalidated by key. Invalidation was
      // firing and no GET followed it — the thread stayed empty after a spoken
      // turn however long you waited, which is what "the transcript works in
      // some cases" was: it filled only when something else happened to refetch.
      // Asking the query itself leaves no key to mismatch.
      void conversation.refetch();
    },
  });

  const say = useMutation({
    mutationFn: ({ text, source }: { text: string; source: "text" | "voice" }) =>
      api.say(token!, conversationId!, text, source),
    onSuccess: (reply) => {
      setJustReplied(true);
      voice.say(reply.reply);
      if (reply.crisis) setCrisis(reply.crisis_resources);
      queryClient.invalidateQueries({ queryKey: ["conversation", conversationId] });
    },
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
    onUtterance: async (uri) => {
      await speak.mutateAsync(uri);
    },
  });

  useEffect(() => {
    if (!justReplied) return;
    const timer = setTimeout(() => setJustReplied(false), 2600);
    return () => clearTimeout(timer);
  }, [justReplied]);

  // Crisis resources are rendered in the thread, and focus mode — the default —
  // strips the thread away. So a reply the server flagged as crisis set the
  // state and put nothing on screen. Leave focus whenever they appear, however
  // they were reached: the one thing on this screen that must never be missed
  // was the one thing the default view could not show.
  useEffect(() => {
    if (crisis !== null) setFocus(false);
  }, [crisis]);

  if (!token) return null;

  const turns: Conversation["turns"] = conversation.data?.turns ?? [];
  const saidSomething = turns.some((t) => t.speaker === "user");
  const lastReply = [...turns].reverse().find((t) => t.speaker !== "user");
  /** The last thing the person said, as it was heard. Focus mode showed only
   *  the agent's side, so someone could talk, get an answer, and have no way to
   *  tell whether a word of it had been understood — which on a screen whose
   *  entire input is a microphone is the one thing it has to show. */
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

  return (
    <AtmosphericShell variant="secondary">
      <KeyboardAvoidingView
      style={[styles.screen, focus && styles.screenFocus]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      {/* The header is a white bar across the top of a screen whose whole point
          is a dark room with one light in it. */}
      <Stack.Screen options={{ headerShown: !focus }} />

      <FieldFrame label="Conversation spatial stage"><View style={[styles.stage, focus && styles.stageFocus]}>
        <MotionSurface
          style={[styles.stageControl, focus && styles.stageControlFocus]}
          onPress={() => setFocus((on) => !on)}
          accessibilityRole="button"
          accessibilityLabel={focus ? "Leave focus mode" : "Enter focus mode"}
        >
          <Suspense
            fallback={
              <View
                style={{ height: focus ? FOCUS_BLOB_SIZE : BLOB_SIZE }}
              />
            }
          >
            <LazyBlob
              state={blobState}
              size={focus ? FOCUS_BLOB_SIZE : BLOB_SIZE}
              energy={voice.level}
            />
          </Suspense>
          <Text style={[styles.stageHint, focus && styles.stageHintFocus]}>
            {STAGE_LABEL[blobState]}
          </Text>
        </MotionSurface>
        <MotionSurface
          onPress={() => {
            // Turning it off stops the current sentence too. Waiting for a reply
            // you have just muted to finish is the opposite of what you asked for.
            if (voiceOn) voice.stop();
            void setVoice(!voiceOn);
          }}
          accessibilityRole="switch"
          accessibilityState={{ checked: voiceOn }}
        >
          <Text style={[styles.voiceToggle, focus && styles.voiceToggleFocus]}>
            {voiceOn ? "Voice on" : "Voice off"}
          </Text>
        </MotionSurface>
      </View></FieldFrame>

      {focus ? (
        // Focus mode strips the thread away. What is left is the blob, the last
        // thing it said, and the microphone — for people who want to talk rather
        // than read, and for whom a wall of transcript is the distraction.
        <View style={styles.focusBody}>
          {/* What was heard, then what was said back. Quieter than the reply and
              above it, in the order the exchange happened. */}
          {lastHeard && (
            <Text style={styles.focusHeard} numberOfLines={3}>
              {lastHeard.content}
            </Text>
          )}
          {lastReply && (
            <Text style={styles.focusReply} numberOfLines={6}>
              {lastReply.content}
            </Text>
          )}
        </View>
      ) : (
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.thread}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: !reducedMotion })}
      >
        {turns.length === 0 && !start.isPending && (
          <Text style={styles.opening}>
            Say whatever is on your mind. I'll ask a few questions to help you get
            it down.
          </Text>
        )}

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

        {(say.isPending || speak.isPending) && (
          <ActivityIndicator style={styles.thinking} />
        )}

        {crisis !== null && (
          // Shown alongside the agent's message, never instead of it, and the
          // services come from the server rather than being invented here.
          <View style={styles.crisis}>
            <Text style={styles.crisisTitle}>If you need someone now</Text>
            {crisis.length > 0 ? (
              crisis.map((line) => (
                // Pills, as the web has them: each service is a separate thing
                // you can act on, not a paragraph to read through while in no
                // state to read paragraphs.
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

        {say.isError && (
          <Text style={styles.error}>
            {say.error instanceof ApiError
              ? say.error.message
              : "Could not send that — what you said is still saved."}
          </Text>
        )}

        {speak.isError && (
          <Text style={styles.error}>
            {speak.error instanceof ApiError
              ? speak.error.message
              : "Could not send that recording."}
          </Text>
        )}
      </ScrollView>
      )}

      {/* No text field, and no send. This screen is for talking; writing is what
          the journal is for, and offering both here asked someone to choose
          between two ways of saying the same thing before they had said
          anything. A field also draws the eye first — a keyboard is a more
          familiar affordance than a microphone — so the screen quietly argued
          against its own purpose. */}
      <View style={[styles.composer, focus && styles.composerFocus]}>
        <View style={styles.actions}>
          <MotionSurface
            style={[
              styles.finish,
              focus && styles.finishFocus,
              !saidSomething && styles.disabled,
            ]}
            disabled={!saidSomething || finish.isPending}
            onPress={() => finish.mutate()}
          >
            <Text style={[styles.finishLabel, focus && styles.finishLabelFocus]}>
              {/* The design says what closing does rather than that it saves:
                  "close · keeps your turns". Which turns are kept is the
                  question someone has while deciding whether to close. */}
              {finish.isPending ? "Saving…" : "Close · keeps your turns"}
            </Text>
          </MotionSurface>
          {/* The design puts this on the talk screen and the web client has it;
              this client only ever showed crisis resources when the server
              flagged the reply. That means a person had to be *detected* to
              reach them. Asking is not a worse signal than being detected, and
              it is the one the person controls. Stops the loop too: leaving
              stops on someone's say-so, not only on the model's judgement. */}
          <MotionSurface
            style={styles.urgent}
            onPress={() => {
              if (live.state !== "off") live.stop();
              setCrisis(crisis ?? []);
            }}
            accessibilityRole="button"
            accessibilityLabel="Urgent — show crisis resources and stop"
          >
            <Text style={styles.urgentLabel}>Urgent</Text>
          </MotionSurface>
        </View>

        {conversationId && (
          <View style={styles.voiceRow}>
            {/* One control for the whole conversation, rather than a button held
                down once per sentence. Holding a button while working out what
                you mean is operating a machine, not talking. */}
            <MotionSurface
              style={[styles.live, live.state !== "off" && styles.liveOn]}
              onPress={() => (live.state === "off" ? void live.start() : live.stop())}
              accessibilityRole="button"
              accessibilityState={{ selected: live.state !== "off" }}
            >
              <View
                style={[
                  styles.liveDot,
                  live.state !== "off" && styles.liveDotOn,
                  // Grows with your voice, so you can see it is hearing you
                  // without reading anything.
                  live.state !== "off" && {
                    transform: [{ scale: 1 + live.level * 1.6 }],
                  },
                ]}
              />
              <Text style={[styles.liveLabel, live.state !== "off" && styles.liveLabelOn]}>
                {LIVE_LABEL[live.state]}
              </Text>
            </MotionSurface>

            {/* Push-to-talk stays for anyone who would rather not leave a
                microphone open, and for rooms where that is not appropriate. */}
            {live.state === "off" && (
              <RecordButton
                disabled={say.isPending || speak.isPending}
                onRecorded={async (uri) => {
                  await speak.mutateAsync(uri);
                }}
                onStateChange={setRecording}
                onError={setRecordError}
                tone={focus ? "dark" : "light"}
              />
            )}
            {(live.error || recordError) && (
              <Text style={styles.error}>{live.error ?? recordError}</Text>
            )}
          </View>
        )}

        {/* One line, as the design carries one. There were two, opening with
            the same three words — the button said the audio is discarded and
            the text kept, the screen said only your turns become entries. Both
            true, and together they read as the screen repeating itself while
            saying two different things. */}
        <Text style={[styles.footnote, focus && styles.footnoteFocus]}>
          Only your turns become entries. The recording is transcribed and then
          discarded, and nothing here is interpreted.
        </Text>
      </View>
      </KeyboardAvoidingView>
    </AtmosphericShell>
  );
}

const styles = StyleSheet.create({
  voiceRow: { gap: 10 },
  live: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    // 3px, as every other control in this design is, and as the button beneath
    // it already was. A pill and a 3px button stacked on top of each other are
    // two answers to what a button is, and the one beneath carries a comment
    // arguing that only a switch should be round.
    borderRadius: radii.surface,
    paddingVertical: 15,
    backgroundColor: colors.surface,
  },
  // Lit rather than merely "pressed". An open microphone should be unmistakable
  // from across a room.
  liveOn: { borderColor: colors.cyan, backgroundColor: colors.surfaceBright },
  liveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.lineStrong,
  },
  liveDotOn: { backgroundColor: colors.cyan },
  // The design's `.btn`: mono, uppercase, letter-spaced. Both of these were
  // bold sans, which is the voice of a heading rather than of a control.
  liveLabel: {
    color: colors.inkSoft,
    fontFamily: fonts.mono,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  liveLabelOn: { color: colors.ink },
  screen: { flex: 1, backgroundColor: colors.room },
  // Focus mode goes dark. Not for style: the blob is a light source, and on white
  // it reads as a smudge rather than as something present in the room.
  screenFocus: { backgroundColor: colors.room },
  stage: { alignItems: "center", paddingTop: 12, gap: 6 },
  stageControl: { alignItems: "center" },
  stageControlFocus: { flex: 1, alignSelf: "stretch", justifyContent: "center" },
  stageFocus: { flex: 1, justifyContent: "center", paddingTop: 0 },
  stageHint: { fontFamily: fonts.sans, fontSize: 12, color: colors.inkMuted },
  voiceToggle: {
    fontFamily: fonts.sans, fontSize: 11,
    color: colors.inkMuted,
    textDecorationLine: "underline",
    paddingVertical: 4,
  },
  voiceToggleFocus: { color: colors.inkMuted },
  stageHintFocus: { fontFamily: fonts.sans, fontSize: 14, color: colors.inkMuted },
  focusBody: { paddingHorizontal: 28, paddingBottom: 12, minHeight: 90 },
  /** Your own words, set quieter than the answer to them — it is there to be
   *  checked, not read. */
  focusHeard: {
    color: colors.inkMuted,
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    marginBottom: 14,
  },
  focusReply: {
    color: colors.ink,
    fontFamily: fonts.sans, fontSize: 18,
    lineHeight: 26,
    textAlign: "center",
  },
  thread: { padding: 16, gap: 10, paddingBottom: 24 },
  opening: { color: colors.inkMuted, fontFamily: fonts.sans, fontSize: 15, lineHeight: 22, marginTop: 8 },
  bubble: { borderRadius: radii.surface, padding: 12, maxWidth: "88%" },
  mine: { alignSelf: "flex-end", backgroundColor: colors.ink },
  mineText: { color: colors.room, fontFamily: fonts.sans, fontSize: 16, lineHeight: 22 },
  theirs: { alignSelf: "flex-start", backgroundColor: colors.surfaceBright },
  theirsText: { color: colors.ink, fontFamily: fonts.sans, fontSize: 16, lineHeight: 22 },
  thinking: { alignSelf: "flex-start", marginVertical: 4 },
  crisis: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radii.surface,
    padding: 12,
    gap: 6,
    marginTop: 8,
  },
  crisisTitle: { fontWeight: "700", fontFamily: fonts.sans, fontSize: 15, color: colors.danger },
  crisisLine: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 22, color: colors.ink },
  crisisNote: { fontFamily: fonts.sans, fontSize: 12, color: colors.inkMuted, lineHeight: 18 },
  composer: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    padding: 12,
    gap: 8,
  },
  composerFocus: { borderTopColor: colors.line },
  input: {
    color: colors.ink,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radii.surface,
    padding: 12,
    minHeight: 64,
    fontFamily: fonts.sans, fontSize: 16,
    textAlignVertical: "top",
  },
  actions: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "space-between" },
  send: {
    flex: 1,
    backgroundColor: colors.violet,
    borderRadius: radii.surface,
    paddingVertical: 12,
    alignItems: "center",
  },
  sendLabel: { color: colors.room, fontWeight: "600", fontFamily: fonts.sans, fontSize: 16 },
  // The design's other corner, and now it looks like one. Closing and asking
  // for help are the same kind of thing — always reachable, never the thing you
  // came here to do — and the design sets both as quiet mono in the margin.
  // This was a bordered flex button in 16px bold beside `urgent`'s 11px mono,
  // so two actions the design treats identically looked nothing alike, and the
  // loud one crowded the composer it sat under.
  finish: { justifyContent: "center", paddingVertical: 12, paddingHorizontal: 4 },
  finishFocus: {},
  finishLabel: {
    color: colors.inkMuted,
    fontFamily: fonts.monoMedium,
    fontSize: scale.kicker.size,
    letterSpacing: scale.kicker.tracking,
    textTransform: "uppercase",
  },
  finishLabelFocus: { color: colors.inkMuted },
  // Quiet, like the design's `.talk-corner`: reachable without shouting, and
  // never competing with the thing someone came here to do.
  urgent: { justifyContent: "center", paddingVertical: 12, paddingHorizontal: 4 },
  urgentLabel: {
    color: colors.inkMuted,
    fontFamily: fonts.monoMedium, fontSize: scale.kicker.size,
    letterSpacing: scale.kicker.tracking,
    textTransform: "uppercase",
  },
  disabled: { opacity: 0.35 },
  error: { color: colors.danger, fontFamily: fonts.sans, fontSize: 13 },
  footnote: { fontFamily: fonts.sans, fontSize: 11, color: colors.inkMuted, textAlign: "center" },
  footnoteFocus: { color: colors.inkMuted },
});
