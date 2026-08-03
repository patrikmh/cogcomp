import type { Experiment, ExperimentState } from "./api";

export const experimentQueryKeys = {
  all: (userId: string) => ["experiments", userId] as const,
  detail: (userId: string, id: string) => ["experiment", userId, id] as const,
};

export function localDateToday(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function validDuration(value: string): boolean {
  const days = Number(value);
  return Number.isInteger(days) && days >= 1 && days <= 42;
}

export function isTransition(state: ExperimentState, target: ExperimentState): boolean {
  return (
    (state === "draft" && (target === "active" || target === "cancelled")) ||
    (state === "active" && (target === "paused" || target === "cancelled" || target === "completed")) ||
    (state === "paused" && (target === "active" || target === "cancelled"))
  );
}

export function eligiblePattern(pattern: { tentative: boolean }): boolean {
  return !pattern.tentative;
}

export function canComplete(experiment: Experiment): boolean {
  return experiment.state === "active" && Boolean(experiment.checkins?.length);
}

export function assessmentLabel(value: "met" | "partly_met" | "not_met" | "unclear"): string {
  return { met: "Met", partly_met: "Partly met", not_met: "Not met", unclear: "Unclear" }[value];
}
