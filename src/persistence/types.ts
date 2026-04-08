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

export interface LayerSnapshot {
  readonly name: string;
  readonly modelRef: CityModelReference;
  readonly rules: ReadonlyArray<Rule>;
  readonly rulesEnabled: boolean;
  readonly visible: boolean;
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
