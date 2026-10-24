import { describe, expect, it } from "vitest";
import { normalizeSelectedLods } from "../../../../src/features/layers/selectedLods";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import type { CityModel } from "../../../../src/domain/citymodel/types";

describe("selected LoDs", () => {
  it("validates saved selections without losing an explicitly empty choice", () => {
    expect(normalizeSelectedLods(["1", "2.2", "1"])).toEqual(["2.2", "1"]);
    expect(normalizeSelectedLods([])).toEqual([]);
    expect(normalizeSelectedLods(undefined)).toBeUndefined();
    expect(normalizeSelectedLods(["2", 1])).toBeUndefined();
    expect(normalizeSelectedLods(["invalid"])).toBeUndefined();
  });
  it("defaults to all available LoDs and honors restored subsets", () => {
    const model: CityModel = {
      sourceEncoding: "cityjson",
      metadata: {},
      bbox: null,
      vertexCount: 0,
      objects: {
        a: {
          id: "a",
          objectType: "Building",
          attributes: {},
          parents: [],
          children: [],
          lod: "2",
          bbox: null,
          surfaces: ["1", "2"].map((lod) => ({
            type: "RoofSurface",
            rings: [],
            attributes: {},
            lod,
          })),
        },
      },
    };
    const input = {
      name: "test",
      model,
      modelRef: { type: "url", url: "https://example.com/a.json" } as const,
      rules: [],
      visible: true,
    };
    useLayerStore.setState({ layers: [] });
    useLayerStore.getState().addLayer(input);
    expect(useLayerStore.getState().layers[0]?.selectedLods).toEqual([
      "2",
      "1",
    ]);
    const id = useLayerStore
      .getState()
      .addLayer({ ...input, selectedLods: ["1"] });
    expect(useLayerStore.getState().layers[1]?.selectedLods).toEqual(["1"]);
    useLayerStore.getState().setLayerLods(id, []);
    expect(useLayerStore.getState().layers[1]?.selectedLods).toEqual([]);
    useLayerStore.setState({ layers: [] });
  });
});
