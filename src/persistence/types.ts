/**
 * Persistence layer interfaces.
 *
 * These define the contracts for saving and restoring workspace state.
 * v1 uses LocalStorage; the interfaces allow future server-backed or
 * Tauri-native implementations without changing feature-level code.
 */

import type { AppearanceTheme } from "@cityjson/navara-core";
import type { Rule } from "../features/rules/types";
import type { PickMode } from "../domain/selection/types";
import type { ViewMode } from "../features/viewMode/viewModeStore";
import type { SceneTheme } from "../features/sceneTheme/sceneThemeStore";
import type {
  GeoLayer,
  GeoLayerInput,
  GeoLayerKind,
} from "../features/geoLayers/geoLayerStore";
import {
  normalizeGeoLayerStyle,
  type GeoLayerStyle,
} from "../features/geoLayers/geoLayerStyle";

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
  /** First-level object groups hidden in this layer, defaulted to `[]` on
   *  restore (via `normalizeLayers`) when absent. The layer's
   *  `availableObjectTypes` is NOT saved: it is derived from the model on
   *  load, and rediscovered cell by cell for a streaming layer. */
  readonly hiddenTypes?: readonly string[];
  /** The appearance theme drawn (texture or material), `null` for plain
   *  colours. Absent in older snapshots — restore then picks the model's
   *  load default, exactly like a fresh load. Additive; version stays "3". */
  readonly appearance?: AppearanceTheme | null;
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
  readonly hiddenTypes?: readonly string[];
  readonly stream?: StreamSourceSnapshot;
}

export interface RawLayersDocument {
  readonly version?: number;
  readonly layers?: ReadonlyArray<RawLayerSnapshot>;
}

export interface NormalizedLayerSnapshot extends RawLayerSnapshot {
  readonly lodMode: "auto" | "manual";
  readonly hiddenTypes: readonly string[];
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
 * defaults `lodMode` to `"auto"` and `hiddenTypes` to `[]` when absent, and
 * marks a file-backed streaming layer `unavailable`.
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
    const hiddenTypes = l.hiddenTypes ?? [];
    return l.stream?.kind === "file"
      ? { ...l, lodMode, hiddenTypes, unavailable: true }
      : { ...l, lodMode, hiddenTypes };
  });
}

// ---------------------------------------------------------------------------
// Geospatial layers (GeoJSON / XYZ raster / 3D Tiles)
// ---------------------------------------------------------------------------

/**
 * One geospatial layer as it is written to a snapshot.
 *
 * Deliberately NOT the store's `GeoLayer`: the id is regenerated on restore
 * (it identifies a live record, not a saved one) and — the rule this type
 * exists to enforce — an inline GeoJSON `data` document is NEVER written. A
 * city-sized extract is megabytes; localStorage holds a few, so persisting it
 * would fail the whole save. `geoLayerSnapshot` is the only sanctioned way to
 * build one.
 */
export interface GeoLayerSnapshot {
  readonly name: string;
  readonly kind: GeoLayerKind;
  readonly visible: boolean;
  readonly opacity: number;
  /**
   * How the layer is drawn — a user choice like the name and the opacity, and
   * persisted for the same reason.
   *
   * OPTIONAL here although it is REQUIRED on the store's record, and the
   * snapshot version stayed `"3"` because of it: the field is purely additive,
   * so a v3 document written before styles existed is still a valid v3
   * document and restores at `DEFAULT_GEO_LAYER_STYLE` — the values that
   * were hardcoded when it was saved, which is exactly the rendering it was
   * saved from. `normalizeGeoLayers` is what makes that true, so no reader
   * downstream ever sees the absence.
   */
  readonly style?: GeoLayerStyle;
  /** The store's config MINUS any inline document. A GeoJSON layer loaded
   *  from a file therefore saves as `{}` and restores as a re-linkable row —
   *  the same treatment a file-backed city model gets (see `normalizeLayers`'
   *  `unavailable` flag). */
  readonly config: Record<string, unknown>;
}

/** Write one store record down, dropping what cannot survive the trip. */
export function geoLayerSnapshot(layer: GeoLayer): GeoLayerSnapshot {
  const base = {
    name: layer.name,
    kind: layer.kind,
    visible: layer.visible,
    opacity: layer.opacity,
    // Copied rather than aliased, like `config` below: a snapshot is a value
    // document that outlives the store record it was read from.
    style: { ...layer.style },
  };
  if (layer.kind !== "geojson") return { ...base, config: { ...layer.config } };
  // The URL costs nothing and restores completely; the document is dropped.
  const { url } = layer.config;
  return { ...base, config: url === undefined ? {} : { url } };
}

