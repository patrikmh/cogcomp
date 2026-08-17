import { dayForRoute, localToday, mondayOfWeek, shiftDay, shiftWeek } from "./dates";

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
