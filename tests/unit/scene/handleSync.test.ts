import { describe, expect, it, vi } from "vitest";
import type { Selection, ThemeStyle } from "@cityjson/navara-cityjson";
import type { Layer } from "../../../src/features/layers/layerStore";
import type { Rule } from "../../../src/features/rules/types";
import type { Surface } from "../../../src/domain/citymodel/types";
import {
  allInteractionHandles,
  interactionHandles,
  layerHeightOffset,
  resolvePickedFeature,
  syncHighlight,
  syncLayers,
  syncStreamState,
  syncStyles,
  totalTriangles,
  type LiveLayer,
  type StreamSyncMemo,
} from "../../../src/scene/handleSync";
import {
  effectiveRules,
  isSyntheticRule,
  normalizeColorBy,
} from "../../../src/features/rules/colorBy";

function fakeHandle(id: string, triangles = 100) {
  return {
    id,
    setVisible: vi.fn(),
    setLod: vi.fn(),
    setStyle: vi.fn(),
    setHighlight: vi.fn(),
    resolvePick: vi.fn(),
    resolveRaycast: vi.fn(),
    getBoundsGeodetic: vi.fn(),
    triangleCount: () => triangles,
    heightOffset: vi.fn(() => 0),
    setHiddenTypes: vi.fn(),
    setVisibleObjectIds: vi.fn(),
    setAppearance: vi.fn(),
    setModel: vi.fn(),
    delete: vi.fn(),
  };
}

