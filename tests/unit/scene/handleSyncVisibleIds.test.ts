import { describe, expect, it, vi } from "vitest";
import { syncLayers } from "../../../src/scene/handleSync";
import type { LiveLayer } from "../../../src/scene/handleSync";
import type { Layer } from "../../../src/features/layers/layerStore";
import type { CityModel } from "../../../src/domain/citymodel/types";

function fakeHandle(id: string) {
  return {
    id,
    setVisible: vi.fn(),
    setLod: vi.fn(),
    setHiddenTypes: vi.fn(),
    setVisibleObjectIds: vi.fn(),
    setStyle: vi.fn(),
    setThemeStyle: vi.fn(),
    setAppearance: vi.fn(),
    setModel: vi.fn(),
    setHighlight: vi.fn(),
    resolvePick: vi.fn(),
    resolveRaycast: vi.fn(),
    getBoundsGeodetic: vi.fn(),
    triangleCount: vi.fn(() => 0),
    delete: vi.fn(),
  };
}

function layer(over: Partial<Layer> = {}): Layer {
  return {
    id: "L",
    name: "l",
    model: {
      sourceEncoding: "cityjson",
      metadata: {},
      bbox: null,
      objects: {},
      vertexCount: 0,
    } as unknown as CityModel,
    modelRef: { type: "url", url: "https://x/a.city.json" },
    visible: true,
    rules: [],
    rulesEnabled: true,
    selectedLod: null,
    availableLods: [],
    lodMode: "auto",
    cameraSync: true,
    hiddenTypes: [],
    availableObjectTypes: [],
    appearanceThemes: [],
    selectedAppearance: null,
    isStreaming: false,
    visibleObjectIds: null,
    ...over,
  } as Layer;
}

describe("syncLayers pushes visibleObjectIds", () => {
  it("pushes a new set once, and not again on an unrelated re-sync", () => {
    const handle = fakeHandle("L");
    const registry = { get: () => undefined, add: () => handle as never };
    const live = new Map<string, LiveLayer>();
    const ids = new Set(["B1"]);

    syncLayers(registry, [layer({ visibleObjectIds: ids })], live, () => {});
    expect(handle.setVisibleObjectIds).toHaveBeenCalledWith(ids);

    handle.setVisibleObjectIds.mockClear();
    syncLayers(registry, [layer({ visibleObjectIds: ids })], live, () => {});
    expect(handle.setVisibleObjectIds).not.toHaveBeenCalled();
  });

  it("pushes a REPLACEMENT set — identity is the change test", () => {
    const handle = fakeHandle("L");
    const registry = { get: () => undefined, add: () => handle as never };
    const live = new Map<string, LiveLayer>();

    syncLayers(
      registry,
      [layer({ visibleObjectIds: new Set(["B1"]) })],
      live,
      () => {},
    );
    handle.setVisibleObjectIds.mockClear();
    const next = new Set(["B1"]);
    syncLayers(registry, [layer({ visibleObjectIds: next })], live, () => {});
    expect(handle.setVisibleObjectIds).toHaveBeenCalledWith(next);
  });

  it("pushes null when the filter is cleared", () => {
    const handle = fakeHandle("L");
    const registry = { get: () => undefined, add: () => handle as never };
    const live = new Map<string, LiveLayer>();

    syncLayers(
      registry,
      [layer({ visibleObjectIds: new Set(["B1"]) })],
      live,
      () => {},
    );
    handle.setVisibleObjectIds.mockClear();
    syncLayers(registry, [layer({ visibleObjectIds: null })], live, () => {});
    expect(handle.setVisibleObjectIds).toHaveBeenCalledWith(null);
  });
});
