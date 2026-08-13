import { loop } from "@tlon/design/marks";

import { fit, place, type Whorl } from "./HeadspaceMap";

/**
 * The survey's layout contract.
 *
 * These are the claims the map makes about the record — patterns above,
 * readings below, you at the centre and largest, everything inside the frame —
 * and they are the same claims the web's terrain makes, because both read the
 * rules from `@tlon/design/marks`. A change that quietly breaks one of them
 * turns the map into a scatter of circles that means nothing.
 */
const whorl = (id: string, group: Whorl["group"], weight = 0.5): Whorl => ({
  id,
  label: id,
  group,
  weight,
  bar: weight,
  tentative: false,
});

describe("the headspace survey", () => {
  const sample: Whorl[] = [
    whorl("you", "you", 1),
    whorl("p1", "pattern", 1),
    whorl("p2", "pattern", 0.4),
    whorl("today", "today", 0.5),
    whorl("r1", "reading", 0.8),
    whorl("r2", "reading", 0.3),
  ];

  it("puts the patterns above the readings", () => {
    const placed = place(sample);
    const patterns = placed.filter((w) => w.group === "pattern");
    const readings = placed.filter((w) => w.group === "reading");
    const lowestPattern = Math.max(...patterns.map((w) => w.z));
    const highestReading = Math.min(...readings.map((w) => w.z));
    expect(lowestPattern).toBeLessThan(highestReading);
  });

  it("puts you at the centre, larger than everything but a massif", () => {
    const placed = place(sample);
    const you = placed.find((w) => w.id === "you")!;
    expect(you.x).toBe(0);
    // Larger than every reading and than today, whatever the record holds.
    for (const other of placed.filter((w) => w.group === "reading" || w.group === "today")) {
      expect(other.radius).toBeLessThan(you.radius);
    }
    // The busiest recurrence outgrows you, and that is the shared rule rather
    // than this client's reading of it: `whorlRadius` gives a pattern at
    // bar 1 a radius of .64R against your .52R. Something you have done on
    // most days of the record is bigger than the fact that you are the one
    // doing it, which is the map's argument, not a bug in it.
    expect(placed.find((w) => w.id === "p1")!.radius).toBeGreaterThan(you.radius);
  });

  it("sizes a pattern by how often it came back", () => {
    const placed = place(sample);
    const often = placed.find((w) => w.id === "p1")!;
    const seldom = placed.find((w) => w.id === "p2")!;
    expect(often.radius).toBeGreaterThan(seldom.radius);
  });

  it("brings you first and the readings last", () => {
    const placed = place(sample);
    const at = (id: string) => placed.find((w) => w.id === id)!.arrives;
    expect(at("you")).toBe(0);
    expect(at("p1")).toBeLessThan(at("p2"));
    expect(at("p2")).toBeLessThan(at("r1"));
    expect(at("r1")).toBeLessThan(at("today"));
  });

  it("frames every whorl, however many there are", () => {
    for (const count of [1, 7, 26]) {
      const many = [
        whorl("you", "you", 1),
        ...Array.from({ length: count }, (_, i) => whorl(`r${i}`, "reading", 0.9)),
      ];
      const placed = place(many);
      const [x, z, w, h] = fit(placed).split(" ").map(Number) as [number, number, number, number];
      expect(w).toBeGreaterThan(0);
      expect(h).toBeGreaterThan(0);
      // Against the drawn path, not the nominal radius. A whorl's radius is
      // the base its harmonics are applied to and the shape is usually smaller
      // than it — so asserting the frame holds `x ± radius` was passing on a
      // coincidence, and stopped the day the loop's harmonics matched the
      // design's. What the frame must hold is what is drawn.
      for (const one of placed) {
        const points = loop(one.id + "0", one.radius, 0.9)
          .slice(1, -1)
          .split(/[ML]/)
          .filter(Boolean)
          .map((pair) => pair.trim().split(" ").map(Number));
        for (const [px, pz] of points) {
          expect(px! + one.x - 140).toBeGreaterThanOrEqual(x);
          expect(px! + one.x - 140).toBeLessThanOrEqual(x + w);
          expect(pz! + one.z - 140).toBeGreaterThanOrEqual(z);
          expect(pz! + one.z - 140).toBeLessThanOrEqual(z + h);
        }
      }
    }
  });

  it("spreads the readings wider as the record holds more of them", () => {
    const spanOf = (count: number) => {
      const placed = place(
        Array.from({ length: count }, (_, i) => whorl(`r${i}`, "reading", 0.5)),
      );
      return Math.max(...placed.map((w) => w.x)) - Math.min(...placed.map((w) => w.x));
    };
    expect(spanOf(20)).toBeGreaterThan(spanOf(7));
  });
});
