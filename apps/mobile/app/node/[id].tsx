import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AtmosphericShell } from "@/components/Atmospheric";
import { EvidenceRail, FieldFrame, LoadingLens, ErrorLens, ObservablePearl } from "@/components/SpatialField";
import { MotionSurface } from "@/components/MotionSurface";
import { api, type Explanation, type Judgement } from "@/lib/api";
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

  if (explanation.isLoading) return <LoadingLens label="Tracing provenance…" />;
  if (explanation.isError || !explanation.data) {
    return <ErrorLens label="Could not load this." />;
  }

  return <Body explanation={explanation.data} nodeId={id!} />;
}

/**
 * Agreeing or disagreeing with a reading.
 *
 * The app has called its inferences hypotheses from the beginning. Until this
 * existed that was a claim it made about itself and gave nobody any way to test —
 * a hypothesis you cannot reject is an assertion with better manners.
 *
 * Tapping the active choice withdraws it. Someone who agreed with something in a
 * bad week must be able to take it back rather than be held to it, and a control
 * with no way out invites people not to use it at all.
 */
function Verdict({ nodeId, status }: { nodeId: string; status: string }) {
  const token = useSession((s) => s.token);
  const client = useQueryClient();

  const judge = useMutation({
    mutationFn: (next: Judgement) => api.judgeNode(token!, nodeId, next),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["explain", nodeId] });
      // Rejecting a reading removes it from everything derived from it, so the
      // screens showing those have to be told.
      void client.invalidateQueries({ queryKey: ["patterns"] });
      void client.invalidateQueries({ queryKey: ["temporal"] });
      void client.invalidateQueries({ queryKey: ["graph"] });
    },
  });

  const choose = (next: Judgement) =>
    judge.mutate(status === next ? "hypothesis" : next);

  return (
    <View style={styles.verdict}>
      <Text style={styles.verdictAsk}>Does this match how it was?</Text>
      <View style={styles.verdictRow}>
        <MotionSurface
          style={[styles.choice, status === "user_confirmed" && styles.choiceYes]}
          onPress={() => choose("user_confirmed")}
          accessibilityRole="button"
          accessibilityState={{ selected: status === "user_confirmed" }}
        >
          <Text
            style={[
              styles.choiceLabel,
              status === "user_confirmed" && styles.choiceLabelOn,
            ]}
          >
            Yes
          </Text>
        </MotionSurface>
        <MotionSurface
          style={[styles.choice, status === "user_rejected" && styles.choiceNo]}
          onPress={() => choose("user_rejected")}
          accessibilityRole="button"
          accessibilityState={{ selected: status === "user_rejected" }}
        >
          <Text
            style={[
              styles.choiceLabel,
              status === "user_rejected" && styles.choiceLabelOn,
            ]}
          >
            Not really
          </Text>
        </MotionSurface>
      </View>
      {status === "user_rejected" && (
        // Said plainly, because the consequence is the point: this is what makes
        // disagreeing worth the tap.
        <Text style={styles.verdictNote}>
          Kept on record, but no longer counted toward patterns or changes.
        </Text>
      )}
      {judge.isError && (
        <Text style={styles.verdictNote}>Could not save that. Try again.</Text>
      )}
    </View>
  );
}

