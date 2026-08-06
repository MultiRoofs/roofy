/**
 * `queryRegionStore`: the React-visible mirror of each streaming layer's
 * fetch bbox.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { QueryRegion } from "@cityjson/navara-flatcitybuf";
import { useQueryRegionStore } from "../../../../src/features/streaming/queryRegionStore";

function region(layerId: string, minX = 0): QueryRegion {
  return {
    layerId,
    bbox: [minX, 0, minX + 100, 100],
    epsg: 7415,
    span: 100,
    heightM: 43.2,
    ring: [
      [4.35, 52],
      [4.36, 52],
      [4.36, 52.01],
      [4.35, 52.01],
    ],
  };
}

describe("queryRegionStore", () => {
  beforeEach(() => useQueryRegionStore.setState({ regions: {} }));

  it("keys regions by layer id and replaces one in place", () => {
    const store = useQueryRegionStore.getState();
    store.setRegion(region("A"));
    store.setRegion(region("B"));
    const moved = region("A", 500);
    store.setRegion(moved);

    const { regions } = useQueryRegionStore.getState();
    expect(Object.keys(regions).sort()).toEqual(["A", "B"]);
    expect(regions.A).toBe(moved);
  });

  it("forgets one layer without touching the others", () => {
    const store = useQueryRegionStore.getState();
    store.setRegion(region("A"));
    store.setRegion(region("B"));
    store.clearRegion("A");
    expect(Object.keys(useQueryRegionStore.getState().regions)).toEqual(["B"]);
  });

  it("keeps the state IDENTITY when there is nothing to clear", () => {
    // An unregister for a layer that never published must not re-render the
    // overlay — the same discipline `streamStore` applies to its own no-ops.
    const before = useQueryRegionStore.getState().regions;
    useQueryRegionStore.getState().clearRegion("nobody");
    expect(useQueryRegionStore.getState().regions).toBe(before);

    useQueryRegionStore.getState().clear();
    expect(useQueryRegionStore.getState().regions).toBe(before);
  });

  it("clears everything when the diagnostic goes off", () => {
    useQueryRegionStore.getState().setRegion(region("A"));
    useQueryRegionStore.getState().clear();
    expect(useQueryRegionStore.getState().regions).toEqual({});
  });
});
