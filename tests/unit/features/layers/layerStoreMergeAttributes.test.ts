/**
 * `mergeAttributes` — the model write-back seam a processing tool's computed
 * attributes arrive through. Immutability is the whole point: a NEW model with
 * new objects for the touched ids ONLY, so `handleSync` can push it on model
 * identity and every untouched object's memoised readers stay valid.
 */
import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CityJSONRoot } from "@cityjson/navara-core";
import { parseCityJSON } from "@cityjson/navara-core";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import type { CityModel } from "../../../../src/domain/citymodel/types";

const fixturePath = path.resolve(
  import.meta.dirname!,
  "../../../../fixtures/two-buildings.city.json",
);

function loadModel(): CityModel {
  return parseCityJSON(
    JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as CityJSONRoot,
  );
}

function addLayer(model: CityModel): string {
  return useLayerStore.getState().addLayer({
    name: "t",
    model,
    modelRef: { type: "file", fileName: "t.city.json" },
    visible: true,
    rules: [],
  });
}

function layerModel(id: string): CityModel {
  return useLayerStore.getState().layers.find((l) => l.id === id)!.model;
}

afterEach(() => useLayerStore.getState().removeAllLayers());

describe("mergeAttributes", () => {
  it("writes attributes onto the named objects in a new model and keeps the others by identity", () => {
    const model = loadModel();
    const id = addLayer(model);
    const [a, b] = Object.keys(model.objects) as [string, string];

    useLayerStore
      .getState()
      .mergeAttributes(id, new Map([[a, { extent_height_m: 9.5 }]]));

    const next = layerModel(id);
    expect(next).not.toBe(model);
    expect(next.objects[a]!.attributes.extent_height_m).toBe(9.5);
    // The object's OTHER attributes survive the merge.
    expect(next.objects[a]!.attributes.function ?? null).toBe(
      model.objects[a]!.attributes.function ?? null,
    );
    // Untouched objects keep IDENTITY — nothing downstream memoised on them
    // is invalidated by a column computed for another building.
    expect(next.objects[b]).toBe(model.objects[b]);
    // The source model the caller still holds is unchanged.
    expect("extent_height_m" in model.objects[a]!.attributes).toBe(false);
  });

  it("removes an attribute when the value is undefined (Undo of a new column)", () => {
    const model = loadModel();
    const id = addLayer(model);
    const [a] = Object.keys(model.objects) as [string];

    useLayerStore.getState().mergeAttributes(id, new Map([[a, { x: 1 }]]));
    useLayerStore
      .getState()
      .mergeAttributes(id, new Map([[a, { x: undefined }]]));

    expect("x" in layerModel(id).objects[a]!.attributes).toBe(false);
  });

  it("touches no other layer's model", () => {
    const model = loadModel();
    const a = addLayer(model);
    const b = addLayer(model);
    const [objectId] = Object.keys(model.objects) as [string];

    useLayerStore
      .getState()
      .mergeAttributes(a, new Map([[objectId, { x: 1 }]]));

    expect(layerModel(b)).toBe(model);
  });

  it("is a NO-OP for an empty map, an unknown layer and unknown object ids", () => {
    const model = loadModel();
    const id = addLayer(model);
    const state = useLayerStore.getState();

    state.mergeAttributes(id, new Map());
    state.mergeAttributes("nope", new Map([["B1", { x: 1 }]]));
    state.mergeAttributes(id, new Map([["not-in-this-model", { x: 1 }]]));

    // Reference equality of the whole state: a fresh `layers` array would
    // re-render every subscriber, and a fresh MODEL would make `syncLayers`
    // push `setModel` and repaint the layer for nothing.
    expect(useLayerStore.getState()).toBe(state);
    expect(layerModel(id)).toBe(model);
  });
});
