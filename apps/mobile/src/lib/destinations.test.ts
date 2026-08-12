import { GROUPS, TABS, allDestinations } from "./destinations";

/**
 * Where a person can go, and from where.
 *
 * These used to describe a flat bar of six destinations and to insist that the
 * machinery — graph, agent activity, experiments — stayed out of it, on the
 * grounds that a menu offering them mid-thought was an invitation to wander
 * off. The design answers that differently and better: the machinery is on the
 * map, under a heading that says it is machinery, behind a tab you have to open
 * on purpose. Nothing is hidden and nothing is in the way.
 *
 * What has not changed is the rule underneath: a screen nobody can reach is a
 * screen that does not exist, so the map must lead everywhere.
 */
describe("the bar along the bottom", () => {
  it("holds four places and no more", () => {
    // The fifth tab opens the map; it is not a destination and is not in this
    // list. A bar that grows with the app is a strip of dots nobody reads.
    expect(TABS).toHaveLength(4);
  });

  it("leads with where things stand, then with writing", () => {
    // "Where do things stand" is the question people arrive with; writing is
    // what the app is for.
    expect(TABS.map((tab) => tab.href).slice(0, 2)).toEqual(["/headspace", "/"]);
  });

  it("gives every tab one of the design's own glyphs", () => {
    for (const tab of TABS) expect(tab.glyph).toBeTruthy();
  });
});

describe("the map behind More", () => {
  it("leads to every screen the app has", () => {
    const reachable = new Set(allDestinations().map((d) => d.href));
    for (const screen of [
      "/",
      "/headspace",
      "/talk",
      "/today",
      "/week",
      "/search",
      "/patterns",
      "/identity",
      "/experiments",
      "/agents",
      "/graph",
      "/settings",
    ]) {
      expect(reachable).toContain(screen);
    }
  });

  it("keeps every tab on the map too", () => {
    // Someone who has only ever opened More should still find the four.
    const reachable = new Set(allDestinations().map((d) => d.href));
    for (const tab of TABS) expect(reachable).toContain(tab.href);
  });

  it("says what each group is for", () => {
    expect(GROUPS.map((g) => g.title)).toEqual([
      "Capture",
      "Looking back",
      "Findings",
      "Self-authorship",
      "Machinery",
    ]);
  });

  it("puts the machinery under the heading that says so", () => {
    const machinery = GROUPS.find((g) => g.title === "Machinery")!;
    expect(machinery.items.map((i) => i.href)).toEqual(["/agents", "/graph", "/settings"]);
  });

  it("never lists the same destination twice", () => {
    // Headspace, Journal, Talk and Today appear once each, in the group they
    // belong to — a map that lists a place twice is two maps.
    const hrefs = allDestinations().map((d) => d.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
