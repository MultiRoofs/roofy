import { describe, it, expect, beforeEach } from "vitest";
import {
  useStreamStore,
  type StreamState,
} from "../../../../src/features/streaming/streamStore";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import { CellCache } from "../../../../src/features/streaming/cellCache";
import type { WorkerClient } from "../../../../src/features/streaming/workerClient";
import type { Grid } from "../../../../src/features/streaming/tileGrid";
import type { FcbHeaderModel } from "../../../../src/domain/citymodel/flatcitybuf/fcbSource";

/**
 * `WorkerClient`'s constructor spins up a real dedicated Worker
 * (`new Worker(new URL("./fcb.worker.ts", import.meta.url), {type:
 * "module"})`), which needs a browser/worker-capable runtime. This suite
 * runs under jsdom (vitest.config.ts), which has no Worker implementation,
 * and none of `streamStore`'s actions ever call a method on `client` — they
 * only hold the reference and hand it back. So `client` is the one field
 * cast at that true boundary (`as unknown as WorkerClient`, never `as
 * never`: `never` type-checks against ANY value whatsoever and would hide a
 * genuine shape mismatch on every other field). Every other field below is
 * a real, correctly-typed value: a real `Grid` literal, a real
 * `FcbHeaderModel` literal, and a REAL `CellCache` instance — not stand-ins
 * for the whole `StreamState`.
 */
const fakeClient = {} as unknown as WorkerClient;

const grid: Grid = { originX: 0, originY: 0, rootCell: 800, maxLevel: 3 };

const header: FcbHeaderModel = {
  version: "1.0",
  featuresCount: 100,
  extent: [0, 0, 0, 800, 800, 50],
  referenceSystem: "https://www.opengis.net/def/crs/EPSG/0/28992",
  epsg: 28992,
};

function makeStreamState(overrides: Partial<StreamState> = {}): StreamState {
  return {
    client: fakeClient,
    grid,
    header,
    cache: new CellCache({ maxTriangles: 1_000_000, maxBytes: 1024 * 1024 }),
    level: null,
    ladder: [],
    ladderVersion: 0,
    status: "idle",
    message: null,
    lastCommit: null,
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

  it("bumpVersion on an unregistered layer id is a harmless no-op", () => {
    expect(() => useStreamStore.getState().bumpVersion("nope")).not.toThrow();
    expect(useStreamStore.getState().streams["nope"]).toBeUndefined();
  });

  it("unregister on an unregistered layer id is a harmless no-op", () => {
    expect(() => useStreamStore.getState().unregister("nope")).not.toThrow();
    expect(useStreamStore.getState().streams).toEqual({});
  });
});
