import { useQueries } from "@tanstack/react-query";

import { amongOf, amongThemesOf, foldDrawnFrom } from "@tlon/ontology";

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
export function useDrawnFrom(weeksBack = 4, enabled = true) {
  const tz = deviceTimezone();
  const weeks = useQueries({
    queries: Array.from({ length: weeksBack }, (_, back) => {
      const monday = mondayOf(shiftDay(localDay(), -7 * back));
      return {
        queryKey: ["summary", "week", monday, tz],
        queryFn: () => api.weekly(monday, tz),
        refetchOnMount: "always" as const,
        refetchOnWindowFocus: "always" as const,
        enabled,
      };
    }),
  });

  return enabled ? foldDrawnFrom(weeks.map((week) => week.data?.inferred ?? [])) : foldDrawnFrom([]);
}

/** Recurrences each act is among. Same weeks as useDrawnFrom, so the request
 *  is not made twice. Empty when findings are hidden, including cached weeks. */
export function useAmong<T extends { id: string }>(
  patterns: readonly T[],
  weeksBack = 4,
  enabled = true,
) {
  const tz = deviceTimezone();
  const weeks = useQueries({
    queries: Array.from({ length: weeksBack }, (_, back) => {
      const monday = mondayOf(shiftDay(localDay(), -7 * back));
      return {
        queryKey: ["summary", "week", monday, tz],
        queryFn: () => api.weekly(monday, tz),
        refetchOnMount: "always" as const,
        refetchOnWindowFocus: "always" as const,
        enabled,
      };
    }),
  });

  return enabled ? amongOf(weeks.map((week) => week.data?.inferred ?? []), patterns) : amongOf([], []);
}

/** Regions each act sits in. Same weeks as useAmong; empty when findings are hidden. */
export function useAmongThemes<T extends { id: string }>(
  themes: readonly T[],
  weeksBack = 4,
  enabled = true,
) {
  const tz = deviceTimezone();
  const weeks = useQueries({
    queries: Array.from({ length: weeksBack }, (_, back) => {
      const monday = mondayOf(shiftDay(localDay(), -7 * back));
      return {
        queryKey: ["summary", "week", monday, tz],
        queryFn: () => api.weekly(monday, tz),
        refetchOnMount: "always" as const,
        refetchOnWindowFocus: "always" as const,
        enabled,
      };
    }),
  });

  return enabled
    ? amongThemesOf(weeks.map((week) => week.data?.inferred ?? []), themes)
    : amongThemesOf([], []);
}

export {
  amongOf,
  amongReadingsOf,
  aboutOf,
  arcsOf,
  eligibleHeld,
  amongThemesOf,
  apartSidesOf,
  changesOf,
  circlingOf,
  contradictsOf,
  conflictedOf,
  untestedOf,
  unhintedHoldsOf,
  untargetedFeltOf,
  untitledThoughtOf,
  untriedOf,
  maybeAfterOf,
  relatesToOf,
  supportsOf,
  circlingThemesOf,
  detectorsWaiting,
  foundWaitingOf,
  feltTowardOf,
  indicatesOf,
  regionsOfReading,
  unplacedReadingsOf,
  themeMembersOf,
  travelsWithOf,
  daysBehindOf,
  weekdayShapeOf,
  feltReadingOf,
  namedInnerOf,
  namedReadingOf,
  namedRecurrenceOf,
  foldDrawnFrom,
  gatheredOf,
  feltThoughtOf,
  heldReadingsOf,
  inRoomOf,
  heldFirst,
  innerFirst,
  innerReadingsOf,
  outerReadingsOf,
  returningInnerOf,
  returningOuterOf,
  namedOnlyDaysOf,
  quietHoldsOf,
  unnamedDaysOf,
  vocabularyMarks,
  VOCABULARY_LOOKBACK_WEEKS,
  type Drawn,
} from "@tlon/ontology";
