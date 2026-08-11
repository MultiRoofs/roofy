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

export interface GeoLayerState {
  readonly layers: readonly GeoLayer[];
  /** The layer whose config the inspector shows — the geo mirror of
   *  `layerStore.activeLayerId`, in its own store like everything else geo.
   *  Null is a real state (nothing selected → the inspector shows the city
   *  view); NOT persisted, matching the city side. */
  readonly activeGeoLayerId: string | null;
}

export interface GeoLayerActions {
  /** @returns the id of the layer that was added. */
  addGeoLayer: (input: GeoLayerInput) => string;
  removeGeoLayer: (id: string) => void;
  removeAllGeoLayers: () => void;
  setActiveGeoLayer: (id: string | null) => void;
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
  activeGeoLayerId: null,

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
        ? { ...base, kind: "geojson", config: input.config }
        : input.kind === "raster-xyz"
          ? { ...base, kind: "raster-xyz", config: input.config }
          : { ...base, kind: "3d-tiles", config: input.config };
    set((state) => ({ layers: [...state.layers, layer] }));
    return id;
  },

  removeGeoLayer: (id) =>
    set((state) =>
      state.layers.some((l) => l.id === id)
        ? {
            layers: state.layers.filter((l) => l.id !== id),
            activeGeoLayerId:
              state.activeGeoLayerId === id ? null : state.activeGeoLayerId,
          }
        : state,
    ),

  removeAllGeoLayers: () =>
    set((state) =>
      state.layers.length === 0 && state.activeGeoLayerId === null
        ? state
        : { layers: [], activeGeoLayerId: null },
    ),

  setActiveGeoLayer: (id) => set({ activeGeoLayerId: id }),

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
        layer.kind === "geojson" ? { ...layer, config: { data } } : null,
      ),
    })),
}));
