/**
 * Selection domain types.
 *
 * These describe what can be selected in the viewer and which
 * picking mode is active. The discriminated union on `kind`
 * makes it easy to extend for multi-select in M2.
 */

export type PickMode = "object" | "surface";

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
