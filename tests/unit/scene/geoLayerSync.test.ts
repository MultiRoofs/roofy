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
  geoLayerIdForEngineLayerId,
  GEO_HIGHLIGHT_COLOR_HEX,
  removeAllGeoLayerHandles,
  syncGeoHighlight,
  syncGeoLayers,
  type GeoFeatureEvaluator,
  type LiveGeoLayer,
} from "../../../src/scene/geoLayerSync";
import type { GeoLayer } from "../../../src/features/geoLayers/geoLayerStore";
import {
  DEFAULT_GEO_LAYER_STYLE,
  hexColorToNumber,
} from "../../../src/features/geoLayers/geoLayerStyle";
import { CITY_HIGHLIGHT_COLOR_HEX } from "../../../src/scene/cityAppearance";

/** A feature-set listener the fake layer handle recorded, so a test can play
 *  the engine and fire `featureCreated`/`featureUpdated` itself. */
type FakeListener = {
  type: "featureCreated" | "featureUpdated";
  cb: (params: {
    readonly featureSetId?: unknown;
    readonly evaluator: GeoFeatureEvaluator;
  }) => void;
};

/** One fake engine `Layer`: an id a pick can be resolved through, the feature
 *  events the module subscribes to, and a counted `forceUpdate`. */
function fakeLayerHandle(
  desc: Record<string, unknown>,
  id: string,
  onDelete: () => void,
) {
  const listeners: FakeListener[] = [];
  return {
    desc,
    id,
    listeners,
    update: vi.fn(),
    delete: vi.fn(onDelete),
    on: vi.fn((type: FakeListener["type"], cb: FakeListener["cb"]) => {
      listeners.push({ type, cb });
    }),
    forceUpdate: vi.fn(),
  };
}

type FakeLayerHandle = ReturnType<typeof fakeLayerHandle>;

/** One engine `FeatureEvaluator`: records the last callback it was handed so a
 *  test can run it for a given batch id and inspect what the module returns. */
function fakeEvaluator() {
  const evaluator = {
    evaluate: vi.fn((cb: (info: { readonly batchId: number }) => unknown) => {
      evaluator.lastCb = cb;
    }),
    lastCb: null as ((info: { readonly batchId: number }) => unknown) | null,
    /** Run the last callback the module installed, as the engine would per
     *  batch. */
    run(batchId: number): Record<string, unknown> {
      if (evaluator.lastCb === null) throw new Error("no callback installed");
      return evaluator.lastCb({ batchId }) as Record<string, unknown>;
    },
  };
  return evaluator;
}

/** Fire one feature-set event at every listener the module installed. */
function fireFeatureEvent(
  handle: FakeLayerHandle,
  type: "featureCreated" | "featureUpdated",
  evaluator: GeoFeatureEvaluator,
  featureSetId?: unknown,
): void {
  for (const listener of handle.listeners) {
    if (listener.type === type) listener.cb({ featureSetId, evaluator });
  }
}

/** The engine `Color` factory the viewport supplies — a plain object here, so
 *  an assertion can read the hex straight back out. */
const makeColor = (hex: number) => ({ hex });

/** Records the order of every engine call, which is what the delete-order
 *  assertion below is really about. */
