import { describe, it, expect, afterEach } from "vitest";
import {
  computeAppearanceThemes,
  defaultAppearanceTheme,
  useLayerStore,
} from "../../../../src/features/layers/layerStore";
import type {
  CityAppearance,
  CityModel,
} from "../../../../src/domain/citymodel/types";

function model(appearance?: CityAppearance): CityModel {
  return {
    sourceEncoding: "cityjsonseq",
    metadata: {},
    bbox: null,
    objects: {},
    vertexCount: 0,
    ...(appearance ? { appearance } : {}),
  };
}

const both: CityAppearance = {
  materials: [],
  textures: [],
  textureThemes: ["night", "rgbTexture"],
  materialThemes: ["paint"],
  defaultTextureTheme: "rgbTexture",
  defaultMaterialTheme: "paint",
};

afterEach(() => {
  useLayerStore.setState({ layers: [], activeLayerId: null });
});

describe("computeAppearanceThemes", () => {
  it("lists texture themes first, then material themes", () => {
    expect(computeAppearanceThemes(model(both))).toEqual([
      { kind: "texture", name: "night" },
      { kind: "texture", name: "rgbTexture" },
      { kind: "material", name: "paint" },
    ]);
    expect(computeAppearanceThemes(model())).toEqual([]);
  });
});

describe("defaultAppearanceTheme", () => {
  it("prefers the declared default texture theme", () => {
    expect(defaultAppearanceTheme(model(both))).toEqual({
      kind: "texture",
      name: "rgbTexture",
    });
  });

  it("falls back to the first texture theme, then materials, then null", () => {
    expect(
      defaultAppearanceTheme(model({ ...both, defaultTextureTheme: null })),
    ).toEqual({ kind: "texture", name: "night" });
    expect(
      defaultAppearanceTheme(
        model({ ...both, defaultTextureTheme: null, textureThemes: [] }),
      ),
    ).toEqual({ kind: "material", name: "paint" });
    expect(defaultAppearanceTheme(model())).toBeNull();
  });
});

describe("layerStore appearance", () => {
  function add(m: CityModel, extra: Record<string, unknown> = {}): string {
    return useLayerStore.getState().addLayer({
      name: "L",
      model: m,
      modelRef: { type: "url", url: "https://host/x.jsonl" },
      visible: true,
      rules: [],
      rulesEnabled: true,
      ...extra,
    });
  }
  const find = (id: string) =>
    useLayerStore.getState().layers.find((l) => l.id === id)!;

  it("seeds the themes and the load default", () => {
    const id = add(model(both));
    expect(find(id).appearanceThemes).toHaveLength(3);
    expect(find(id).selectedAppearance).toEqual({
      kind: "texture",
      name: "rgbTexture",
    });
  });

  it("has no themes and no selection for a model without appearance", () => {
    const id = add(model());
    expect(find(id).appearanceThemes).toEqual([]);
    expect(find(id).selectedAppearance).toBeNull();
  });

  it("keeps a restored theme the model carries, and honours an explicit null", () => {
    const kept = add(model(both), {
      selectedAppearance: { kind: "material", name: "paint" },
    });
    expect(find(kept).selectedAppearance).toEqual({
      kind: "material",
      name: "paint",
    });
    const none = add(model(both), { selectedAppearance: null });
    expect(find(none).selectedAppearance).toBeNull();
  });

  it("falls back to the load default when the restored theme is unknown", () => {
    const id = add(model(both), {
      selectedAppearance: { kind: "texture", name: "gone" },
    });
    expect(find(id).selectedAppearance).toEqual({
      kind: "texture",
      name: "rgbTexture",
    });
  });

  it("offers no themes for a streaming layer", () => {
    const id = add(model(both), { isStreaming: true });
    expect(find(id).appearanceThemes).toEqual([]);
  });

  it("setLayerAppearance replaces the selection", () => {
    const id = add(model(both));
    useLayerStore
      .getState()
      .setLayerAppearance(id, { kind: "texture", name: "night" });
    expect(find(id).selectedAppearance).toEqual({
      kind: "texture",
      name: "night",
    });
    useLayerStore.getState().setLayerAppearance(id, null);
    expect(find(id).selectedAppearance).toBeNull();
  });
});
