import { useQueries } from "@tanstack/react-query";
import { amongOf, foldDrawnFrom } from "@tlon/ontology";

import { api } from "@/lib/api";
import { deviceTimezone, localToday, mondayOfWeek, shiftWeek } from "@/lib/dates";

/**
 * What each act left behind, keyed by the act.
 *
 * The weekly summary is the only read that maps readings back to the entries
 * they came from (`source_observation_ids`), so the visible weeks are fetched
 * and folded into one index.
 *
 * The fold itself is in `@tlon/ontology` because both clients show these chips
 * and the rule it encodes — a Pattern is never "drawn from" a single entry — is
 * a statement about the graph rather than about a screen. This file is the part
 * that is genuinely per-client: which weeks to ask for, and how this app talks
 * to the API.
 */
export function useDrawnFrom(
  token: string | null,
  userId: string | null,
  weeksBack = 4,
  enabled = true,
) {
  const tz = deviceTimezone();
  const weeks = useQueries({
    queries: Array.from({ length: weeksBack }, (_, back) => {
      const monday = shiftWeek(mondayOfWeek(localToday()), -back);
      return {
        queryKey: ["summary", "week", monday, tz, userId],
        queryFn: () => api.weeklySummary(token!, monday, tz),
        enabled: Boolean(token && userId && enabled),
      };
    }),
  });

  // Disabled queries retain their previous data in React Query. Never fold that
  // cache into a derived view after findings are hidden.
  return enabled ? foldDrawnFrom(weeks.map((week) => week.data?.inferred ?? [])) : foldDrawnFrom([]);
}

/** Recurrences each act is among. Same weeks as useDrawnFrom, so the request
 *  is not made twice. Empty when findings are hidden, including cached weeks. */
export function useAmong<T extends { id: string }>(
  token: string | null,
  userId: string | null,
  patterns: readonly T[],
  weeksBack = 4,
  enabled = true,
) {
  const tz = deviceTimezone();
  const weeks = useQueries({
    queries: Array.from({ length: weeksBack }, (_, back) => {
      const monday = shiftWeek(mondayOfWeek(localToday()), -back);
      return {
        queryKey: ["summary", "week", monday, tz, userId],
        queryFn: () => api.weeklySummary(token!, monday, tz),
        enabled: Boolean(token && userId && enabled),
      };
    }),
  });

  return enabled ? amongOf(weeks.map((week) => week.data?.inferred ?? []), patterns) : amongOf([], []);
}

export {
  amongOf,
  amongReadingsOf,
  circlingOf,
  circlingThemesOf,
  feltReadingOf,
  innerReadingsOf,
  outerReadingsOf,
  vocabularyMarks,
  VOCABULARY_LOOKBACK_WEEKS,
} from "@tlon/ontology";
