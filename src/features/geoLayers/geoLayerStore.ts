/**
 * Geospatial layers: GeoJSON, XYZ raster tiles and Cesium 3D Tiles.
 *
 * A SEPARATE store from `layerStore`, not a variant of it, because the two
 * share nothing but the word "layer": a geospatial layer has no `CityModel`,
 * no LoD ladder, no rules, no object types, nothing to pick and nothing to
 * measure. Folding it into `Layer` would make every one of those fields
 * optional and every consumer of them defensive, for a record whose entire
 * lifecycle is "add a source, add a layer, delete both".
 *
 * Every action REPLACES what it edits — the record, the array — and never
 * mutates in place. That is not style: `geoLayerSync.ts` decides "rebuild the
 * engine pair" from `config` identity and "re-describe the live layer" from
 * the record's own fields, so an in-place mutation would be invisible to it
 * and a needless replacement would tear a live layer down for nothing.
 */
import { create } from "zustand";
import {
  DEFAULT_GEO_LAYER_STYLE,
  normalizeGeoLayerStyle,
  type GeoLayerStyle,
} from "./geoLayerStyle";
import {
  normalizeGeoJsonDocument,
  readGeoStableFeatureId,
} from "./geoJsonRecords";

export type GeoLayerKind = "geojson" | "raster-xyz" | "3d-tiles";

/**
 * A GeoJSON layer's source: an inline document (a dropped file, parsed) or a
 * URL the engine fetches.
 *
 * BOTH are optional, and a config with neither is a real, reachable state:
 * inline data is far too big for localStorage, so a file-loaded layer comes
 * back from a snapshot with an empty config and waits to be re-linked. See
 * {@link isGeoLayerUnavailable}.
 */
export interface GeoJsonLayerConfig {
  /** A parsed `Feature` / `FeatureCollection`. `unknown` because nothing in
   *  this app inspects it — it is handed to the engine as-is, and validated
   *  once at the door by `parseGeoJsonText`. */
  readonly data?: unknown;
  readonly url?: string;
  /** Engine-only normalized clone; never persisted. */
  readonly preparedData?: unknown;
  readonly preparation?: "loading" | "ready" | "failed";
  readonly preparationError?: string;
  readonly preparationEpoch?: number;
}

export interface RasterXyzLayerConfig {
  /** An XYZ template, e.g. `https://…/{z}/{x}/{y}.png`. */
  readonly urlTemplate: string;
  readonly minZoom?: number;
  readonly maxZoom?: number;
  /** TMS row order (y flipped), which some services publish instead of XYZ. */
  readonly tms?: boolean;
}

export interface Tiles3dLayerConfig {
  /** The `tileset.json` entry point. */
  readonly url: string;
}

export type GeoLayerConfig =
  | GeoJsonLayerConfig
  | RasterXyzLayerConfig
  | Tiles3dLayerConfig;

interface GeoLayerBase {
  readonly id: string;
  readonly name: string;
  readonly visible: boolean;
  /** 0…1. Only the raster rows expose a slider today, but the value is on
   *  every record because every kind's engine description has somewhere to
   *  put it. */
  readonly opacity: number;
  /** How the layer is drawn. REQUIRED, and always a whole record: every kind's
   *  description reads at least one of its fields, and an optional style would
   *  put the "or the default" branch in every one of those readers instead of
   *  once, here. Replaced wholesale on edit — never mutated — so the reconciler
   *  can memoise on its identity. */
  readonly style: GeoLayerStyle;
}

/**
 * DISCRIMINATED on `kind`, so the description builders can read
 * `config.urlTemplate` without a cast and a new kind cannot be added without
 * the compiler asking what its description looks like.
 */
export type GeoLayer =
  | (GeoLayerBase & {
      readonly kind: "geojson";
      readonly config: GeoJsonLayerConfig;
    })
  | (GeoLayerBase & {
      readonly kind: "raster-xyz";
      readonly config: RasterXyzLayerConfig;
    })
  | (GeoLayerBase & {
      readonly kind: "3d-tiles";
      readonly config: Tiles3dLayerConfig;
    });

/**
 * The union's GeoJSON arm.
 *
 * Every reader of a vector layer's CONTENT — the cross-layer run, the records
 * panel, the export, the style controls — reads `config.preparedData`, which
 * only this arm has; typing such a reader `GeoLayer` does not compile and casting
 * it would be a lie the compiler cannot check. `Extract` rather than a second
 * hand-written record, so a change to the arm cannot leave this behind.
 */
export type GeoJsonLayer = Extract<GeoLayer, { kind: "geojson" }>;

/** What `addGeoLayer` takes: a {@link GeoLayer} without the id the store
 *  mints, and with the three defaulted fields optional. Distributive on
 *  purpose — `Omit` over a union would collapse the kind/config pairing that
 *  makes the union worth having. */
