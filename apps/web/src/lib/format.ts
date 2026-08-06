import type { Detector } from "./api";

export const fmt = (c: number) => c.toFixed(2);

/**
 * What the backend calls a detector, in the words the design uses.
 *
 * The API's names are identifiers (`stated-vs-recorded`); the prototype's are
 * prose ("stated vs recorded"). Mapped in one place so no screen invents a
 * third vocabulary.
 */
export const DETECTOR_LABEL: Record<Detector, string> = {
  "exact-label": "recurrence",
  weekday: "calendar shape",
  lag: "ordering",
  "same-day-order": "ordering, within a day",
  "stated-vs-recorded": "stated vs recorded",
};

/** Local ISO date, not toISOString — that converts to UTC and returns
 *  yesterday for anyone west of Greenwich in the evening. */
export function localDay(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function mondayOf(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const value = new Date(y!, m! - 1, d!, 12);
  value.setDate(value.getDate() - ((value.getDay() + 6) % 7));
  return localDay(value);
}

export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const value = new Date(y!, m! - 1, d!, 12);
  value.setDate(value.getDate() + delta);
  return localDay(value);
}

export const deviceTimezone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export function clockOf(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function dayLabelOf(iso: string) {
  const day = localDay(new Date(iso));
  if (day === localDay()) return "Today";
  if (day === shiftDay(localDay(), -1)) return "Yesterday";
  return new Date(iso).toLocaleDateString([], { weekday: "short", day: "numeric", month: "long" });
}
