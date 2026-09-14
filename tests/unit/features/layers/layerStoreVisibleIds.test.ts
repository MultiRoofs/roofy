import { beforeEach, describe, expect, it } from "vitest";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import type { CityModel } from "../../../../src/domain/citymodel/types";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";

function model(): CityModel {
  return {
    sourceEncoding: "cityjson",
    metadata: {},
    bbox: null,
    objects: {},
    vertexCount: 0,
  } as unknown as CityModel;
}

function addLayer(): string {
  return useLayerStore.getState().addLayer({
    name: "l",
    model: model(),
    modelRef: { type: "url", url: "https://x/a.city.json" },
    visible: true,
    rules: [],
  });
}

beforeEach(() => {
  useLayerStore.setState({ layers: [] });
  useWorkspaceStore.setState({ activeLayerId: null });
});

describe("Layer.visibleObjectIds", () => {
  it("defaults to null — no filter", () => {
    const id = addLayer();
    expect(
      useLayerStore.getState().layers.find((l) => l.id === id)!
        .visibleObjectIds,
    ).toBeNull();
  });

  it("setVisibleObjectIds replaces the set on that layer alone", () => {
    const a = addLayer();
    const b = addLayer();
    const ids = new Set(["B1"]);
    useLayerStore.getState().setVisibleObjectIds(a, ids);
    const layers = useLayerStore.getState().layers;
    expect(layers.find((l) => l.id === a)!.visibleObjectIds).toBe(ids);
    expect(layers.find((l) => l.id === b)!.visibleObjectIds).toBeNull();
  });

  it("keeps an EMPTY set — it means 'nothing matched', not 'no filter'", () => {
    const id = addLayer();
    useLayerStore.getState().setVisibleObjectIds(id, new Set());
    expect(
      useLayerStore.getState().layers.find((l) => l.id === id)!.visibleObjectIds
        ?.size,
    ).toBe(0);
  });

  it("clears back to null", () => {
    const id = addLayer();
    useLayerStore.getState().setVisibleObjectIds(id, new Set(["B1"]));
    useLayerStore.getState().setVisibleObjectIds(id, null);
    expect(
      useLayerStore.getState().layers.find((l) => l.id === id)!
        .visibleObjectIds,
    ).toBeNull();
  });

  it("is a NO-OP when the set is already the one being set", () => {
    const id = addLayer();
    const ids = new Set(["B1"]);
    useLayerStore.getState().setVisibleObjectIds(id, ids);
    const state = useLayerStore.getState();

    useLayerStore.getState().setVisibleObjectIds(id, ids);
    // Reference equality of the whole state: a fresh `layers` array would
    // re-render every subscriber and re-run the viewport's sync effect, whose
    // test for this field is set IDENTITY — so a churned identical set would
    // rebuild the mesh's geometry for nothing.
    expect(useLayerStore.getState()).toBe(state);
    expect(useLayerStore.getState().layers).toBe(state.layers);
  });

  it("is a NO-OP for null over null — the common case, on every recompute", () => {
    const id = addLayer();
    const state = useLayerStore.getState();
    useLayerStore.getState().setVisibleObjectIds(id, null);
    expect(useLayerStore.getState()).toBe(state);
  });

  it("still replaces an EQUAL but distinct set — identity is the contract", () => {
    const id = addLayer();
    useLayerStore.getState().setVisibleObjectIds(id, new Set(["B1"]));
    const first = useLayerStore.getState().layers;
    useLayerStore.getState().setVisibleObjectIds(id, new Set(["B1"]));
    expect(useLayerStore.getState().layers).not.toBe(first);
  });
});
