import { radii, type as scale } from "@tlon/design";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { Kicker, Rule } from "@/components/Marks";
import { MotionSurface } from "@/components/MotionSurface";
import { Rise, Rising } from "@/components/Rise";
import { summaryLines } from "@/lib/agentActivity";
import { api, type AgentRun } from "@/lib/api";
import { useSession } from "@/state/session";
import { colors, fonts, statusColor } from "@/theme";

/**
 * What was decided while you were away.
 *
 * One line per attempt, including the attempts that did nothing: "nothing ran"
 * and "something ran and found nothing" are different answers to someone asking
 * why their graph changed, and this screen exists so they can be told apart.
 *
 * The web has been a run log since it was ported and this client drew the same
 * runs as points floating in a head. A log is a list of events in time — the
 * head said nothing about any of them, and it cost the one thing a log is for,
 * which is reading them in order. Counts only, never what anyone wrote.
 */
export default function AgentsScreen() {
  const token = useSession((s) => s.token);
  const queryClient = useQueryClient();

  const runs = useQuery({
    queryKey: ["agent-runs"],
    queryFn: () => api.listAgentRuns(token!),
    enabled: Boolean(token),
  });

  const runNow = useMutation({
    mutationFn: () => api.runAgents(token!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agent-runs"] });
      void queryClient.invalidateQueries({ queryKey: ["patterns"] });
      void queryClient.invalidateQueries({ queryKey: ["graph"] });
    },
  });

  if (!token) return null;

  const all: AgentRun[] = runs.data ?? [];
  const wrote = all.filter((run) => run.status === "succeeded").length;
  const skipped = all.filter((run) => run.status === "skipped").length;
  const failed = all.filter((run) => run.status === "failed").length;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Rising>
        <Kicker>Agent activity</Kicker>
        <Text style={styles.title}>What was decided while you were away</Text>
        <Text style={styles.sub}>One line per attempt. Counts only — never what you wrote.</Text>

        <View style={styles.summary}>
          <Text style={styles.summaryText}>
            {runs.isLoading
              ? "Reading the log…"
              : runs.isError
                ? "Could not load activity."
                : all.length === 0
                  ? "Nothing has run yet."
                  : `${all.length} ${all.length === 1 ? "attempt" : "attempts"} recorded: ${wrote} did work, ${skipped} had nothing to work on, ${failed} failed.`}
          </Text>
        </View>

        <View style={styles.actions}>
          <MotionSurface
            style={styles.button}
            onPress={() => runNow.mutate()}
            accessibilityRole="button"
            accessibilityState={{ disabled: runNow.isPending }}
          >
            <Text style={styles.buttonLabel}>{runNow.isPending ? "RUNNING…" : "RUN NOW"}</Text>
          </MotionSurface>
          <Text style={styles.note}>A run you asked for always looks, and always reports.</Text>
        </View>

        {all.length > 0 && (
          <>
            <Kicker heading>Every run</Kicker>
            <Rule />
          </>
        )}

        {all.map((run, i) => (
          <Rise key={run.id} index={i}>
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <View style={styles.agent}>
                  <View style={[styles.dot, { backgroundColor: statusColor(run.status) }]} />
                  <Text style={styles.agentName}>{run.agent}</Text>
                </View>
                <Text style={styles.meta}>
                  {new Date(run.started_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · {run.version}
                </Text>
              </View>
              <Text style={styles.line}>
                {statusLabel(run.status)} · {summaryLines(run.summary).join(" · ") || "nothing to report"}
              </Text>
              {run.error ? <Text style={styles.error}>{run.error}</Text> : null}
            </View>
          </Rise>
        ))}
      </Rising>
    </ScrollView>
  );
}

/** The web's words for a status, so both logs read the same. */
function statusLabel(status: string): string {
  if (status === "failed") return "failed";
  if (status === "skipped") return "nothing new to work on";
  return "wrote";
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.room },
  content: { padding: 20, paddingBottom: 56, gap: 10 },
  title: {
    color: colors.ink,
    fontFamily: fonts.sansBold,
    fontSize: scale.title.size,
    lineHeight: scale.title.line,
    letterSpacing: scale.title.tracking,
  },
  sub: {
    color: colors.inkMuted,
    fontFamily: fonts.sans,
    fontSize: scale.body.size,
    lineHeight: scale.body.line,
  },
  summary: {
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radii.surface,
    backgroundColor: colors.surface,
    padding: 14,
    marginTop: 4,
  },
  summaryText: {
    color: colors.ink,
    fontFamily: fonts.sans,
    fontSize: scale.body.size,
    lineHeight: scale.body.line,
  },
  actions: { gap: 8, marginTop: 4, marginBottom: 6 },
  button: {
    borderWidth: 1,
    borderColor: colors.ink,
    borderRadius: radii.surface,
    paddingVertical: 12,
    alignItems: "center",
  },
  buttonLabel: {
    color: colors.ink,
    fontFamily: fonts.monoMedium,
    fontSize: scale.kicker.size,
    letterSpacing: scale.kicker.tracking,
  },
  note: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: scale.meta.size },
  card: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.surface,
    backgroundColor: colors.surface,
    padding: 12,
    gap: 8,
  },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  agent: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  agentName: { color: colors.ink, fontFamily: fonts.sansSemi, fontSize: scale.body.size, flexShrink: 1 },
  meta: { color: colors.inkMuted, fontFamily: fonts.mono, fontSize: scale.meta.size },
  line: { color: colors.inkSoft, fontFamily: fonts.mono, fontSize: scale.meta.size, lineHeight: 18 },
  error: { color: colors.danger, fontFamily: fonts.mono, fontSize: scale.meta.size },
});