function fakeView() {
  const calls: string[] = [];
  const sources: Array<{ desc: unknown; delete: ReturnType<typeof vi.fn> }> =
    [];
  const layers: FakeLayerHandle[] = [];

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
      const handle = fakeLayerHandle(
        desc,
        `engine-layer-${layers.length + 1}`,
        () => {
          calls.push("layer.delete");
        },
      );
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

describe("geoLayerIdForEngineLayerId", () => {
  it("finds the record whose handle carries the engine layer id", () => {
    const { view, layers } = fakeView();
    const live = new Map<string, LiveGeoLayer>();
    syncGeoLayers(view, [geojson(), raster()], live);

    expect(geoLayerIdForEngineLayerId(live, layers[0]!.id)).toBe("g1");
    expect(geoLayerIdForEngineLayerId(live, layers[1]!.id)).toBe("r1");
  });

  it("answers null for an id nothing carries", () => {
    const { view } = fakeView();
    const live = new Map<string, LiveGeoLayer>();
    syncGeoLayers(view, [geojson()], live);

    expect(geoLayerIdForEngineLayerId(live, "engine-layer-99")).toBeNull();
    expect(geoLayerIdForEngineLayerId(new Map(), "engine-layer-1")).toBeNull();
  });

  it("never matches a handle that carries no id, even against undefined", () => {
    const view = {
      addSource: vi.fn(() => ({ delete: vi.fn(() => true) })),
      addLayer: vi.fn(() => ({ update: vi.fn(), delete: vi.fn() })),
    };
    const live = new Map<string, LiveGeoLayer>();
    syncGeoLayers(view, [geojson()], live);

    expect(live.size).toBe(1);
    expect(geoLayerIdForEngineLayerId(live, undefined)).toBeNull();
  });
});

/** The style's own colour, as the engine number — what a cleared or unselected
 *  feature must be told explicitly, because an omitted key never resets a
 *  previously evaluated override. */
const OWN_COLOR_HEX = 0xf2683c;

describe("GEO_HIGHLIGHT_COLOR_HEX", () => {
  it("is the SAME accent the city meshes highlight a surface with", () => {
    // Pinned against the submodule rather than restated as a comment: the two
    // constants are the same UI state ("this is selected") in one viewport, and
    // a plugin-side retune of the city accent must fail here rather than
    // silently leave a picked GeoJSON polygon a different orange. The import is
    // engine-free (`@cityjson/navara-cityjson`'s main barrel is Node-safe by
    // construction), and the submodule spells the value as a CSS hex string.
    expect(GEO_HIGHLIGHT_COLOR_HEX).toBe(
      hexColorToNumber(CITY_HIGHLIGHT_COLOR_HEX),
    );
  });
});

describe("syncGeoHighlight", () => {
  /** A layer with two feature sets registered, exactly as a mixed-geometry
   *  GeoJSON produces: one evaluator per material. */
  function highlightable() {
    const { view, layers } = fakeView();
    const live = new Map<string, LiveGeoLayer>();
    syncGeoLayers(view, [geojson()], live);
    const handle = layers[0]!;
    const points = fakeEvaluator();
    const polygons = fakeEvaluator();
    fireFeatureEvent(handle, "featureCreated", points, 1n);
    fireFeatureEvent(handle, "featureCreated", polygons, 2n);
    return { view, live, layers, handle, points, polygons };
  }

  it("evaluates EVERY registered feature set and forces one update", () => {
    const { live, handle, points, polygons } = highlightable();

    syncGeoHighlight({ geoLayerId: "g1", batchId: 7 }, live, makeColor);

    expect(points.evaluate).toHaveBeenCalledTimes(1);
    expect(polygons.evaluate).toHaveBeenCalledTimes(1);
    for (const evaluator of [points, polygons]) {
      expect(evaluator.run(7)).toEqual({
        color: { hex: GEO_HIGHLIGHT_COLOR_HEX },
      });
      // NOT `{}`: an omitted field leaves a previous override in place, so
      // every other feature is told the layer's own colour explicitly.
      expect(evaluator.run(8)).toEqual({ color: { hex: OWN_COLOR_HEX } });
    }
    expect(handle.forceUpdate).toHaveBeenCalledTimes(1);
  });

  it("costs nothing when the same selection is re-applied", () => {
    const { live, handle, points } = highlightable();
    const selection = { geoLayerId: "g1", batchId: 7 };

    syncGeoHighlight(selection, live, makeColor);
    syncGeoHighlight({ ...selection }, live, makeColor);

    expect(points.evaluate).toHaveBeenCalledTimes(1);
    expect(handle.forceUpdate).toHaveBeenCalledTimes(1);
  });

  it("clears back to the layer's own colour, and never touches a layer that was never highlighted", () => {
    const { view, live, layers, handle, points, polygons } = highlightable();
    // A second layer, with its own feature set, that is never selected.
    syncGeoLayers(view, [geojson(), raster({ id: "r1" })], live);
    const untouched = fakeEvaluator();
    const untouchedHandle = layers[1]!;
    fireFeatureEvent(untouchedHandle, "featureCreated", untouched, 1n);

    syncGeoHighlight({ geoLayerId: "g1", batchId: 7 }, live, makeColor);
    syncGeoHighlight(null, live, makeColor);

    expect(points.evaluate).toHaveBeenCalledTimes(2);
    expect(polygons.evaluate).toHaveBeenCalledTimes(2);
    expect(points.run(7)).toEqual({ color: { hex: OWN_COLOR_HEX } });
    expect(points.run(8)).toEqual({ color: { hex: OWN_COLOR_HEX } });
    expect(handle.forceUpdate).toHaveBeenCalledTimes(2);

    // The layer that never had an override is left alone — evaluated colours
    // would otherwise shadow every future style edit.
    expect(untouched.evaluate).not.toHaveBeenCalled();
    expect(untouchedHandle.forceUpdate).not.toHaveBeenCalled();
  });

  it("applies the live highlight through a feature set created afterwards", () => {
    const { live, handle, points } = highlightable();
    syncGeoHighlight({ geoLayerId: "g1", batchId: 7 }, live, makeColor);

    // `Layer.update()` recreates features: a fresh evaluator arrives and must
    // carry the desired state, or the highlight silently disappears.
    const rebuilt = fakeEvaluator();
    fireFeatureEvent(handle, "featureCreated", rebuilt, 3n);

    expect(rebuilt.evaluate).toHaveBeenCalledTimes(1);
    expect(rebuilt.run(7)).toEqual({ color: { hex: GEO_HIGHLIGHT_COLOR_HEX } });
    expect(rebuilt.run(8)).toEqual({ color: { hex: OWN_COLOR_HEX } });
    expect(live.get("g1")!.evaluators.size).toBe(3);
    expect([...live.get("g1")!.evaluators.values()]).toContain(points);
  });

  it("adds and highlights harmlessly when the handle has no feature events", () => {
    const view = {
      addSource: vi.fn(() => ({ delete: vi.fn(() => true) })),
      addLayer: vi.fn(() => ({ update: vi.fn(), delete: vi.fn() })),
    };
    const live = new Map<string, LiveGeoLayer>();

    expect(() => syncGeoLayers(view, [geojson()], live)).not.toThrow();
    expect(live.get("g1")!.evaluators.size).toBe(0);

    expect(() =>
      syncGeoHighlight({ geoLayerId: "g1", batchId: 7 }, live, makeColor),
    ).not.toThrow();
    expect(live.get("g1")!.highlightedBatchId).toBe(7);
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
