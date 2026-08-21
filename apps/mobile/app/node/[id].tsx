import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useCallback, useEffect, useState } from "react";

import { AtmosphericShell } from "@/components/Atmospheric";
import { Kicker, Meter, Rule } from "@/components/Marks";
import { Seal } from "@/components/Seal";
import { EvidenceRail, FieldFrame, LoadingLens, ErrorLens, ObservablePearl } from "@/components/SpatialField";
import { MotionSurface } from "@/components/MotionSurface";
import { api, type Explanation, type GraphNode, type Judgement, type ObservationResponse, type Pattern, type Theme } from "@/lib/api";
import { aboutOf, amongReadingsOf, apartSidesOf, contradictsOf, feltTowardOf, indicatesOf, regionsOfReading, travelsWithOf, weekdayShapeOf } from "@/lib/drawnFrom";
import { patternDestination } from "@/lib/patterns";
import { useSession } from "@/state/session";
import { usePreferences } from "@/state/preferences";
import { colors, fonts } from "@/theme";
import { radii } from "@tlon/design";
import { type as scale } from "@tlon/design";
import { Guide } from "@/components/Guide";
import { HEADINGS } from "@tlon/copy/headings";
import { SECTIONS, asideOf } from "@tlon/copy/sections";

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
  const userId = useSession((s) => s.userId);
  const showFindings = usePreferences((s) => s.findings);

  const explanation = useQuery({
    queryKey: ["explain", id],
    queryFn: () => api.explain(token!, id!),
    enabled: Boolean(token && id && showFindings),
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });
  const observation = useQuery({
    queryKey: ["observation", id],
    queryFn: () => api.getObservation(token!, id!),
    enabled: Boolean(token && id && !showFindings),
  });
  const patterns = useQuery({
    queryKey: ["patterns", userId],
    queryFn: () => api.listPatterns(token!),
    enabled: Boolean(token && userId && showFindings),
  });
  const neighbours = useQuery({
    queryKey: ["neighbours", id],
    queryFn: () => api.neighbours(token!, id!),
    enabled: Boolean(token && id && showFindings),
  });
  const themes = useQuery({
    queryKey: ["themes", userId],
    queryFn: () => api.listThemes(token!),
    enabled: Boolean(token && userId && showFindings),
  });

  useFocusEffect(
    useCallback(() => {
      if (token && id && showFindings) void explanation.refetch();
    }, [explanation.refetch, id, showFindings, token]),
  );

  // The auth gate in _layout redirects before this renders when signed out.
  if (!token) return null;
  if (!showFindings) {
    if (observation.isLoading) return <LoadingLens label="Loading entry…" />;
    if (observation.data) return <RawObservation observation={observation.data} />;
    return <ErrorLens label="This derived reading is hidden." />;
  }

  if (explanation.isLoading) return <LoadingLens label="Tracing provenance…" />;
  if (explanation.isError || !explanation.data) {
    return <ErrorLens label="Could not load this." onRetry={() => void explanation.refetch()} />;
  }

  const foundPatterns: Pattern[] = patterns.data ?? [];
  const foundNeighbours: GraphNode[] = neighbours.data?.neighbours ?? [];
  const among = amongReadingsOf(foundNeighbours, foundPatterns);
  const company: GraphNode[] = travelsWithOf(id!, foundNeighbours, neighbours.data?.edges ?? []);
  const aimed = feltTowardOf(id!, foundNeighbours, neighbours.data?.edges ?? []);
  const spoken = aboutOf(id!, foundNeighbours, neighbours.data?.edges ?? []);
  const hinted = indicatesOf(id!, foundNeighbours, neighbours.data?.edges ?? []);
  const tension = contradictsOf(id!, foundNeighbours, neighbours.data?.edges ?? []);
  const foundThemes: Theme[] = themes.data ?? [];
  const regions = regionsOfReading(explanation.data.node.label, foundThemes);
  const opened = foundPatterns.find((pattern) => pattern.id === id);
  const instants: string[] = explanation.data.derived_from.map(
    (entry: { captured_at: string }) => entry.captured_at,
  );
  const calendar = opened?.detector === "weekday" ? weekdayShapeOf(instants) : [];
  const apart =
    opened?.detector === "stated-vs-recorded"
      ? apartSidesOf(foundNeighbours)
      : { named: [] as GraphNode[], done: [] as GraphNode[] };
  return (
    <Body
      explanation={explanation.data}
      nodeId={id!}
      among={among}
      company={company}
      regions={regions}
      calendar={calendar}
      apart={apart}
      aimed={aimed}
      spoken={spoken}
      hinted={hinted}
      tension={tension}
    />
  );
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
  const [visibleStatus, setVisibleStatus] = useState(status);

  // Keep the server response authoritative once it changes, while allowing the
  // consequence of a tap to be visible before the explanation query is refetched.
  useEffect(() => setVisibleStatus(status), [status]);

  const judge = useMutation({
    mutationFn: (next: Judgement) => api.judgeNode(token!, nodeId, next),
    onMutate: (next) => {
      const previousStatus = visibleStatus;
      setVisibleStatus(next);
      return { previousStatus };
    },
    onError: (_error, _next, context) => {
      // Never leave an optimistic withdrawal visible after the server rejected it.
      if (context) setVisibleStatus(context.previousStatus);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["explain", nodeId], refetchType: "active" });
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
    onSettled: () => {
      // Success and failure both reconcile against the authority, including a
      // withdrawal that raced with a previous judgement.
      void client.invalidateQueries({ queryKey: ["explain", nodeId], refetchType: "active" });
    },
  });
  const choose = (next: Judgement) => {
    if (judge.isPending) return;
    judge.mutate(visibleStatus === next ? "hypothesis" : next);
  };

  return (
    <View style={styles.verdict}>
      <Text style={styles.verdictAsk}>Does this match how it was?</Text>
      <View style={styles.verdictRow}>
        <MotionSurface
          style={[styles.choice, visibleStatus === "user_confirmed" && styles.choiceYes]}
          onPress={() => choose("user_confirmed")}
          accessibilityRole="button"
          accessibilityState={{ selected: visibleStatus === "user_confirmed" }}
        >
          <Text
            style={[
              styles.choiceLabel,
              visibleStatus === "user_confirmed" && styles.choiceLabelOn,
            ]}
          >
            Yes
          </Text>
        </MotionSurface>
        <MotionSurface
          style={[styles.choice, visibleStatus === "user_rejected" && styles.choiceNo]}
          onPress={() => choose("user_rejected")}
          accessibilityRole="button"
          accessibilityState={{ selected: visibleStatus === "user_rejected" }}
        >
          <Text
            style={[
              styles.choiceLabel,
              visibleStatus === "user_rejected" && styles.choiceLabelOn,
            ]}
          >
            Not really
          </Text>
        </MotionSurface>
      </View>
      {visibleStatus === "user_rejected" && (
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

function RawObservation({ observation }: { observation: ObservationResponse }) {
  return (
    <AtmosphericShell variant="secondary">
      <ScrollView contentContainerStyle={styles.screen}>
        <View style={styles.actHead}>
          <Seal id={observation.id} size={34} />
          <Kicker>{HEADINGS.node.kicker}</Kicker>
        </View>
        <Text style={styles.rawContent} accessibilityLabel={`Journal entry: ${observation.content}`}>
          {observation.content}
        </Text>
        <Text style={styles.meta}>
          {new Date(observation.captured_at).toLocaleString()} · {observation.source}
        </Text>
      </ScrollView>
    </AtmosphericShell>
  );
}

function Body({
  explanation,
  nodeId,
  among,
  company,
  regions,
  calendar,
  apart,
  aimed,
  spoken,
  hinted,
  tension,
}: {
  explanation: Explanation;
  nodeId: string;
  among: Pattern[];
  company: GraphNode[];
  regions: Theme[];
  calendar: { weekday: string; count: number }[];
  apart: { named: GraphNode[]; done: GraphNode[] };
  aimed: { toward: GraphNode[]; from: GraphNode[] };
  spoken: { about: GraphNode[]; aboutThis: GraphNode[] };
  hinted: { hints: GraphNode[]; hinted: GraphNode[] };
  tension: { against: GraphNode[]; againstThis: GraphNode[] };
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

  const router = useRouter();
  const confidence = node.confidence ?? 0;
  const tentative = confidence < 0.5;
  const peaked = Math.max(0, ...calendar.map((day) => day.count));

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

      {(apart.named.length > 0 || apart.done.length > 0) && (
        <>
          <View style={styles.sectionRow}>
            <Kicker heading>{SECTIONS.apart.title}</Kicker>
            <View style={styles.ruleFill}>
              <Rule />
            </View>
            <Text style={styles.meta}>{asideOf("apart", true)}</Text>
          </View>
          {apart.named.map((reading) => (
            <MotionSurface
              key={reading.id}
              onPress={() => router.push(`/node/${reading.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`${reading.label} — named, open this reading`}
            >
              <Text style={styles.sourceText}>{reading.label}</Text>
              <Text style={styles.meta}>{reading.kind.toLowerCase()} · named</Text>
            </MotionSurface>
          ))}
          {apart.done.map((reading) => (
            <MotionSurface
              key={reading.id}
              onPress={() => router.push(`/node/${reading.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`${reading.label} — recorded, open this reading`}
            >
              <Text style={styles.sourceText}>{reading.label}</Text>
              <Text style={styles.meta}>{reading.kind.toLowerCase()} · recorded</Text>
            </MotionSurface>
          ))}
        </>
      )}

      {peaked > 0 && (
        <>
          <View style={styles.sectionRow}>
            <Kicker heading>{SECTIONS.calendar.title}</Kicker>
            <View style={styles.ruleFill}>
              <Rule />
            </View>
            <Text style={styles.meta}>{asideOf("calendar", true)}</Text>
          </View>
          <View style={styles.calendar}>
            {calendar.map((day) => (
              <Text
                key={day.weekday}
                style={[styles.calendarDay, day.count === peaked && styles.calendarPeak]}
              >
                {day.weekday} {day.count}
              </Text>
            ))}
          </View>
        </>
      )}

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

      {aimed.toward.length > 0 && (
        <>
          <View style={styles.sectionRow}>
            <Kicker heading>{SECTIONS.toward.title}</Kicker>
            <View style={styles.ruleFill}>
              <Rule />
            </View>
            <Text style={styles.meta}>{asideOf("toward", true)}</Text>
          </View>
          {aimed.toward.map((reading) => (
            <MotionSurface
              key={reading.id}
              onPress={() => router.push(`/node/${reading.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`${reading.label} — felt toward, open this reading`}
            >
              <Text style={styles.sourceText}>{reading.label}</Text>
              <Text style={styles.meta}>{reading.kind.toLowerCase()} · a direction, not a reason</Text>
            </MotionSurface>
          ))}
        </>
      )}

      {aimed.from.length > 0 && (
        <>
          <View style={styles.sectionRow}>
            <Kicker heading>{SECTIONS.towardThis.title}</Kicker>
            <View style={styles.ruleFill}>
              <Rule />
            </View>
            <Text style={styles.meta}>{asideOf("towardThis", true)}</Text>
          </View>
          {aimed.from.map((reading) => (
            <MotionSurface
              key={reading.id}
              onPress={() => router.push(`/node/${reading.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`${reading.label} — felt toward this, open this reading`}
            >
              <Text style={styles.sourceText}>{reading.label}</Text>
              <Text style={styles.meta}>{reading.kind.toLowerCase()} · a direction, not a reason</Text>
            </MotionSurface>
          ))}
        </>
      )}

      {spoken.about.length > 0 && (
        <>
          <View style={styles.sectionRow}>
            <Kicker heading>{SECTIONS.about.title}</Kicker>
            <View style={styles.ruleFill}>
              <Rule />
            </View>
            <Text style={styles.meta}>{asideOf("about", true)}</Text>
          </View>
          {spoken.about.map((reading) => (
            <MotionSurface
              key={reading.id}
              onPress={() => router.push(`/node/${reading.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`${reading.label} — about, open this reading`}
            >
              <Text style={styles.sourceText}>{reading.label}</Text>
              <Text style={styles.meta}>{reading.kind.toLowerCase()} · subject, not a verdict</Text>
            </MotionSurface>
          ))}
        </>
      )}

      {spoken.aboutThis.length > 0 && (
        <>
          <View style={styles.sectionRow}>
            <Kicker heading>{SECTIONS.aboutThis.title}</Kicker>
            <View style={styles.ruleFill}>
              <Rule />
            </View>
            <Text style={styles.meta}>{asideOf("aboutThis", true)}</Text>
          </View>
          {spoken.aboutThis.map((reading) => (
            <MotionSurface
              key={reading.id}
              onPress={() => router.push(`/node/${reading.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`${reading.label} — about this, open this reading`}
            >
              <Text style={styles.sourceText}>{reading.label}</Text>
              <Text style={styles.meta}>{reading.kind.toLowerCase()} · subject, not a verdict</Text>
            </MotionSurface>
          ))}
        </>
      )}

      {hinted.hints.length > 0 && (
        <>
          <View style={styles.sectionRow}>
            <Kicker heading>{SECTIONS.hints.title}</Kicker>
            <View style={styles.ruleFill}>
              <Rule />
            </View>
            <Text style={styles.meta}>{asideOf("hints", true)}</Text>
          </View>
          {hinted.hints.map((reading) => (
            <MotionSurface
              key={reading.id}
              onPress={() => router.push(`/node/${reading.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`${reading.label} — hinted at, open this reading`}
            >
              <Text style={styles.sourceText}>{reading.label}</Text>
              <Text style={styles.meta}>{reading.kind.toLowerCase()} · a hint, not a cause</Text>
            </MotionSurface>
          ))}
        </>
      )}

      {hinted.hinted.length > 0 && (
        <>
          <View style={styles.sectionRow}>
            <Kicker heading>{SECTIONS.hinted.title}</Kicker>
            <View style={styles.ruleFill}>
              <Rule />
            </View>
            <Text style={styles.meta}>{asideOf("hinted", true)}</Text>
          </View>
          {hinted.hinted.map((reading) => (
            <MotionSurface
              key={reading.id}
              onPress={() => router.push(`/node/${reading.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`${reading.label} — hints at this, open this reading`}
            >
              <Text style={styles.sourceText}>{reading.label}</Text>
              <Text style={styles.meta}>{reading.kind.toLowerCase()} · a hint, not a cause</Text>
            </MotionSurface>
          ))}
        </>
      )}

      {tension.against.length > 0 && (
        <>
          <View style={styles.sectionRow}>
            <Kicker heading>{SECTIONS.against.title}</Kicker>
            <View style={styles.ruleFill}>
              <Rule />
            </View>
            <Text style={styles.meta}>{asideOf("against", true)}</Text>
          </View>
          {tension.against.map((reading) => (
            <MotionSurface
              key={reading.id}
              onPress={() => router.push(`/node/${reading.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`${reading.label} — sits against, open this reading`}
            >
              <Text style={styles.sourceText}>{reading.label}</Text>
              <Text style={styles.meta}>{reading.kind.toLowerCase()} · tension, not a verdict</Text>
            </MotionSurface>
          ))}
        </>
      )}

      {tension.againstThis.length > 0 && (
        <>
          <View style={styles.sectionRow}>
            <Kicker heading>{SECTIONS.againstThis.title}</Kicker>
            <View style={styles.ruleFill}>
              <Rule />
            </View>
            <Text style={styles.meta}>{asideOf("againstThis", true)}</Text>
          </View>
          {tension.againstThis.map((reading) => (
            <MotionSurface
              key={reading.id}
              onPress={() => router.push(`/node/${reading.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`${reading.label} — sits against this, open this reading`}
            >
              <Text style={styles.sourceText}>{reading.label}</Text>
              <Text style={styles.meta}>{reading.kind.toLowerCase()} · tension, not a verdict</Text>
            </MotionSurface>
          ))}
        </>
      )}

      {among.length > 0 && (
        <>
          <View style={styles.sectionRow}>
            <Kicker heading>{SECTIONS.among.title}</Kicker>
            <View style={styles.ruleFill}>
              <Rule />
            </View>
            <Text style={styles.meta}>{asideOf("among", true)}</Text>
          </View>
          {among.map((pattern) => (
            <MotionSurface
              key={pattern.id}
              onPress={() => router.push(patternDestination(pattern).href)}
              accessibilityRole="button"
              accessibilityLabel={`${pattern.label} — open this pattern`}
            >
              <Text style={styles.sourceText}>{pattern.label.split(" · ")[0] ?? pattern.label}</Text>
              <Text style={styles.meta}>{patternDestination(pattern).label}</Text>
            </MotionSurface>
          ))}
        </>
      )}

      {company.length > 0 && (
        <>
          <View style={styles.sectionRow}>
            <Kicker heading>{SECTIONS.travels.title}</Kicker>
            <View style={styles.ruleFill}>
              <Rule />
            </View>
            <Text style={styles.meta}>{asideOf("travels", true)}</Text>
          </View>
          {company.map((reading) => (
            <MotionSurface
              key={reading.id}
              onPress={() => router.push(`/node/${reading.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`${reading.label} — open this reading`}
            >
              <Text style={styles.sourceText}>{reading.label}</Text>
              <Text style={styles.meta}>{reading.kind.toLowerCase()} · together, not because</Text>
            </MotionSurface>
          ))}
        </>
      )}

      {regions.length > 0 && (
        <>
          <View style={styles.sectionRow}>
            <Kicker heading>{SECTIONS.inRegion.title}</Kicker>
            <View style={styles.ruleFill}>
              <Rule />
            </View>
            <Text style={styles.meta}>{asideOf("inRegion", true)}</Text>
          </View>
          {regions.map((theme) => (
            <MotionSurface
              key={theme.id}
              onPress={() => router.push(`/theme/${theme.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`${theme.label} — open this region`}
            >
              <Text style={styles.sourceText}>{theme.label}</Text>
              <Text style={styles.meta}>{theme.member_count} things · the region →</Text>
            </MotionSurface>
          ))}
        </>
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
  calendar: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 8 },
  calendarDay: { fontFamily: fonts.mono, fontSize: 12, color: colors.inkMuted },
  calendarPeak: { color: colors.ink },
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
  rawContent: { fontFamily: fonts.sans, fontSize: 22, lineHeight: 31, color: colors.ink, marginTop: 16 },
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
