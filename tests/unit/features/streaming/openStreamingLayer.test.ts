/**
 * `openStreamingLayer` is now a thin store-registration wrapper over
 * `FlatCityBufPlugin.openStream`: the worker, the admission gate, the CRS
 * gate, the grid and the cell cache all live inside the plugin (and are
 * tested there, in `packages/navara-flatcitybuf/tests/streamRegistry.test.ts`).
 *
 * So there is no `FakeWorker` here any more. The plugin is faked at its own
 * seam — the `StreamPlugin` interface — which keeps this suite engine-free:
 * the real `FlatCityBufPlugin` lives behind the `/plugin` subpath and imports
 * `@navaramap/*`, which crashes at module scope under Node (Global
 * Constraints -> NODE_IMPORT_SAFE = false).
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import { useStreamStore } from "../../../../src/features/streaming/streamStore";
import {
  closeStreamingLayer,
  openStreamingLayer,
} from "../../../../src/features/streaming/openStreamingLayer";
import type { StreamPlugin } from "../../../../src/features/streaming/streamPlugin";
import type {
  FcbStreamLayerHandle,
  Grid,
  StreamStatus,
} from "@cityjson/navara-flatcitybuf";
import type { FcbHeaderModel } from "@cityjson/navara-flatcitybuf";

const HEADER: FcbHeaderModel = {
  version: "1.0",
  featuresCount: 1000,
  extent: [0, 0, 0, 1000, 1000, 40],
  referenceSystem: "https://www.opengis.net/def/crs/EPSG/0/28992",
  epsg: 28992,
};

const GRID: Grid = { originX: 0, originY: 0, rootCell: 1000, maxLevel: 4 };

/** The handle's published state plus its four event fan-outs, so a test can
 *  drive exactly what the plugin would report and assert what the store
 *  mirrored. */
interface FakeHandle {
  readonly handle: FcbStreamLayerHandle;
  emitStatus: (status: StreamStatus, message: string | null) => void;
  emitLadder: (ladder: ReadonlyArray<string>) => void;
  emitTypes: (types: ReadonlyArray<string>) => void;
  emitCommit: (level: number | null) => void;
  /** How many subscribers each fan-out still has — the observable form of
   *  "were the disposers actually run?". */
  listenerCount: () => number;
  readonly deleted: Mock<() => void>;
}

function drop<T>(list: T[], item: T): void {
  const i = list.indexOf(item);
  if (i >= 0) list.splice(i, 1);
}

function fakeHandle(id: string): FakeHandle {
  const deleted = vi.fn();
  const statusCbs: Array<(s: StreamStatus, m: string | null) => void> = [];
  const ladderCbs: Array<(l: ReadonlyArray<string>) => void> = [];
  const typesCbs: Array<(t: ReadonlyArray<string>) => void> = [];
  const commitCbs: Array<(v: number) => void> = [];
  const state = { level: null as number | null, version: 0 };
  const handle = {
    id,
    grid: GRID,
    header: HEADER,
    get level() {
      return state.level;
    },
    get version() {
      return state.version;
    },
    ladder: [] as ReadonlyArray<string>,
    typesSeen: [] as ReadonlyArray<string>,
    status: "idle" as StreamStatus,
    message: null as string | null,
    // Real unsubscribes, not `() => undefined`: the handle's own `delete()`
    // does NOT clear these sets, so whether `closeStreamingLayer` runs them is
    // the difference between a released store closure and a retained one.
    onStatus: (cb: (s: StreamStatus, m: string | null) => void) => {
      statusCbs.push(cb);
      return () => drop(statusCbs, cb);
    },
    onLadder: (cb: (l: ReadonlyArray<string>) => void) => {
      ladderCbs.push(cb);
      return () => drop(ladderCbs, cb);
    },
    onTypes: (cb: (t: ReadonlyArray<string>) => void) => {
      typesCbs.push(cb);
      return () => drop(typesCbs, cb);
    },
    onCommit: (cb: (v: number) => void) => {
      commitCbs.push(cb);
      return () => drop(commitCbs, cb);
    },
    delete: deleted,
  } as unknown as FcbStreamLayerHandle;
  return {
    handle,
    listenerCount: () =>
      statusCbs.length + ladderCbs.length + typesCbs.length + commitCbs.length,
    deleted,
    emitStatus: (s, m) => statusCbs.forEach((cb) => cb(s, m)),
    emitLadder: (l) => ladderCbs.forEach((cb) => cb(l)),
    emitTypes: (t) => typesCbs.forEach((cb) => cb(t)),
    emitCommit: (level) => {
      state.level = level;
      state.version += 1;
      commitCbs.forEach((cb) => cb(state.version));
    },
  };
}

