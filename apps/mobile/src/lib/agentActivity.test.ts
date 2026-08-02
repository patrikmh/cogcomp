import { summaryLines } from "./agentActivity";

describe("summaryLines", () => {
  it("renders counts and known privacy-safe reasons", () => {
    expect(
      summaryLines({
        patterns: 2,
        considered: 8,
        groups: 1,
        nodes_merged: 3,
        reason: "nothing was duplicated",
      }),
    ).toEqual([
      "2 patterns",
      "8 inferences considered",
      "1 duplicate group",
      "3 nodes merged",
      "nothing was duplicated",
    ]);
  });

  it("does not render unknown summary fields or arbitrary strings", () => {
    expect(
      summaryLines({
        reason: "private entry content",
        patterns: Number.NaN,
      }),
    ).toEqual([]);
  });
});