export type GeoLayerInput = GeoLayer extends infer L
  ? L extends GeoLayer
    ? Omit<L, "id" | "visible" | "opacity" | "style"> & {
        readonly visible?: boolean;
        readonly opacity?: number;
        readonly style?: GeoLayerStyle;
      }
    : never
  : never;

/** The fields an edit may touch. `config` is deliberately absent: replacing a
 *  source is a different operation with a different cost (the engine pair is
 *  rebuilt), and it has its own action. */
export interface GeoLayerPatch {
  readonly name?: string;
  readonly visible?: boolean;
  readonly opacity?: number;
  /** WHOLE-OBJECT replacement, never a partial merge: the record is small, the
   *  UI always holds the complete style it is editing, and a per-field patch
   *  would make "unset this field" indistinguishable from "leave it". Its own
   *  identity moves on every style edit, which is exactly what the reconciler
   *  re-describes on. Normalized on write. */
  readonly style?: GeoLayerStyle;
}

/** Fully opaque. A layer the user just added must be visible at the strength
 *  they expect, and fading it is the deliberate act. */
export const DEFAULT_GEO_LAYER_OPACITY = 1;

function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_GEO_LAYER_OPACITY;
  return Math.min(1, Math.max(0, value));
}

/**
 * A layer that cannot be drawn because its bytes did not survive a reload.
 *
 * Only a GeoJSON layer can be in this state, and only one that was loaded from
 * a local file: `data` is never persisted (see `GeoLayerSnapshot`), so a
 * restored workspace brings the row back with an empty config. The row stays —
 * with its name, visibility and opacity — and offers to be re-linked, exactly
 * as a file-backed city model does (`App.tsx`'s unavailable-layer prompt).
 * Dropping it silently would lose settings the user chose.
 */
export function isGeoLayerUnavailable(layer: GeoLayer): boolean {
  return (
    layer.kind === "geojson" &&
    layer.config.data === undefined &&
    (layer.config.url === undefined || layer.config.url === "")
  );
}

/**
 * A prepared document with `byStableId`'s values merged into the matching
 * features' properties, or `null` when nothing matched.
 *
 * Copy-on-write, feature by feature: the features that change are replaced and
 * the rest keep their identity, so a merge over 6 of 6,000 areas clones 6
 * objects. `null` rather than an unchanged clone, so the caller can leave the
 * layer record — and the engine pair — untouched.
 *
 * PURE and non-mutating, which is what lets Task 23 hand it the PARENT's
 * `preparedData` to build a derived layer's document from: §6's "the run leaves
 * the target untouched" is a property of this function, not of its callers.
 */
export function mergeGeoDocumentProperties(
  document: unknown,
  byStableId: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
  // `unknown` and not `unknown | null`: the union collapses to `unknown` and
  // the linter refuses the redundant constituent. The NULL is the contract —
  // "nothing matched" — and every caller compares against it.
): unknown {
  if (byStableId.size === 0) return null;
  const source = document as {
    type?: unknown;
    features?: unknown[];
  } | null;
  const mergeFeature = (feature: unknown): unknown => {
    const record = feature as { properties?: unknown } | null;
    const properties =
      record?.properties && typeof record.properties === "object"
        ? (record.properties as Record<string, unknown>)
        : null;
    if (properties === null) return feature;
    const stableId = readGeoStableFeatureId(properties);
    const values = stableId === null ? undefined : byStableId.get(stableId);
    if (values === undefined) return feature;
    return { ...record, properties: { ...properties, ...values } };
  };
  if (source?.type === "FeatureCollection" && Array.isArray(source.features)) {
    const features = source.features.map(mergeFeature);
    const changed = features.some((f, i) => f !== source.features?.[i]);
    return changed ? { ...source, features } : null;
  }
  if (source?.type === "Feature") {
    const merged = mergeFeature(source);
    return merged === source ? null : merged;
  }
  return null;
}

/**
 * What a property was before a run wrote it, when it was not there at all.
 *
 * A SENTINEL and not `undefined`: `{ ...properties, bld_buildings_n: undefined }`
 * leaves the KEY in the bag, and the records grid, Details and the GeoJSON
 * export would all still list it — an Undo that visibly did not undo.
 */
export const GEO_PROPERTY_ABSENT: unique symbol = Symbol("absent");

export type GeoPreviousValues = ReadonlyMap<
  string,
  Readonly<Record<string, unknown>>
>;