function Body({
  explanation,
  nodeId,
}: {
  explanation: Explanation;
  nodeId: string;
}) {
  const { node, derived_from, is_observed } = explanation;

  if (is_observed) {
    // An observation is what the user wrote. It is not a claim, has no
    // confidence, and needs no justification beyond itself.
    return (
      <AtmosphericShell variant="secondary">
        <ScrollView contentContainerStyle={styles.screen}>
        <Text style={styles.kind}>Your entry</Text>
        <Text style={styles.headline}>{node.label}</Text>
        <Text style={styles.footnote}>
          This is something you wrote. Everything else in the graph is drawn from
          entries like this one.
        </Text>
        </ScrollView>
      </AtmosphericShell>
    );
  }

  const confidence = node.confidence ?? 0;
  const tentative = confidence < 0.5;

  return (
    <AtmosphericShell variant="secondary">
      <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.kicker}>EVIDENCE CHAIN</Text>
      <Text style={styles.kind}>{node.kind.toLowerCase()}</Text>
      <Text style={styles.headline}>{node.label}</Text>

      <View style={[styles.badge, tentative && styles.badgeTentative]}>
        <Text style={styles.badgeText}>
          {tentative ? "A tentative guess" : "A guess"} ·{" "}
          {Math.round(confidence * 100)}% confident
        </Text>
      </View>

      {/* The same number as a length.
          "70% confident" is a phrase people skim; a bar that is visibly two
          thirds full is not. The threshold is marked because the app treats
          either side of it differently — below it a reading is drawn hollow and
          filed under "Less sure about" — and a scale with an invisible cutoff
          asks the reader to remember a rule instead of seeing it. */}
      <View style={styles.meter} accessibilityElementsHidden>
        <View
          style={[
            styles.meterFill,
            tentative && styles.meterFillTentative,
            { width: `${Math.round(confidence * 100)}%` },
          ]}
        />
        <View style={styles.meterThreshold} />
      </View>

      <Verdict nodeId={nodeId} status={node.epistemic_status ?? "hypothesis"} />

      <Text style={styles.lead}>
        {/* Stated before the evidence, not after. The user should know what kind
            of thing they are reading before they read it. */}
        This is a hypothesis drawn from your own words, not a conclusion about
        you. It came from:
      </Text>

      <EvidenceRail label="Evidence chain from hypothesis to source">
      {derived_from.length === 0 ? (
        // Should be unreachable: the database refuses an inference with no
        // provenance. Shown rather than hidden, because silently rendering an
        // uncited claim is exactly the failure this screen exists to prevent.
        <Text style={styles.error}>
          No source entries found. This should not happen — please report it.
        </Text>
      ) : (
        derived_from.map((observation) => (
          <View key={observation.id} style={styles.source} accessibilityLabel={`Source entry: ${observation.content}`}>
            <Text style={styles.sourceText}>{observation.content}</Text>
            <Text style={styles.meta}>
              {new Date(observation.captured_at).toLocaleString()} ·{" "}
              {observation.source}
              {/* Said plainly where the evidence is read. An entry written days
                  after the thing it describes is weaker evidence about when
                  that thing happened, and the person is the only one who can
                  weigh that against what they remember. */}
              {observation.recall_days > 0 &&
                ` · written ${observation.recall_days} ${
                  observation.recall_days === 1 ? "day" : "days"
                } later`}
            </Text>
          </View>
        ))
      )}
      </EvidenceRail>

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
    </AtmosphericShell>
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
  verdict: { gap: 8, marginTop: 18 },
  verdictAsk: { color: "#b5b3c7", fontSize: 14 },
  verdictRow: { flexDirection: "row", gap: 10 },
  choice: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#454563",
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
  },
  choiceYes: { borderColor: "#67e8f9", backgroundColor: "#0c1c22" },
  choiceNo: { borderColor: "#fbbf24", backgroundColor: "#221a08" },
  choiceLabel: { color: "#b5b3c7", fontSize: 15, fontWeight: "700" },
  choiceLabelOn: { color: "#f1f0f8" },
  verdictNote: { color: "#a09db4", fontSize: 12, lineHeight: 18 },
  meter: {
    height: 6,
    borderRadius: 999,
    backgroundColor: "#29293b",
    overflow: "hidden",
    marginTop: 10,
    justifyContent: "center",
  },
  meterFill: { height: 6, borderRadius: 999, backgroundColor: "#67e8f9" },
  meterFillTentative: { backgroundColor: "#fbbf24" },
  // Sits at the halfway mark, where "tentative" starts.
  meterThreshold: {
    position: "absolute",
    left: "50%",
    width: 1,
    height: 6,
    backgroundColor: "#08080c",
  },
  screen: { backgroundColor: "#08080c", padding: 20, gap: 14, paddingBottom: 48 },
  kicker: { color: "#67e8f9", fontSize: 11, fontWeight: "700", letterSpacing: 1.8 },
  kind: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: "#a09db4",
  },
  headline: { fontSize: 22, lineHeight: 30, fontWeight: "600", color: "#f1f0f8" },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: "#181827",
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  badgeTentative: { backgroundColor: "#3a2e0e" },
  badgeText: { fontSize: 13, color: "#b5b3c7" },
  lead: { fontSize: 15, lineHeight: 22, color: "#b5b3c7", marginTop: 8 },
  source: {
    backgroundColor: "#12121c",
    marginLeft: 10,
    borderLeftWidth: 3,
    borderLeftColor: "#67e8f9",
    paddingLeft: 12,
    paddingVertical: 6,
    gap: 4,
  },
  sourceText: { fontSize: 16, lineHeight: 23, color: "#f1f0f8" },
  meta: { fontSize: 12, color: "#a09db4" },
  provenance: {
    backgroundColor: "#12121c",
    marginTop: 20,
    borderWidth: 1,
    borderColor: "#29293b",
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  provenanceTitle: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: "#a09db4",
    marginBottom: 2,
  },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  rowLabel: { fontSize: 13, color: "#a09db4" },
  rowValue: { fontSize: 13, flexShrink: 1, textAlign: "right", color: "#f1f0f8" },
  loader: { marginTop: 40 },
  error: { color: "#fb7185", padding: 16 },
  footnote: { marginTop: 20, fontSize: 12, lineHeight: 18, color: "#a09db4" },
});
