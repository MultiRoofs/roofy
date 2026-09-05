import { describe, it, expect, vi } from "vitest";
import {
  syncLayers,
  syncStreamState,
  type LiveLayer,
  type StreamInteractionHandle,
  type StreamSyncMemo,
} from "../../../src/scene/handleSync";
import type { Layer } from "../../../src/features/layers/layerStore";
import type { CityModel } from "../../../src/domain/citymodel/types";

const model: CityModel = {
  sourceEncoding: "cityjsonseq",
  metadata: {},
  bbox: null,
  objects: {},
  vertexCount: 0,
};

function fakeHandle(id: string) {
  return {
    id,
    setVisible: vi.fn(),
    setLod: vi.fn(),
    setStyle: vi.fn(),
    setHighlight: vi.fn(),
    resolvePick: vi.fn(),
    resolveRaycast: vi.fn(),
    getBoundsGeodetic: vi.fn(),
    triangleCount: () => 0,
    heightOffset: () => 0,
    setHiddenTypes: vi.fn(),
    setVisibleObjectIds: vi.fn(),
    setThemeStyle: vi.fn(),
    setAppearance: vi.fn(),
    batchIdMap: () => [],
    delete: vi.fn(),
  };
}

function layer(patch: Partial<Layer> & { id: string }): Layer {
  return {
    name: patch.id,
    model,
    modelRef: { type: "url", url: "https://host/x.jsonl" },
    visible: true,
    rules: [],
    rulesEnabled: true,
    selectedLod: null,
    availableLods: [],
    lodMode: "auto",
    cameraSync: true,
    isStreaming: false,
    hiddenTypes: [],
    visibleObjectIds: null,
    availableObjectTypes: [],
    appearanceThemes: [{ kind: "texture", name: "rgb" }],
    selectedAppearance: { kind: "texture", name: "rgb" },
    ...patch,
  };
}

describe("syncLayers appearance", () => {
  it("seeds a new handle's theme through add and does not push it again", () => {
    const handle = fakeHandle("L1");
    const add = vi.fn(() => handle as never);
    const live = new Map<string, LiveLayer>();
    const l = layer({ id: "L1" });
    syncLayers({ get: () => undefined, add }, [l], live, () => {});
    expect(add).toHaveBeenCalledWith(l);
    expect(handle.setAppearance).not.toHaveBeenCalled();
    // A re-render with an EQUAL but fresh theme object is not a change.
    syncLayers(
      { get: () => undefined, add },
      [
        layer({
          id: "L1",
          selectedAppearance: { kind: "texture", name: "rgb" },
        }),
      ],
      live,
      () => {},
    );
    expect(handle.setAppearance).not.toHaveBeenCalled();
  });

  it("pushes a changed theme, and null when the user picks None", () => {
    const handle = fakeHandle("L1");
    const live = new Map<string, LiveLayer>();
    const registry = { get: () => undefined, add: () => handle as never };
    syncLayers(registry, [layer({ id: "L1" })], live, () => {});
    syncLayers(
      registry,
      [
        layer({
          id: "L1",
          selectedAppearance: { kind: "material", name: "m" },
        }),
      ],
      live,
      () => {},
    );
    expect(handle.setAppearance).toHaveBeenCalledWith({
      kind: "material",
      name: "m",
    });
    syncLayers(
      registry,
      [layer({ id: "L1", selectedAppearance: null })],
      live,
      () => {},
    );
    expect(handle.setAppearance).toHaveBeenLastCalledWith(null);
    expect(handle.setAppearance).toHaveBeenCalledTimes(2);
  });

  it("treats a live entry without a recorded theme as plain colours", () => {
    const handle = fakeHandle("L1");
    const live = new Map<string, LiveLayer>([
      [
        "L1",
        { handle: handle as never, lod: null, visible: true, hiddenTypes: [] },
      ],
    ]);
    const registry = { get: () => handle as never, add: () => handle as never };
    syncLayers(
      registry,
      [layer({ id: "L1", selectedAppearance: null })],
      live,
      () => {},
    );
    expect(handle.setAppearance).not.toHaveBeenCalled();
    syncLayers(registry, [layer({ id: "L1" })], live, () => {});
    expect(handle.setAppearance).toHaveBeenCalledWith({
      kind: "texture",
      name: "rgb",
    });
  });
});

describe("syncStreamState appearance", () => {
  function streamHandle(): StreamInteractionHandle {
    return {
      id: "S1",
      setRules: vi.fn(),
      setLod: vi.fn(),
      setVisible: vi.fn(),
      setCameraSync: vi.fn(),
      setThemeStyle: vi.fn(),
      setHiddenTypes: vi.fn(),
      setAppearance: vi.fn(),
      onCommit: () => () => {},
      lastQueryRegion: () => null,
      onQueryRegion: () => () => {},
      setHighlight: vi.fn(),
      resolvePick: vi.fn(),
      resolveRaycast: vi.fn(),
      getBoundsGeodetic: vi.fn(),
      triangleCount: () => 0,
      heightOffset: () => 0,
    } as unknown as StreamInteractionHandle;
  }

  it("pushes the theme by value and only when it changes", () => {
    const handle = streamHandle();
    const memos = new Map<string, StreamSyncMemo>();
    const l = layer({ id: "S1", isStreaming: true });
    syncStreamState(l, handle, memos);
    expect(handle.setAppearance).toHaveBeenCalledWith({
      kind: "texture",
      name: "rgb",
    });
    syncStreamState(
      layer({
        id: "S1",
        isStreaming: true,
        selectedAppearance: { kind: "texture", name: "rgb" },
      }),
      handle,
      memos,
    );
    expect(handle.setAppearance).toHaveBeenCalledTimes(1);
    syncStreamState(
      layer({ id: "S1", isStreaming: true, selectedAppearance: null }),
      handle,
      memos,
    );
    expect(handle.setAppearance).toHaveBeenLastCalledWith(null);
  });
});
