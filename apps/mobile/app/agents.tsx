import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  api,
  type AgentInfo,
  type AgentRun,
} from "@/lib/api";
import { summaryLines } from "@/lib/agentActivity";
import { useSession } from "@/state/session";

export default function AgentsScreen() {
  const token = useSession((s) => s.token);
  const queryClient = useQueryClient();
  const agents = useQuery({
    queryKey: ["agents"],
    queryFn: () => api.listAgents(token!),
    enabled: Boolean(token),
  });
  const runs = useQuery({
    queryKey: ["agent-runs"],
    queryFn: () => api.listAgentRuns(token!),
    enabled: Boolean(token),
  });
  const runAll = useMutation({
    mutationFn: () => api.runAgents(token!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agent-runs"] });
      void queryClient.invalidateQueries({ queryKey: ["patterns"] });
      void queryClient.invalidateQueries({ queryKey: ["graph"] });
    },
  });

  if (!token) return null;

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.intro}>
        This is the activity log for work that can update your graph. It records
        what ran, when, and counts — never your entry content.
      </Text>

      <Pressable
        style={[styles.button, runAll.isPending && styles.disabled]}
        disabled={runAll.isPending}
        onPress={() => runAll.mutate()}
      >
        <Text style={styles.buttonLabel}>
          {runAll.isPending ? "Running agents…" : "Run all agents now"}
        </Text>
      </Pressable>
      {runAll.isError && (
        <Text style={styles.error}>Could not run the agents.</Text>
      )}
      {runAll.data && (
        <Text style={styles.feedback}>
          Finished {runAll.data.length} {runAll.data.length === 1 ? "agent" : "agents"}.
        </Text>
      )}

      <AgentList agents={agents.data} loading={agents.isLoading} error={agents.isError} />

      <Text style={styles.sectionTitle}>Recent activity</Text>
      {runs.isLoading ? (
        <ActivityIndicator style={styles.loader} />
      ) : runs.isError ? (
        <View style={styles.state}>
          <Text style={styles.error}>Could not load agent activity.</Text>
          <Pressable onPress={() => void runs.refetch()}>
            <Text style={styles.link}>Try again</Text>
          </Pressable>
        </View>
      ) : runs.data?.length === 0 ? (
        <Text style={styles.empty}>No agent runs yet.</Text>
      ) : (
        <View style={styles.list}>
          {runs.data?.map((run: AgentRun) => <RunRow key={run.id} run={run} />)}
        </View>
      )}
    </ScrollView>
  );
}

function AgentList({
  agents,
  loading,
  error,
}: {
  agents: AgentInfo[] | undefined;
  loading: boolean;
  error: boolean;
}) {
  if (loading) return <ActivityIndicator style={styles.smallLoader} />;
  if (error) return <Text style={styles.error}>Could not load the agent list.</Text>;
  if (!agents?.length) return null;

  return (
    <View style={styles.agentList}>
      <Text style={styles.sectionTitle}>Available agents</Text>
      {agents.map((agent) => (
        <View key={agent.name} style={styles.agentCard}>
          <Text style={styles.agentName}>{agent.name}</Text>
          <Text style={styles.meta}>
            Version {agent.version} · every {formatCadence(agent.cadence_seconds)}
          </Text>
        </View>
      ))}
    </View>
  );
}

function RunRow({ run }: { run: AgentRun }) {
  const summary = summaryLines(run.summary);
  return (
    <View style={styles.card}>
      <View style={styles.rowHeader}>
        <Text style={styles.agentName}>{run.agent}</Text>
        <Text style={[styles.status, statusStyle(run.status)]}>
          {run.status}
        </Text>
      </View>
      <Text style={styles.meta}>
        {run.trigger === "manual" ? "Manual" : "Scheduled"} · {formatDate(run.started_at)}
      </Text>
      {run.finished_at && (
        <Text style={styles.meta}>Finished {formatDate(run.finished_at)}</Text>
      )}
      {summary.map((line) => (
        <Text key={line} style={styles.summary}>
          {line}
        </Text>
      ))}
      {run.status === "failed" && (
        <Text style={styles.meta}>Failure details are not shown here.</Text>
      )}
    </View>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function formatCadence(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function statusStyle(status: AgentRun["status"]) {
  if (status === "succeeded") return styles.success;
  if (status === "failed") return styles.failed;
  if (status === "skipped") return styles.skipped;
  return styles.running;
}

const styles = StyleSheet.create({
  screen: { padding: 16, gap: 12, paddingBottom: 40 },
  intro: { fontSize: 15, lineHeight: 22, color: "#3f3f46" },
  button: {
    backgroundColor: "#18181b",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  buttonLabel: { color: "#fafafa", fontWeight: "600", fontSize: 16 },
  disabled: { opacity: 0.4 },
  feedback: { color: "#52525b", fontSize: 13 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: "#71717a",
  },
  agentList: { gap: 8, marginTop: 12 },
  agentCard: {
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  agentName: { fontSize: 16, fontWeight: "600" },
  list: { gap: 8 },
  card: {
    borderWidth: 1,
    borderColor: "#e4e4e7",
    borderRadius: 12,
    padding: 12,
    gap: 5,
  },
  rowHeader: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  status: { fontSize: 12, fontWeight: "700", textTransform: "uppercase" },
  success: { color: "#166534" },
  failed: { color: "#b91c1c" },
  skipped: { color: "#a16207" },
  running: { color: "#52525b" },
  summary: { color: "#3f3f46", fontSize: 14 },
  meta: { fontSize: 12, color: "#71717a" },
  loader: { marginTop: 24 },
  smallLoader: { marginVertical: 8 },
  state: { alignItems: "center", gap: 8, marginTop: 20 },
  empty: { color: "#71717a", textAlign: "center", marginTop: 20 },
  error: { color: "#b91c1c", fontSize: 13 },
  link: { color: "#3f3f46", fontWeight: "600" },
});
