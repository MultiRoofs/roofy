/**
 * What a city layer's source can do, said once, and the one accessor for "the
 * objects this layer has right now" that the table, the inspector, the export
 * and the processing tools all read.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  RESIDENT_SOURCE,
  STREAMED_SOURCE,
  layerObjects,
} from "../../../../src/features/layers/cityLayerSource";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import { useStreamStore } from "../../../../src/features/streaming/streamStore";
import type { CityModel } from "../../../../src/domain/citymodel/types";

const model: CityModel = {
  sourceEncoding: "cityjson",
  metadata: {},
  bbox: null,
  vertexCount: 0,
  objects: {
    b: { id: "b", objectType: "Building", attributes: {}, surfaces: [] },
  },
} as unknown as CityModel;

afterEach(() => {
  useLayerStore.setState({ layers: [] });
  useStreamStore.setState({ streams: {} });
});

describe("source capabilities", () => {
  it("say a resident source is whole and known up front", () => {
    expect(RESIDENT_SOURCE).toEqual({
      access: "resident",
      coverage: "complete",
      discovery: "upfront",
    });
  });

  it("say a streamed source covers the viewport and is discovered as cells land", () => {
    expect(STREAMED_SOURCE).toEqual({
      access: "stream",
      coverage: "viewport",
      discovery: "progressive",
    });
  });

  it("default a new layer to resident, and keep what a stream says", () => {
    const store = useLayerStore.getState();
    const a = store.addLayer({
      name: "a",
      model,
      modelRef: { type: "url", url: "https://x/a.city.json" },
      visible: true,
      rules: [],
    });
    const b = store.addLayer({
      name: "b",
      model,
      modelRef: { type: "url", url: "https://x/b.fcb" },
      visible: true,
      rules: [],
      source: STREAMED_SOURCE,
    });
    const layers = useLayerStore.getState().layers;
    expect(layers.find((l) => l.id === a)!.source).toBe(RESIDENT_SOURCE);
    expect(layers.find((l) => l.id === b)!.source).toBe(STREAMED_SOURCE);
  });

  it("leave a streamed layer's LoDs, types and themes to discovery", () => {
    const id = useLayerStore.getState().addLayer({
      name: "b",
      model,
      modelRef: { type: "url", url: "https://x/b.fcb" },
      visible: true,
      rules: [],
      source: STREAMED_SOURCE,
    });
    const layer = useLayerStore.getState().layers.find((l) => l.id === id)!;
    expect(layer.availableObjectTypes).toEqual([]);
    expect(layer.selectedLods).toBeUndefined();
    expect(layer.appearanceThemes).toEqual([]);
  });
});

describe("layerObjects", () => {
  it("reads a resident layer's model", () => {
    const id = useLayerStore.getState().addLayer({
      name: "a",
      model,
      modelRef: { type: "url", url: "https://x/a.city.json" },
      visible: true,
      rules: [],
    });
    const layer = useLayerStore.getState().layers.find((l) => l.id === id)!;
    expect(Object.keys(layerObjects(layer, 0))).toEqual(["b"]);
  });

  it("reads a streamed layer's resident cells, never its stub model", () => {
    const id = useLayerStore.getState().addLayer({
      name: "s",
      model,
      modelRef: { type: "url", url: "https://x/s.fcb" },
      visible: true,
      rules: [],
      source: STREAMED_SOURCE,
    });
    const resident = { objects: { r: { id: "r" } } };
    useStreamStore.setState({
      streams: {
        [id]: {
          handle: { getResidentModel: () => resident },
        } as never,
      },
    });
    const layer = useLayerStore.getState().layers.find((l) => l.id === id)!;
    expect(Object.keys(layerObjects(layer, 1))).toEqual(["r"]);
  });
});