function layer(patch: Partial<Layer> & { id: string }): Layer {
  // `colorBy` is DERIVED from the rules unless the case states a mode, so
  // every test written before "Color by" existed still means what it said:
  // rules read as "Color by rules".
  const colorBy = normalizeColorBy({
    colorBy: patch.colorBy,
    singleColor: patch.singleColor,
    unmatchedColor: patch.unmatchedColor,
    rules: patch.rules,
  });
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
    selectedLod: "2",
    availableLods: ["2", "1"],
    lodMode: "manual",
    // Matches the store's real default (`addLayer`): every layer starts
    // following the camera, and freezing an extract is a deliberate act.
    cameraSync: true,
    hiddenTypes: [],
    availableObjectTypes: [],
    appearanceThemes: [],
    selectedAppearance: null,
    isStreaming: false,
    ...patch,
    ...colorBy,
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
      [
        "L1",
        { handle: handle as never, lod: "2", visible: true, hiddenTypes: [] },
      ],
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
      [
        "L1",
        { handle: handle as never, lod: "2", visible: true, hiddenTypes: [] },
      ],
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
      [
        "L1",
        { handle: handle as never, lod: "2", visible: true, hiddenTypes: [] },
      ],
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
      [
        "L1",
        { handle: handle as never, lod: "2", visible: true, hiddenTypes: [] },
      ],
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

  it("pushes hiddenTypes only when the array identity changes", () => {
    const handle = fakeHandle("L1");
    const live = new Map<string, LiveLayer>([
      [
        "L1",
        { handle: handle as never, lod: "2", visible: true, hiddenTypes: [] },
      ],
    ]);
    const registry = { get: () => handle, add: vi.fn() };
    const hidden = ["Building"];

    syncLayers(
      registry as never,
      [layer({ id: "L1", hiddenTypes: hidden })],
      live,
      () => {},
    );
    expect(handle.setHiddenTypes).toHaveBeenCalledWith(hidden);

    // Each push rebuilds the layer's merged geometry (the seam a LoD change
    // uses), so a re-render with the SAME array must not pay for one.
    handle.setHiddenTypes.mockClear();
    syncLayers(
      registry as never,
      [layer({ id: "L1", hiddenTypes: hidden })],
      live,
      () => {},
    );
    expect(handle.setHiddenTypes).not.toHaveBeenCalled();
  });

  it("does not push hiddenTypes to a freshly added handle — `add` built it filtered", () => {
    const handle = fakeHandle("L1");
    const registry = { get: () => undefined, add: vi.fn(() => handle) };
    const live = new Map<string, LiveLayer>();
    syncLayers(
      registry as never,
      [layer({ id: "L1", hiddenTypes: ["Building"] })],
      live,
      () => {},
    );
    expect(handle.setHiddenTypes).not.toHaveBeenCalled();
    expect(live.get("L1")!.hiddenTypes).toEqual(["Building"]);
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
      [
        "L1",
        { handle: handle as never, lod: "2", visible: true, hiddenTypes: [] },
      ],
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

  // The model write-back seam: a processing tool's computed attributes reach
  // the mesh as a NEW model (`layerStore.mergeAttributes`), and `setModel` is
  // a full repaint of the layer — so it is pushed on model IDENTITY and on
  // nothing else.
  it("pushes a new model identity to setModel, and pushes it once", () => {
    const handle = fakeHandle("L1");
    const registry = { get: () => handle, add: vi.fn(() => handle) };
    const live = new Map<string, LiveLayer>();
    const before = layer({ id: "L1" });
    syncLayers(registry as never, [before], live, () => {});
    // Seeded by the add, not pushed: `registry.add` builds the mesh from
    // exactly this model.
    expect(handle.setModel).not.toHaveBeenCalled();

    const merged = {
      ...before.model,
      objects: { ...before.model.objects },
    };
    const after = layer({ id: "L1", model: merged });
    syncLayers(registry as never, [after], live, () => {});
    expect(handle.setModel).toHaveBeenCalledTimes(1);
    expect(handle.setModel).toHaveBeenCalledWith(merged);
    expect(live.get("L1")!.model).toBe(merged);

    // An unrelated store change must not repaint the layer again.
    syncLayers(registry as never, [after], live, () => {});
    expect(handle.setModel).toHaveBeenCalledTimes(1);
  });
});

describe("totalTriangles", () => {
  it("counts only visible layers", () => {
    const live = new Map<string, LiveLayer>([
      [
        "L1",
        {
          handle: fakeHandle("L1", 30) as never,
          lod: "2",
          visible: true,
          hiddenTypes: [],
        },
      ],
      [
        "L2",
        {
          handle: fakeHandle("L2", 70) as never,
          lod: "2",
          visible: false,
          hiddenTypes: [],
        },
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
        {
          handle: fakeHandle("L1", 30) as never,
          lod: "2",
          visible: true,
          hiddenTypes: [],
        },
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
      ["L1", { handle: h1 as never, lod: "2", visible: true, hiddenTypes: [] }],
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
      ["L1", { handle: h1 as never, lod: "2", visible: true, hiddenTypes: [] }],
    ]);
    expect(
      interactionHandles(
        [layer({ id: "S1", isStreaming: true }), layer({ id: "L1" })],
        live,
      ),
    ).toEqual([h1]);
  });
});

describe("syncStyles", () => {
  const roofRule: Rule = {
    id: "r1",
    name: "flat roofs",
    color: "#4ec84e",
    conditions: [],
    logic: "AND",
    enabled: true,
  };
  const roof: Surface = {
    type: "RoofSurface",
    rings: [
      [
        [0, 0, 10],
        [10, 0, 10],
        [10, 10, 10],
      ],
    ],
    attributes: {},
    lod: "2",
  };

  function live(handle: ReturnType<typeof fakeHandle>) {
    return new Map<string, LiveLayer>([
      [
        "L1",
        { handle: handle as never, lod: "2", visible: true, hiddenTypes: [] },
      ],
    ]);
  }

  it("compiles the layer's rules and pushes them to the handle", () => {
    const handle = fakeHandle("L1");
    const entries = live(handle);
    syncStyles([layer({ id: "L1", rules: [roofRule] })], entries);

    expect(handle.setStyle).toHaveBeenCalledTimes(1);
    // What was pushed is a working evaluator, not just "some function":
    // a roof gets the rule color, a wall keeps its base color.
    const evaluate = handle.setStyle.mock.calls[0]![0] as (
      s: unknown,
      o: unknown,
    ) => readonly number[] | null;
    const object = {
      objectId: "B1",
      object: { attributes: {}, surfaces: [roof] },
    };
    expect(evaluate({ surfaceIndex: 0, surface: roof }, object)).toHaveLength(
      3,
    );
    expect(
      evaluate(
        { surfaceIndex: 0, surface: { ...roof, type: "WallSurface" } },
        object,
      ),
    ).toBeNull();
  });

  it("never touches a handle whose layer has no rules", () => {
    const handle = fakeHandle("L1");
    syncStyles([layer({ id: "L1" })], live(handle));
    // Not even setStyle(null): a fresh handle is already unstyled, and a
    // needless push would repaint every vertex of the layer.
    expect(handle.setStyle).not.toHaveBeenCalled();
  });

  it("never styles a layer whose rules are switched off", () => {
    const handle = fakeHandle("L1");
    syncStyles(
      [layer({ id: "L1", rules: [roofRule], colorBy: "surface" })],
      live(handle),
    );
    expect(handle.setStyle).not.toHaveBeenCalled();
  });

  it("pushes once, then not again while the rules are unchanged", () => {
    const handle = fakeHandle("L1");
    const entries = live(handle);
    const rules = [roofRule];
    const l = layer({ id: "L1", rules });
    syncStyles([l], entries);
    // A re-render with the same rules array (any unrelated store change) must
    // not recompile or repaint.
    syncStyles([layer({ id: "L1", rules })], entries);
    syncStyles([l], entries);
    expect(handle.setStyle).toHaveBeenCalledTimes(1);
  });

  it("re-pushes when the rules array changes", () => {
    const handle = fakeHandle("L1");
    const entries = live(handle);
    syncStyles([layer({ id: "L1", rules: [roofRule] })], entries);
    syncStyles(
      [
        layer({
          id: "L1",
          rules: [{ ...roofRule, color: "#ff0000" }],
        }),
      ],
      entries,
    );
    expect(handle.setStyle).toHaveBeenCalledTimes(2);
    expect(handle.setStyle.mock.calls[1]![0]).not.toBe(
      handle.setStyle.mock.calls[0]![0],
    );
  });

  it("clears the style when the layer's rules are switched off", () => {
    const handle = fakeHandle("L1");
    const entries = live(handle);
    const rules = [roofRule];
    syncStyles([layer({ id: "L1", rules })], entries);
    syncStyles([layer({ id: "L1", rules, colorBy: "surface" })], entries);
    expect(handle.setStyle).toHaveBeenCalledTimes(2);
    expect(handle.setStyle).toHaveBeenLastCalledWith(null);
  });

  it("keeps painting when the last enabled rule is disabled — everything is now UNMATCHED", () => {
    const handle = fakeHandle("L1");
    const entries = live(handle);
    syncStyles(
      [layer({ id: "L1", rules: [roofRule], colorBy: "rules" })],
      entries,
    );
    syncStyles(
      [
        layer({
          id: "L1",
          rules: [{ ...roofRule, enabled: false }],
          colorBy: "rules",
        }),
      ],
      entries,
    );
    // Not `setStyle(null)`, which is what this used to assert: a layer that is
    // colouring BY RULES and matches none of them is not a layer colouring by
    // surface type — every roof wears the unmatched colour, which is a fact the
    // user can see and act on. Going back to the semantic palette is a MODE
    // change now, and the round-trip test below covers it.
    expect(handle.setStyle).toHaveBeenCalledTimes(2);
    expect(handle.setStyle.mock.calls[1]![0]).not.toBeNull();
  });

  it("styles a layer again after it was re-added (a fresh handle is unstyled)", () => {
    const first = fakeHandle("L1");
    const entries = live(first);
    const rules = [roofRule];
    syncStyles([layer({ id: "L1", rules })], entries);

    const second = fakeHandle("L1");
    entries.set("L1", {
      handle: second as never,
      lod: "2",
      visible: true,
      hiddenTypes: [],
    });
    syncStyles([layer({ id: "L1", rules })], entries);
    expect(second.setStyle).toHaveBeenCalledTimes(1);
  });

  it("never styles a streaming layer (its colors are worker-baked)", () => {
    const handle = fakeHandle("S1");
    const entries = new Map<string, LiveLayer>([
      [
        "S1",
        { handle: handle as never, lod: "2", visible: true, hiddenTypes: [] },
      ],
    ]);
    syncStyles(
      [
        layer({
          id: "S1",
          isStreaming: true,
          rules: [roofRule],
        }),
      ],
      entries,
    );
    expect(handle.setStyle).not.toHaveBeenCalled();
  });

  it("skips a layer that has no live handle (its add was refused)", () => {
    expect(() =>
      syncStyles([layer({ id: "L1", rules: [roofRule] })], new Map()),
    ).not.toThrow();
  });

  it("styles hidden layers too, so a re-shown layer is already correct", () => {
    const handle = fakeHandle("L1");
    syncStyles(
      [
        layer({
          id: "L1",
          visible: false,
          rules: [roofRule],
        }),
      ],
      live(handle),
    );
    expect(handle.setStyle).toHaveBeenCalledTimes(1);
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

  it("skips a handle whose OWN filtered view did not change", () => {
    // `setHighlight` re-runs computeStyleColors over the whole layer, so this
    // is the difference between one recolor and one recolor PER LAYER on every
    // hover step.
    const a = fakeHandle("L1");
    const b = fakeHandle("L2");
    const memo = new WeakMap<never, string>();
    const inA: Selection = { kind: "object", layerId: "L1", objectId: "B1" };
    const alsoInA: Selection = {
      kind: "object",
      layerId: "L1",
      objectId: "B2",
    };

    syncHighlight([a, b] as never, [], inA, memo as never);
    expect(a.setHighlight).toHaveBeenCalledTimes(1);
    expect(b.setHighlight).toHaveBeenCalledTimes(1);

    // The hover moved to another building in layer L1: L1 repaints, L2 does not.
    syncHighlight([a, b] as never, [], alsoInA, memo as never);
    expect(a.setHighlight).toHaveBeenCalledTimes(2);
    expect(b.setHighlight).toHaveBeenCalledTimes(1);

    // Nothing at all changed: neither repaints.
    syncHighlight([a, b] as never, [], alsoInA, memo as never);
    expect(a.setHighlight).toHaveBeenCalledTimes(2);
    expect(b.setHighlight).toHaveBeenCalledTimes(1);
  });

  it("pushes to BOTH handles when a selection change touches both layers", () => {
    const a = fakeHandle("L1");
    const b = fakeHandle("L2");
    const memo = new WeakMap<never, string>();
    const inA: Selection = { kind: "object", layerId: "L1", objectId: "B1" };
    const inB: Selection = { kind: "object", layerId: "L2", objectId: "B9" };

    syncHighlight([a, b] as never, [inA], null, memo as never);
    // Selecting in L2 instead: L1 must CLEAR and L2 must paint.
    syncHighlight([a, b] as never, [inB], null, memo as never);
    expect(a.setHighlight).toHaveBeenCalledTimes(2);
    expect(b.setHighlight).toHaveBeenCalledTimes(2);
  });

  it("distinguishes a surface selection from the object it belongs to", () => {
    const a = fakeHandle("L1");
    const memo = new WeakMap<never, string>();
    syncHighlight(
      [a] as never,
      [{ kind: "object", layerId: "L1", objectId: "B1" }],
      null,
      memo as never,
    );
    syncHighlight(
      [a] as never,
      [{ kind: "surface", layerId: "L1", objectId: "B1", surfaceIndex: 0 }],
      null,
      memo as never,
    );
    expect(a.setHighlight).toHaveBeenCalledTimes(2);
  });

  it("always pushes to a FRESH handle, even for the same layer id", () => {
    // A removed-and-re-added layer gets a new mesh with no highlight on it; an
    // id-keyed memo would report "already up to date" and leave it blank.
    const memo = new WeakMap<never, string>();
    const sel: Selection = { kind: "object", layerId: "L1", objectId: "B1" };
    syncHighlight([fakeHandle("L1")] as never, [sel], null, memo as never);
    const reborn = fakeHandle("L1");
    syncHighlight([reborn] as never, [sel], null, memo as never);
    expect(reborn.setHighlight).toHaveBeenCalledTimes(1);
  });

  it("pushes unconditionally when no memo is supplied", () => {
    const a = fakeHandle("L1");
    syncHighlight([a] as never, [sel], null);
    syncHighlight([a] as never, [sel], null);
    expect(a.setHighlight).toHaveBeenCalledTimes(2);
  });

  it("reaches HIDDEN layers through allInteractionHandles", () => {
    // Task B5 carry-forward: each handle filters the selection by its own
    // layerId, so pushing the whole array is safe — but a hidden layer must
    // still be updated, or re-showing it would reveal a stale highlight.
    const hidden = fakeHandle("L1");
    const live = new Map<string, LiveLayer>([
      [
        "L1",
        { handle: hidden as never, lod: "2", visible: false, hiddenTypes: [] },
      ],
    ]);
    const layers = [layer({ id: "L1", visible: false })];
    expect(interactionHandles(layers, live)).toEqual([]);
    syncHighlight(allInteractionHandles(layers, live), [sel], null);
    expect(hidden.setHighlight).toHaveBeenCalledWith([sel], undefined);
  });

  it("highlights streaming layers from the second registry too", () => {
    const stream = fakeHandle("S1");
    const streamSel: Selection = {
      kind: "object",
      layerId: "S1",
      objectId: "B7",
    };
    syncHighlight(
      allInteractionHandles(
        [layer({ id: "S1", isStreaming: true })],
        new Map(),
        new Map([["S1", stream as never]]),
      ),
      [streamSel],
      null,
    );
    expect(stream.setHighlight).toHaveBeenCalledWith([streamSel], undefined);
  });
});

describe("resolvePickedFeature", () => {
  const hit: Selection = {
    kind: "surface",
    layerId: "L2",
    objectId: "B1",
    surfaceIndex: 3,
  };

  function owner(id: string, result: Selection | null) {
    return {
      id,
      setHighlight: vi.fn(),
      resolvePick: vi.fn(() => result),
      resolveRaycast: vi.fn(() => null),
      getBoundsGeodetic: vi.fn(() => null),
      triangleCount: () => 0,
    };
  }

  it("delegates to the handle named by properties.layerId, not the first one that answers", () => {
    // h1 would happily return a selection if asked — the point is that it is
    // never asked, because the feature says it belongs to L2. A batchId is only
    // meaningful inside the mesh that produced it, so asking the wrong handle
    // would return a real-looking but WRONG surface.
    const h1 = owner("L1", {
      kind: "surface",
      layerId: "L1",
      objectId: "WRONG",
      surfaceIndex: 0,
    });
    const h2 = owner("L2", hit);
    const feature = { batchId: 7, properties: { layerId: "L2" } };

    expect(resolvePickedFeature([h1, h2] as never, feature)).toBe(hit);
    expect(h1.resolvePick).not.toHaveBeenCalled();
    expect(h2.resolvePick).toHaveBeenCalledWith(feature);
  });

  it("reads the layer id our meshes actually stamp: object3d.userData", () => {
    // Task B7 review: `PickedFeature.properties` is null for custom meshes, so
    // the identity carrier is the Object3D's userData — which is where
    // `CityModelMesh` writes `layerId`.
    const h1 = owner("L1", hit);
    const feature = { batchId: 7, object3d: { userData: { layerId: "L1" } } };
    expect(resolvePickedFeature([h1] as never, feature)).toBe(hit);
    expect(h1.resolvePick).toHaveBeenCalledWith(feature);
  });

  it("returns null for an unknown layerId instead of guessing", () => {
    const h1 = owner("L1", hit);
    expect(
      resolvePickedFeature([h1] as never, {
        batchId: 7,
        properties: { layerId: "GONE" },
      }),
    ).toBeNull();
    expect(h1.resolvePick).not.toHaveBeenCalled();
  });

  it("returns null when the feature carries no layerId at all", () => {
    const h1 = owner("L1", hit);
    expect(resolvePickedFeature([h1] as never, { batchId: 7 })).toBeNull();
    expect(h1.resolvePick).not.toHaveBeenCalled();
  });

  it("falls back to the top-level layerId the engine reports", () => {
    const h1 = owner("L1", hit);
    expect(
      resolvePickedFeature([h1] as never, { batchId: 7, layerId: "L1" }),
    ).toBe(hit);
  });

  it("passes a null through when the owning handle cannot resolve the feature", () => {
    const h1 = owner("L1", null);
    expect(
      resolvePickedFeature([h1] as never, {
        batchId: 99,
        properties: { layerId: "L1" },
      }),
    ).toBeNull();
  });
});

describe("layerHeightOffset", () => {
  it("reads the live handle's offset, so a cursor readout can go orthometric", () => {
    const handle = fakeHandle("L1");
    handle.heightOffset.mockReturnValue(43.2);
    const live = new Map<string, LiveLayer>([
      [
        "L1",
        { handle: handle as never, lod: "2", visible: true, hiddenTypes: [] },
      ],
    ]);
    expect(layerHeightOffset("L1", live)).toBe(43.2);
  });

  it("is 0 for an unknown layer, an absent id, or a handle that has none", () => {
    const live = new Map<string, LiveLayer>();
    expect(layerHeightOffset("L1", live)).toBe(0);
    expect(layerHeightOffset(undefined, live)).toBe(0);
    // A streaming handle from Part C may not publish one yet.
    const stream = { id: "S1", setHighlight: vi.fn() };
    expect(
      layerHeightOffset("S1", live, new Map([["S1", stream as never]])),
    ).toBe(0);
  });

  it("falls back to a non-finite offset as 0 rather than poisoning the readout", () => {
    const handle = fakeHandle("L1");
    handle.heightOffset.mockReturnValue(Number.NaN);
    const live = new Map<string, LiveLayer>([
      [
        "L1",
        { handle: handle as never, lod: "2", visible: true, hiddenTypes: [] },
      ],
    ]);
    expect(layerHeightOffset("L1", live)).toBe(0);
  });
});

describe("syncStreamState", () => {
  function fakeStreamHandle(id = "S1") {
    return {
      id,
      setHighlight: vi.fn(),
      resolvePick: vi.fn(),
      resolveRaycast: vi.fn(),
      getBoundsGeodetic: vi.fn(),
      triangleCount: () => 0,
      onCommit: vi.fn(() => () => undefined),
      setRules: vi.fn(),
      setLod: vi.fn(),
      setVisible: vi.fn(),
      setCameraSync: vi.fn(),
      setHiddenTypes: vi.fn(),
      setAppearance: vi.fn(),
    };
  }

  it("pushes rules, LoD and visibility on the first pass", () => {
    const handle = fakeStreamHandle();
    const memos = new Map<string, StreamSyncMemo>();
    const rules: Rule[] = [
      {
        id: "r",
        name: "r",
        color: "#fff",
        conditions: [],
        logic: "AND",
        enabled: true,
      },
    ];
    const l = layer({
      id: "S1",
      isStreaming: true,
      rules,
      visible: false,
      lodMode: "auto",
      selectedLod: null,
    });

    syncStreamState(l, handle as never, memos);

    // Rules as DATA — never a compiled SurfaceStyleEvaluator (shared contract
    // -> Streaming styling) — and the EFFECTIVE list, so a streamed cell and a
    // resident mesh are baked from one answer: the user's rule, then the
    // trailing unmatched catch-all.
    expect(handle.setRules).toHaveBeenCalledWith(effectiveRules(l), true);
    const pushed = handle.setRules.mock.calls[0]![0] as ReadonlyArray<Rule>;
    expect(pushed[0]).toBe(rules[0]);
    expect(isSyntheticRule(pushed[pushed.length - 1]!)).toBe(true);
    expect(handle.setLod).toHaveBeenCalledWith("auto", null);
    expect(handle.setVisible).toHaveBeenCalledWith(false);
    expect(handle.setCameraSync).toHaveBeenCalledWith(true);
  });

  it("freezes a layer whose camera sync was switched off, and thaws it again", () => {
    const handle = fakeStreamHandle();
    const memos = new Map<string, StreamSyncMemo>();
    const l = layer({ id: "S1", isStreaming: true });
    syncStreamState(l, handle as never, memos);
    handle.setCameraSync.mockClear();

    // OFF is the whole point of the control: the plugin stops committing, so
    // no further cells are fetched however far the camera moves.
    syncStreamState({ ...l, cameraSync: false }, handle as never, memos);
    expect(handle.setCameraSync).toHaveBeenCalledWith(false);

    handle.setCameraSync.mockClear();
    syncStreamState({ ...l, cameraSync: true }, handle as never, memos);
    expect(handle.setCameraSync).toHaveBeenCalledWith(true);
  });

  it("pushes nothing on a second pass with the same values", () => {
    const handle = fakeStreamHandle();
    const memos = new Map<string, StreamSyncMemo>();
    const l = layer({ id: "S1", isStreaming: true });
    syncStreamState(l, handle as never, memos);
    handle.setRules.mockClear();
    handle.setLod.mockClear();
    handle.setVisible.mockClear();

    // A fresh Layer object with identical values: the viewport's effect re-runs
    // on every store change, so this is the common case, and each of the three
    // setters costs a worker round trip or a fan-out over every cell mesh.
    syncStreamState({ ...l }, handle as never, memos);

    expect(handle.setRules).not.toHaveBeenCalled();
    expect(handle.setLod).not.toHaveBeenCalled();
    expect(handle.setVisible).not.toHaveBeenCalled();
  });

  it("pushes only the field that changed", () => {
    const handle = fakeStreamHandle();
    const memos = new Map<string, StreamSyncMemo>();
    const l = layer({ id: "S1", isStreaming: true, visible: true });
    syncStreamState(l, handle as never, memos);
    handle.setRules.mockClear();
    handle.setLod.mockClear();
    handle.setVisible.mockClear();

    syncStreamState({ ...l, visible: false }, handle as never, memos);
    expect(handle.setVisible).toHaveBeenCalledWith(false);
    expect(handle.setRules).not.toHaveBeenCalled();
    expect(handle.setLod).not.toHaveBeenCalled();
  });

  it("pushes hiddenTypes on change only — a push refetches every affected cell", () => {
    const handle = fakeStreamHandle();
    const memos = new Map<string, StreamSyncMemo>();
    const hidden = ["Building"];
    const l = layer({ id: "S1", isStreaming: true });
    syncStreamState(l, handle as never, memos);
    handle.setHiddenTypes.mockClear();

    syncStreamState({ ...l, hiddenTypes: hidden }, handle as never, memos);
    expect(handle.setHiddenTypes).toHaveBeenCalledWith(hidden);

    handle.setHiddenTypes.mockClear();
    syncStreamState({ ...l, hiddenTypes: hidden }, handle as never, memos);
    expect(handle.setHiddenTypes).not.toHaveBeenCalled();
  });

  it("re-pushes everything to a REPLACED handle for the same layer id", () => {
    // A layer closed and re-opened under the same id gets a brand new handle
    // that has been told nothing; an id-keyed memo would report "already up to
    // date" and leave it unstyled, at the wrong LoD and possibly visible.
    const memos = new Map<string, StreamSyncMemo>();
    const first = fakeStreamHandle();
    const l = layer({ id: "S1", isStreaming: true });
    syncStreamState(l, first as never, memos);

    const second = fakeStreamHandle();
    syncStreamState(l, second as never, memos);
    expect(second.setRules).toHaveBeenCalledTimes(1);
    expect(second.setLod).toHaveBeenCalledTimes(1);
    expect(second.setVisible).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Color by
//
// One effective rule list, two consumers. The memo on BOTH paths must key on
// everything that can change the list — including the two colours, which are
// not rules at all — or a user dragging the unmatched swatch would see nothing
// move.
// ---------------------------------------------------------------------------

describe("colorBy", () => {
  const roofRule: Rule = {
    id: "r1",
    name: "flat roofs",
    color: "#4ec84e",
    conditions: [],
    logic: "AND",
    enabled: true,
  };

  function live(handle: ReturnType<typeof fakeHandle>) {
    return new Map<string, LiveLayer>([
      [
        "L1",
        { handle: handle as never, lod: "2", visible: true, hiddenTypes: [] },
      ],
    ]);
  }

  function fakeStreamHandle(id = "S1") {
    return {
      id,
      setHighlight: vi.fn(),
      resolvePick: vi.fn(),
      resolveRaycast: vi.fn(),
      getBoundsGeodetic: vi.fn(),
      triangleCount: () => 0,
      onCommit: vi.fn(() => () => undefined),
      setRules: vi.fn(),
      setLod: vi.fn(),
      setVisible: vi.fn(),
      setCameraSync: vi.fn(),
      setHiddenTypes: vi.fn(),
      setAppearance: vi.fn(),
    };
  }

  it("repaints a STATIC layer when only the unmatched colour changes", () => {
    const handle = fakeHandle("L1");
    const entries = live(handle);
    const rules = [roofRule];
    const l = layer({ id: "L1", rules, colorBy: "rules" });
    syncStyles([l], entries);
    expect(handle.setStyle).toHaveBeenCalledTimes(1);

    // Same rules array, same mode — only the trailing catch-all's colour moved.
    syncStyles(
      [layer({ id: "L1", rules, colorBy: "rules", unmatchedColor: "#010203" })],
      entries,
    );
    expect(handle.setStyle).toHaveBeenCalledTimes(2);
  });

  it("repaints a STREAMING layer when only the unmatched colour changes", () => {
    const handle = fakeStreamHandle();
    const memos = new Map<string, StreamSyncMemo>();
    const rules = [roofRule];
    const l = layer({ id: "S1", isStreaming: true, rules, colorBy: "rules" });
    syncStreamState(l, handle as never, memos);
    handle.setRules.mockClear();

    syncStreamState(
      layer({
        id: "S1",
        isStreaming: true,
        rules,
        colorBy: "rules",
        unmatchedColor: "#010203",
      }),
      handle as never,
      memos,
    );
    expect(handle.setRules).toHaveBeenCalledTimes(1);
    const pushed = handle.setRules.mock.calls[0]![0] as ReadonlyArray<Rule>;
    expect(pushed[pushed.length - 1]!.color).toBe("#010203");
  });

  it("repaints when only the single colour changes", () => {
    const handle = fakeStreamHandle();
    const memos = new Map<string, StreamSyncMemo>();
    const base = { id: "S1", isStreaming: true, colorBy: "single" } as const;
    syncStreamState(layer({ ...base }), handle as never, memos);
    handle.setRules.mockClear();
    syncStreamState(
      layer({ ...base, singleColor: "#0f0f0f" }),
      handle as never,
      memos,
    );
    expect(handle.setRules).toHaveBeenCalledTimes(1);
    expect(
      (handle.setRules.mock.calls[0]![0] as ReadonlyArray<Rule>)[0]!.color,
    ).toBe("#0f0f0f");
  });

  it("round-trips Rules -> Surface -> Rules on both paths", () => {
    const staticHandle = fakeHandle("L1");
    const entries = live(staticHandle);
    const streamHandle = fakeStreamHandle();
    const memos = new Map<string, StreamSyncMemo>();
    const rules = [roofRule];
    const ruled = { rules, colorBy: "rules" } as const;
    const plain = { rules, colorBy: "surface" } as const;

    syncStyles([layer({ id: "L1", ...ruled })], entries);
    syncStyles([layer({ id: "L1", ...plain })], entries);
    syncStyles([layer({ id: "L1", ...ruled })], entries);
    // Painted, cleared, painted again — and the clear is an explicit
    // `setStyle(null)`, because a mesh that carries rule colours does not go
    // back to its semantic palette on its own.
    expect(staticHandle.setStyle).toHaveBeenCalledTimes(3);
    expect(staticHandle.setStyle.mock.calls[1]![0]).toBeNull();
    expect(staticHandle.setStyle.mock.calls[2]![0]).not.toBeNull();

    const stream = (patch: Partial<Layer>) =>
      syncStreamState(
        layer({ id: "S1", isStreaming: true, ...patch }),
        streamHandle as never,
        memos,
      );
    stream(ruled);
    stream(plain);
    stream(ruled);
    expect(streamHandle.setRules).toHaveBeenCalledTimes(3);
    expect(streamHandle.setRules.mock.calls[1]).toEqual([[], false]);
  });

  it("does not re-push when nothing about the colouring moved", () => {
    const handle = fakeHandle("L1");
    const entries = live(handle);
    const rules = [roofRule];
    const same = { id: "L1", rules, colorBy: "rules" } as const;
    syncStyles([layer({ ...same })], entries);
    syncStyles([layer({ ...same })], entries);
    syncStyles([layer({ ...same })], entries);
    expect(handle.setStyle).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Scene themes
//
// A theme's mesh style reaches BOTH layer kinds through the same two sync
// functions the rest of the layer state does, and for the same reason: a layer
// added (or a stream opened) while a theme is active must come up themed, not
// photoreal-then-themed a frame later.
//
// Pushing is not cheap — `setThemeStyle` re-extracts every structural edge of
// every mesh — so the tests below are mostly about NOT pushing.
// ---------------------------------------------------------------------------

describe("theme styles", () => {
  const CARTOON: ThemeStyle = Object.freeze({
    fill: "vertex",
    edges: Object.freeze({ color: 0x1a1a1a }),
  });
  const CYBER: ThemeStyle = Object.freeze({
    fill: "tint",
    tintRGB: [0.06, 0.07, 0.12] as const,
    edges: Object.freeze({ color: 0x33e0ff }),
  });

  function themedHandle(id: string) {
    return { ...fakeHandle(id), setThemeStyle: vi.fn() };
  }

  function themedStreamHandle(id = "S1") {
    return {
      id,
      setHighlight: vi.fn(),
      resolvePick: vi.fn(),
      resolveRaycast: vi.fn(),
      getBoundsGeodetic: vi.fn(),
      triangleCount: () => 0,
      onCommit: vi.fn(() => () => undefined),
      setRules: vi.fn(),
      setLod: vi.fn(),
      setVisible: vi.fn(),
      setCameraSync: vi.fn(),
      setHiddenTypes: vi.fn(),
      setVisibleObjectIds: vi.fn(),
      setAppearance: vi.fn(),
      setThemeStyle: vi.fn(),
    };
  }

  it("styles a newly added static layer with the active theme", () => {
    const handle = themedHandle("L1");
    const registry = { get: () => undefined, add: vi.fn(() => handle) };
    const live = new Map<string, LiveLayer>();

    syncLayers(
      registry as never,
      [layer({ id: "L1" })],
      live,
      () => {},
      CARTOON,
    );

    expect(handle.setThemeStyle).toHaveBeenCalledWith(CARTOON);
  });

  it("re-styles a live static layer when the theme changes, once", () => {
    const handle = themedHandle("L1");
    const registry = { get: () => undefined, add: vi.fn(() => handle) };
    const live = new Map<string, LiveLayer>();
    const layers = [layer({ id: "L1" })];

    syncLayers(registry as never, layers, live, () => {}, CARTOON);
    handle.setThemeStyle.mockClear();

    // Same theme, another store change (a rename, another layer's toggle):
    // pushing again would rebuild the edge geometry for nothing.
    syncLayers(registry as never, layers, live, () => {}, CARTOON);
    expect(handle.setThemeStyle).not.toHaveBeenCalled();

    syncLayers(registry as never, layers, live, () => {}, CYBER);
    expect(handle.setThemeStyle).toHaveBeenCalledTimes(1);
    expect(handle.setThemeStyle).toHaveBeenCalledWith(CYBER);
  });

  it("pushes nothing to a static layer when no theme is supplied", () => {
    const handle = themedHandle("L1");
    const registry = { get: () => undefined, add: vi.fn(() => handle) };
    const live = new Map<string, LiveLayer>();
    syncLayers(registry as never, [layer({ id: "L1" })], live, () => {});
    expect(handle.setThemeStyle).not.toHaveBeenCalled();
  });

  it("styles a streaming layer with the active theme, on change only", () => {
    const handle = themedStreamHandle();
    const memos = new Map<string, StreamSyncMemo>();
    const l = layer({ id: "S1", isStreaming: true });

    syncStreamState(l, handle as never, memos, CARTOON);
    expect(handle.setThemeStyle).toHaveBeenCalledWith(CARTOON);

    handle.setThemeStyle.mockClear();
    syncStreamState({ ...l }, handle as never, memos, CARTOON);
    expect(handle.setThemeStyle).not.toHaveBeenCalled();

    syncStreamState(l, handle as never, memos, CYBER);
    expect(handle.setThemeStyle).toHaveBeenCalledTimes(1);
    expect(handle.setThemeStyle).toHaveBeenCalledWith(CYBER);
  });

  it("re-styles a REPLACED streaming handle for the same layer id", () => {
    // A stream closed and re-opened gets a brand new handle whose cells are
    // unthemed; a memo that survived the swap would leave them photoreal in a
    // themed scene.
    const memos = new Map<string, StreamSyncMemo>();
    const l = layer({ id: "S1", isStreaming: true });
    const first = themedStreamHandle();
    syncStreamState(l, first as never, memos, CYBER);

    const second = themedStreamHandle();
    syncStreamState(l, second as never, memos, CYBER);
    expect(second.setThemeStyle).toHaveBeenCalledWith(CYBER);
  });

  it("pushes nothing to a streaming layer when no theme is supplied", () => {
    const handle = themedStreamHandle();
    const memos = new Map<string, StreamSyncMemo>();
    syncStreamState(
      layer({ id: "S1", isStreaming: true }),
      handle as never,
      memos,
    );
    expect(handle.setThemeStyle).not.toHaveBeenCalled();
  });
});

it("updates multi-LoD selection even when its highest label is unchanged", () => {
  const handle = fakeHandle("L1");
  const live = new Map<string, LiveLayer>();
  const registry = { get: () => handle, add: vi.fn(() => handle) };
  const first = layer({ id: "L1", selectedLod: "2", selectedLods: ["2", "1"] });
  syncLayers(registry as never, [first], live, () => {});
  expect(handle.setLod).not.toHaveBeenCalled();
  const second = { ...first, selectedLods: ["2"] };
  syncLayers(registry as never, [second], live, () => {});
  expect(handle.setLod).toHaveBeenCalledWith(["2"]);
  handle.setLod.mockClear();
  syncLayers(registry as never, [second], live, () => {});
  expect(handle.setLod).not.toHaveBeenCalled();
});
