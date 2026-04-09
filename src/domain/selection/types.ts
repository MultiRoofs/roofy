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
