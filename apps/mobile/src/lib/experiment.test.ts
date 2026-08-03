import { assessmentLabel, canComplete, eligiblePattern, experimentQueryKeys, localDateToday, validDuration } from "./experiment";

describe("experiment helpers", () => {
  it("uses local calendar values and defaults", () => {
    expect(localDateToday(new Date(2026, 2, 5, 23))).toBe("2026-03-05");
    expect(validDuration("1")).toBe(true);
    expect(validDuration("42")).toBe(true);
    expect(validDuration("0")).toBe(false);
    expect(validDuration("43")).toBe(false);
  });

  it("scopes list and detail keys by account", () => {
    expect(experimentQueryKeys.all("account-a")).not.toEqual(experimentQueryKeys.all("account-b"));
    expect(experimentQueryKeys.detail("account-a", "id")).not.toEqual(experimentQueryKeys.detail("account-b", "id"));
  });

  it("only permits live patterns and completion with an attached check-in", () => {
    expect(eligiblePattern({ tentative: false })).toBe(true);
    expect(eligiblePattern({ tentative: true })).toBe(false);
    const active = { state: "active", checkins: [{ id: "observation" }] } as never;
    expect(canComplete(active)).toBe(true);
    expect(assessmentLabel("partly_met")).toBe("Partly met");
  });
});
