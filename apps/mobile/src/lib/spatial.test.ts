import { constellationPoint, spatialDistance } from "./spatial";

describe("constellationPoint", () => {
  it("is deterministic for a semantic id", () => {
    expect(constellationPoint("thought-1", 0)).toEqual(constellationPoint("thought-1", 0));
  });

  it("does not move when the response order changes", () => {
    expect(constellationPoint("thought-1", 0)).toEqual(constellationPoint("thought-1", 0));
    expect(constellationPoint("thought-1", 0)).not.toEqual(constellationPoint("thought-2", 1));
  });

  it("keeps lights inside the readable field", () => {
    for (let index = 0; index < 100; index += 1) {
      const point = constellationPoint(`node-${index}`, index);
      expect(point.x).toBeGreaterThanOrEqual(0.08);
      expect(point.x).toBeLessThanOrEqual(0.92);
      expect(point.y).toBeGreaterThanOrEqual(0.14);
      expect(point.y).toBeLessThanOrEqual(0.86);
    }
  });

  it("provides meaningful spatial separation", () => {
    expect(spatialDistance(constellationPoint("a", 0), constellationPoint("b", 1))).toBeGreaterThan(0);
  });
});