const GEO_LAYER_KINDS: readonly string[] = [
  "geojson",
  "raster-xyz",
  "3d-tiles",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * Turn saved geo layers back into `addGeoLayer` inputs, dropping anything a
 * hand-edited (or truncated) document made unusable.
 *
 * The counterpart of {@link normalizeLayers}, and validating for the same
 * reason: these values reach the ENGINE. A missing `urlTemplate` would become
 * a raster source with no URL, which is a tile request per frame for nothing;
 * an unknown `kind` has no description builder at all. A GeoJSON layer with
 * neither data nor a URL is NOT dropped, though — that is the re-linkable row,
 * and losing it would lose the user's settings with it.
 */
export function normalizeGeoLayers(
  raw: ReadonlyArray<unknown> | undefined,
): GeoLayerInput[] {
  const out: GeoLayerInput[] = [];
  for (const entry of raw ?? []) {
    if (!isRecord(entry)) continue;
    const { name, kind, config } = entry;
    if (typeof name !== "string" || typeof kind !== "string") continue;
    if (!GEO_LAYER_KINDS.includes(kind)) continue;
    if (!isRecord(config)) continue;

    const visible = entry.visible === undefined ? true : entry.visible === true;
    const opacity = optionalNumber(entry.opacity) ?? 1;
    // TOTAL and per-field, so an absent style (a v3 document saved before
    // styles existed) and a hand-edited one both come back complete, and the
    // one bad field costs only itself. Applied here rather than left to the
    // store's own normalisation so this function's output is already the whole
    // truth about a restored layer.
    const style = normalizeGeoLayerStyle(entry.style);

    if (kind === "raster-xyz") {
      const urlTemplate = config.urlTemplate;
      if (typeof urlTemplate !== "string" || urlTemplate === "") continue;
      out.push({
        name,
        kind,
        visible,
        opacity,
        style,
        config: {
          urlTemplate,
          // Written only when present, so an absent bound stays absent all the
          // way to the engine description rather than becoming an explicit
          // `undefined` the source has to interpret.
          ...(optionalNumber(config.minZoom) === undefined
            ? {}
            : { minZoom: config.minZoom as number }),
          ...(optionalNumber(config.maxZoom) === undefined
            ? {}
            : { maxZoom: config.maxZoom as number }),
          ...(typeof config.tms === "boolean" ? { tms: config.tms } : {}),
        },
      });
      continue;
    }
    if (kind === "3d-tiles") {
      const url = config.url;
      if (typeof url !== "string" || url === "") continue;
      out.push({ name, kind, visible, opacity, style, config: { url } });
      continue;
    }
    const url = typeof config.url === "string" ? config.url : undefined;
    out.push({
      name,
      kind: "geojson",
      visible,
      opacity,
      style,
      config: url === undefined ? {} : { url },
    });
  }
  return out;
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
  /**
   * The camera policy the workspace was saved in ("2d" | "2.5d" | "3d").
   *
   * OPTIONAL, and absent means the default — exactly like `lodMode` and
   * `hiddenTypes` on a layer. Snapshots written before view modes existed were
   * saved from a free camera, which is what `"3d"` is, so
   * {@link normalizeViewMode} defaults to it and no migration is needed.
   * Type-only import: persistence takes no runtime dependency on the store.
   */
  readonly viewMode?: ViewMode;
  /**
   * The scene theme the workspace was saved in ("photoreal" | "cartoon" |
   * "cyber" | "wireframe").
   *
   * OPTIONAL on exactly the same terms as {@link viewMode} above: absent means
   * the default, so a snapshot written before themes existed restores as
   * photoreal — which is the rendering it was saved from — and no migration is
   * needed. Type-only import, like the mode's.
   */
  readonly sceneTheme?: SceneTheme;
}

/**
 * A saved view mode, defaulted and validated.
 *
 * Validated as well as defaulted because this value drives the CAMERA: a
 * hand-edited or truncated document that yielded an unknown mode would give
 * `viewModePolicy` no entry to look up and leave the controller flags
 * undefined. Unknown reads as "the default", which is always safe.
 */
export function normalizeViewMode(mode: ViewMode | undefined): ViewMode {
  return mode === "2d" || mode === "2.5d" || mode === "3d" ? mode : "3d";
}

/**
 * A saved scene theme, defaulted and validated — the twin of
 * {@link normalizeViewMode}, and validated for the same kind of reason: this
 * value drives the RENDERER, and an unknown theme has no `sceneThemePolicy`
 * entry, so every environment push would dereference `undefined`. Unknown
 * reads as photoreal, which is the one theme that changes nothing.
 */
export function normalizeSceneTheme(theme: SceneTheme | undefined): SceneTheme {
  return theme === "photoreal" ||
    theme === "cartoon" ||
    theme === "cyber" ||
    theme === "wireframe"
    ? theme
    : "photoreal";
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
  /**
   * The user's geospatial layers, if any.
   *
   * OPTIONAL, and absent means "none" — the same convention `viewMode` and
   * `hiddenTypes` follow, and the reason no snapshot written before geospatial
   * layers existed needs migrating. Share links deliberately do NOT carry
   * these: a hash is a lightweight subset (camera, datetime, URL-backed city
   * layers), and it stays one.
   */
  readonly geoLayers?: ReadonlyArray<GeoLayerSnapshot>;
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
      `This saved workspace was created by an older version of Urbis (v${found}) and can no longer be restored. Saved cameras changed from scene coordinates to geographic coordinates; please re-save from the current version.`,
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
