import {
  dayForRoute,
  localToday,
  mondayOfWeek,
  shiftDay,
  shiftWeek,
  weeksBackForOldest,
  withinReadingsWindow,
} from "./dates";

describe("calendar helpers", () => {
  it("keeps Monday as Monday and maps Sunday to its Monday", () => {
    expect(mondayOfWeek("2026-03-16")).toBe("2026-03-16");
    expect(mondayOfWeek("2026-03-22")).toBe("2026-03-16");
  });

  it("shifts weeks without changing the requested calendar date", () => {
    expect(shiftWeek("2026-03-16", 1)).toBe("2026-03-23");
    expect(shiftWeek("2026-03-16", -1)).toBe("2026-03-09");
  });

  it("resets an invalid or missing route date to local today", () => {
    expect(dayForRoute(null, "2026-03-16")).toBe("2026-03-16");
  });

  it("keeps a valid route date", () => {
    expect(dayForRoute("2026-03-12", "2026-03-16")).toBe("2026-03-12");
  });

  it("uses local calendar fields rather than UTC for today", () => {
    const localDate = new Date(2026, 2, 16, 23, 30);
    expect(localToday(localDate)).toBe("2026-03-16");
    expect(shiftDay("2026-03-29", 1)).toBe("2026-03-30");
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
