/**
 * The clock arithmetic behind the sun animation (Task C16).
 *
 * Extracted from the render loop so it can be tested without one: the loop
 * itself (a `preUpdate` subscription on the engine) is asserted in
 * `navaraViewportSolar.test.tsx`, against the mocked engine bus.
 */
import { describe, expect, it } from "vitest";
import { advanceTime } from "../../../src/scene/timeAnimation";

const T0 = new Date("2026-06-21T12:00:00.000Z");

describe("advanceTime", () => {
  it("advances by delta * speed seconds", () => {
    // A real frame delta (50 ms), i.e. one that is NOT capped: at 60x that is
    // three seconds of sun per frame.
    expect(advanceTime(T0, 0.05, 60, 0).next.toISOString()).toBe(
      "2026-06-21T12:00:03.000Z",
    );
  });

  it("caps a tab-refocus delta at 100 ms so time never jumps", () => {
    expect(advanceTime(T0, 5, 60, 0).next.getTime() - T0.getTime()).toBe(
      100 * 60,
    );
  });

  it("asks for a store sync only once per 100 ms of wall clock", () => {
    expect(advanceTime(T0, 0.016, 60, 40).shouldSyncStore).toBe(false);
    expect(advanceTime(T0, 0.016, 60, 101).shouldSyncStore).toBe(true);
  });

  it("leaves the input Date untouched", () => {
    advanceTime(T0, 0.5, 3600, 0);
    expect(T0.toISOString()).toBe("2026-06-21T12:00:00.000Z");
  });
});
