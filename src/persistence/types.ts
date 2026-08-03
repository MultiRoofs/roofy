/**
 * Persistence layer interfaces.
 *
 * These define the contracts for saving and restoring workspace state.
 * v1 uses LocalStorage; the interfaces allow future server-backed or
 * Tauri-native implementations without changing feature-level code.
 */

import type { Rule } from "../features/rules/types";
import type { PickMode } from "../domain/selection/types";

// ---------------------------------------------------------------------------
// Model reference — how a snapshot refers to the loaded city model
// ---------------------------------------------------------------------------

export interface UrlModelRef {
  readonly type: "url";
  readonly url: string;
}

export interface FileModelRef {
  readonly type: "file";
  readonly fileName: string;
}

export type CityModelReference = UrlModelRef | FileModelRef;

// ---------------------------------------------------------------------------
// Per-layer snapshot data
// ---------------------------------------------------------------------------

/**
 * How a streaming layer's `.fcb` source was opened, captured alongside
 * `modelRef` so a restore can tell it apart from a plain (non-streaming)
 * layer sharing the same `CityModelReference` shape. A `"file"` source
 * cannot be reopened on restore — there is no persisted Blob — see
 * `normalizeLayers`'s `unavailable` flag below.
 */
export type StreamSourceSnapshot =
  | { readonly kind: "url"; readonly url: string }
  | { readonly kind: "file"; readonly fileName: string };

export interface LayerSnapshot {
  readonly name: string;
  readonly modelRef: CityModelReference;
  readonly rules: ReadonlyArray<Rule>;
  readonly rulesEnabled: boolean;
  readonly visible: boolean;
  readonly selectedLod?: string | null;
  /** Defaults to "auto" on restore (via `normalizeLayers`) when absent from
   *  a saved snapshot. */
  readonly lodMode?: "auto" | "manual";
  /** Present only for a streaming layer. */
  readonly stream?: StreamSourceSnapshot;
}

// ---------------------------------------------------------------------------
// Layer-snapshot normalisation
// ---------------------------------------------------------------------------

/**
 * Loosely-typed shape `normalizeLayers` accepts: "whatever was actually
 * saved to localStorage or decoded from a share hash", which may be missing
 * optional fields such as `lodMode`/`stream`. An index signature (not
 * `unknown`/`never`) keeps every already-known field (`name`, `modelRef`,
 * `rules`, ...) passed through untouched via the spread in `normalizeLayers`,
 * while still accepting arbitrary extra/missing keys from a saved document.
 */
export interface RawLayerSnapshot {
  readonly [key: string]: unknown;
  readonly lodMode?: "auto" | "manual";
  readonly stream?: StreamSourceSnapshot;
}

export interface RawLayersDocument {
  readonly version?: number;
  readonly layers?: ReadonlyArray<RawLayerSnapshot>;
}

export interface NormalizedLayerSnapshot extends RawLayerSnapshot {
  readonly lodMode: "auto" | "manual";
  /** True when this layer streamed from a local `File`/`Blob` — that byte
   *  source cannot survive a reload, so the layer must be presented as an
   *  explicit "needs re-selection" placeholder rather than silently
   *  dropped (see App.tsx's restore path). Omitted (not `false`) when not
   *  applicable, matching this codebase's convention of leaving
   *  not-applicable optional booleans absent rather than explicit `false`. */
  readonly unavailable?: boolean;
}

/**
 * Normalises a raw layers document to the shape the restore path consumes:
 * defaults `lodMode` to `"auto"` when absent, and marks a file-backed
 * streaming layer `unavailable`.
 *
 * This is NOT a version migration — snapshot v3 rejects every older document
 * outright (see {@link UnsupportedSnapshotVersionError}). It is the
 * per-layer "default what's optional, flag what cannot survive a reload"
 * pass, which a perfectly current v3 document needs too, because `lodMode`
 * is optional in {@link LayerSnapshot} and a `File`-backed stream source is
 * unreachable after a reload no matter which version wrote it.
 */
