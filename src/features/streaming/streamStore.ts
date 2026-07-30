/**
 * Zustand store for per-layer viewport-streaming state, keyed by layer id.
 *
 * This is a SEPARATE store from `useLayerStore` on purpose. `layerStore`'s
 * `layers` array is subscribed to WHOLE by `CitySceneR3F.tsx`,
 * `InspectorPanel.tsx`, `TablePanel.tsx`, and read field-by-field by
 * `App.tsx` for object counts — and Zustand re-evaluates every selector on
 * every store notification to decide whether to re-render. A cell commit
 * happens far more often than a layer is added or removed (every pan/zoom
 * settle, vs. once per file load), so if committing a cell replaced the
 * `layers` array or a `Layer` object, every one of those consumers would
 * re-render — and several of them (InspectorPanel, TablePanel, App's object
 * counts) touch `layer.model`, which is exactly the resident-model
 * materialization this streaming design exists to avoid doing eagerly.
 * Keeping stream state here means a commit only ever changes `streams`,
 * never `useLayerStore.getState().layers` — verified in
 * streamStore.test.ts by reference equality (`toBe`), not deep equality.
 */
import { create } from "zustand";
import type { CellCache } from "./cellCache";
import type { WorkerClient } from "./workerClient";
import type { Grid } from "./tileGrid";
import type { CellGeometry, ResidentObjectRecord } from "./workerProtocol";
import type { FcbHeaderModel } from "../../domain/citymodel/flatcitybuf/fcbSource";

export type StreamStatus =
  | "idle"
  | "probing"
  | "fetching"
  | "too-far"
  | "error";

/**
 * What the main-thread cache holds per resident cell. Mirrors the worker's
 * `'cell'` response payload (see workerProtocol.ts) minus the envelope
 * fields (`type`/`id`/`key` — `key` is the cache's own map key, not part of
 * the value). This is what Task 13's scene layer builds `CellSceneState`
 * (mesh/pickingIndex/baseColors/ruleColors) from, and what the inspector/
 * table read object attributes from without re-fetching.
 */
export interface CellEntry {
  readonly geometry: CellGeometry;
  readonly objects: ReadonlyArray<ResidentObjectRecord>;
  readonly surfaceAttrKeys: ReadonlyArray<string>;
  readonly lodsSeen: ReadonlyArray<string>;
}

export interface StreamState {
  readonly client: WorkerClient;
  readonly grid: Grid;
  readonly header: FcbHeaderModel;
  readonly cache: CellCache<CellEntry>;
  readonly level: number | null;
  readonly ladder: ReadonlyArray<string>;
  readonly ladderVersion: number;
  readonly status: StreamStatus;
  readonly message: string | null;
  readonly lastCommit: {
    readonly centre: readonly [number, number];
    readonly span: number;
  } | null;
  /** Bumped on every cell commit. The ONLY thing that changes on a commit —
   *  see the module doc comment for why. Consumers that need to react to a
   *  commit (e.g. the R3F scene syncing cell meshes) select this field, not
   *  `streams` as a whole and not `useLayerStore.layers`. */
  readonly version: number;
}

export interface StreamStoreState {
  readonly streams: Readonly<Record<string, StreamState>>;
}

export interface StreamStoreActions {
  register: (layerId: string, state: StreamState) => void;
  unregister: (layerId: string) => void;
  get: (layerId: string) => StreamState | undefined;
  bumpVersion: (layerId: string) => void;
  setStatus: (
    layerId: string,
    status: StreamStatus,
    message?: string | null,
  ) => void;
}

export type StreamStore = StreamStoreState & StreamStoreActions;

export const useStreamStore = create<StreamStore>((set, getState) => ({
  streams: {},

  register: (layerId, state) =>
    set((s) => ({ streams: { ...s.streams, [layerId]: state } })),

  unregister: (layerId) =>
    set((s) => {
      if (!(layerId in s.streams)) return s; // nothing to remove
      const streams = { ...s.streams };
      delete streams[layerId];
      return { streams };
    }),

  get: (layerId) => getState().streams[layerId],

  // A commit can race an unregister (the layer was removed while a worker
  // response was in flight) — the same race fcb.worker.ts's own `recolor`
  // handler documents and skips rather than errors on. Bumping a version
  // for a layer nobody is listening to anymore is a no-op, not an error.
  bumpVersion: (layerId) =>
    set((s) => {
      const entry = s.streams[layerId];
      if (!entry) return s;
      return {
        streams: {
          ...s.streams,
          [layerId]: { ...entry, version: entry.version + 1 },
        },
      };
    }),

  setStatus: (layerId, status, message = null) =>
    set((s) => {
      const entry = s.streams[layerId];
      if (!entry) return s;
      return {
        streams: {
          ...s.streams,
          [layerId]: { ...entry, status, message },
        },
      };
    }),
}));
