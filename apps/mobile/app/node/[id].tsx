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
import { Kicker, Meter, Rule } from "@/components/Marks";
import { Seal } from "@/components/Seal";
import { EvidenceRail, FieldFrame, LoadingLens, ErrorLens, ObservablePearl } from "@/components/SpatialField";
import { MotionSurface } from "@/components/MotionSurface";
import { api, type Explanation, type Judgement } from "@/lib/api";
import { useSession } from "@/state/session";
import { colors, fonts } from "@/theme";
import { radii } from "@tlon/design";
import { type as scale } from "@tlon/design";
import { Guide } from "@/components/Guide";
import { HEADINGS } from "@tlon/copy/headings";
import { SECTIONS } from "@tlon/copy/sections";

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
      // Identity is one of those screens. A reading you have just rejected is
      // still offered as a candidate there until something says otherwise,
      // and the composition would go on drawing a ring for it.
      void client.invalidateQueries({ queryKey: ["identity"] });
      // And the day it was drawn on, which lists it under what the record
      // stands behind.
      void client.invalidateQueries({ queryKey: ["summary"] });
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
        <View style={styles.actHead}>
          {/* The same mark as on the journal — arriving here from an entry, you
              should see the shape you tapped. */}
          <Seal id={node.id} size={34} />
          <Kicker>{HEADINGS.node.kicker}</Kicker>
        </View>
        <Text style={styles.headline}>{node.label}</Text>
        {/* No guide on an entry: it is the person's own words and has nothing
            to explain. The pill says what it is *not* — a claim — because that
            is the distinction the whole record rests on. */}
        <View style={styles.pills}>
          <Text style={styles.pill}>{node.kind.toLowerCase()}</Text>
          <Text style={styles.pill}>observation · makes no claim</Text>
        </View>
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
      <Kicker>{HEADINGS.node.kicker}</Kicker>
      <View style={styles.headingRow}>
        <Text style={[styles.headline, styles.headlineFill]}>{node.label}</Text>
        <Guide id="node" />
      </View>

      {/* Kind, then how sure — two pills, as the design sets them. "Growing
          vague" rather than "a tentative guess": a reading below the threshold
          is not merely uncertain, it is fading, and the word says so. */}
      <View style={styles.pills}>
        <Text style={styles.pill}>{node.kind.toLowerCase()}</Text>
        <Text style={[styles.pill, tentative && styles.pillTentative]}>
          {tentative ? "growing vague" : "confident"} · {confidence.toFixed(2)}
        </Text>
      </View>

      {/* The same number as a length.
          "70% confident" is a phrase people skim; a bar that is visibly two
          thirds full is not. The threshold is marked because the app treats
          either side of it differently — below it a reading is drawn hollow and
          filed under "Less sure about" — and a scale with an invisible cutoff
          asks the reader to remember a rule instead of seeing it. */}
      {/* The shared meter, which fills over .7s as the web's does rather than
          being found already at its value. */}
      <Meter confidence={confidence} tentative={tentative} threshold />

      <Verdict nodeId={nodeId} status={node.epistemic_status ?? "hypothesis"} />

      <Text style={styles.lead}>
        {/* Stated before the evidence, not after. The user should know what kind
            of thing they are reading before they read it. */}
        This is a hypothesis drawn from your own words, not a conclusion about
        you. It came from:
      </Text>

      {/* The design heads the evidence rather than letting it follow a
          sentence: "The acts behind it" names what the list is, so the entries
          read as the reading's grounds and not as more prose. */}
      <View style={styles.sectionRow}>
        <Kicker heading>{SECTIONS.evidence.title}</Kicker>
        <View style={styles.ruleFill}>
          <Rule />
        </View>
      </View>

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
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 12 },
  sectionRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 22 },
  ruleFill: { flex: 1 },
  pill: {
    color: colors.inkSoft,
    fontFamily: fonts.mono,
    fontSize: scale.meta.size,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 2,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  pillTentative: { color: colors.warning, borderColor: colors.warning },
  headingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  headlineFill: { flex: 1 },
  verdict: { gap: 8, marginTop: 18 },
  verdictAsk: { color: colors.inkSoft, fontFamily: fonts.sans, fontSize: 14 },
  verdictRow: { flexDirection: "row", gap: 10 },
  choice: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
  },
  choiceYes: { borderColor: colors.cyan, backgroundColor: colors.surfaceBright },
  choiceNo: { borderColor: colors.warning, backgroundColor: colors.surfaceBright },
  choiceLabel: { color: colors.inkSoft, fontFamily: fonts.sans, fontSize: 15, fontWeight: "700" },
  choiceLabelOn: { color: colors.ink },
  verdictNote: { color: colors.inkMuted, fontFamily: fonts.sans, fontSize: 12, lineHeight: 18 },
  meter: {
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.line,
    overflow: "hidden",
    marginTop: 10,
    justifyContent: "center",
  },
  meterFill: { height: 6, borderRadius: 999, backgroundColor: colors.cyan },
  meterFillTentative: { backgroundColor: colors.warning },
  // Sits at the halfway mark, where "tentative" starts.
  meterThreshold: {
    position: "absolute",
    left: "50%",
    width: 1,
    height: 6,
    backgroundColor: colors.room,
  },
  screen: { backgroundColor: colors.room, padding: 20, gap: 14, paddingBottom: 48 },
  actHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  kind: {
    fontFamily: fonts.mono, fontSize: scale.kicker.size,
    textTransform: "uppercase",
    letterSpacing: scale.kicker.tracking,
    color: colors.inkMuted,
  },
  headline: { fontFamily: fonts.sans, fontSize: 22, lineHeight: 30, fontWeight: "600", color: colors.ink },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceBright,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  badgeTentative: { backgroundColor: colors.surfaceBright },
  badgeText: { fontFamily: fonts.sans, fontSize: 13, color: colors.inkSoft },
  lead: { fontFamily: fonts.sans, fontSize: 15, lineHeight: 22, color: colors.inkSoft, marginTop: 8 },
  source: {
    backgroundColor: colors.surface,
    marginLeft: 10,
    borderLeftWidth: 3,
    borderLeftColor: colors.cyan,
    paddingLeft: 12,
    paddingVertical: 6,
    gap: 4,
  },
  sourceText: { fontFamily: fonts.sans, fontSize: 16, lineHeight: 23, color: colors.ink },
  meta: { fontFamily: fonts.sans, fontSize: 12, color: colors.inkMuted },
  provenance: {
    backgroundColor: colors.surface,
    marginTop: 20,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.surface,
    padding: 12,
    gap: 6,
  },
  provenanceTitle: {
    fontFamily: fonts.mono, fontSize: scale.kicker.size,
    textTransform: "uppercase",
    letterSpacing: scale.kicker.tracking,
    color: colors.inkMuted,
    marginBottom: 2,
  },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  rowLabel: { fontFamily: fonts.sans, fontSize: 13, color: colors.inkMuted },
  rowValue: { fontFamily: fonts.sans, fontSize: 13, flexShrink: 1, textAlign: "right", color: colors.ink },
  loader: { marginTop: 40 },
  error: { color: colors.danger, padding: 16 },
  footnote: { marginTop: 20, fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, color: colors.inkMuted },
});