export function normalizeLayers(
  raw: RawLayersDocument,
): NormalizedLayerSnapshot[] {
  return (raw.layers ?? []).map((l): NormalizedLayerSnapshot => {
    const lodMode = l.lodMode ?? "auto";
    return l.stream?.kind === "file"
      ? { ...l, lodMode, unavailable: true }
      : { ...l, lodMode };
  });
}

// ---------------------------------------------------------------------------
// View state — camera, datetime, and display settings
// ---------------------------------------------------------------------------

/**
 * The saved camera, in GEOGRAPHIC terms (snapshot v3): the camera's own
 * geodetic position plus its orientation in degrees, exactly the six scalars
 * the viewport's `getCameraState`/`setCameraState` exchange.
 *
 * Structurally identical to the scene layer's `GeographicCameraState`
 * (`src/scene/geographicCamera.ts`) and deliberately declared twice, so
 * persistence never imports the scene and the scene never imports
 * persistence; TypeScript's structural typing lets one flow into the other,
 * and a unit test asserts that assignability so the two cannot drift apart.
 *
 * v1/v2 stored `cameraPosition`/`cameraTarget` — two Three.js scene-space
 * 3-tuples measured from an origin-offset mesh frame that no longer exists.
 * Those coordinates cannot be converted into this shape after the fact,
 * which is why old snapshots are rejected rather than migrated.
 */
export interface GeographicCamera {
  readonly lng: number;
  readonly lat: number;
  /** Metres above the WGS84 ellipsoid. */
  readonly height: number;
  /** Degrees clockwise from north. */
  readonly heading: number;
  /** Degrees; negative looks down. */
  readonly pitch: number;
  /** Degrees. */
  readonly roll: number;
}

export interface ViewState {
  readonly camera: GeographicCamera;
  readonly datetime: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// Project snapshot — the full serializable workspace state
// ---------------------------------------------------------------------------

/**
 * Schema version written by `captureSnapshot` and demanded by
 * `restoreSnapshot`. Lives here rather than beside either of them so the two
 * halves of the round trip read the SAME constant.
 *
 * v3 (breaking): `viewState.camera` is a {@link GeographicCamera}, replacing
 * v2's `cameraPosition`/`cameraTarget` scene-space tuples.
 */
export const SNAPSHOT_VERSION = "3";

export interface ProjectSnapshot {
  /** Always {@link SNAPSHOT_VERSION} when written; anything else is rejected
   *  on restore. */
  readonly version: string;
  readonly savedAt: string; // ISO 8601
  readonly label: string;
  readonly layers?: ReadonlyArray<LayerSnapshot>;
  readonly viewState: ViewState;
  readonly pickMode: PickMode;
}

/**
 * Thrown by `restoreSnapshot` for any snapshot not written by the current
 * version. There is deliberately no migration shim: v1/v2 stored the camera
 * as Three.js scene coordinates relative to an origin-offset mesh frame that
 * the Navara viewport no longer has, so a "migrated" snapshot could only
 * restore a wrong camera silently. Failing loudly with a re-save instruction
 * is the honest option.
 */
export class UnsupportedSnapshotVersionError extends Error {
  constructor(readonly found: string) {
    super(
      `This saved workspace was created by an older version of MultiRoof Viewer (v${found}) and can no longer be restored. Saved cameras changed from scene coordinates to geographic coordinates; please re-save from the current version.`,
    );
    this.name = "UnsupportedSnapshotVersionError";
  }
}

// ---------------------------------------------------------------------------
// Store interface — CRUD for snapshots
// ---------------------------------------------------------------------------

export interface SnapshotSummary {
  readonly id: string;
  readonly savedAt: string;
  readonly label: string;
}

export interface ProjectStateStore {
  save(snapshot: ProjectSnapshot): Promise<string>;
  load(id: string): Promise<ProjectSnapshot | null>;
  list(): Promise<SnapshotSummary[]>;
  remove(id: string): Promise<void>;
}
