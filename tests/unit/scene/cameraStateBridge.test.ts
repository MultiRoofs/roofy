import { describe, expect, it } from "vitest";
import {
  cameraStateFromTuples,
  cameraStateToTuples,
} from "../../../src/scene/cameraStateBridge";
import { cameraForBounds } from "../../../src/scene/geographicCamera";

describe("cameraStateBridge", () => {
  it("round-trips a geographic camera state through the legacy tuples", () => {
    const state = {
      lng: 4.3571,
      lat: 52.0116,
      height: 812.5,
      heading: 33,
      pitch: -47,
      roll: 0,
    };
    const { position, target } = cameraStateToTuples(state);
    expect(position).toEqual([4.3571, 52.0116, 812.5]);
    expect(target).toEqual([33, -47, 0]);
    expect(cameraStateFromTuples(position, target)).toEqual(state);
  });

  it("round-trips a fitted camera bit for bit", () => {
    const fitted = cameraForBounds({
      west: 4.34,
      south: 52.0,
      east: 4.35,
      north: 52.01,
      minHeight: 0,
      maxHeight: 12,
    });
    const { position, target } = cameraStateToTuples(fitted);
    expect(cameraStateFromTuples(position, target)).toEqual(fitted);
  });

  it("hands out fresh tuples per call, so callers cannot alias state", () => {
    const state = {
      lng: 1,
      lat: 2,
      height: 3,
      heading: 4,
      pitch: 5,
      roll: 6,
    };
    const first = cameraStateToTuples(state);
    const second = cameraStateToTuples(state);
    expect(first.position).not.toBe(second.position);
    expect(first.target).not.toBe(second.target);
    expect(first.position).toEqual(second.position);
  });
});
