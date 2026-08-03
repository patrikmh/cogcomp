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

export function deviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
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
