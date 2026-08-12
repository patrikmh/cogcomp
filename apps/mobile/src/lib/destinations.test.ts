import { CORE, dockDestinations } from "./destinations";

/**
 * Where a person can go, and from where.
 *
 * These used to describe two menus — an orbit on the Journal and a dock on
 * detail screens — and to insist that no quiet corner appeared in the dock,
 * because the dock rode along on screens you were reading and Settings there
 * was an invitation to wander off mid-thought.
 *
 * There is one menu now, pinned to the bottom of every screen. That reasoning
 * inverted with it: Settings appeared *only* in the orbit, so the moment the
 * orbit went, the one route it uniquely offered became unreachable. A menu that
 * excludes the quiet corners is only safe while something else includes them.
 */
describe("the one set of destinations", () => {
  it("leads with the way back to writing", () => {
    // The bar is on every screen, including ones you reached by following
    // something, and the most likely next move from those is going back to
    // where you write.
    expect(dockDestinations()[0]?.href).toBe("/");
  });

  it("offers the four, in order, after it", () => {
    expect(dockDestinations().slice(1, 5).map((d) => d.href)).toEqual(CORE.map((d) => d.href));
  });

  it("keeps machinery out", () => {
    // Graph, Patterns and Activity are reachable — from the Recurring lens, the
    // graph readout, and the developer menu — but none of them is a place you
    // pass through on the way to writing something down.
    const everywhere = [...dockDestinations(true), ...dockDestinations()].map((d) => d.href);
    for (const machinery of ["/graph", "/patterns", "/agents", "/explore", "/experiments"]) {
      expect(everywhere).not.toContain(machinery);
    }
  });
});

describe("the quiet corners", () => {
  it("offers Settings, because nothing else does", () => {
    // Not a peer of the four — it trails them and is drawn dimmer — but present,
    // which for one commit it was not.
    const dock = dockDestinations(false);
    expect(dock.map((d) => d.href)).toContain("/settings");
    expect(dock.at(-1)?.href).toBe("/settings");
  });

  it("marks it quiet so it can be drawn quiet", () => {
    expect(dockDestinations().find((d) => d.href === "/settings")?.quiet).toBe(true);
  });

  it("keeps the four loud", () => {
    // Whatever `quiet` comes to mean visually, it must never reach the
    // destinations someone uses constantly.
    const four = dockDestinations().slice(1, 5);
    expect(four.some((d) => d.quiet)).toBe(false);
  });

  it("adds Dev only when the switch is on", () => {
    expect(dockDestinations(false).map((d) => d.href)).not.toContain("/dev");
    expect(dockDestinations(true).map((d) => d.href)).toContain("/dev");
  });

  it("never leaves a registered screen with no way in", () => {
    // The failure this exists for: /settings was reachable from exactly one
    // menu, that menu was removed, and nothing said so. Every quiet corner must
    // be offered somewhere, and /dev is offered by Settings itself.
    const reachable = dockDestinations(true).map((d) => d.href);
    expect(reachable).toContain("/settings");
    expect(reachable).toContain("/dev");
  });
});
