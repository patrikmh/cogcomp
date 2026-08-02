import type { AgentSummary } from "./api";

const SAFE_REASONS = new Set([
  "nothing was duplicated",
  "no inferences to examine yet",
  "nothing new to work on",
]);

/** Only known numeric counters and backend-controlled reason phrases are shown. */
export function summaryLines(summary: AgentSummary): string[] {
  const lines: string[] = [];
  if (Number.isFinite(summary.patterns)) lines.push(countLine(summary.patterns, "pattern"));
  if (Number.isFinite(summary.considered)) {
    lines.push(`${summary.considered} ${summary.considered === 1 ? "inference" : "inferences"} considered`);
  }
  if (Number.isFinite(summary.groups)) lines.push(countLine(summary.groups, "duplicate group"));
  if (Number.isFinite(summary.nodes_merged)) {
    lines.push(`${summary.nodes_merged} ${summary.nodes_merged === 1 ? "node" : "nodes"} merged`);
  }
  if (summary.reason && SAFE_REASONS.has(summary.reason)) lines.push(summary.reason);
  return lines;
}

function countLine(count: number | undefined, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}
