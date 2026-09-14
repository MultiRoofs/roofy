/**
 * Selection domain types.
 *
 * These describe what can be selected in the viewer and which
 * picking mode is active. ToolMode controls the active interaction tool.
 */

export type PickMode = "object" | "surface";
export type ToolMode = "select" | "box-select" | "measure";

export interface ObjectSelection {
  readonly kind: "object";
  readonly layerId: string;
  readonly objectId: string;
}

export interface SurfaceSelection {
  readonly kind: "surface";
  readonly layerId: string;
  readonly objectId: string;
  readonly surfaceIndex: number;
}

export type Selection = ObjectSelection | SurfaceSelection;

/**
 * A picked feature of a GeoJSON (GIS) layer.
 *
 * Deliberately NOT part of the `Selection` union: geo features have no
 * city-object identity (no objectId, no surface index), and widening the
 * union would ripple through every consumer that narrows on `kind`. The
 * selection store carries it in a parallel field instead, mutually
 * exclusive with the city-object selections.
 */
export interface GeoFeatureSelection {
  /** Layer id in the geo layer store. */
  readonly geoLayerId: string;
  /** Engine per-feature batch id. */
  readonly batchId: number;
  /** Stable source identity, when the GeoJSON source was normalized. */
  readonly stableFeatureId?: string;
  readonly properties: Readonly<Record<string, unknown>>;
}
