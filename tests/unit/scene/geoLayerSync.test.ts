/**
 * Store -> engine reconciliation for geospatial layers, against a FAKE view.
 *
 * Same discipline as `handleSync.test.ts`: the decisions (what to add, what to
 * rebuild, what to merely re-describe, and in which order to delete) are pure
 * and testable without booting Navara, which is the whole reason
 * `geoLayerSync.ts` takes a structural view rather than a `ThreeView`.
 *
 * Two engine facts drive most of what is asserted here:
 *  - `Layer.update()` REPLACES the whole description, so a visibility or
 *    opacity change must re-send a FULL one;
 *  - `Source.delete()` is reference-counted and removes nothing while a layer
 *    still points at it, so the layer must go first.
 */
import { describe, expect, it, vi } from "vitest";
import {
  removeAllGeoLayerHandles,
  syncGeoLayers,
  type LiveGeoLayer,
} from "../../../src/scene/geoLayerSync";
import type { GeoLayer } from "../../../src/features/geoLayers/geoLayerStore";
import { DEFAULT_GEO_LAYER_STYLE } from "../../../src/features/geoLayers/geoLayerStyle";

/** Records the order of every engine call, which is what the delete-order
 *  assertion below is really about. */
function fakeView() {
  const calls: string[] = [];
  const sources: Array<{ desc: unknown; delete: ReturnType<typeof vi.fn> }> =
    [];
  const layers: Array<{
    desc: unknown;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  }> = [];

  const view = {
    addSource: vi.fn((desc: Record<string, unknown>) => {
      const handle = {
        desc,
        delete: vi.fn(() => {
          calls.push("source.delete");
          return true;
        }),
      };
      sources.push(handle);
      calls.push("addSource");
      return handle;
    }),
    addLayer: vi.fn((desc: Record<string, unknown>) => {
      const handle = {
        desc,
        update: vi.fn(),
        delete: vi.fn(() => {
          calls.push("layer.delete");
        }),
      };
      layers.push(handle);
      calls.push("addLayer");
      return handle;
    }),
  };

  return { view, calls, sources, layers };
}

/** SHARED across the records below, exactly as the store shares it: an edit to
 *  a layer's name or visibility replaces the record but never its config, and
 *  the reconciler reads that identity to decide whether to rebuild. */
const RASTER_CONFIG = { urlTemplate: "https://t/{z}/{x}/{y}.png" };

function raster(patch: Partial<GeoLayer> = {}): GeoLayer {
  return {
    id: "r1",
    name: "tiles",
    kind: "raster-xyz",
    visible: true,
    opacity: 1,
    style: DEFAULT_GEO_LAYER_STYLE,
    config: RASTER_CONFIG,
    ...patch,
  } as GeoLayer;
}

describe("syncGeoLayers — adding", () => {
  it("adds one source and one layer per record", () => {
    const { view } = fakeView();
    const live = new Map<string, LiveGeoLayer>();

    syncGeoLayers(view, [raster()], live);

    expect(view.addSource).toHaveBeenCalledTimes(1);
    expect(view.addLayer).toHaveBeenCalledTimes(1);
    expect(live.size).toBe(1);
  });

  it("does not re-add an unchanged layer on a later pass", () => {
    const { view } = fakeView();
    const live = new Map<string, LiveGeoLayer>();
    const layer = raster();

    syncGeoLayers(view, [layer], live);
    syncGeoLayers(view, [layer], live);

    expect(view.addSource).toHaveBeenCalledTimes(1);
    expect(view.addLayer).toHaveBeenCalledTimes(1);
  });

  it("references the source HANDLE from the layer description", () => {
    const { view, sources, layers } = fakeView();

    syncGeoLayers(view, [raster()], new Map());

    expect((layers[0]!.desc as { source: unknown }).source).toBe(sources[0]);
  });

  it("skips a GeoJSON layer with nothing to load, and keeps retrying it", () => {
    const { view } = fakeView();
    const live = new Map<string, LiveGeoLayer>();
    const unavailable = {
      id: "g1",
      name: "restored",
      kind: "geojson",
      visible: true,
      opacity: 1,
      style: DEFAULT_GEO_LAYER_STYLE,
      config: {},
    } as GeoLayer;

    syncGeoLayers(view, [unavailable], live);

    expect(view.addSource).not.toHaveBeenCalled();
    expect(live.size).toBe(0);

    // Re-linked: the same id now carries a document, and the pair appears.
    syncGeoLayers(
      view,
      [
        {
          ...unavailable,
          config: { data: { type: "FeatureCollection", features: [] } },
        } as GeoLayer,
      ],
      live,
    );
    expect(view.addSource).toHaveBeenCalledTimes(1);
    expect(live.size).toBe(1);
  });
});

