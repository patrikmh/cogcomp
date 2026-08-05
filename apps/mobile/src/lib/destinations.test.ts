import { CORE, dockDestinations, orbitDestinations } from "./destinations";

describe("the app offers one set of destinations", () => {
  it("shows the same places in the dock as in the orbit", () => {
    // The bug this prevents: the orbit was cut from eight destinations to four
    // and the dock was not, so the same app named different top-level places
    // depending on which screen you were standing on.
    const orbit = orbitDestinations(false).filter((d) => !d.quiet);
    const dock = dockDestinations().filter((d) => d.href !== "/");

    expect(dock.map((d) => d.href)).toEqual(orbit.map((d) => d.href));
  });

  it("leads the dock with the way back to writing", () => {
    expect(dockDestinations()[0]?.href).toBe("/");
  });

  it("keeps machinery out of both menus", () => {
    // Graph, Patterns and Activity are reachable — from the Recurring lens, the
    // graph readout, and the developer menu — but none of them is a place you
    // pass through on the way to writing something down.
    const everywhere = [...orbitDestinations(true), ...dockDestinations()].map((d) => d.href);
    for (const machinery of ["/graph", "/patterns", "/agents", "/explore", "/experiments"]) {
      expect(everywhere).not.toContain(machinery);
    }
  });
});

describe("the quiet corners", () => {
  it("offers Settings but never as a peer of the four", () => {
    const orbit = orbitDestinations(false);
    expect(orbit.map((d) => d.href)).toEqual([...CORE.map((d) => d.href), "/settings"]);
    expect(orbit.at(-1)?.quiet).toBe(true);
  });

  it("adds Dev only when the switch is on", () => {
    expect(orbitDestinations(false).map((d) => d.href)).not.toContain("/dev");
    expect(orbitDestinations(true).map((d) => d.href)).toContain("/dev");
  });

  it("never puts a quiet corner in the dock", () => {
    // The dock rides on detail screens. Settings there would be an invitation
    // to wander off mid-thought.
    expect(dockDestinations().some((d) => d.quiet)).toBe(false);
  });
});
