import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ApiError, api, type ObservationResponse } from "@/lib/api";
import { uuidv7 } from "@/lib/ids";
import { useSession } from "@/state/session";

export default function JournalScreen() {
  const token = useSession((s) => s.token);
  const signOut = useSession((s) => s.signOut);
  const [draft, setDraft] = useState("");
  const queryClient = useQueryClient();

  const observations = useQuery({
    queryKey: ["observations"],
    queryFn: () => api.listObservations(token!),
    enabled: Boolean(token),
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
      queryClient.invalidateQueries({ queryKey: ["observations"] });
    },
  });

  // The auth gate in _layout redirects before this renders when signed out.
  if (!token) return null;

  return (
    <View style={styles.screen}>
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="What's on your mind?"
          multiline
          editable={!capture.isPending}
        />
        <Pressable
          style={[
            styles.button,
            (!draft.trim() || capture.isPending) && styles.buttonDisabled,
          ]}
          disabled={!draft.trim() || capture.isPending}
          onPress={() => capture.mutate(draft)}
        >
          <Text style={styles.buttonLabel}>
            {capture.isPending ? "Saving…" : "Save"}
          </Text>
        </Pressable>
        {capture.isError && (
          <Text style={styles.error}>
            {capture.error instanceof ApiError
              ? capture.error.message
              : "Could not save. Your text is still here — try again."}
          </Text>
        )}
      </View>

      <View style={styles.row}>
        <Link href="/today" style={styles.link}>
          Today
        </Link>
        <Link href="/graph" style={styles.link}>
          Graph
        </Link>
        <Pressable
          onPress={() => {
            // Revoke server-side too, so a copied token cannot outlive sign-out.
            void api.logout(token).catch(() => undefined);
            void signOut();
          }}
        >
          <Text style={styles.link}>Sign out</Text>
        </Pressable>
      </View>

      {observations.isLoading ? (
        <ActivityIndicator style={styles.loader} />
      ) : (
        <FlatList
          data={observations.data?.observations ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ObservationRow observation={item} />}
          ListEmptyComponent={
            <Text style={styles.notice}>No entries yet.</Text>
          }
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
}

function ObservationRow({
  observation,
}: {
  observation: ObservationResponse;
}) {
  return (
    <View style={styles.entry}>
      <Text style={styles.rowContent}>{observation.content}</Text>
      <Text style={styles.rowMeta}>
        {new Date(observation.captured_at).toLocaleString()} ·{" "}
        {observation.source}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, gap: 12 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  composer: { gap: 8 },
  input: {
    borderWidth: 1,
    borderColor: "#d4d4d8",
    borderRadius: 12,
    padding: 12,
    minHeight: 96,
    fontSize: 16,
    textAlignVertical: "top",
  },
  button: {
    backgroundColor: "#18181b",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.4 },
  buttonLabel: { color: "#fafafa", fontWeight: "600", fontSize: 16 },
  link: { color: "#3f3f46", fontWeight: "600" },
  loader: { marginTop: 24 },
  list: { gap: 8, paddingBottom: 24 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  entry: {
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  rowContent: { fontSize: 16, lineHeight: 22 },
  rowMeta: { fontSize: 12, color: "#71717a" },
  notice: { color: "#71717a", textAlign: "center", marginTop: 24 },
  error: { color: "#b91c1c", fontSize: 13 },
});
