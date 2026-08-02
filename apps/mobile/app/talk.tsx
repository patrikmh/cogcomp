import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
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

import { RecordButton } from "@/components/RecordButton";
import { ApiError, api, type Conversation } from "@/lib/api";
import { useSession } from "@/state/session";

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
  const scrollRef = useRef<ScrollView>(null);

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
      if (reply.crisis) setCrisis(reply.crisis_resources);
      queryClient.invalidateQueries({ queryKey: ["conversation", conversationId] });
    },
  });

  const say = useMutation({
    mutationFn: ({ text, source }: { text: string; source: "text" | "voice" }) =>
      api.say(token!, conversationId!, text, source),
    onSuccess: (reply) => {
      setDraft("");
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

  if (!token) return null;

  const turns: Conversation["turns"] = conversation.data?.turns ?? [];
  const saidSomething = turns.some((t) => t.speaker === "user");

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
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

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Say something…"
          multiline
          editable={Boolean(conversationId) && !say.isPending}
        />
        <View style={styles.actions}>
          <Pressable
            style={[styles.send, (!draft.trim() || say.isPending) && styles.disabled]}
            disabled={!draft.trim() || say.isPending}
            onPress={() => say.mutate({ text: draft, source: "text" })}
          >
            <Text style={styles.sendLabel}>Send</Text>
          </Pressable>
          <Pressable
            style={[styles.finish, !saidSomething && styles.disabled]}
            disabled={!saidSomething || finish.isPending}
            onPress={() => finish.mutate()}
          >
            <Text style={styles.finishLabel}>
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
          />
        )}

        <Text style={styles.footnote}>
          Only what you say is kept. My side of this isn't saved as an entry.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
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
  finishLabel: { color: "#18181b", fontWeight: "600", fontSize: 16 },
  disabled: { opacity: 0.35 },
  error: { color: "#b91c1c", fontSize: 13 },
  footnote: { fontSize: 11, color: "#a1a1aa", textAlign: "center" },
});