/**
 * §6.2's Undo for a vector run: this run's OWN columns put back, feature by
 * feature, into the CURRENT document.
 *
 * NOT a stored snapshot of the whole document. Two runs can be undoable on one
 * layer at the same time — Undo is stolen only where two runs share a COLUMN
 * (`runQueue.ts`'s `stealUndo`) — so restoring a snapshot taken before run A
 * would also erase run B's results while B still read "undoable". Touching only
 * the keys the run wrote makes the two Undos independent in either order, which
 * is what §6.2 promises.
 *
 * Copy-on-write like {@link mergeGeoDocumentProperties}, and `null` when
 * nothing changed so the caller can leave the layer record — and the engine
 * pair — alone.
 */
export function restoreGeoDocumentProperties(
  document: unknown,
  previous: GeoPreviousValues,
  /** `null` when nothing changed; see {@link mergeGeoDocumentProperties}. */
): unknown {
  if (previous.size === 0) return null;
  const source = document as { type?: unknown; features?: unknown[] } | null;
  const restoreFeature = (feature: unknown): unknown => {
    const record = feature as { properties?: unknown } | null;
    const properties =
      record?.properties && typeof record.properties === "object"
        ? (record.properties as Record<string, unknown>)
        : null;
    if (properties === null) return feature;
    const stableId = readGeoStableFeatureId(properties);
    const values = stableId === null ? undefined : previous.get(stableId);
    if (values === undefined) return feature;
    const next: Record<string, unknown> = { ...properties };
    let changed = false;
    for (const [key, value] of Object.entries(values)) {
      if (value === GEO_PROPERTY_ABSENT) {
        if (key in next) {
          delete next[key];
          changed = true;
        }
        continue;
      }
      if (!(key in next) || next[key] !== value) changed = true;
      next[key] = value;
    }
    return changed ? { ...record, properties: next } : feature;
  };
  if (source?.type === "FeatureCollection" && Array.isArray(source.features)) {
    const features = source.features.map(restoreFeature);
    const changed = features.some((f, i) => f !== source.features?.[i]);
    return changed ? { ...source, features } : null;
  }
  if (source?.type === "Feature") {
    const restored = restoreFeature(source);
    return restored === source ? null : restored;
  }
  return null;
}

export interface GeoLayerState {
  readonly layers: readonly GeoLayer[];
}

export interface GeoLayerActions {
  /** @returns the id of the layer that was added. */
  addGeoLayer: (input: GeoLayerInput) => string;
  removeGeoLayer: (id: string) => void;
  removeAllGeoLayers: () => void;
  updateGeoLayer: (id: string, patch: GeoLayerPatch) => void;
  /**
   * Give a GeoJSON layer a freshly read document — the re-link path for a row
   * restored from a snapshot.
   *
   * Its own action rather than a `config` field on {@link GeoLayerPatch}
   * because it is the one edit that costs a full engine rebuild, and because
   * typing it this narrowly is what keeps a raster config from ever being
   * written onto a GeoJSON layer. A layer of another kind is left untouched.
   */
  relinkGeoJsonLayer: (id: string, data: unknown) => void;
  /**
   * Spec §7.6: a run's results, merged onto the vector layer's FEATURE
   * PROPERTIES — which is what the app holds for a vector layer (it has no
   * DuckDB table and no model).
   *
   * Into `preparedData`, never `config.data`: `preparedData` is the document the
   * engine, the records panel and the GeoJSON export all read, and it is
   * documented "never persisted" — which is exactly §8's "nothing new is
   * saved". Writing `data` would put a URL-backed layer's whole fetched
   * document into the snapshot.
   *
   * ONE new config, whatever the number of features: `geoLayerSync.ts` rebuilds
   * the engine pair on config identity, so a `set` per feature would rebuild it
   * once per area. A merge that changes nothing leaves the record's identity
   * alone.
   */
  mergeGeoFeatureProperties: (
    layerId: string,
    byStableId: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
  ) => void;
  /** §6.2's Undo for a vector run: the restored document, put back whole. */
  replaceGeoPreparedData: (layerId: string, data: unknown) => void;
  setPreparedGeoJson: (id: string, data: unknown) => void;
  setGeoJsonPreparationError: (id: string, message: string) => void;
  retryGeoJsonPreparation: (id: string) => void;
}

export type GeoLayerStore = GeoLayerState & GeoLayerActions;

/** Replace exactly one record, or leave the whole array's identity alone. The
 *  latter matters: the viewport's sync effect depends on `layers`, so a
 *  no-op edit that replaced the array would re-run reconciliation for
 *  nothing. */
function replaceLayer(
  layers: readonly GeoLayer[],
  id: string,
  next: (layer: GeoLayer) => GeoLayer | null,
): readonly GeoLayer[] {
  const index = layers.findIndex((l) => l.id === id);
  if (index === -1) return layers;
  const replacement = next(layers[index]!);
  if (replacement === null) return layers;
  const copy = [...layers];
  copy[index] = replacement;
  return copy;
}