type FakePlugin = StreamPlugin & {
  readonly openStream: Mock<StreamPlugin["openStream"]>;
  readonly remove: Mock<StreamPlugin["remove"]>;
};

/** Resolves a fresh fake handle per open, and records the options it saw. */
function fakePlugin(handles: FakeHandle[] = []): FakePlugin {
  return {
    openStream: vi.fn((opts) => {
      const h = fakeHandle(opts.id);
      handles.push(h);
      return Promise.resolve(h.handle);
    }),
    remove: vi.fn(),
  };
}

beforeEach(() => {
  useLayerStore.getState().removeAllLayers();
  useStreamStore.setState({ streams: {} });
});

describe("openStreamingLayer", () => {
  it("registers a streaming Layer and a matching StreamState when the plugin admits the file (URL source)", async () => {
    const plugin = fakePlugin();
    const layerId = await openStreamingLayer({
      plugin,
      source: { url: "https://x/a.fcb" },
      name: "a.fcb",
      modelRef: { type: "url", url: "https://x/a.fcb" },
    });

    const opts = plugin.openStream.mock.calls[0]![0];
    expect(opts.source).toEqual({ url: "https://x/a.fcb" });

    const layer = useLayerStore.getState().layers.find((l) => l.id === layerId);
    expect(layer).toBeDefined();
    expect(layer!.isStreaming).toBe(true);
    expect(layer!.model.bbox).toEqual(HEADER.extent);
    expect(layer!.model.objects).toEqual({});

    const stream = useStreamStore.getState().get(layerId);
    expect(stream).toBeDefined();
    expect(stream!.grid).toBe(GRID);
    expect(stream!.header).toEqual(HEADER);
    expect(stream!.status).toBe("idle");
    expect(stream!.level).toBeNull();
  });

  it("opens the stream under the SAME id the layer gets, so plugin.getHandle(layer.id) can never miss", async () => {
    const plugin = fakePlugin();
    const layerId = await openStreamingLayer({
      plugin,
      source: { url: "https://x/a.fcb" },
      name: "a.fcb",
      modelRef: { type: "url", url: "https://x/a.fcb" },
    });
    const opts = plugin.openStream.mock.calls[0]![0];
    expect(opts.id).toBe(layerId);
    expect(useStreamStore.getState().get(layerId)!.handle.id).toBe(layerId);
  });

  it("passes a local Blob straight through as `blob`, never converting it to an ArrayBuffer", async () => {
    const plugin = fakePlugin();
    const blob = new Blob(["fake fcb bytes"]);
    await openStreamingLayer({
      plugin,
      source: { blob },
      name: "local.fcb",
      modelRef: { type: "file", fileName: "local.fcb" },
    });
    const source = plugin.openStream.mock.calls[0]![0].source;
    expect("blob" in source && source.blob).toBe(blob); // same ref, not re-encoded
    expect("url" in source).toBe(false);
  });

  it("rejects and registers nothing when the plugin refuses the file (admission, CRS, missing extent)", async () => {
    const plugin = fakePlugin();
    plugin.openStream.mockRejectedValueOnce(
      new Error(
        "This file's reference system could not be established as metric.",
      ),
    );

    await expect(
      openStreamingLayer({
        plugin,
        source: { url: "https://x/degrees.fcb" },
        name: "degrees.fcb",
        modelRef: { type: "url", url: "https://x/degrees.fcb" },
      }),
    ).rejects.toThrow(/could not be established as metric/);

    expect(useLayerStore.getState().layers).toHaveLength(0);
    expect(Object.keys(useStreamStore.getState().streams)).toHaveLength(0);
  });

  it("applies rules/rulesEnabled/visible overrides onto the created layer AND seeds them into the plugin before its first commit", async () => {
    const plugin = fakePlugin();
    const layerId = await openStreamingLayer({
      plugin,
      source: { url: "https://x/a.fcb" },
      name: "a.fcb",
      modelRef: { type: "url", url: "https://x/a.fcb" },
      visible: false,
      rulesEnabled: false,
    });
    const layer = useLayerStore
      .getState()
      .layers.find((l) => l.id === layerId)!;
    expect(layer.visible).toBe(false);
    expect(layer.rulesEnabled).toBe(false);
    expect(layer.rules).toEqual([]);

    const opts = plugin.openStream.mock.calls[0]![0];
    expect(opts.visible).toBe(false);
    expect(opts.rulesEnabled).toBe(false);
    expect(opts.rules).toEqual([]);
  });

  it("seeds hiddenTypes into the plugin AND onto the layer, so a restored layer's very first fetch is already filtered", async () => {
    const plugin = fakePlugin();
    const layerId = await openStreamingLayer({
      plugin,
      source: { url: "https://x/a.fcb" },
      name: "a.fcb",
      modelRef: { type: "url", url: "https://x/a.fcb" },
      hiddenTypes: ["Building"],
    });

    expect(plugin.openStream.mock.calls[0]![0].hiddenTypes).toEqual([
      "Building",
    ]);
    const layer = useLayerStore
      .getState()
      .layers.find((l) => l.id === layerId)!;
    expect(layer.hiddenTypes).toEqual(["Building"]);
  });

  it("defaults hiddenTypes to nothing hidden", async () => {
    const plugin = fakePlugin();
    const layerId = await openStreamingLayer({
      plugin,
      source: { url: "https://x/a.fcb" },
      name: "a.fcb",
      modelRef: { type: "url", url: "https://x/a.fcb" },
    });
    expect(plugin.openStream.mock.calls[0]![0].hiddenTypes).toEqual([]);
    expect(
      useLayerStore.getState().layers.find((l) => l.id === layerId)!
        .hiddenTypes,
    ).toEqual([]);
  });

  it("defaults rulesEnabled/visible to true in BOTH the layer and the plugin — the handle's own default is false, so an unseeded first fetch would bake no rule colours", async () => {
    const plugin = fakePlugin();
    const layerId = await openStreamingLayer({
      plugin,
      source: { url: "https://x/a.fcb" },
      name: "a.fcb",
      modelRef: { type: "url", url: "https://x/a.fcb" },
    });
    const layer = useLayerStore
      .getState()
      .layers.find((l) => l.id === layerId)!;
    expect(layer.rulesEnabled).toBe(true);
    expect(layer.visible).toBe(true);
    const opts = plugin.openStream.mock.calls[0]![0];
    expect(opts.rulesEnabled).toBe(true);
    expect(opts.visible).toBe(true);
  });
});

