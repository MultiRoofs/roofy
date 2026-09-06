/**
 * The shadow-quality table IS the specification of what a level means, so the
 * assertions are about its invariants, not any one tuned number (the browser
 * pass at a low sun owns those — see the module's own comment):
 *
 *   - three levels, each a power-of-two shadow map, strictly growing;
 *   - the depth bias scales with the texel: bias × map size is the same for
 *     every level, so every level resists acne alike and a higher level only
 *     buys shadows that attach closer to their casters;
 *   - the parts that are NOT quality (no normal bias, the 500 m margin) ride
 *     on every row, so a quality change can never drop them.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHADOW_QUALITY,
  SHADOW_QUALITIES,
  shadowTuningFor,
} from "../../../src/scene/shadowQuality";

describe("shadowQuality", () => {
  it("offers low, medium and high, defaulting to medium", () => {
    expect([...SHADOW_QUALITIES]).toEqual(["low", "medium", "high"]);
    expect(DEFAULT_SHADOW_QUALITY).toBe("medium");
  });

  it("doubles the shadow map per level, powers of two only", () => {
    const sizes = SHADOW_QUALITIES.map((q) => shadowTuningFor(q).shadowMapSize);
    for (const size of sizes) {
      expect(Number.isInteger(Math.log2(size))).toBe(true);
    }
    const [low = 0, medium = 0, high = 0] = sizes;
    expect(medium).toBe(low * 2);
    expect(high).toBe(medium * 2);
    expect(shadowTuningFor("medium").shadowMapSize).toBe(2048);
  });

  it("scales the depth bias with the texel so every level resists acne alike", () => {
    const products = SHADOW_QUALITIES.map((q) => {
      const t = shadowTuningFor(q);
      expect(t.shadowBias).toBeLessThan(0);
      return t.shadowBias * t.shadowMapSize;
    });
    const [low = 0, medium = 1, high = 2] = products;
    expect(medium).toBeCloseTo(low, 10);
    expect(high).toBeCloseTo(low, 10);
  });

  it("carries the non-quality tuning on every row", () => {
    for (const q of SHADOW_QUALITIES) {
      expect(shadowTuningFor(q)).toMatchObject({
        shadowNormalBias: 0,
        shadowMargin: 500,
      });
    }
  });

  it("hands out frozen rows", () => {
    expect(Object.isFrozen(shadowTuningFor("high"))).toBe(true);
  });
});
