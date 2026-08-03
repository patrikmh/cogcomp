import { motionPolicy } from "@/lib/motion";

describe("motionPolicy", () => {
  it("keeps purposeful feedback enabled when motion is allowed", () => {
    expect(motionPolicy(false)).toEqual({
      reduced: false,
      duration: 140,
      allowMomentum: true,
      allowScrollAnimation: true,
    });
  });

  it("removes timer-driven motion and animated scrolling for reduced motion", () => {
    expect(motionPolicy(true)).toEqual({
      reduced: true,
      duration: 0,
      allowMomentum: false,
      allowScrollAnimation: false,
    });
  });
});
