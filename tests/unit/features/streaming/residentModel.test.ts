/**
 * The merge moved to `@cityjson/navara-flatcitybuf` in M7.5, and its memo
 * moved INTO `FcbStreamLayerHandle` in Task C9 — see that package's
 * `tests/residentModel.test.ts` for the cell-merge, attr-key-union and
 * reference-equality cases. What is left here is the app's store binding:
 * resolving a layer id to its handle, and the unregistered-layer case.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { getResidentModel } from "../../../../src/features/streaming/residentModel";
import { useStreamStore } from "../../../../src/features/streaming/streamStore";
import type { ResidentModel } from "@cityjson/navara-flatcitybuf";

function model(ids: string[]): ResidentModel {
  return {
    objects: Object.fromEntries(
      ids.map((id) => [id, { id } as ResidentModel["objects"][string]]),
    ),
    cellCount: 1,
    featureCount: ids.length,
    surfaceAttrKeys: ["slope"],
  };
}

let getResident: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getResident = vi.fn(() => model(["a", "b"]));
  useStreamStore.setState({
    streams: { L: { handle: { getResidentModel: getResident } } as never },
  });
});

describe("getResidentModel", () => {
  it("delegates to the layer's handle", () => {
    const m = getResidentModel("L", 1);
    expect(Object.keys(m.objects).sort()).toEqual(["a", "b"]);
    expect(m.featureCount).toBe(2);
    expect(getResident).toHaveBeenCalledTimes(1);
  });

  it("does NOT memoise on `version` — the handle memoises on its own commit counter, which is the only one that knows a cell landed", () => {
    getResidentModel("L", 1);
    getResidentModel("L", 1);
    // Two calls in, two calls through: an app-side memo keyed on the version
    // passed in would have swallowed the second, and would then have served a
    // stale model for any commit that did not change the version it was
    // handed (a recolor, a mid-flight eviction).
    expect(getResident).toHaveBeenCalledTimes(2);
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

  it("gives the same empty model object every time for an unregistered layer, so it is safe as a hook dependency", () => {
    expect(getResidentModel("nope", 0)).toBe(getResidentModel("nope", 1));
  });

  it("stops answering from a layer that was unregistered — nothing keeps its cells alive", () => {
    getResidentModel("L", 1);
    useStreamStore.getState().unregister("L");
    expect(getResidentModel("L", 1).featureCount).toBe(0);
  });

  it("does not serve a model from a torn-down layer's handle after the layer restarts", () => {
    expect(Object.keys(getResidentModel("L", 1).objects).sort()).toEqual([
      "a",
      "b",
    ]);
    useStreamStore.setState({
      streams: {
        L: { handle: { getResidentModel: () => model(["z"]) } } as never,
      },
    });
    // Same layer id, same version — only the handle changed, and the answer
    // follows the handle.
    expect(Object.keys(getResidentModel("L", 1).objects)).toEqual(["z"]);
  });

  it("is genuinely lazy: nothing recomputes until a caller actually asks, however many commits land", () => {
    getResidentModel("L", 1);
    expect(getResident).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i++) useStreamStore.getState().bumpVersion("L");
    // Five commits, no consumer call: the merge must not have run again. This
    // is the exact scenario the module doc warns a Zustand selector would get
    // wrong (materialising on every notification).
    expect(getResident).toHaveBeenCalledTimes(1);
  });
});
