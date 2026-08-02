import { describe, expect, it, vi } from "vitest";
import type { Selection } from "@cityjson/navara-cityjson";
import type { Layer } from "../../../src/features/layers/layerStore";
import {
  interactionHandles,
  syncHighlight,
  syncLayers,
  totalTriangles,
  type LiveLayer,
} from "../../../src/scene/handleSync";

function fakeHandle(id: string, triangles = 100) {
  return {
    id,
    setVisible: vi.fn(),
    setLod: vi.fn(),
    setStyle: vi.fn(),
    setHighlight: vi.fn(),
    resolvePick: vi.fn(),
    getBoundsGeodetic: vi.fn(),
    triangleCount: () => triangles,
    delete: vi.fn(),
  };
}

function layer(patch: Partial<Layer> & { id: string }): Layer {
  return {
    name: patch.id,
    model: {
      sourceEncoding: "cityjson",
      metadata: {},
      bbox: null,
      objects: {},
      vertexCount: 0,
    },
    modelRef: { kind: "url", url: "x" },
    visible: true,
    rules: [],
    rulesEnabled: false,
    selectedLod: "2",
    availableLods: ["2", "1"],
    lodMode: "manual",
    isStreaming: false,
    ...patch,
  } as Layer;
}

describe("syncLayers", () => {
  it("adds a handle for a new layer", () => {
    const handle = fakeHandle("L1");
    const registry = { get: () => undefined, add: vi.fn(() => handle) };
    const live = new Map<string, LiveLayer>();
    syncLayers(registry as never, [layer({ id: "L1" })], live, () => {});
    expect(registry.add).toHaveBeenCalledTimes(1);
    expect(live.get("L1")!.handle).toBe(handle);
  });

  it("deletes the handle of a removed layer", () => {
    const handle = fakeHandle("L1");
    const live = new Map<string, LiveLayer>([
      ["L1", { handle: handle as never, lod: "2", visible: true }],
    ]);
    syncLayers(
      { get: () => undefined, add: vi.fn() } as never,
      [],
      live,
      () => {},
    );
    expect(handle.delete).toHaveBeenCalledTimes(1);
    expect(live.size).toBe(0);
  });

  it("pushes only changed visibility and LoD", () => {
    const handle = fakeHandle("L1");
    const live = new Map<string, LiveLayer>([
      ["L1", { handle: handle as never, lod: "2", visible: true }],
    ]);
    const registry = { get: () => handle, add: vi.fn() };
    syncLayers(registry as never, [layer({ id: "L1" })], live, () => {});
    expect(handle.setVisible).not.toHaveBeenCalled();
    expect(handle.setLod).not.toHaveBeenCalled();

    syncLayers(
      registry as never,
      [layer({ id: "L1", visible: false, selectedLod: "1" })],
      live,
      () => {},
    );
    expect(handle.setVisible).toHaveBeenCalledWith(false);
    expect(handle.setLod).toHaveBeenCalledWith("1");
  });

  it("rebuilds through setLod rather than recreating the handle", () => {
    const handle = fakeHandle("L1");
    const live = new Map<string, LiveLayer>([
      ["L1", { handle: handle as never, lod: "2", visible: true }],
    ]);
    const registry = { get: () => handle, add: vi.fn() };
    syncLayers(
      registry as never,
      [layer({ id: "L1", selectedLod: "1" })],
      live,
      () => {},
    );
    expect(handle.delete).not.toHaveBeenCalled();
    expect(registry.add).not.toHaveBeenCalled();
    expect(live.get("L1")!.handle).toBe(handle);
    expect(live.get("L1")!.lod).toBe("1");
  });

  it("clears the LoD filter when the layer's selection goes null", () => {
    const handle = fakeHandle("L1");
    const live = new Map<string, LiveLayer>([
      ["L1", { handle: handle as never, lod: "2", visible: true }],
    ]);
    syncLayers(
      { get: () => handle, add: vi.fn() } as never,
      [layer({ id: "L1", selectedLod: null })],
      live,
      () => {},
    );
    expect(handle.setLod).toHaveBeenCalledWith(null);
    expect(live.get("L1")!.lod).toBeNull();
  });

  it("reports an add failure through onError without throwing (CRS gate)", () => {
    const registry = {
      get: () => undefined,
      add: () => {
        throw new Error("Cannot georeference this layer");
      },
    };
    const errors: Array<[string, unknown]> = [];
    const live = new Map<string, LiveLayer>();
    expect(() =>
      syncLayers(registry as never, [layer({ id: "L1" })], live, (id, e) =>
        errors.push([id, e]),
      ),
    ).not.toThrow();
    expect(errors[0]![0]).toBe("L1");
    expect(live.size).toBe(0);
  });

  it("keeps syncing the remaining layers after one fails to add", () => {
    const ok = fakeHandle("L2");
    const registry = {
      get: () => undefined,
      add: vi.fn((l: Layer) => {
        if (l.id === "L1") throw new Error("boom");
        return ok;
      }),
    };
    const live = new Map<string, LiveLayer>();
    const errors: string[] = [];
    syncLayers(
      registry as never,
      [layer({ id: "L1" }), layer({ id: "L2" })],
      live,
      (id) => errors.push(id),
    );
    expect(errors).toEqual(["L1"]);
    expect(live.get("L2")!.handle).toBe(ok);
  });

  it("skips streaming layers (M7.5 owns those)", () => {
    const registry = { get: () => undefined, add: vi.fn() };
    syncLayers(
      registry as never,
      [layer({ id: "S1", isStreaming: true })],
      new Map(),
      () => {},
    );
    expect(registry.add).not.toHaveBeenCalled();
  });

  it("drops the static handle of a layer that turns into a stream", () => {
    const handle = fakeHandle("L1");
    const live = new Map<string, LiveLayer>([
      ["L1", { handle: handle as never, lod: "2", visible: true }],
    ]);
    syncLayers(
      { get: () => handle, add: vi.fn() } as never,
      [layer({ id: "L1", isStreaming: true })],
      live,
      () => {},
    );
    expect(handle.delete).toHaveBeenCalledTimes(1);
    expect(live.size).toBe(0);
  });
});

