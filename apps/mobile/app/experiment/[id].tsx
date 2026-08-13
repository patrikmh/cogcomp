import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { AtmosphericShell } from "@/components/Atmospheric";
import { MotionSurface } from "@/components/MotionSurface";
import { ApiError, api, type Experiment, type Pattern, type ObservationResponse } from "@/lib/api";
import { experimentQueryKeys, eligiblePattern, assessmentLabel } from "@/lib/experiment";
import { uuidv7 } from "@/lib/ids";
import { useSession } from "@/state/session";
import { colors, fonts } from "@/theme";
import { radii } from "@tlon/design";
import { type as scale } from "@tlon/design";
import { Arc } from "@/components/Arc";
import { SECTIONS } from "@tlon/copy/sections";

const assessments: NonNullable<Experiment["outcome"]>["assessment"][] = ["met", "partly_met", "not_met", "unclear"];

export default function ExperimentDetail() {
  const token = useSession((s) => s.token);
  const userId = useSession((s) => s.userId);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const client = useQueryClient();
  const [observation, setObservation] = useState("");
  const [pendingObservationId, setPendingObservationId] = useState<string | null>(null);
  const [assessment, setAssessment] = useState<NonNullable<Experiment["outcome"]>["assessment"]>("unclear");
  const [finalId, setFinalId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const query = useQuery({ queryKey: experimentQueryKeys.detail(userId!, id!), queryFn: () => api.experiment(token!, id!), enabled: Boolean(token && userId && id) });
  const refresh = () => { void query.refetch(); };
  const updateAfterMutation = (updated: Experiment) => {
    client.setQueryData(experimentQueryKeys.detail(userId!, id!), updated);
    void client.invalidateQueries({ queryKey: experimentQueryKeys.all(userId!) });
    void client.invalidateQueries({ queryKey: ["observations", userId] });
    void client.invalidateQueries({ queryKey: ["summary"] });
    void client.invalidateQueries({ queryKey: ["patterns", userId] });
    void client.invalidateQueries({ queryKey: ["graph", userId] });
  };
  const transition = useMutation({ mutationFn: (target: "start" | "pause" | "resume" | "cancel") => api.experimentTransition(token!, id!, target, query.data!.revision), onSuccess: updateAfterMutation, onError: (error) => { if (error instanceof ApiError && error.status === 409) refresh(); } });
  const link = useMutation({ mutationFn: (nodeId: string) => api.linkExperimentPattern(token!, id!, nodeId, query.data!.revision), onSuccess: updateAfterMutation, onError: (error) => { if (error instanceof ApiError && error.status === 409) refresh(); } });
  const attach = useMutation({ mutationFn: (observationId: string) => api.attachExperimentCheckin(token!, id!, observationId, query.data!.revision), onSuccess: (updated) => { setPendingObservationId(null); setObservation(""); updateAfterMutation(updated); }, onError: (error) => { if (error instanceof ApiError && error.status === 409) refresh(); } });
  const saveObservation = useMutation({ mutationFn: async () => { const observationId = pendingObservationId ?? uuidv7(); if (!pendingObservationId) await api.createObservation(token!, { id: observationId, content: observation.trim(), source: "text", capturedAt: new Date().toISOString() }); return observationId; }, onSuccess: (observationId) => { setPendingObservationId(observationId); attach.mutate(observationId); }, onError: (error) => { if (error instanceof ApiError && error.status === 409) refresh(); } });
  const complete = useMutation({ mutationFn: () => api.experimentTransition(token!, id!, "complete", query.data!.revision, assessment, finalId!), onSuccess: updateAfterMutation, onError: (error) => { if (error instanceof ApiError && error.status === 409) refresh(); } });
  const remove = useMutation({ mutationFn: () => api.deleteExperiment(token!, id!, query.data!.revision), onSuccess: () => { client.setQueryData(experimentQueryKeys.detail(userId!, id!), undefined); void client.invalidateQueries({ queryKey: experimentQueryKeys.all(userId!) }); setConfirmDelete(false); router.replace("/experiments"); }, onError: (error) => { if (error instanceof ApiError && error.status === 409) refresh(); } });
  const patterns = useQuery({ queryKey: ["patterns", userId], queryFn: () => api.listPatterns(token!), enabled: Boolean(token && userId && query.data?.state === "draft") });
  const experiment = query.data;
  if (!token || !userId) return null;
  if (query.isLoading) return <AtmosphericShell><ActivityIndicator accessibilityLabel="Loading experiment" color={colors.cyan} /></AtmosphericShell>;
  if (query.isError || !experiment) return <AtmosphericShell><View style={styles.screen}><Text accessibilityRole="alert" style={styles.error}>Could not load this experiment.</Text><MotionSurface onPress={refresh}><Text style={styles.link}>Reload</Text></MotionSurface></View></AtmosphericShell>;
  const mutationError = [transition, link, attach, saveObservation, complete, remove].find((m) => m.isError)?.error;
  return <AtmosphericShell variant="secondary"><ScrollView contentContainerStyle={styles.screen} accessibilityLabel="Experiment detail">
    <Text style={styles.kicker}>EXPERIMENT</Text><Text style={styles.title}>{experiment.title}</Text>
    {/* The state as a pill, coloured by what it is: live while it runs, ink
        once it is over, dotted while it is still a draft — the design's
        `.x-state`. It was a word appended to the kicker, where it read as part
        of the screen's name rather than as the thing that changes. */}
    <View style={styles.stateRow}>
      <Text
        style={[
          styles.state,
          experiment.state === "active" && styles.stateRunning,
          experiment.state === "completed" && styles.stateDone,
          experiment.state === "draft" && styles.stateDraft,
        ]}
      >
        {experiment.state}
      </Text>
      <Text style={styles.stateMeta}>
        {experiment.checkins?.length ?? 0} of {experiment.duration_days} check-ins
      </Text>
    </View>
    {/* The arc at the size the design gives it here: on this screen it is the
        subject rather than a line in a list. */}
    <Arc
      id={experiment.id}
      days={experiment.duration_days}
      checkins={experiment.checkins?.length ?? 0}
      state={experiment.state}
      big
    />
    <Text style={styles.body}>Optional self-observation, not diagnosis or medical treatment.</Text>
    {/* The design groups these under a heading rather than listing them bare
        under the title: the hypothesis, the action and the criterion are one
        thought — why you started — and reading them as three loose sentences
        loses that they were written together. */}
    <Text style={styles.heading}>{SECTIONS.reason.title}</Text><Text style={styles.body}>{experiment.hypothesis}</Text><Text style={styles.body}>Action: {experiment.action}</Text><Text style={styles.body}>Success criterion: {experiment.success_criterion}</Text><Text style={styles.meta}>From {experiment.start_date} · {experiment.duration_days} days · {experiment.timezone} · {experiment.cadence}</Text>
    {mutationError && <View accessibilityRole="alert"><Text style={styles.error}>{mutationError instanceof ApiError && mutationError.status === 409 ? "This changed elsewhere. The latest version was reloaded; try again." : "That action could not be saved."}</Text><MotionSurface onPress={refresh}><Text style={styles.link}>Reload latest</Text></MotionSurface></View>}
    <View style={styles.actions}>{experiment.state === "draft" && <Button label="Start" onPress={() => transition.mutate("start")} disabled={transition.isPending} />}{experiment.state === "active" && <Button label="Pause" onPress={() => transition.mutate("pause")} disabled={transition.isPending} />}{experiment.state === "paused" && <Button label="Resume" onPress={() => transition.mutate("resume")} disabled={transition.isPending} />}{(experiment.state === "draft" || experiment.state === "active" || experiment.state === "paused") && <Button label="Cancel" onPress={() => transition.mutate("cancel")} disabled={transition.isPending} />}</View>
    {experiment.links && experiment.links.length > 0 && <View style={styles.section}><Text style={styles.heading}>Linked evidence</Text>{experiment.links.map((linkItem: NonNullable<Experiment["links"]>[number]) => linkItem.availability === false ? <Text key={linkItem.node_id} style={styles.meta}>Unavailable evidence: {linkItem.label}</Text> : <MotionSurface key={linkItem.node_id} accessibilityRole="button" accessibilityLabel={`Explain linked evidence ${linkItem.label}`} onPress={() => router.push(`/node/${linkItem.node_id}`)}><Text style={styles.link}>{linkItem.label} · Explain this evidence →</Text></MotionSurface>)}</View>}
    {experiment.state === "draft" && <View style={styles.section}><Text style={styles.heading}>Link a live pattern before starting</Text>{patterns.isLoading && <ActivityIndicator accessibilityLabel="Loading eligible patterns" color={colors.cyan} />}{patterns.data?.filter(eligiblePattern).map((pattern: Pattern) => <Pressable key={pattern.id} accessibilityRole="button" accessibilityLabel={`Link pattern ${pattern.label}`} disabled={link.isPending} onPress={() => link.mutate(pattern.id)} style={styles.pattern}><Text style={styles.body}>{pattern.label}</Text><Text style={styles.meta}>Live pattern · {pattern.occurrences} occurrences</Text></Pressable>)}{patterns.data?.filter(eligiblePattern).length === 0 && <Text style={styles.meta}>No live patterns are eligible yet.</Text>}</View>}
    {experiment.state === "active" && <View style={styles.section}><Text style={styles.heading}>{SECTIONS.checkins.title}</Text><Text style={styles.aside}>{SECTIONS.checkins.aside}</Text><Text style={styles.meta}>Write an ordinary Journal observation. It is saved first, then attached once.</Text><TextInput accessibilityLabel="Check-in observation" multiline value={observation} onChangeText={setObservation} editable={!saveObservation.isPending && !attach.isPending} placeholder="What did you notice?" placeholderTextColor={colors.inkMuted} style={[styles.input, pendingObservationId && styles.pending]} />{pendingObservationId && attach.isError && <Text accessibilityRole="alert" style={styles.error}>Saved but not attached. Retry attachment without duplicating the observation.</Text>}<Button label={attach.isPending ? "Attaching…" : pendingObservationId ? "Retry attachment" : "Save check-in"} onPress={() => pendingObservationId ? attach.mutate(pendingObservationId) : saveObservation.mutate()} disabled={saveObservation.isPending || attach.isPending || (!pendingObservationId && !observation.trim())} />{experiment.checkins?.map((checkin: ObservationResponse) => <Pressable key={checkin.id} accessibilityRole="radio" accessibilityState={{ selected: finalId === checkin.id }} onPress={() => setFinalId(checkin.id)} style={styles.checkin}><Text style={styles.body}>{checkin.content}</Text><Text style={styles.meta}>{finalId === checkin.id ? "Selected final check-in" : "Select as final check-in"}</Text></Pressable>)}</View>}
    {experiment.state === "active" && <View style={styles.section}><Text style={styles.heading}>{SECTIONS.finish.title}</Text><Text style={styles.aside}>{SECTIONS.finish.aside}</Text><View style={styles.choices}>{assessments.map((value) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: assessment === value }} onPress={() => setAssessment(value)} style={[styles.choice, assessment === value && styles.selected]}><Text style={styles.body}>{assessmentLabel(value)}</Text></Pressable>)}</View><Button label="Complete experiment" onPress={() => complete.mutate()} disabled={!finalId || complete.isPending} /></View>}
    {experiment.outcome && <View style={styles.outcome}><Text style={styles.heading}>Outcome</Text><Text style={styles.body}>{assessmentLabel(experiment.outcome.assessment)}</Text><Text style={styles.meta}>Final check-in selected by you. No score or interpretation.</Text></View>}
    <Button label="Delete experiment" onPress={() => setConfirmDelete(true)} disabled={remove.isPending} />
    {confirmDelete && <View accessibilityRole="alert" style={styles.confirmation}><Text style={styles.heading}>Delete experiment?</Text><Text style={styles.meta}>This removes it from your experiment list.</Text><View style={styles.actions}><Button label="Keep" onPress={() => setConfirmDelete(false)} /><Button label="Delete" accessibilityLabel="Confirm delete experiment" onPress={() => remove.mutate()} disabled={remove.isPending} /></View></View>}
  </ScrollView></AtmosphericShell>;
}

