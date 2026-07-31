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
import {
  emptyCellGeometry,
  type CellGeometry,
  type ResidentObjectRecord,
} from "./workerProtocol";
import type { FcbHeaderModel } from "../../domain/citymodel/flatcitybuf/fcbSource";
import type { Rule } from "../rules/types";

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
  /** The layer's `rulesEnabled`/`rules` at the moment THIS cell's fetch was
   *  dispatched (`commitStreamingLayer`, useTileStreaming.ts) — exactly what
   *  `geometry.ruleColors` was computed from. A fetch can still be in flight
   *  when the user edits a rule; if it lands afterwards, the layer's CURRENT
   *  rules (by the time `syncStreamingCells` installs this entry) may
   *  already differ from these. Comparing the two is how `syncStreamingCells`
   *  detects a newly-installed cell carrying stale colors and asks for an
   *  immediate recolor — otherwise nothing would ever revisit it: the
   *  "rules changed" effect (`recolorStreamingCells` in CitySceneR3F.tsx)
   *  only recolors cells that were ALREADY resident at the moment it ran,
   *  and a cell arriving later never triggers it again on its own (B2,
   *  2026-07-28 final review). */
  readonly builtWithRulesEnabled: boolean;
  readonly builtWithRules: ReadonlyArray<Rule>;
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
  /** Persists the LoD ladder `useTileStreaming.ts` derives from what the
   *  worker has actually observed across every commit so far (see
   *  `buildLadder` in levelPolicy.ts). A no-op for an unregistered layer id,
   *  same race-tolerance convention as `bumpVersion`/`setStatus`. */
  setLadder: (layerId: string, ladder: ReadonlyArray<string>) => void;
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

  setLadder: (layerId, ladder) =>
    set((s) => {
      const entry = s.streams[layerId];
      if (!entry) return s;
      return {
        streams: {
          ...s.streams,
          [layerId]: {
            ...entry,
            ladder,
            ladderVersion: entry.ladderVersion + 1,
          },
        },
      };
    }),
}));

/** A `CellEntry` for a cell the worker genuinely queried and found nothing
 *  in — see `emptyCellGeometry`'s doc comment (workerProtocol.ts) for why
 *  this needs to exist as a real, cacheable value rather than the absence
 *  of one. Takes the same rules snapshot as its sibling cells from the same
 *  commit, so it never looks "stale" on its own next to them. */
export function emptyCellEntry(
  rulesEnabled: boolean,
  rules: ReadonlyArray<Rule>,
): CellEntry {
  return {
    geometry: emptyCellGeometry(),
    objects: [],
    surfaceAttrKeys: [],
    lodsSeen: [],
    builtWithRulesEnabled: rulesEnabled,
    builtWithRules: rules,
  };
}
