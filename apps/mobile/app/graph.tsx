import { useQuery } from "@tanstack/react-query";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { api, type GraphSummary } from "@/lib/api";
import { useSession } from "@/state/session";

/**
 * Placeholder graph view. The Skia force-directed explorer replaces this once
 * the extraction pipeline produces nodes worth exploring — until then a count
 * per kind is the honest amount of information to show.
 */
export default function GraphScreen() {
  const token = useSession((s) => s.token);

  const summary = useQuery({
    queryKey: ["graph-summary"],
    queryFn: () => api.graphSummary(token!),
    enabled: Boolean(token),
  });

  // The auth gate in _layout redirects before this renders when signed out.
  if (!token) return null;

  if (summary.isLoading) {
    return <ActivityIndicator style={styles.loader} />;
  }

  const counts: GraphSummary["counts"] = summary.data?.counts ?? [];

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.version}>
        Graph schema v{summary.data?.schema_version ?? "?"}
      </Text>

      {counts.length === 0 ? (
        <Text style={styles.notice}>
          Nothing in the graph yet. Write a journal entry to start.
        </Text>
      ) : (
        counts.map(({ kind, count }) => (
          <View key={kind} style={styles.row}>
            <Text style={styles.kind}>{kind}</Text>
            <Text style={styles.count}>{count}</Text>
          </View>
        ))
      )}

      <Text style={styles.footnote}>
        Everything here except your own entries is a hypothesis, not a
        conclusion. Tap any node to see which of your words it came from.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 16, gap: 8 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  loader: { marginTop: 32 },
  version: { fontSize: 12, color: "#71717a", marginBottom: 8 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 12,
    padding: 12,
  },
  kind: { fontSize: 16, fontWeight: "500" },
  count: { fontSize: 16, color: "#71717a" },
  notice: { color: "#71717a", textAlign: "center", marginTop: 24 },
  footnote: {
    marginTop: 24,
    fontSize: 13,
    lineHeight: 19,
    color: "#71717a",
  },
});