function Button({ label, accessibilityLabel, onPress, disabled }: { label: string; accessibilityLabel?: string; onPress: () => void; disabled?: boolean }) { return <MotionSurface accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled }} onPress={onPress} disabled={disabled} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></MotionSurface>; }
const styles = StyleSheet.create({
  stateRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10 },
  state: {
    color: colors.inkMuted,
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 2,
  },
  stateRunning: { color: colors.cyan, borderColor: colors.cyan },
  stateDone: { color: colors.ink, borderColor: colors.lineStrong },
  stateDraft: { color: colors.inkMuted, borderStyle: "dotted" },
  stateMeta: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: scale.meta.size },
  aside: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: scale.meta.size }, screen: { padding: 20, gap: 14, paddingBottom: 48 }, kicker: { color: colors.cyan, fontFamily: fonts.sans, fontSize: 11, fontWeight: "700", letterSpacing: 1.4 }, title: { color: colors.ink, fontSize: scale.title.size, fontWeight: "700" }, body: { color: colors.ink, fontSize: 15, lineHeight: 22 }, meta: { color: colors.inkMuted, lineHeight: 20 }, actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" }, button: { backgroundColor: colors.cyan, borderRadius: radii.surface, padding: 13, alignItems: "center" }, buttonText: { color: colors.room, fontWeight: "700" }, disabled: { opacity: 0.4 }, section: { gap: 9, marginTop: 8 }, heading: { color: colors.ink, fontWeight: "700", fontSize: 17 }, input: { minHeight: 90, padding: 12, borderRadius: radii.surface, backgroundColor: colors.surface, color: colors.ink, textAlignVertical: "top" }, pending: { borderWidth: 1, borderColor: colors.cyan }, pattern: { padding: 12, borderRadius: radii.surface, backgroundColor: colors.surface }, checkin: { padding: 12, borderRadius: radii.surface, borderWidth: 1, borderColor: colors.lineStrong, gap: 4 }, choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, choice: { padding: 10, borderRadius: radii.surface, borderWidth: 1, borderColor: colors.lineStrong }, selected: { borderColor: colors.cyan }, confirmation: { padding: 14, borderRadius: radii.surface, borderWidth: 1, borderColor: colors.lineStrong, gap: 8 }, outcome: { padding: 14, borderRadius: radii.surface, backgroundColor: colors.surface, gap: 6 }, error: { color: colors.danger }, link: { color: colors.cyan, fontWeight: "700", paddingVertical: 8 } });
