import { useQueryStore } from "../../../src/features/query/queryStore";
import { afterEach, expect, it } from "vitest";
import { useLayerStore } from "../../../src/features/layers/layerStore";
import {
  normalizeLayers,
  type LayerSnapshot,
} from "../../../src/persistence/types";
import { captureSnapshot } from "../../../src/persistence/captureSnapshot";
import {
  encodeShareState,
  readShareHash,
} from "../../../src/persistence/urlShare";
import type { CityModel } from "../../../src/domain/citymodel/types";
const model: CityModel = {
  sourceEncoding: "cityjson",
  objects: {},
  metadata: {},
  bbox: null,
  vertexCount: 0,
};
const cam = { lng: 4, lat: 52, height: 100, heading: 0, pitch: -45, roll: 0 };
afterEach(() => useLayerStore.setState({ layers: [] }));
function add(name: string) {
  return useLayerStore.getState().addLayer({
    name,
    model,
    modelRef: { type: "url", url: "https://example.com/city.json" },
    visible: true,
    rules: [],
  });
}
it("isolates order by layer and exact object type", () => {
  const a = add("A"),
    b = add("B");
  const store = useLayerStore.getState();
  store.setAttributeOrder(a, "Building", ["height", "name"]);
  store.setAttributeOrder(a, "BuildingPart", ["name", "height"]);
  store.setAttributeOrder(b, "Building", ["year", "height"]);
  const layers = useLayerStore.getState().layers;
  expect(layers[0]!.attributeOrders).toEqual({
    Building: ["height", "name"],
    BuildingPart: ["name", "height"],
  });
  expect(layers[1]!.attributeOrders).toEqual({ Building: ["year", "height"] });
});
it("restores orders from a serialized workspace into a newly identified layer", () => {
  const attributeOrders = {
    Building: ["hoogte", "naam"],
    SolitaryVegetationObject: ["species", "height"],
  };
  const snapshotLayer: LayerSnapshot = {
    name: "city",
    modelRef: { type: "url", url: "https://example.com/city.json" },
    rules: [],
    rulesEnabled: false,
    visible: true,
    attributeOrders,
    tablePresentation: {
      columns: ["status", "id"],
      sort: { column: "id", dir: "desc" },
      view: "raw",
      pageSize: 50,
      drawerTab: "summary",
    },
  };
  const snapshot = captureSnapshot({
    label: "test",
    layers: [snapshotLayer],
    camera: cam,
    datetime: new Date("2026-09-09T12:00:00Z"),
    pickMode: "object",
  });
  const [restored] = normalizeLayers(JSON.parse(JSON.stringify(snapshot)));
  const id = useLayerStore.getState().addLayer({
    name: snapshotLayer.name,
    model,
    modelRef: snapshotLayer.modelRef,
    visible: true,
    rules: [],
    attributeOrders: restored!.attributeOrders,
    tablePresentation: restored!.tablePresentation,
  });
  expect(useQueryStore.getState().queries[id]).toMatchObject(
    snapshotLayer.tablePresentation!,
  );
  expect(
    useLayerStore.getState().layers.find((layer) => layer.id === id)!
      .attributeOrders,
  ).toEqual(attributeOrders);
});
it("round-trips per-type attribute orders including Unicode in a share link", () => {
  const attributeOrders = {
    Building: ["高度", "name"],
    BuildingPart: ["name", "高度"],
  };
  const hash = encodeShareState({
    v: 3,
    cam,
    dt: "2026-09-09T12:00:00Z",
    pm: "object",
    layers: [
      {
        name: "city",
        modelUrl: "https://example.com/city.json",
        rules: [],
        rulesEnabled: false,
        visible: true,
        attributeOrders,
      },
    ],
  });
  const result = readShareHash(hash);
  expect(result.kind).toBe("ok");
  if (result.kind === "ok")
    expect(result.state.layers[0]!.attributeOrders).toEqual(attributeOrders);
});