describe("openStreamingLayer — the store mirrors the handle's reports", () => {
  it("mirrors status, ladder and commits without ever replacing the handle", async () => {
    const handles: FakeHandle[] = [];
    const plugin = fakePlugin(handles);
    const layerId = await openStreamingLayer({
      plugin,
      source: { url: "https://x/a.fcb" },
      name: "a.fcb",
      modelRef: { type: "url", url: "https://x/a.fcb" },
    });
    const fake = handles[0]!;
    const handle = useStreamStore.getState().get(layerId)!.handle;

    fake.emitStatus("fetching", null);
    expect(useStreamStore.getState().get(layerId)!.status).toBe("fetching");

    fake.emitStatus("error", "boom");
    expect(useStreamStore.getState().get(layerId)!.message).toBe("boom");

    fake.emitLadder(["1.2", "2.2"]);
    expect(useStreamStore.getState().get(layerId)!.ladder).toEqual([
      "1.2",
      "2.2",
    ]);
    expect(useStreamStore.getState().get(layerId)!.ladderVersion).toBe(1);

    // Types are discovered from the cells the worker decodes, exactly like the
    // ladder — a streaming layer's toggles read this, not the layer's own
    // (always empty) `availableObjectTypes`.
    fake.emitTypes(["Building", "Road"]);
    expect(useStreamStore.getState().get(layerId)!.types).toEqual([
      "Building",
      "Road",
    ]);
    expect(useStreamStore.getState().get(layerId)!.typesVersion).toBe(1);

    fake.emitCommit(3);
    const after = useStreamStore.getState().get(layerId)!;
    expect(after.version).toBe(1);
    // The level MUST come along with the commit: LodSelector's auto read-out
    // derives the cell size from it, and there is no other event carrying it.
    expect(after.level).toBe(3);
    expect(after.handle).toBe(handle);
  });

  it("keeps two layers' reports apart", async () => {
    const handles: FakeHandle[] = [];
    const plugin = fakePlugin(handles);
    const a = await openStreamingLayer({
      plugin,
      source: { url: "https://x/a.fcb" },
      name: "a.fcb",
      modelRef: { type: "url", url: "https://x/a.fcb" },
    });
    const b = await openStreamingLayer({
      plugin,
      source: { url: "https://x/b.fcb" },
      name: "b.fcb",
      modelRef: { type: "url", url: "https://x/b.fcb" },
    });

    handles[0]!.emitStatus("too-far", "Zoom in");
    expect(useStreamStore.getState().get(a)!.status).toBe("too-far");
    expect(useStreamStore.getState().get(b)!.status).toBe("idle");
  });

  it("a report for a layer already closed is a harmless no-op, not a resurrected entry", async () => {
    const handles: FakeHandle[] = [];
    const plugin = fakePlugin(handles);
    const layerId = await openStreamingLayer({
      plugin,
      source: { url: "https://x/a.fcb" },
      name: "a.fcb",
      modelRef: { type: "url", url: "https://x/a.fcb" },
    });
    closeStreamingLayer(plugin, layerId);

    expect(() => handles[0]!.emitStatus("error", "late")).not.toThrow();
    expect(() => handles[0]!.emitCommit(2)).not.toThrow();
    expect(useStreamStore.getState().streams[layerId]).toBeUndefined();
  });
});

