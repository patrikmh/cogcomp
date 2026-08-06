import { useQueries } from "@tanstack/react-query";

import { api } from "./api";
import { deviceTimezone, localDay, mondayOf, shiftDay } from "./format";

export interface Drawn {
  id: string;
  label: string;
  confidence: number;
  tentative: boolean;
}

/**
 * What each act left behind, keyed by the act.
 *
 * The weekly summary is the only read that maps readings back to the entries
 * they came from (`source_observation_ids`), so the visible weeks are fetched
 * and folded into one index. Shared by the journal and the day, because an act
 * must show the same chips wherever it appears — two screens disagreeing about
 * what an entry produced would undermine the one promise the app makes.
 */
export function useDrawnFrom(weeksBack = 4) {
  const tz = deviceTimezone();
  const weeks = useQueries({
    queries: Array.from({ length: weeksBack }, (_, back) => {
      const monday = mondayOf(shiftDay(localDay(), -7 * back));
      return { queryKey: ["summary", "week", monday, tz], queryFn: () => api.weekly(monday, tz) };
    }),
  });

  const index = new Map<string, Drawn[]>();
  for (const week of weeks) {
    for (const reading of week.data?.inferred ?? []) {
      for (const source of reading.source_observation_ids) {
        const list = index.get(source) ?? [];
        if (!list.some((r) => r.id === reading.id)) {
          list.push({
            id: reading.id,
            label: reading.label,
            confidence: reading.confidence,
            tentative: reading.tentative,
          });
        }
        index.set(source, list);
      }
    }
  }
  return index;
}