export const useGeoLayerStore = create<GeoLayerStore>((set) => ({
  layers: [],

  addGeoLayer: (input) => {
    const id = crypto.randomUUID();
    const base = {
      id,
      name: input.name,
      visible: input.visible ?? true,
      opacity: clampOpacity(input.opacity ?? DEFAULT_GEO_LAYER_OPACITY),
      // Normalized even though the input is TYPED as a style: this store is
      // reached from a restored snapshot and a share link as well as from the
      // UI, and these values go on to the engine unchecked.
      style:
        input.style === undefined
          ? DEFAULT_GEO_LAYER_STYLE
          : normalizeGeoLayerStyle(input.style),
    };
    // Rebuilt per kind rather than spread, so the discriminated union survives
    // the trip through the loosely-typed input.
    const layer: GeoLayer =
      input.kind === "geojson"
        ? {
            ...base,
            kind: "geojson",
            config:
              input.config.data === undefined
                ? {
                    ...input.config,
                    preparation: input.config.url ? "loading" : undefined,
                  }
                : {
                    ...input.config,
                    preparedData: normalizeGeoJsonDocument(input.config.data)
                      .data,
                    preparation: "ready",
                  },
          }
        : input.kind === "raster-xyz"
          ? { ...base, kind: "raster-xyz", config: input.config }
          : { ...base, kind: "3d-tiles", config: input.config };
    set((state) => ({ layers: [...state.layers, layer] }));
    return id;
  },

  removeGeoLayer: (id) =>
    set((state) =>
      state.layers.some((l) => l.id === id)
        ? { layers: state.layers.filter((l) => l.id !== id) }
        : state,
    ),

  removeAllGeoLayers: () =>
    set((state) => (state.layers.length === 0 ? state : { layers: [] })),

  updateGeoLayer: (id, patch) =>
    set((state) => ({
      layers: replaceLayer(state.layers, id, (layer) => ({
        ...layer,
        name: patch.name ?? layer.name,
        visible: patch.visible ?? layer.visible,
        opacity:
          patch.opacity === undefined
            ? layer.opacity
            : clampOpacity(patch.opacity),
        // Identity preserved when the patch is silent about style, so a
        // visibility toggle does not look like a restyle to the reconciler.
        style:
          patch.style === undefined
            ? layer.style
            : normalizeGeoLayerStyle(patch.style),
      })),
    })),

  relinkGeoJsonLayer: (id, data) =>
    set((state) => ({
      layers: replaceLayer(state.layers, id, (layer) =>
        layer.kind === "geojson"
          ? {
              ...layer,
              config: {
                data,
                preparedData: normalizeGeoJsonDocument(data).data,
                preparation: "ready",
              },
            }
          : null,
      ),
    })),

  mergeGeoFeatureProperties: (layerId, byStableId) =>
    set((state) => ({
      layers: replaceLayer(state.layers, layerId, (layer) => {
        if (layer.kind !== "geojson") return null;
        const merged = mergeGeoDocumentProperties(
          layer.config.preparedData,
          byStableId,
        );
        return merged === null
          ? null
          : { ...layer, config: { ...layer.config, preparedData: merged } };
      }),
    })),

  replaceGeoPreparedData: (layerId, data) =>
    set((state) => ({
      layers: replaceLayer(state.layers, layerId, (layer) =>
        layer.kind === "geojson"
          ? { ...layer, config: { ...layer.config, preparedData: data } }
          : null,
      ),
    })),

  setPreparedGeoJson: (id, data) =>
    set((state) => ({
      layers: replaceLayer(state.layers, id, (layer) =>
        layer.kind === "geojson"
          ? {
              ...layer,
              config: {
                ...layer.config,
                preparedData: data,
                preparation: "ready",
                preparationError: undefined,
              },
            }
          : null,
      ),
    })),
  setGeoJsonPreparationError: (id, message) =>
    set((state) => ({
      layers: replaceLayer(state.layers, id, (layer) =>
        layer.kind === "geojson"
          ? {
              ...layer,
              config: {
                ...layer.config,
                preparedData: undefined,
                preparation: "failed",
                preparationError: message,
              },
            }
          : null,
      ),
    })),
  retryGeoJsonPreparation: (id) =>
    set((state) => ({
      layers: replaceLayer(state.layers, id, (layer) =>
        layer.kind === "geojson"
          ? {
              ...layer,
              config: {
                ...layer.config,
                preparedData: undefined,
                preparation: "loading",
                preparationError: undefined,
                preparationEpoch: (layer.config.preparationEpoch ?? 0) + 1,
              },
            }
          : null,
      ),
    })),
}));