describe("totalTriangles", () => {
  it("counts only visible layers", () => {
    const live = new Map<string, LiveLayer>([
      [
        "L1",
        { handle: fakeHandle("L1", 30) as never, lod: "2", visible: true },
      ],
      [
        "L2",
        { handle: fakeHandle("L2", 70) as never, lod: "2", visible: false },
      ],
    ]);
    expect(
      totalTriangles(
        [layer({ id: "L1" }), layer({ id: "L2", visible: false })],
        live,
      ),
    ).toBe(30);
  });

  it("counts streaming handles from the second registry too", () => {
    const live = new Map<string, LiveLayer>([
      [
        "L1",
        { handle: fakeHandle("L1", 30) as never, lod: "2", visible: true },
      ],
    ]);
    const streams = new Map([["S1", fakeHandle("S1", 12) as never]]);
    expect(
      totalTriangles(
        [layer({ id: "L1" }), layer({ id: "S1", isStreaming: true })],
        live,
        streams,
      ),
    ).toBe(42);
  });

  it("is zero when nothing has a handle yet", () => {
    expect(totalTriangles([layer({ id: "L1" })], new Map())).toBe(0);
  });
});

describe("interactionHandles", () => {
  it("returns visible layers' handles in layer order, static and streaming alike", () => {
    const h1 = fakeHandle("L1");
    const s1 = fakeHandle("S1");
    const live = new Map<string, LiveLayer>([
      ["L1", { handle: h1 as never, lod: "2", visible: true }],
    ]);
    const streams = new Map([["S1", s1 as never]]);
    const layers = [
      layer({ id: "S1", isStreaming: true }),
      layer({ id: "L1" }),
      layer({ id: "L2", visible: false }),
    ];
    expect(interactionHandles(layers, live, streams)).toEqual([s1, h1]);
  });

  it("defaults the streaming registry to empty", () => {
    const h1 = fakeHandle("L1");
    const live = new Map<string, LiveLayer>([
      ["L1", { handle: h1 as never, lod: "2", visible: true }],
    ]);
    expect(
      interactionHandles(
        [layer({ id: "S1", isStreaming: true }), layer({ id: "L1" })],
        live,
      ),
    ).toEqual([h1]);
  });
});

describe("syncHighlight", () => {
  const sel: Selection = { kind: "object", layerId: "L1", objectId: "B1" };
  const hover: Selection = {
    kind: "surface",
    layerId: "S1",
    objectId: "B9",
    surfaceIndex: 2,
  };

  it("pushes the full selection to every handle — each one filters by layerId", () => {
    const h1 = fakeHandle("L1");
    const s1 = fakeHandle("S1");
    syncHighlight([h1, s1] as never, [sel], hover);
    expect(h1.setHighlight).toHaveBeenCalledWith([sel], hover);
    expect(s1.setHighlight).toHaveBeenCalledWith([sel], hover);
  });

  it("normalizes a null hover to undefined", () => {
    const h1 = fakeHandle("L1");
    syncHighlight([h1] as never, [], null);
    expect(h1.setHighlight).toHaveBeenCalledWith([], undefined);
  });
});
