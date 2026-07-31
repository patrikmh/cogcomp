import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { api, type Explanation } from "@/lib/api";
import { useSession } from "@/state/session";

/**
 * "Why do you think this?"
 *
 * The screen the whole provenance design exists to make possible. Everywhere else
 * in the app promises that an inference can be traced back to the user's own
 * words; this is where that promise is kept.
 */
export default function NodeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const token = useSession((s) => s.token);

  const explanation = useQuery({
    queryKey: ["explain", id],
    queryFn: () => api.explain(token!, id!),
    enabled: Boolean(token && id),
  });

  // The auth gate in _layout redirects before this renders when signed out.
  if (!token) return null;

  if (explanation.isLoading) return <ActivityIndicator style={styles.loader} />;
  if (explanation.isError || !explanation.data) {
    return <Text style={styles.error}>Could not load this.</Text>;
  }

  return <Body explanation={explanation.data} />;
}

function Body({ explanation }: { explanation: Explanation }) {
  const { node, derived_from, is_observed } = explanation;

  if (is_observed) {
    // An observation is what the user wrote. It is not a claim, has no
    // confidence, and needs no justification beyond itself.
    return (
      <ScrollView contentContainerStyle={styles.screen}>
        <Text style={styles.kind}>Your entry</Text>
        <Text style={styles.headline}>{node.label}</Text>
        <Text style={styles.footnote}>
          This is something you wrote. Everything else in the graph is drawn from
          entries like this one.
        </Text>
      </ScrollView>
    );
  }

  const confidence = node.confidence ?? 0;
  const tentative = confidence < 0.5;

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.kind}>{node.kind.toLowerCase()}</Text>
      <Text style={styles.headline}>{node.label}</Text>

      <View style={[styles.badge, tentative && styles.badgeTentative]}>
        <Text style={styles.badgeText}>
          {tentative ? "A tentative guess" : "A guess"} ·{" "}
          {Math.round(confidence * 100)}% confident
        </Text>
      </View>

      <Text style={styles.lead}>
        {/* Stated before the evidence, not after. The user should know what kind
            of thing they are reading before they read it. */}
        This is a hypothesis drawn from your own words, not a conclusion about
        you. It came from:
      </Text>

      {derived_from.length === 0 ? (
        // Should be unreachable: the database refuses an inference with no
        // provenance. Shown rather than hidden, because silently rendering an
        // uncited claim is exactly the failure this screen exists to prevent.
        <Text style={styles.error}>
          No source entries found. This should not happen — please report it.
        </Text>
      ) : (
        derived_from.map((observation) => (
          <View key={observation.id} style={styles.source}>
            <Text style={styles.sourceText}>{observation.content}</Text>
            <Text style={styles.meta}>
              {new Date(observation.captured_at).toLocaleString()} ·{" "}
              {observation.source}
            </Text>
          </View>
        ))
      )}

      <View style={styles.provenance}>
        <Text style={styles.provenanceTitle}>How this was produced</Text>
        <Row label="Status" value={node.epistemic_status ?? "hypothesis"} />
        <Row label="Extracted by" value={node.extractor ?? "unknown"} />
        <Row
          label="Recorded"
          value={new Date(node.created_at).toLocaleString()}
        />
      </View>

      <Text style={styles.footnote}>
        Confidence is the extractor's own estimate that this is a fair reading of
        what you wrote — not a measure of how strongly you feel it, or how
        important it is.
      </Text>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 16, gap: 12, paddingBottom: 40 },
  kind: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: "#71717a",
  },
  headline: { fontSize: 22, lineHeight: 30, fontWeight: "600" },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: "#f4f4f5",
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  badgeTentative: { backgroundColor: "#fef3c7" },
  badgeText: { fontSize: 13, color: "#3f3f46" },
  lead: { fontSize: 15, lineHeight: 22, color: "#3f3f46", marginTop: 8 },
  source: {
    borderLeftWidth: 3,
    borderLeftColor: "#18181b",
    paddingLeft: 12,
    paddingVertical: 6,
    gap: 4,
  },
  sourceText: { fontSize: 16, lineHeight: 23 },
  meta: { fontSize: 12, color: "#71717a" },
  provenance: {
    marginTop: 20,
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  provenanceTitle: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: "#71717a",
    marginBottom: 2,
  },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  rowLabel: { fontSize: 13, color: "#71717a" },
  rowValue: { fontSize: 13, flexShrink: 1, textAlign: "right" },
  loader: { marginTop: 40 },
  error: { color: "#b91c1c", padding: 16 },
  footnote: { marginTop: 20, fontSize: 12, lineHeight: 18, color: "#a1a1aa" },
});
