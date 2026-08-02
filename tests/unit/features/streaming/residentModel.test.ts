/**
 * The merge itself (and its memo) moved to `@cityjson/navara-flatcitybuf` in
 * M7.5 — see that package's `tests/residentModel.test.ts` for the cell-merge,
 * attr-key-union and reference-equality cases. What is left here is the app's
 * store binding: resolving a layer id to its cache via `useStreamStore`, one
 * memo per layer id, and the unregistered-layer case.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getResidentModel,
  __resetMemo,
} from "../../../../src/features/streaming/residentModel";
import { useStreamStore } from "../../../../src/features/streaming/streamStore";
import { CellCache } from "../../../../src/features/streaming/cellCache";

function entry(ids: string[]) {
  return {
    objects: ids.map((id) => ({
      id,
      objectType: "Building",
      attributes: {},
      bbox: [0, 0, 0, 1, 1, 1],
      lod: "2.2",
      surfaceCount: 2,
      roofMetrics: [],
      footprintAreaSqM: 10,
      volumeCuM: 30,
      parents: [],
      children: [],
    })),
    surfaceAttrKeys: ["slope"],
  };
}

let cache: CellCache<never>;

beforeEach(() => {
  __resetMemo();
  cache = new CellCache<never>({
    maxTriangles: Infinity,
    maxBytes: Infinity,
  });
  cache.set("2/0/0", entry(["a", "b"]) as never, { triangles: 1, bytes: 1 });
  cache.set("2/1/0", entry(["c"]) as never, { triangles: 1, bytes: 1 });
  useStreamStore.setState({ streams: { L: { cache, version: 1 } as never } });
});

describe("getResidentModel", () => {
  it("merges the objects of the cells resident in the layer's cache", () => {
    const m = getResidentModel("L", 1);
    expect(Object.keys(m.objects).sort()).toEqual(["a", "b", "c"]);
    expect(m.cellCount).toBe(2);
    expect(m.featureCount).toBe(3);
    expect(m.surfaceAttrKeys).toEqual(["slope"]);
  });

  it("returns the identical object for the same version (memoised)", () => {
    expect(getResidentModel("L", 1)).toBe(getResidentModel("L", 1));
  });

  it("recomputes when the version changes", () => {
    const first = getResidentModel("L", 1);
    expect(getResidentModel("L", 2)).not.toBe(first);
  });

  it("returns an empty model for a layer with no stream registered", () => {
    const m = getResidentModel("nonexistent-layer", 0);
    expect(m).toEqual({
      objects: {},
      cellCount: 0,
      featureCount: 0,
      surfaceAttrKeys: [],
    });
  });

  it("keeps a separate memo entry per layer", () => {
    const cacheB = new CellCache<never>({
      maxTriangles: Infinity,
      maxBytes: Infinity,
    });
    cacheB.set("2/0/0", entry(["z"]) as never, { triangles: 1, bytes: 1 });
    useStreamStore.setState((s) => ({
      streams: {
        ...s.streams,
        M: { cache: cacheB, version: 1 } as never,
      },
    }));

    const mL = getResidentModel("L", 1);
    const mM = getResidentModel("M", 1);
    expect(Object.keys(mL.objects).sort()).toEqual(["a", "b", "c"]);
    expect(Object.keys(mM.objects)).toEqual(["z"]);
    // Recomputing L again at the same version must still be memoised and
    // unaffected by M's entry having been computed in between.
    expect(getResidentModel("L", 1)).toBe(mL);
  });

  it("is genuinely lazy: recomputation only happens when a caller actually asks for the new version, not on every commit", () => {
    // First call actually reads the cache (spy proves the merge ran).
    const keysSpy = vi.spyOn(cache, "keys");
    const first = getResidentModel("L", 1);
    expect(keysSpy).toHaveBeenCalledTimes(1);

    // Simulate several cell commits bumping the store's version WITHOUT any
    // consumer calling getResidentModel — this is the exact scenario the
    // module doc warns a Zustand selector would get wrong (materialising on
    // every notification). A plain function only runs when called.
    for (let i = 0; i < 5; i++) useStreamStore.getState().bumpVersion("L");
    expect(useStreamStore.getState().streams.L!.version).toBe(6);

    // No call happened in between, so asking again for the STALE version 1
    // must still hit the memo (no new cache read) and return the same
    // object — proving no background/eager recomputation occurred.
    expect(keysSpy).toHaveBeenCalledTimes(1);
    expect(getResidentModel("L", 1)).toBe(first);
    expect(keysSpy).toHaveBeenCalledTimes(1);

    // Only calling with the NEW version triggers exactly one more merge.
    const second = getResidentModel("L", 6);
    expect(keysSpy).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });

  it("gives the same empty model object every time for an unregistered layer", () => {
    expect(getResidentModel("nope", 0)).toBe(getResidentModel("nope", 1));
  });

  it("drops the memo of an unregistered layer so its cache can be collected", () => {
    const keysSpy = vi.spyOn(cache, "keys");
    getResidentModel("L", 1);
    expect(keysSpy).toHaveBeenCalledTimes(1);

    useStreamStore.getState().unregister("L");
    // Any later call prunes the dead entry — nothing must keep holding L's
    // cache (and its decoded cell geometry) alive.
    getResidentModel("other", 0);

    // Re-registering the very same cache at the very same version therefore
    // merges again instead of answering from a memo that outlived the layer.
    useStreamStore.setState({ streams: { L: { cache, version: 1 } as never } });
    getResidentModel("L", 1);
    expect(keysSpy).toHaveBeenCalledTimes(2);
  });

  it("does not serve a model merged from a torn-down layer's cache", () => {
    const first = getResidentModel("L", 1);
    // Re-registering restarts the layer with a fresh cache — and a version
    // counter that starts over, so version alone cannot tell them apart.
    const restarted = new CellCache<never>({
      maxTriangles: Infinity,
      maxBytes: Infinity,
    });
    restarted.set("2/0/0", entry(["z"]) as never, { triangles: 1, bytes: 1 });
    useStreamStore.setState({
      streams: { L: { cache: restarted, version: 1 } as never },
    });

    const after = getResidentModel("L", 1);
    expect(after).not.toBe(first);
    expect(Object.keys(after.objects)).toEqual(["z"]);
  });
});