describe("syncGeoLayers — a refused add", () => {
  it("returns nothing, leaves the registry empty and does not throw", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const sourceDelete = vi.fn(() => true);
    const view = {
      addSource: vi.fn(() => ({ delete: sourceDelete })),
      addLayer: vi.fn(() => {
        throw new Error("the engine refused this layer");
      }),
    };
    const live = new Map<string, LiveGeoLayer>();

    expect(() => syncGeoLayers(view, [raster()], live)).not.toThrow();

    expect(live.size).toBe(0);
    // The source succeeded and its layer did not: leaving it registered would
    // leak one per attempt, and nothing else can reach it.
    expect(sourceDelete).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("syncGeoLayers — visibility and opacity", () => {
  it("pushes a FULL replacement description, not a patch", () => {
    const { view, layers } = fakeView();
    const live = new Map<string, LiveGeoLayer>();
    const layer = raster();
    syncGeoLayers(view, [layer], live);

    syncGeoLayers(view, [raster({ visible: false, opacity: 0.5 })], live);

    const update = layers[0]!.update;
    expect(update).toHaveBeenCalledTimes(1);
    const desc = update.mock.calls[0]![0] as Record<string, unknown>;
    // Every field the engine needs is present — `Layer.update` REPLACES the
    // description, so anything omitted here is lost from the live layer.
    expect(desc).toEqual({
      type: "raster",
      source: expect.anything(),
      raster: { opacity: 0.5, show: false },
    });
    // and nothing was rebuilt for a change this cheap.
    expect(view.addSource).toHaveBeenCalledTimes(1);
  });

  it("costs nothing at all when only the name changed", () => {
    const { view, layers } = fakeView();
    const live = new Map<string, LiveGeoLayer>();
    syncGeoLayers(view, [raster()], live);

    syncGeoLayers(view, [raster({ name: "renamed" })], live);

    expect(layers[0]!.update).not.toHaveBeenCalled();
    expect(view.addSource).toHaveBeenCalledTimes(1);
    expect(view.addLayer).toHaveBeenCalledTimes(1);
  });
});

/** Shared for the same reason `RASTER_CONFIG` is: the store replaces a
 *  record's `config` only when the SOURCE really changed, and a style edit
 *  must not be mistaken for one. */
const GEOJSON_CONFIG = { data: { type: "FeatureCollection", features: [] } };

function geojson(patch: Partial<GeoLayer> = {}): GeoLayer {
  return {
    id: "g1",
    name: "points",
    kind: "geojson",
    visible: true,
    opacity: 1,
    style: DEFAULT_GEO_LAYER_STYLE,
    config: GEOJSON_CONFIG,
    ...patch,
  } as GeoLayer;
}

describe("syncGeoLayers — a changed style", () => {
  it("re-describes the layer instead of rebuilding the pair", () => {
    const { view, layers } = fakeView();
    const live = new Map<string, LiveGeoLayer>();
    syncGeoLayers(view, [geojson()], live);

    // A style edit replaces the style object by IDENTITY, exactly as the store
    // does — the fields could all be equal and it would still be an edit.
    const edited = geojson({
      style: { ...DEFAULT_GEO_LAYER_STYLE, color: "#00ff00" },
    });
    syncGeoLayers(view, [edited], live);

    const update = layers[0]!.update;
    expect(update).toHaveBeenCalledTimes(1);
    const desc = update.mock.calls[0]![0] as Record<
      string,
      { color: number } | unknown
    >;
    expect((desc.point as { color: number }).color).toBe(0x00ff00);
    expect((desc.polyline as { color: number }).color).toBe(0x00ff00);
    expect((desc.polygon as { color: number }).color).toBe(0x00ff00);
    // Nothing was rebuilt: the source still carries the same document.
    expect(view.addSource).toHaveBeenCalledTimes(1);
    expect(view.addLayer).toHaveBeenCalledTimes(1);

    // and the memo holds — the same record costs no further engine call.
    syncGeoLayers(view, [edited], live);
    expect(update).toHaveBeenCalledTimes(1);
    expect(view.addSource).toHaveBeenCalledTimes(1);
  });
});

describe("syncGeoLayers — a changed config", () => {
  it("rebuilds the pair, layer before source", () => {
    const { view, calls } = fakeView();
    const live = new Map<string, LiveGeoLayer>();
    syncGeoLayers(view, [raster()], live);
    calls.length = 0;

    syncGeoLayers(
      view,
      [raster({ config: { urlTemplate: "https://other/{z}/{x}/{y}.png" } })],
      live,
    );

    expect(calls).toEqual([
      "layer.delete",
      "source.delete",
      "addSource",
      "addLayer",
    ]);
    expect(live.size).toBe(1);
  });
});

describe("syncGeoLayers — removal", () => {
  it("deletes the layer BEFORE its source", () => {
    const { view, calls } = fakeView();
    const live = new Map<string, LiveGeoLayer>();
    syncGeoLayers(view, [raster()], live);
    calls.length = 0;

    syncGeoLayers(view, [], live);

    expect(calls).toEqual(["layer.delete", "source.delete"]);
    expect(live.size).toBe(0);
  });

  it("survives a handle that refuses to go away", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = {
      addSource: vi.fn(() => ({ delete: vi.fn(() => true) })),
      addLayer: vi.fn(() => ({
        update: vi.fn(),
        delete: vi.fn(() => {
          throw new Error("already deleted");
        }),
      })),
    };
    const live = new Map<string, LiveGeoLayer>();
    syncGeoLayers(view, [raster()], live);

    expect(() => syncGeoLayers(view, [], live)).not.toThrow();
    expect(live.size).toBe(0);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("removeAllGeoLayerHandles", () => {
  it("empties the registry, layer before source", () => {
    const { view, calls } = fakeView();
    const live = new Map<string, LiveGeoLayer>();
    syncGeoLayers(view, [raster(), raster({ id: "r2" })], live);
    calls.length = 0;

    removeAllGeoLayerHandles(live);

    expect(calls).toEqual([
      "layer.delete",
      "source.delete",
      "layer.delete",
      "source.delete",
    ]);
    expect(live.size).toBe(0);
  });
});
