import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { AtmosphericShell } from "@/components/Atmospheric";
import { MotionSurface } from "@/components/MotionSurface";
import { Seal } from "@/components/Seal";
import { ApiError, api, type Experiment } from "@/lib/api";
import { localDateToday, localTimezone, validDuration, experimentQueryKeys } from "@/lib/experiment";
import { uuidv7 } from "@/lib/ids";
import { useSession } from "@/state/session";
import { colors, fonts } from "@/theme";
import { radii } from "@tlon/design";
import { type as scale } from "@tlon/design";
import { Arc } from "@/components/Arc";
import { HEADINGS } from "@tlon/copy/headings";
import { SECTIONS } from "@tlon/copy/sections";

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
  // Running first, then what is paused or unstarted, then what is finished —
  // the design's order, which is also the order of what needs attention. The
  // design calls a running arc "running"; this app's state for it is "active",
  // and the two vocabularies are mapped here rather than assumed to match.
  const order: Record<string, number> = { active: 0, paused: 1, draft: 2, completed: 3, cancelled: 4 };
  const all = [...(experiments.data?.experiments ?? [])].sort(
    (a: Experiment, b: Experiment) => (order[a.state] ?? 9) - (order[b.state] ?? 9),
  );
  const running = all.filter((x: Experiment) => x.state === "active").length;
  const completed = all.filter((x: Experiment) => x.state === "completed").length;
  if (!token || !userId) return null;
  return <AtmosphericShell variant="secondary"><ScrollView contentContainerStyle={styles.screen} accessibilityLabel="Experiments">
    {/* What you already have comes before the form to add more. This screen
        opened on six empty fields, so the arcs someone was actually running
        were below the fold of a page asking them to start another. */}
    <Text style={styles.kicker}>{HEADINGS.experiments.kicker}</Text>
    <Text style={styles.title}>{HEADINGS.experiments.title}</Text>
    <Text style={styles.tally}>
      {/* The second sentence is the design's and the desktop client already carries
          it. On a screen about things someone chose to try, saying that nothing
          here was proposed or scored for them is the whole promise — and this
          client had dropped exactly that half. */}
      {`${all.length} ${all.length === 1 ? "experiment" : "experiments"} · ${running} running · ${completed} completed — you judge them, the app doesn't. Nothing here is proposed, scored, or judged for you.`}
    </Text>
    <Text style={styles.intro}>Optional self-observation, not diagnosis or medical treatment. You choose what to record.</Text>

    <View style={styles.sectionRow}>
      <Text style={styles.kicker}>{SECTIONS.arcs.title}</Text>
      <View style={styles.ruleFill}><View style={styles.rule} /></View>
      <Text style={styles.aside}>{SECTIONS.arcs.aside}</Text>
    </View>
    {experiments.isLoading && <ActivityIndicator accessibilityLabel="Loading experiments" color={colors.cyan} />}
    {experiments.isError && <View><Text accessibilityRole="alert" style={styles.error}>Could not load experiments.</Text><MotionSurface onPress={() => void experiments.refetch()}><Text style={styles.link}>Try again</Text></MotionSurface></View>}
    {!experiments.isLoading && !experiments.isError && all.length === 0 && <Text style={styles.intro}>Nothing started yet. An experiment is a question you decided to try.</Text>}
    {all.map((experiment: Experiment) => <MotionSurface key={experiment.id} accessibilityRole="button" accessibilityLabel={`Open experiment ${experiment.title}`} onPress={() => router.push(`/experiment/${experiment.id}`)} style={styles.card}><Seal id={experiment.id} size={28} stamp /><View style={styles.cardBody}><Text style={styles.cardTitle}>{experiment.title}</Text><Text style={styles.meta}>{experiment.state} · {experiment.checkins?.length ?? 0} of {experiment.duration_days} check-ins · {cadenceLabel[experiment.cadence]}</Text>
      {/* The arc: one cell per day of the experiment, lit on the days it was
          checked in. The list said how long an experiment runs and never how it
          is going, which is the one thing you open this screen to see. */}
      <Arc id={experiment.id} days={experiment.duration_days} checkins={experiment.checkins?.length ?? 0} state={experiment.state} /></View></MotionSurface>)}

    <View style={styles.sectionRow}>
      <Text style={styles.kicker}>Try a question</Text>
      <View style={styles.ruleFill}><View style={styles.rule} /></View>
      <Text style={styles.aside}>in your own words</Text>
    </View>
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
  </ScrollView></AtmosphericShell>;
}

const styles = StyleSheet.create({ tally: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: 10.5, lineHeight: 17, letterSpacing: 0.8, textTransform: "uppercase" }, sectionRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14 }, ruleFill: { flex: 1 }, rule: { height: 1, backgroundColor: colors.line }, aside: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: scale.meta.size }, screen: { padding: 20, gap: 14, backgroundColor: colors.room, paddingBottom: 48 }, kicker: { color: colors.inkMuted, fontFamily: fonts.monoMedium, fontSize: scale.kicker.size, letterSpacing: scale.kicker.tracking, textTransform: "uppercase" }, title: { color: colors.ink, fontSize: scale.title.size, fontWeight: "700" }, intro: { color: colors.inkMuted, lineHeight: 21 }, hint: { color: colors.inkMuted, fontSize: 12 }, input: { backgroundColor: colors.surface, color: colors.ink, borderRadius: radii.surface, padding: 14, minHeight: 48 }, label: { color: colors.ink, fontWeight: "700" }, choices: { flexDirection: "row", gap: 8, flexWrap: "wrap" }, choice: { borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radii.surface, padding: 12 }, choiceSelected: { borderColor: colors.cyan, backgroundColor: colors.surface }, choiceText: { color: colors.ink }, button: { backgroundColor: colors.cyan, padding: 15, borderRadius: radii.surface, alignItems: "center" }, disabled: { opacity: 0.4 }, buttonText: { color: colors.room, fontWeight: "700" }, error: { color: colors.danger }, section: { color: colors.ink, fontWeight: "700", marginTop: 14 }, card: { backgroundColor: colors.surface, padding: 16, borderRadius: radii.surface, gap: 10, flexDirection: "row", alignItems: "flex-start" }, cardBody: { flex: 1, gap: 6 }, cardTitle: { color: colors.ink, fontSize: 17, fontWeight: "700" }, meta: { color: colors.inkMuted }, link: { color: colors.cyan, paddingVertical: 10 } });
