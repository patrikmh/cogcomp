import { describe, expect, it } from "vitest";

import {
  dateOf,
  dayFromRoute,
  isLocalDate,
  localDay,
  mondayOf,
  shiftDay,
  stampOf,
  weeksBackForOldest,
  withinReadingsWindow,
} from "./format";

/**
 * Dates, in the timezone the person is standing in.
 *
 * All three of these exist because `toISOString()` converts to UTC, which
 * returns yesterday for anyone west of Greenwich in the evening and tomorrow
 * for anyone far enough east in the morning. A journal that files an entry
 * under the wrong day is worse than one that files none.
 */
describe("localDay", () => {
  it("reads the local calendar date, not the UTC one", () => {
    // 23:30 on the 7th in a zone ahead of UTC is still the 7th here, though
    // toISOString would call it the 7th at 21:30Z — and an hour later, the 8th.
    expect(localDay(new Date(2026, 7, 7, 23, 30))).toBe("2026-08-07");
    expect(localDay(new Date(2026, 7, 8, 0, 15))).toBe("2026-08-08");
  });

  it("pads single-digit months and days", () => {
    expect(localDay(new Date(2026, 0, 5, 12))).toBe("2026-01-05");
  });
});

describe("dayFromRoute", () => {
  it("opens the day that was asked for", () => {
    expect(dayFromRoute("2026-03-12", "2026-03-16")).toBe("2026-03-12");
  });

  it("falls back to today when the date is missing or not a calendar day", () => {
    expect(dayFromRoute(null, "2026-03-16")).toBe("2026-03-16");
    expect(dayFromRoute("16-03-2026", "2026-03-16")).toBe("2026-03-16");
    expect(isLocalDate("2026-02-30")).toBe(false);
  });

  it("does not open tomorrow", () => {
    expect(dayFromRoute("2026-03-17", "2026-03-16")).toBe("2026-03-16");
  });
});

describe("mondayOf", () => {
  it("returns the Monday that starts the week", () => {
    // 2026-08-07 is a Friday.
    expect(mondayOf("2026-08-07")).toBe("2026-08-03");
  });

  it("leaves a Monday where it is", () => {
    expect(mondayOf("2026-08-03")).toBe("2026-08-03");
  });

  it("treats Sunday as the end of its week, not the start of the next", () => {
    expect(mondayOf("2026-08-09")).toBe("2026-08-03");
  });
});

describe("shiftDay", () => {
  it("crosses a month boundary", () => {
    expect(shiftDay("2026-08-01", -1)).toBe("2026-07-31");
    expect(shiftDay("2026-07-31", 1)).toBe("2026-08-01");
  });

  it("crosses a year boundary", () => {
    expect(shiftDay("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("handles a leap day", () => {
    expect(shiftDay("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftDay("2028-02-29", 1)).toBe("2028-03-01");
  });

  it("is its own inverse", () => {
    expect(shiftDay(shiftDay("2026-08-07", 9), -9)).toBe("2026-08-07");
  });
});

describe("stampOf", () => {
  /**
   * One entry, one stamp. Three screens had each written their own version of
   * this and one printed seconds, so the same act looked like two records
   * depending on where you met it.
   */
  it("names today rather than dating it", () => {
    const now = new Date();
    now.setHours(9, 50, 21, 0);
    expect(stampOf(now.toISOString())).toMatch(/^Today · \d{2}:\d{2}$/);
  });

  it("never shows seconds", () => {
    const now = new Date();
    now.setHours(9, 50, 21, 0);
    expect(stampOf(now.toISOString())).not.toContain("21");
  });

  it("dates something older than the last few days", () => {
    const old = new Date();
    old.setDate(old.getDate() - 40);
    // Not "Today", not a weekday on its own — a date you can place.
    expect(stampOf(old.toISOString())).not.toMatch(/^Today/);
  });
});

/**
 * A plain calendar date.
 *
 * Three screens were calling `toLocaleDateString()` with no options, which is
 * the locale's numeric form — `2026-08-10` in a Swedish browser, `8/10/2026` in
 * an American one — beside written-out dates everywhere else in the app. The
 * design writes them `28 Jan`.
 */
describe("dateOf", () => {
  it("writes the month rather than numbering it", () => {
    expect(dateOf("2026-01-28T09:50:00Z")).not.toMatch(/^\d+[/-]\d+/);
    expect(dateOf("2026-01-28T09:50:00Z")).toMatch(/\d/);
  });

  it("carries no year, because these sit in a sentence about now", () => {
    expect(dateOf("2026-01-28T09:50:00Z")).not.toContain("2026");
  });

  it("gives different days different dates", () => {
    expect(dateOf("2026-01-28T09:50:00Z")).not.toBe(dateOf("2026-02-11T09:50:00Z"));
  });
});

describe("readings window", () => {
  it("asks for four weeks when there is no history", () => {
    expect(weeksBackForOldest(undefined, "2026-08-24")).toBe(4);
    expect(weeksBackForOldest("2026-08-20", "2026-08-24")).toBe(4);
  });

  it("counts calendar weeks, not raw days — summaries are Monday-anchored", () => {
    // Aug 1 is a Saturday: its week begins Mon Jul 27, the fifth fetched Monday.
    expect(weeksBackForOldest("2026-08-01T20:00:00Z", "2026-08-24")).toBe(5);
    // Same entry with a four-week window is outside it.
    expect(withinReadingsWindow("2026-08-01T20:00:00Z", "2026-08-24", 4)).toBe(false);
    expect(withinReadingsWindow("2026-08-01T20:00:00Z", "2026-08-24", 5)).toBe(true);
  });

  it("never asks further than the cap", () => {
    expect(weeksBackForOldest("2019-01-01", "2026-08-24")).toBe(26);
  });

  it("keeps entries inside the fetched window and stays silent about older ones", () => {
    expect(withinReadingsWindow("2026-08-22", "2026-08-24", 5)).toBe(true);
    expect(withinReadingsWindow("2025-01-06", "2026-08-24", 26)).toBe(false);
    // Unknown dates never hide information.
    expect(withinReadingsWindow(undefined, "2026-08-24", 5)).toBe(true);
    // A date that cannot be parsed says nothing either way.
    expect(weeksBackForOldest("not-a-date", "2026-08-24")).toBe(4);
  });
});
