import { describe, expect, it } from "vitest";
import { wantsContinuousRendering } from "../../../src/scene/renderPolicy";

describe("wantsContinuousRendering", () => {
  const still = {
    timeAnimating: false,
    cloudsShown: false,
    precipitationShown: false,
  };

  it("draws on demand when nothing moves by itself", () => {
    expect(wantsContinuousRendering(still)).toBe(false);
  });

  it.each(["timeAnimating", "cloudsShown", "precipitationShown"] as const)(
    "draws every frame while %s",
    (key) => {
      expect(wantsContinuousRendering({ ...still, [key]: true })).toBe(true);
    },
  );
});
