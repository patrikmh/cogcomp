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

/**
 * The time of an act, always on a 24-hour clock.
 *
 * Not the viewer's locale, deliberately. The journal's time gutter is 52px and
 * does not admit an "AM"; more to the point every stamp in this app is a datum
 * in a monospace column, and a record is read the way records are kept. A
 * 12-hour locale would have quietly overflowed the gutter and made "09:50" and
 * "21:50" indistinguishable at a glance in a list sorted by time.
 */
export function clockOf(iso: string) {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * The heading a day gets in the journal.
 *
 * "Today" and "Yesterday" keep their date beside them, as the design has it —
 * a stream you scroll needs to say where you are without arithmetic, and
 * "Today" alone stops being useful the moment you have scrolled past it. Older
 * days are named in full: a short weekday reads as an abbreviation of something
 * you were not told.
 */
export function dayLabelOf(iso: string) {
  const day = localDay(new Date(iso));
  const full = new Date(iso).toLocaleDateString([], {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  if (day === localDay()) return `Today · ${full}`;
  if (day === shiftDay(localDay(), -1)) return `Yesterday · ${full}`;
  return full;
}

/**
 * The same day, named as briefly as it can be.
 *
 * A heading has a column to itself and can afford the whole date; a stamp on an
 * evidence card sits beside a clock time and cannot. They were one function
 * until the heading grew, at which point every stamp in the app quietly became
 * "Today · Wednesday 4 February · 09:50".
 */
function shortDayOf(iso: string) {
  const day = localDay(new Date(iso));
  if (day === localDay()) return "Today";
  if (day === shiftDay(localDay(), -1)) return "Yesterday";
  return new Date(iso).toLocaleDateString([], { weekday: "short", day: "numeric", month: "long" });
}

/**
 * How an act is stamped, everywhere it appears.
 *
 * One entry must be recognisable as the same entry on the journal, on a node's
 * evidence card, under a pattern and beside an experiment. Three screens had
 * each written their own version of this and one of them printed seconds.
 */
export function stampOf(iso: string) {
  return `${shortDayOf(iso)} · ${clockOf(iso)}`;
}
