import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { api, type Pattern } from "@/lib/api";
import { useSession } from "@/state/session";

export default function PatternsScreen() {
  const token = useSession((s) => s.token);
  const queryClient = useQueryClient();
  const patterns = useQuery({
    queryKey: ["patterns"],
    queryFn: () => api.listPatterns(token!),
    enabled: Boolean(token),
  });
  const mine = useMutation({
    mutationFn: () => api.minePatterns(token!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["patterns"] });
      void queryClient.invalidateQueries({ queryKey: ["graph"] });
    },
  });

  if (!token) return null;

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.intro}>
        Patterns are recurring ideas found across your entries. They are
        hypotheses, not conclusions.
      </Text>

      <Pressable
        style={[styles.button, mine.isPending && styles.disabled]}
        disabled={mine.isPending}
        onPress={() => mine.mutate()}
      >
        <Text style={styles.buttonLabel}>
          {mine.isPending ? "Looking for patterns…" : "Look for patterns now"}
        </Text>
      </Pressable>
      {mine.isError && <Text style={styles.error}>Could not look for patterns.</Text>}
      {mine.data && (
        <Text style={styles.feedback}>
          Checked {mine.data.considered} {mine.data.considered === 1 ? "inference" : "inferences"}; found {mine.data.patterns} {mine.data.patterns === 1 ? "pattern" : "patterns"}.
        </Text>
      )}

      {patterns.isLoading ? (
        <ActivityIndicator style={styles.loader} />
      ) : patterns.isError ? (
        <View style={styles.state}>
          <Text style={styles.error}>Could not load patterns.</Text>
          <Pressable onPress={() => void patterns.refetch()}>
            <Text style={styles.link}>Try again</Text>
          </Pressable>
        </View>
      ) : patterns.data?.length === 0 ? (
        <Text style={styles.empty}>
          No recurring patterns yet. Write a few entries, then check again.
        </Text>
      ) : (
        <View style={styles.list}>
          <Text style={styles.sectionTitle}>Patterns</Text>
          {patterns.data?.map((pattern: Pattern) => (
            <PatternRow key={pattern.id} pattern={pattern} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function PatternRow({ pattern }: { pattern: Pattern }) {
  const router = useRouter();
  return (
    <Pressable
      style={[styles.card, pattern.tentative && styles.cardTentative]}
      onPress={() => router.push(`/node/${pattern.id}`)}
    >
      <Text style={styles.label}>{pattern.label}</Text>
      <Text style={styles.meta}>
        {pattern.occurrences} {pattern.occurrences === 1 ? "occurrence" : "occurrences"} · {Math.round(pattern.confidence * 100)}% confident
      </Text>
      <Text style={styles.meta}>
        {pattern.tentative ? "Tentative hypothesis" : "Hypothesis"} · Tap to see the entries behind it
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 16, gap: 12, paddingBottom: 40 },
  intro: { fontSize: 15, lineHeight: 22, color: "#3f3f46" },
  button: {
    backgroundColor: "#18181b",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  buttonLabel: { color: "#fafafa", fontWeight: "600", fontSize: 16 },
  disabled: { opacity: 0.4 },
  feedback: { color: "#52525b", fontSize: 13 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: "#71717a",
  },
  list: { gap: 8, marginTop: 12 },
  card: {
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  cardTentative: { borderStyle: "dashed", borderColor: "#d4d4d8" },
  label: { fontSize: 17, lineHeight: 23 },
  meta: { fontSize: 12, color: "#71717a" },
  loader: { marginTop: 32 },
  state: { alignItems: "center", gap: 8, marginTop: 28 },
  empty: { color: "#71717a", textAlign: "center", marginTop: 28, lineHeight: 21 },
  error: { color: "#b91c1c", fontSize: 13 },
  link: { color: "#3f3f46", fontWeight: "600" },
});
