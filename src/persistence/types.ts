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
 * `migrateSnapshot`'s `unavailable` flag below.
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
  /** Defaults to "auto" on restore (via `migrateSnapshot`) when absent from
   *  an older saved snapshot. */
  readonly lodMode?: "auto" | "manual";
  /** Present only for a streaming layer. */
  readonly stream?: StreamSourceSnapshot;
}

// ---------------------------------------------------------------------------
// Versioned layer-snapshot schema + migration
// ---------------------------------------------------------------------------

/**
 * Loosely-typed shape `migrateSnapshot` accepts: "whatever was actually
 * saved to localStorage or decoded from a share hash", which may be an
 * older schema missing `lodMode`/`stream` entirely. An index signature (not
 * `unknown`/`never`) keeps every already-known field (`name`, `modelRef`,
 * `rules`, ...) passed through untouched via the spread in `migrateSnapshot`,
 * while still accepting arbitrary extra/missing keys from an old save.
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

export interface MigratedLayerSnapshot extends RawLayerSnapshot {
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
 * Upgrades a raw, possibly-older layers document to the current per-layer
 * schema: defaults `lodMode` to `"auto"` when absent, and marks a
 * file-backed streaming layer `unavailable`. The same pass is correct for
 * both a v1 document (no `lodMode`/`stream` at all) and an already-v2 one
 * (both fields present) — there is no schema-specific branching needed,
 * since "default what's missing, flag what can't survive a reload" is the
 * right transform either way.
 */
export function migrateSnapshot(raw: RawLayersDocument): {
  readonly version: 2;
  readonly layers: MigratedLayerSnapshot[];
} {
  const layers = (raw.layers ?? []).map((l): MigratedLayerSnapshot => {
    const lodMode = l.lodMode ?? "auto";
    return l.stream?.kind === "file"
      ? { ...l, lodMode, unavailable: true }
      : { ...l, lodMode };
  });
  return { version: 2, layers };
}

// ---------------------------------------------------------------------------
// View state — camera, datetime, and display settings
// ---------------------------------------------------------------------------

export interface ViewState {
  readonly cameraPosition: readonly [number, number, number];
  readonly cameraTarget: readonly [number, number, number];
  readonly datetime: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// Project snapshot — the full serializable workspace state
// ---------------------------------------------------------------------------

export interface ProjectSnapshot {
  readonly version: string;
  readonly savedAt: string; // ISO 8601
  readonly label: string;
  /** @deprecated Use `layers` instead. Kept for backward compatibility. */
  readonly modelRef?: CityModelReference | null;
  /** @deprecated Use `layers` instead. */
  readonly rules?: ReadonlyArray<Rule>;
  /** @deprecated Use `layers` instead. */
  readonly rulesEnabled?: boolean;
  readonly layers?: ReadonlyArray<LayerSnapshot>;
  readonly viewState: ViewState;
  readonly pickMode: PickMode;
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
