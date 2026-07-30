import { describe, it, expect } from "vitest";
import { shouldRefetch } from "../../../../src/features/streaming/throttleGates";

const prev = { centre: [0, 0] as [number, number], span: 1000 };

describe("shouldRefetch", () => {
  it("skips a small pan", () => {
    expect(
      shouldRefetch(prev, { centre: [100, 0], span: 1000 }, false, false),
    ).toBe(false);
  });

  it("fires when the centre moves past MOVE_FRAC of the span", () => {
    expect(
      shouldRefetch(prev, { centre: [250, 0], span: 1000 }, false, false),
    ).toBe(true);
  });

  it("fires when the span changes by SCALE_FACTOR", () => {
    expect(
      shouldRefetch(prev, { centre: [0, 0], span: 1400 }, false, false),
    ).toBe(true);
    expect(
      shouldRefetch(prev, { centre: [0, 0], span: 700 }, false, false),
    ).toBe(true);
  });

  it("skips a small zoom", () => {
    expect(
      shouldRefetch(prev, { centre: [0, 0], span: 1100 }, false, false),
    ).toBe(false);
  });

  it("BYPASSES hysteresis when the cover has holes", () => {
    expect(
      shouldRefetch(prev, { centre: [10, 0], span: 1000 }, true, false),
    ).toBe(true);
  });

  it("BYPASSES hysteresis when the level changed", () => {
    expect(
      shouldRefetch(prev, { centre: [10, 0], span: 1000 }, false, true),
    ).toBe(true);
  });

  it("always fires on the first commit", () => {
    expect(
      shouldRefetch(null, { centre: [0, 0], span: 1000 }, false, false),
    ).toBe(true);
  });
});
