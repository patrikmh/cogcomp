import { useQueries } from "@tanstack/react-query";

import { foldDrawnFrom } from "@tlon/ontology";

import { api } from "./api";
import { deviceTimezone, localDay, mondayOf, shiftDay } from "./format";

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

  return foldDrawnFrom(weeks.map((week) => week.data?.inferred ?? []));
}

export { foldDrawnFrom, type Drawn } from "@tlon/ontology";
