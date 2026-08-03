import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Observatory } from "@/components/Observatory";
import { summaryLines } from "@/lib/agentActivity";
import { api, type AgentRun } from "@/lib/api";
import { useSession } from "@/state/session";
import { colors } from "@/theme";

/**
 * What ran while you were not looking.
 *
 * This is the transparency surface for background work, so the thing it has to
 * make obvious is not *that* agents ran but *what kind* of thing each run was.
 * Colour carries status — succeeded, skipped, failed — and a failure is a red
 * point you cannot miss among the quiet ones, which a scrolling list of grey rows
 * never managed.
 *
 * Every run is here, including the ones that did nothing. "Nothing ran" and
 * "something ran and found nothing" are different answers to someone asking why
 * their graph changed, and this screen exists so they can tell them apart.
 */
export default function AgentsScreen() {
  const token = useSession((s) => s.token);
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);

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

  const history: AgentRun[] = runs.data ?? [];
  const current = history.find((run) => run.id === selected) ?? null;
  const failures = history.filter((run) => run.status === "failed").length;

  return (
    <Observatory
      eyebrow="What ran on its own"
      data={history.map((run, index) => ({
        id: run.id,
        // Most recent heaviest, so the newest activity reads first.
        weight: 1 - Math.min(index / Math.max(history.length, 10), 0.7),
        // Status is the colour, so a failure is visible without reading a word.
        tone: run.status,
        // A run that did nothing is drawn hollow — present, but not an event.
        tentative: run.status === "skipped",
      }))}
      selected={selected}
      onSelect={setSelected}
      dotSize={8}
      loading={runs.isLoading}
      error={runs.isError ? "Could not load activity." : null}
      empty="Nothing has run in the background yet."
      hint={
        failures > 0
          ? `${history.length} runs · ${failures} failed. Red is a failure — tap it.`
          : `${history.length} ${history.length === 1 ? "run" : "runs"}. Hollow means it looked and found nothing.`
      }
      detail={
        current && (
          <View style={styles.detail}>
            <Text style={styles.kind}>
              {current.agent} · {current.status} ·{" "}
              {current.trigger === "manual" ? "you asked" : "scheduled"}
            </Text>
            {summaryLines(current.summary).map((line: string) => (
              <Text key={line} style={styles.line}>
                {line}
              </Text>
            ))}
            {current.error && <Text style={styles.error}>{current.error}</Text>}
            <Text style={styles.version}>{current.version}</Text>
          </View>
        )
      }
      action={{
        label: runNow.isPending ? "Running…" : "Run them now",
        onPress: () => runNow.mutate(),
        pending: runNow.isPending,
      }}
    />
  );
}

const styles = StyleSheet.create({
  detail: { gap: 4 },
  kind: {
    color: colors.inkMuted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  line: { color: colors.ink, fontSize: 15, lineHeight: 21 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  version: { color: colors.inkMuted, fontSize: 11 },
});