describe("closeStreamingLayer", () => {
  it("unregisters the stream and asks the plugin to tear the layer down", async () => {
    const plugin = fakePlugin();
    const layerId = await openStreamingLayer({
      plugin,
      source: { url: "https://x/a.fcb" },
      name: "a.fcb",
      modelRef: { type: "url", url: "https://x/a.fcb" },
    });

    closeStreamingLayer(plugin, layerId);

    expect(useStreamStore.getState().streams[layerId]).toBeUndefined();
    // `plugin.remove` (not `handle.delete()`): it is what ALSO drops the layer
    // from the settle loop, so a deleted layer stops being committed.
    expect(plugin.remove).toHaveBeenCalledWith(layerId);
  });

  it("is a no-op for a static layer id — callers remove layers without knowing which were streaming", () => {
    const plugin = fakePlugin();
    closeStreamingLayer(plugin, "a-static-layer");
    expect(plugin.remove).not.toHaveBeenCalled();
  });

  it("runs the three event disposers, so a closed layer stops reaching the store", async () => {
    // `handle.delete()` does not clear the handle's listener sets, so without
    // these the store's closures stay reachable from the handle for as long as
    // anything holds it — and `NavaraViewport`'s `streamsRef` holds it.
    const handles: FakeHandle[] = [];
    const plugin = fakePlugin(handles);
    const layerId = await openStreamingLayer({
      plugin,
      source: { url: "https://x/a.fcb" },
      name: "a.fcb",
      modelRef: { type: "url", url: "https://x/a.fcb" },
    });
    expect(handles[0]!.listenerCount()).toBe(4);

    closeStreamingLayer(plugin, layerId);
    expect(handles[0]!.listenerCount()).toBe(0);
  });

  it("deletes the handle itself when there is no plugin left to remove it through", async () => {
    // The engine has gone away (the viewport unmounted), so `plugin.remove` is
    // unreachable. Dropping the store entry regardless would strand a live
    // worker with no reference to it anywhere.
    const handles: FakeHandle[] = [];
    const plugin = fakePlugin(handles);
    const layerId = await openStreamingLayer({
      plugin,
      source: { url: "https://x/a.fcb" },
      name: "a.fcb",
      modelRef: { type: "url", url: "https://x/a.fcb" },
    });

    closeStreamingLayer(null, layerId);

    expect(handles[0]!.deleted).toHaveBeenCalledTimes(1);
    expect(handles[0]!.listenerCount()).toBe(0);
    expect(useStreamStore.getState().streams[layerId]).toBeUndefined();
  });
});
