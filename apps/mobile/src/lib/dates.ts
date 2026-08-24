/**
 * The device's own calendar date and timezone.
 *
 * Both are needed by the summary endpoint: the server cannot infer which day a
 * user means, and computing it server-side in UTC would show the wrong day to
 * anyone who journals late at night outside UTC.
 */
export function localToday(now: Date = new Date()): string {
  // Not toISOString() — that converts to UTC first and would return yesterday
  // for anyone west of Greenwich in the evening.
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dayForRoute(routeDate: string | null, today: string = localToday()): string {
  return routeDate ?? today;
}

export function deviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function isLocalDate(value: string): boolean {
  if (!(/^\d{4}-\d{2}-\d{2}$/.test(value))) return false;
  const [year, month, date] = value.split("-").map(Number);
  const parsed = new Date(year!, month! - 1, date!, 12);
  return parsed.getFullYear() === year && parsed.getMonth() === month! - 1 && parsed.getDate() === date;
}

export function mondayOfWeek(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const value = new Date(year!, month! - 1, date!, 12);
  return shiftDay(day, -((value.getDay() + 6) % 7));
}

export function shiftWeek(weekStart: string, deltaWeeks: number): string {
  return shiftDay(weekStart, deltaWeeks * 7);
}

export function shiftDay(day: string, deltaDays: number): string {
  const [year, month, date] = day.split("-").map(Number);
  // Constructed at noon so a DST transition cannot roll the date over.
  const shifted = new Date(year!, month! - 1, date! + deltaDays, 12);
  return localToday(shifted);
}

/**
 * How many weekly summaries the journal must fold so every listed entry can
 * show what was drawn from it. Summaries are anchored to Mondays, so what
 * matters is how many calendar weeks back the oldest act lives — an entry
 * 23 days old can still sit in a fifth week of summaries. A window shorter
 * than that list made older acts claim "nothing drawn from this yet" about
 * readings that exist.
 */
export function weeksBackForOldest(
  oldestCapturedAt: string | null | undefined,
  today: string,
  cap = 26,
): number {
  const weeks = weekDistance(today, oldestCapturedAt);
  if (weeks === null) return 4;
  return Math.min(cap, Math.max(4, weeks + 1));
}

/** Whether an act falls inside the calendar weeks of summaries actually
 *  fetched. Acts older than the window say nothing rather than something
 *  untrue. */
export function withinReadingsWindow(
  capturedAt: string | null | undefined,
  today: string,
  weeksBack: number,
): boolean {
  const weeks = weekDistance(today, capturedAt);
  return weeks === null ? true : weeks >= 0 && weeks < weeksBack;
}

/** Whole calendar weeks between the Monday of `today` and the Monday of
 *  `earlierIso`. Null when either date cannot be understood. */
function weekDistance(today: string, earlierIso: string | null | undefined): number | null {
  if (!earlierIso || !/^\d{4}-\d{2}-\d{2}/.test(earlierIso)) return null;
  const a = Date.parse(`${mondayOfWeek(today)}T12:00:00`);
  const b = Date.parse(`${mondayOfWeek(earlierIso.slice(0, 10))}T12:00:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) / 604_800_000);
}
