import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  resolveActiveLayer,
  unifiedLayerOrder,
  useActiveCityLayer,
  useActiveLayer,
} from "../../../../src/features/workspace/activeLayer";
import {
  useLayerStore,
  type Layer,
} from "../../../../src/features/layers/layerStore";
import {
  useGeoLayerStore,
  type GeoLayer,
} from "../../../../src/features/geoLayers/geoLayerStore";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";

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

describe("useActiveLayer / useActiveCityLayer", () => {
  beforeEach(() => {
    useLayerStore.setState({ layers: [city("a")] });
    useGeoLayerStore.setState({ layers: [geo("g")] });
    useWorkspaceStore.setState({ activeLayerId: null });
  });

  it("follows the workspace id across both kinds", () => {
    const { result, rerender } = renderHook(() => useActiveLayer());
    expect(result.current).toBeNull();

    useWorkspaceStore.setState({ activeLayerId: "a" });
    rerender();
    expect(result.current).toEqual({ kind: "city", layer: city("a") });

    useWorkspaceStore.setState({ activeLayerId: "g" });
    rerender();
    expect(result.current).toEqual({ kind: "geo", layer: geo("g") });
  });

  it("keeps one object identity while the active layer does not change", () => {
    useWorkspaceStore.setState({ activeLayerId: "a" });
    const { result, rerender } = renderHook(() => useActiveLayer());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("useActiveCityLayer is null when the active layer is geo", () => {
    useWorkspaceStore.setState({ activeLayerId: "g" });
    const { result } = renderHook(() => useActiveCityLayer());
    expect(result.current).toBeNull();
  });

  it("useActiveCityLayer returns the layer when the active layer is a city model", () => {
    useWorkspaceStore.setState({ activeLayerId: "a" });
    const { result } = renderHook(() => useActiveCityLayer());
    expect(result.current).toEqual(city("a"));
  });
});
