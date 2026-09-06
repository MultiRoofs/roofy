import { describe, it, expect } from "vitest";
import {
  resolveActiveLayer,
  unifiedLayerOrder,
} from "../../../../src/features/workspace/activeLayer";
import type { Layer } from "../../../../src/features/layers/layerStore";
import type { GeoLayer } from "../../../../src/features/geoLayers/geoLayerStore";

const city = (id: string) => ({ id, name: id }) as unknown as Layer;
const geo = (id: string) =>
  ({ id, name: id, kind: "geojson" }) as unknown as GeoLayer;

describe("resolveActiveLayer", () => {
  it("returns null for a null id and for an unknown id (no first-layer fallback)", () => {
    expect(resolveActiveLayer(null, [city("a")], [])).toBeNull();
    expect(resolveActiveLayer("zzz", [city("a")], [geo("g")])).toBeNull();
  });
  it("resolves a city layer and a geo layer by id", () => {
    expect(resolveActiveLayer("a", [city("a")], [geo("g")])).toEqual({
      kind: "city",
      layer: city("a"),
    });
    expect(resolveActiveLayer("g", [city("a")], [geo("g")])).toEqual({
      kind: "geo",
      layer: geo("g"),
    });
  });
});

describe("unifiedLayerOrder", () => {
  it("lists city layers first, then geo layers, each in add order", () => {
    expect(
      unifiedLayerOrder([city("b"), city("a")], [geo("g2"), geo("g1")]),
    ).toEqual(["b", "a", "g2", "g1"]);
  });
});
