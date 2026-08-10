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
  TextInput,
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
import { colors } from "@/theme";
import { radii, type as scale } from "@tlon/design";

const LazyBlob = lazySkia(() => import("@/components/Blob"));

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
  idle: "Tap to see the transcript · drag to spin",
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
  const [draft, setDraft] = useState("");
  const [crisis, setCrisis] = useState<string[] | null>(null);
  const [recording, setRecording] = useState<RecordState>("idle");
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
      queryClient.invalidateQueries({ queryKey: ["conversation", conversationId] });
    },
  });

  const say = useMutation({
    mutationFn: ({ text, source }: { text: string; source: "text" | "voice" }) =>
      api.say(token!, conversationId!, text, source),
    onSuccess: (reply) => {
      setDraft("");
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
                <Text key={line} style={styles.crisisLine}>
                  {line}
                </Text>
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

      <View style={[styles.composer, focus && styles.composerFocus]}>
        {!focus && (
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Say something…"
            multiline
            editable={Boolean(conversationId) && !say.isPending}
          />
        )}
        <View style={styles.actions}>
          {!focus && (
          <MotionSurface
            style={[styles.send, (!draft.trim() || say.isPending) && styles.disabled]}
            disabled={!draft.trim() || say.isPending}
            onPress={() => say.mutate({ text: draft, source: "text" })}
          >
            <Text style={styles.sendLabel}>Send</Text>
          </MotionSurface>
          )}
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
              {finish.isPending ? "Saving…" : "Finish & save"}
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
                tone={focus ? "dark" : "light"}
              />
            )}
            {live.error && <Text style={styles.error}>{live.error}</Text>}
          </View>
        )}

        <Text style={[styles.footnote, focus && styles.footnoteFocus]}>
          Only what you say is kept. My side of this isn't saved as an entry.
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
    borderRadius: 999,
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
  liveLabel: { color: colors.inkSoft, fontSize: 15, fontWeight: "700" },
  liveLabelOn: { color: colors.ink },
  screen: { flex: 1, backgroundColor: colors.room },
  // Focus mode goes dark. Not for style: the blob is a light source, and on white
  // it reads as a smudge rather than as something present in the room.
  screenFocus: { backgroundColor: colors.room },
  stage: { alignItems: "center", paddingTop: 12, gap: 6 },
  stageControl: { alignItems: "center" },
  stageControlFocus: { flex: 1, alignSelf: "stretch", justifyContent: "center" },
  stageFocus: { flex: 1, justifyContent: "center", paddingTop: 0 },
  stageHint: { fontSize: 12, color: colors.inkMuted },
  voiceToggle: {
    fontSize: 11,
    color: colors.inkMuted,
    textDecorationLine: "underline",
    paddingVertical: 4,
  },
  voiceToggleFocus: { color: colors.inkMuted },
  stageHintFocus: { fontSize: 14, color: colors.inkMuted },
  focusBody: { paddingHorizontal: 28, paddingBottom: 12, minHeight: 90 },
  focusReply: {
    color: colors.ink,
    fontSize: 18,
    lineHeight: 26,
    textAlign: "center",
  },
  thread: { padding: 16, gap: 10, paddingBottom: 24 },
  opening: { color: colors.inkMuted, fontSize: 15, lineHeight: 22, marginTop: 8 },
  bubble: { borderRadius: radii.surface, padding: 12, maxWidth: "88%" },
  mine: { alignSelf: "flex-end", backgroundColor: colors.ink },
  mineText: { color: colors.room, fontSize: 16, lineHeight: 22 },
  theirs: { alignSelf: "flex-start", backgroundColor: colors.surfaceBright },
  theirsText: { color: colors.ink, fontSize: 16, lineHeight: 22 },
  thinking: { alignSelf: "flex-start", marginVertical: 4 },
  crisis: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radii.surface,
    padding: 12,
    gap: 6,
    marginTop: 8,
  },
  crisisTitle: { fontWeight: "700", fontSize: 15, color: colors.danger },
  crisisLine: { fontSize: 15, lineHeight: 22, color: colors.ink },
  crisisNote: { fontSize: 12, color: colors.inkMuted, lineHeight: 18 },
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
    fontSize: 16,
    textAlignVertical: "top",
  },
  actions: { flexDirection: "row", gap: 8 },
  send: {
    flex: 1,
    backgroundColor: colors.violet,
    borderRadius: radii.surface,
    paddingVertical: 12,
    alignItems: "center",
  },
  sendLabel: { color: colors.room, fontWeight: "600", fontSize: 16 },
  finish: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.ink,
    borderRadius: radii.surface,
    paddingVertical: 12,
    alignItems: "center",
  },
  finishFocus: { borderColor: colors.inkSoft },
  finishLabel: { color: colors.ink, fontWeight: "600", fontSize: 16 },
  finishLabelFocus: { color: colors.ink },
  // Quiet, like the design's `.talk-corner`: reachable without shouting, and
  // never competing with the thing someone came here to do.
  urgent: { justifyContent: "center", paddingVertical: 12, paddingHorizontal: 4 },
  urgentLabel: {
    color: colors.inkMuted,
    fontSize: scale.kicker.size,
    letterSpacing: scale.kicker.tracking,
    textTransform: "uppercase",
  },
  disabled: { opacity: 0.35 },
  error: { color: colors.danger, fontSize: 13 },
  footnote: { fontSize: 11, color: colors.inkMuted, textAlign: "center" },
  footnoteFocus: { color: colors.inkMuted },
});
