import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { Suspense, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { RecordButton, type RecordState } from "@/components/RecordButton";
import { ApiError, api, type Conversation } from "@/lib/api";
import type { BlobState } from "@/lib/blobShape";
import { lazySkia } from "@/lib/lazySkia";
import { useSpokenReply } from "@/lib/useSpokenReply";
import { useSession } from "@/state/session";

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
  // Focus is the default. The sphere is the interface — the transcript is there
  // for when you want to check what you said, not the thing you sit and read
  // while talking.
  const [focus, setFocus] = useState(true);
  // Cleared on a timer rather than tracked from the thread: "has just replied" is
  // a moment, and the last turn stays the agent's long after that moment passes.
  const [justReplied, setJustReplied] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const scrollRef = useRef<ScrollView>(null);

  // Speaking is an addition to the text, never a replacement: if it is off, or
  // unconfigured, or fails, the reply is still on screen to read.
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

  useEffect(() => {
    if (!justReplied) return;
    const timer = setTimeout(() => setJustReplied(false), 2600);
    return () => clearTimeout(timer);
  }, [justReplied]);

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
    <KeyboardAvoidingView
      style={[styles.screen, focus && styles.screenFocus]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      {/* The header is a white bar across the top of a screen whose whole point
          is a dark room with one light in it. */}
      <Stack.Screen options={{ headerShown: !focus }} />

      <Pressable
        style={[styles.stage, focus && styles.stageFocus]}
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
        <Pressable
          onPress={() => {
            // Turning it off stops the current sentence too. Waiting for a reply
            // you have just muted to finish is the opposite of what you asked for.
            if (voiceOn) voice.stop();
            setVoiceOn((on) => !on);
          }}
          accessibilityRole="switch"
          accessibilityState={{ checked: voiceOn }}
        >
          <Text style={[styles.voiceToggle, focus && styles.voiceToggleFocus]}>
            {voiceOn ? "Voice on" : "Voice off"}
          </Text>
        </Pressable>
      </Pressable>

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
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
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
          <Pressable
            style={[styles.send, (!draft.trim() || say.isPending) && styles.disabled]}
            disabled={!draft.trim() || say.isPending}
            onPress={() => say.mutate({ text: draft, source: "text" })}
          >
            <Text style={styles.sendLabel}>Send</Text>
          </Pressable>
          )}
          <Pressable
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
          </Pressable>
        </View>

        {conversationId && (
          <RecordButton
            disabled={say.isPending || speak.isPending}
            onRecorded={async (uri) => {
              await speak.mutateAsync(uri);
            }}
            onStateChange={setRecording}
            tone={focus ? "dark" : "light"}
          />
        )}

        <Text style={[styles.footnote, focus && styles.footnoteFocus]}>
          Only what you say is kept. My side of this isn't saved as an entry.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  // Focus mode goes dark. Not for style: the blob is a light source, and on white
  // it reads as a smudge rather than as something present in the room.
  screenFocus: { backgroundColor: "#08080c" },
  stage: { alignItems: "center", paddingTop: 12, gap: 6 },
  stageFocus: { flex: 1, justifyContent: "center", paddingTop: 0 },
  stageHint: { fontSize: 12, color: "#a1a1aa" },
  voiceToggle: {
    fontSize: 11,
    color: "#71717a",
    textDecorationLine: "underline",
    paddingVertical: 4,
  },
  voiceToggleFocus: { color: "#a1a1aa" },
  stageHintFocus: { fontSize: 14, color: "#71717a" },
  focusBody: { paddingHorizontal: 28, paddingBottom: 12, minHeight: 90 },
  focusReply: {
    color: "#e4e4e7",
    fontSize: 18,
    lineHeight: 26,
    textAlign: "center",
  },
  thread: { padding: 16, gap: 10, paddingBottom: 24 },
  opening: { color: "#71717a", fontSize: 15, lineHeight: 22, marginTop: 8 },
  bubble: { borderRadius: 14, padding: 12, maxWidth: "88%" },
  mine: { alignSelf: "flex-end", backgroundColor: "#18181b" },
  mineText: { color: "#fafafa", fontSize: 16, lineHeight: 22 },
  theirs: { alignSelf: "flex-start", backgroundColor: "#f4f4f5" },
  theirsText: { color: "#18181b", fontSize: 16, lineHeight: 22 },
  thinking: { alignSelf: "flex-start", marginVertical: 4 },
  crisis: {
    borderWidth: 1,
    borderColor: "#b91c1c",
    borderRadius: 12,
    padding: 12,
    gap: 6,
    marginTop: 8,
  },
  crisisTitle: { fontWeight: "700", fontSize: 15, color: "#b91c1c" },
  crisisLine: { fontSize: 15, lineHeight: 22 },
  crisisNote: { fontSize: 12, color: "#71717a", lineHeight: 18 },
  composer: {
    borderTopWidth: 1,
    borderTopColor: "#e4e4e7",
    padding: 12,
    gap: 8,
  },
  composerFocus: { borderTopColor: "#1c1c22" },
  input: {
    borderWidth: 1,
    borderColor: "#d4d4d8",
    borderRadius: 12,
    padding: 12,
    minHeight: 64,
    fontSize: 16,
    textAlignVertical: "top",
  },
  actions: { flexDirection: "row", gap: 8 },
  send: {
    flex: 1,
    backgroundColor: "#18181b",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  sendLabel: { color: "#fafafa", fontWeight: "600", fontSize: 16 },
  finish: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#18181b",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  finishFocus: { borderColor: "#3f3f46" },
  finishLabel: { color: "#18181b", fontWeight: "600", fontSize: 16 },
  finishLabelFocus: { color: "#e4e4e7" },
  disabled: { opacity: 0.35 },
  error: { color: "#b91c1c", fontSize: 13 },
  footnote: { fontSize: 11, color: "#a1a1aa", textAlign: "center" },
  footnoteFocus: { color: "#52525b" },
});
