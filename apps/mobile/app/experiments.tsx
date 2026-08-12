import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { AtmosphericShell } from "@/components/Atmospheric";
import { MotionSurface } from "@/components/MotionSurface";
import { ApiError, api, type Experiment } from "@/lib/api";
import { localDateToday, localTimezone, validDuration, experimentQueryKeys } from "@/lib/experiment";
import { uuidv7 } from "@/lib/ids";
import { useSession } from "@/state/session";
import { colors, fonts } from "@/theme";
import { radii } from "@tlon/design";
import { type as scale } from "@tlon/design";

const cadences: Experiment["cadence"][] = ["daily", "weekly", "end_only"];
const cadenceLabel = { daily: "Daily", weekly: "Weekly", end_only: "At the end" };

export default function ExperimentsScreen() {
  const token = useSession((s) => s.token);
  const userId = useSession((s) => s.userId);
  const router = useRouter();
  const client = useQueryClient();
  const [title, setTitle] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [action, setAction] = useState("");
  const [criterion, setCriterion] = useState("");
  const [startDate, setStartDate] = useState(localDateToday());
  const [duration, setDuration] = useState("7");
  const [cadence, setCadence] = useState<Experiment["cadence"]>("daily");
  const experiments = useQuery({ queryKey: experimentQueryKeys.all(userId!), queryFn: () => api.listExperiments(token!), enabled: Boolean(token && userId) });
  const create = useMutation({
    mutationFn: () => api.createExperiment(token!, { id: uuidv7(), title: title.trim(), hypothesis: hypothesis.trim(), action: action.trim(), success_criterion: criterion.trim(), start_date: startDate, duration_days: Number(duration), timezone: localTimezone(), cadence }),
    onSuccess: (created) => { setTitle(""); setHypothesis(""); setAction(""); setCriterion(""); void client.invalidateQueries({ queryKey: experimentQueryKeys.all(userId!) }); router.push(`/experiment/${created.id}`); },
  });
  const valid = Boolean(title.trim() && hypothesis.trim().toLowerCase().startsWith("i wonder whether") && action.trim() && criterion.trim() && /^\d{4}-\d{2}-\d{2}$/.test(startDate) && validDuration(duration));
  if (!token || !userId) return null;
  return <AtmosphericShell variant="secondary"><ScrollView contentContainerStyle={styles.screen} accessibilityLabel="Experiments">
    <Text style={styles.kicker}>USER-AUTHORED EXPERIMENTS</Text>
    <Text style={styles.title}>Try a question, in your own words.</Text>
    <Text style={styles.intro}>Optional self-observation, not diagnosis or medical treatment. You choose what to record.</Text>
    <TextInput accessibilityLabel="Title" placeholder="Title" placeholderTextColor={colors.inkMuted} value={title} onChangeText={setTitle} style={styles.input} />
    <Text style={styles.hint}>Frame your question in first person. We will not rewrite it.</Text>
    <TextInput accessibilityLabel="Hypothesis" placeholder="I wonder whether…" placeholderTextColor={colors.inkMuted} value={hypothesis} onChangeText={setHypothesis} style={styles.input} />
    <TextInput accessibilityLabel="Action" placeholder="Action I will take" placeholderTextColor={colors.inkMuted} value={action} onChangeText={setAction} style={styles.input} />
    <TextInput accessibilityLabel="Success criterion" placeholder="What would count as useful to notice?" placeholderTextColor={colors.inkMuted} value={criterion} onChangeText={setCriterion} style={styles.input} />
    <TextInput accessibilityLabel="Start date" placeholder="YYYY-MM-DD" placeholderTextColor={colors.inkMuted} value={startDate} onChangeText={setStartDate} style={styles.input} />
    <TextInput accessibilityLabel="Duration in days" keyboardType="number-pad" placeholder="1–42 days" placeholderTextColor={colors.inkMuted} value={duration} onChangeText={setDuration} style={styles.input} />
    <Text style={styles.label}>Cadence</Text><View style={styles.choices}>{cadences.map((value) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: cadence === value }} onPress={() => setCadence(value)} style={[styles.choice, cadence === value && styles.choiceSelected]}><Text style={styles.choiceText}>{cadenceLabel[value]}</Text></Pressable>)}</View>
    <MotionSurface accessibilityRole="button" accessibilityState={{ disabled: create.isPending || !valid }} disabled={create.isPending || !valid} onPress={() => create.mutate()} style={[styles.button, (!valid || create.isPending) && styles.disabled]}><Text style={styles.buttonText}>{create.isPending ? "Saving…" : "Save draft"}</Text></MotionSurface>
    {create.isError && <Text accessibilityRole="alert" style={styles.error}>{create.error instanceof ApiError ? create.error.message : "Could not save this draft. Try again."}</Text>}
    <Text style={styles.section}>Your drafts and records</Text>
    {experiments.isLoading && <ActivityIndicator accessibilityLabel="Loading experiments" color={colors.cyan} />}
    {experiments.isError && <View><Text accessibilityRole="alert" style={styles.error}>Could not load experiments.</Text><MotionSurface onPress={() => void experiments.refetch()}><Text style={styles.link}>Try again</Text></MotionSurface></View>}
    {!experiments.isLoading && !experiments.isError && experiments.data?.experiments.length === 0 && <Text style={styles.intro}>No experiments yet.</Text>}
    {experiments.data?.experiments.map((experiment: Experiment) => <MotionSurface key={experiment.id} accessibilityRole="button" accessibilityLabel={`Open experiment ${experiment.title}`} onPress={() => router.push(`/experiment/${experiment.id}`)} style={styles.card}><Text style={styles.cardTitle}>{experiment.title}</Text><Text style={styles.meta}>{experiment.state} · {experiment.duration_days} days · {cadenceLabel[experiment.cadence]}</Text></MotionSurface>)}
  </ScrollView></AtmosphericShell>;
}

const styles = StyleSheet.create({ screen: { padding: 20, gap: 14, backgroundColor: colors.room, paddingBottom: 48 }, kicker: { color: colors.cyan, fontFamily: fonts.sans, fontSize: 11, fontWeight: "700", letterSpacing: 1.5 }, title: { color: colors.ink, fontSize: scale.title.size, fontWeight: "700" }, intro: { color: colors.inkMuted, lineHeight: 21 }, hint: { color: colors.inkMuted, fontSize: 12 }, input: { backgroundColor: colors.surface, color: colors.ink, borderRadius: radii.surface, padding: 14, minHeight: 48 }, label: { color: colors.ink, fontWeight: "700" }, choices: { flexDirection: "row", gap: 8, flexWrap: "wrap" }, choice: { borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radii.surface, padding: 12 }, choiceSelected: { borderColor: colors.cyan, backgroundColor: colors.surface }, choiceText: { color: colors.ink }, button: { backgroundColor: colors.cyan, padding: 15, borderRadius: radii.surface, alignItems: "center" }, disabled: { opacity: 0.4 }, buttonText: { color: colors.room, fontWeight: "700" }, error: { color: colors.danger }, section: { color: colors.ink, fontWeight: "700", marginTop: 14 }, card: { backgroundColor: colors.surface, padding: 16, borderRadius: radii.surface, gap: 6 }, cardTitle: { color: colors.ink, fontSize: 17, fontWeight: "700" }, meta: { color: colors.inkMuted }, link: { color: colors.cyan, paddingVertical: 10 } });
