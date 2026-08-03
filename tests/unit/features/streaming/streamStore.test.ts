import { describe, it, expect, beforeEach } from "vitest";
import {
  useStreamStore,
  type StreamState,
} from "../../../../src/features/streaming/streamStore";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import type { FcbStreamLayerHandle, Grid } from "@cityjson/navara-flatcitybuf";
import type { FcbHeaderModel } from "../../../../src/domain/citymodel/flatcitybuf/fcbSource";

const grid: Grid = { originX: 0, originY: 0, rootCell: 800, maxLevel: 3 };

const header: FcbHeaderModel = {
  version: "1.0",
  featuresCount: 100,
  extent: [0, 0, 0, 800, 800, 50],
  referenceSystem: "https://www.opengis.net/def/crs/EPSG/0/28992",
  epsg: 28992,
};

/**
 * A stand-in for the plugin handle. Constructing a real
 * `FcbStreamLayerHandle` would spin up a `WorkerClient`, whose constructor
 * reaches the DOM `Worker` constructor jsdom does not implement — and none of
 * `streamStore`'s actions ever call a method on the handle: they only hold the
 * reference and hand it back. So the handle is the one field cast at that true
 * boundary (`as unknown as FcbStreamLayerHandle`, never `as never`: `never`
 * type-checks against ANY value whatsoever and would hide a genuine shape
 * mismatch on every other field). Every other field below is a real,
 * correctly-typed value: a real `Grid` literal and a real `FcbHeaderModel`.
 */
function fakeHandle(): FcbStreamLayerHandle {
  return { id: "L", grid, header } as unknown as FcbStreamLayerHandle;
}

function makeStreamState(overrides: Partial<StreamState> = {}): StreamState {
  return {
    handle: fakeHandle(),
    disposers: [],
    grid,
    header,
    level: null,
    ladder: [],
    ladderVersion: 0,
    status: "idle",
    message: null,
    version: 0,
    ...overrides,
  };
}

function addLayer(): string {
  return useLayerStore.getState().addLayer({
    name: "s.fcb",
    model: {
      sourceEncoding: "flatcitybuf",
      metadata: {},
      bbox: null,
      objects: {},
      vertexCount: 0,
    },
    modelRef: { type: "url", url: "https://x/s.fcb" },
    visible: true,
    rules: [],
    rulesEnabled: true,
  });
}

beforeEach(() => {
  useStreamStore.setState({ streams: {} });
  useLayerStore.getState().removeAllLayers();
});

describe("streamStore", () => {
  it("bumping a version does not change the layers array identity", () => {
    const id = addLayer();
    const before = useLayerStore.getState().layers;
    useStreamStore.getState().register(id, makeStreamState());
    useStreamStore.getState().bumpVersion(id);
    expect(useLayerStore.getState().layers).toBe(before); // same reference
    expect(useStreamStore.getState().streams[id]!.version).toBe(1);
  });

  it("keeps the handle by reference across a version bump — the plugin owns the cache, the store only mirrors counters", () => {
    const handle = fakeHandle();
    useStreamStore.getState().register("l1", makeStreamState({ handle }));
    useStreamStore.getState().bumpVersion("l1");
    expect(useStreamStore.getState().get("l1")!.handle).toBe(handle);
  });

  it("unregister removes the stream entry", () => {
    useStreamStore.getState().register("L", makeStreamState());
    useStreamStore.getState().unregister("L");
    expect(useStreamStore.getState().streams["L"]).toBeUndefined();
  });

  it("defaults a new layer to auto LoD mode", () => {
    const id = addLayer();
    expect(
      useLayerStore.getState().layers.find((l) => l.id === id)!.lodMode,
    ).toBe("auto");
  });

  it("defaults a new layer to not streaming", () => {
    const id = addLayer();
    expect(
      useLayerStore.getState().layers.find((l) => l.id === id)!.isStreaming,
    ).toBe(false);
  });

  it("setLodMode updates only the targeted layer, leaving the other's mode alone", () => {
    const a = addLayer();
    const b = addLayer();
    useLayerStore.getState().setLodMode(a, "manual");
    const layers = useLayerStore.getState().layers;
    expect(layers.find((l) => l.id === a)!.lodMode).toBe("manual");
    expect(layers.find((l) => l.id === b)!.lodMode).toBe("auto");
  });

  it("get returns the registered state by reference, and undefined for an unknown id", () => {
    const state = makeStreamState({ status: "probing" });
    useStreamStore.getState().register("L", state);
    expect(useStreamStore.getState().get("L")).toBe(state);
    expect(useStreamStore.getState().get("missing-id")).toBeUndefined();
  });

  it("setStatus updates status and message on the targeted stream only", () => {
    useStreamStore.getState().register("A", makeStreamState());
    useStreamStore.getState().register("B", makeStreamState());
    useStreamStore.getState().setStatus("A", "error", "boom");
    const streams = useStreamStore.getState().streams;
    expect(streams["A"]!.status).toBe("error");
    expect(streams["A"]!.message).toBe("boom");
    expect(streams["B"]!.status).toBe("idle");
    expect(streams["B"]!.message).toBeNull();
  });

  it("setStatus defaults message to null when the message argument is omitted", () => {
    useStreamStore
      .getState()
      .register("A", makeStreamState({ message: "stale message" }));
    useStreamStore.getState().setStatus("A", "idle");
    expect(useStreamStore.getState().streams["A"]!.message).toBeNull();
  });

  it("setLadder replaces the ladder and bumps its own version", () => {
    useStreamStore.getState().register("A", makeStreamState());
    useStreamStore.getState().setLadder("A", ["1.2", "2.2"]);
    expect(useStreamStore.getState().streams["A"]!.ladder).toEqual([
      "1.2",
      "2.2",
    ]);
    expect(useStreamStore.getState().streams["A"]!.ladderVersion).toBe(1);
  });

  it("setLevel mirrors the handle's committed level", () => {
    useStreamStore.getState().register("A", makeStreamState());
    useStreamStore.getState().setLevel("A", 3);
    expect(useStreamStore.getState().streams["A"]!.level).toBe(3);
  });

  it("setLevel to the value already stored notifies nothing — LodSelector must not re-render on every settle that keeps the same level", () => {
    useStreamStore.getState().register("A", makeStreamState({ level: 3 }));
    const before = useStreamStore.getState().streams;
    useStreamStore.getState().setLevel("A", 3);
    expect(useStreamStore.getState().streams).toBe(before);
  });

  it("bumpVersion on an unregistered layer id is a harmless no-op", () => {
    expect(() => useStreamStore.getState().bumpVersion("nope")).not.toThrow();
    expect(useStreamStore.getState().streams["nope"]).toBeUndefined();
  });

  it("setLevel and setLadder on an unregistered layer id are harmless no-ops", () => {
    expect(() => useStreamStore.getState().setLevel("nope", 2)).not.toThrow();
    expect(() =>
      useStreamStore.getState().setLadder("nope", ["1.2"]),
    ).not.toThrow();
    expect(useStreamStore.getState().streams).toEqual({});
  });

  it("unregister on an unregistered layer id is a harmless no-op", () => {
    expect(() => useStreamStore.getState().unregister("nope")).not.toThrow();
    expect(useStreamStore.getState().streams).toEqual({});
  });
});
