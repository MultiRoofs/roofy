/**
 * Zustand store for per-layer viewport-streaming state, keyed by layer id.
 *
 * The streaming state machine itself is NOT here: it lives in
 * `@cityjson/navara-flatcitybuf`'s `FcbStreamLayerHandle`, which owns the
 * worker, the resident cell cache, the LoD ladder and the commit counter, and
 * only *reports* what it did through
 * `onStatus`/`onLadder`/`onTypes`/`onCommit`. This
 * store is the React-visible mirror of those reports plus the handle itself —
 * nothing recomputes here, and no consumer drives the stream through it.
 *
 * It is a SEPARATE store from `useLayerStore` on purpose. `layerStore`'s
 * `layers` array is subscribed to WHOLE by `NavaraViewport.tsx`,
 * `DetailsPanel.tsx`, `TablePanel.tsx`, and read field-by-field by
 * `App.tsx` for object counts — and Zustand re-evaluates every selector on
 * every store notification to decide whether to re-render. A cell commit
 * happens far more often than a layer is added or removed (every pan/zoom
 * settle, vs. once per file load), so if committing a cell replaced the
 * `layers` array or a `Layer` object, every one of those consumers would
 * re-render — and several of them (DetailsPanel, TablePanel, App's object
 * counts) touch `layer.model`, which is exactly the resident-model
 * materialization this streaming design exists to avoid doing eagerly.
 * Keeping stream state here means a commit only ever changes `streams`,
 * never `useLayerStore.getState().layers` — verified in
 * streamStore.test.ts by reference equality (`toBe`), not deep equality.
 */
import type { AppearanceTheme } from "@cityjson/navara-core";
import { create } from "zustand";
import type {
  FcbHeaderModel,
  FcbStreamLayerHandle,
  Grid,
  StreamStatus,
} from "@cityjson/navara-flatcitybuf";

/** Re-export shim — the streaming status vocabulary moved to
 *  `@cityjson/navara-flatcitybuf` with the handle that emits it. */
export type { StreamStatus };

export interface StreamState {
  /** The layer's plugin handle: the owner of the worker, the resident cell
   *  cache and the commit loop. Held by REFERENCE and never replaced by any
   *  action below — a version bump mirrors a commit, it does not re-create
   *  the thing that committed. */
  readonly handle: FcbStreamLayerHandle;
  /**
   * The unsubscribes for the four handle events this store mirrors
   * (`onStatus`/`onLadder`/`onTypes`/`onCommit`), to be run by
   * `closeStreamingLayer`.
   *
   * Held here because `handle.delete()` does NOT clear the handle's listener
   * sets: without these, a closed layer's callbacks stay reachable from the
   * handle, keeping this store's closures — and through them the layer id and
   * anything else they capture — alive for as long as anything still holds the
   * handle. `NavaraViewport`'s `streamsRef` is exactly such a holder.
   */
  readonly disposers: ReadonlyArray<() => void>;
  /** `handle.grid`, mirrored so `LodSelector` can size a cell without
   *  reaching into the handle on every render. Immutable for the layer's
   *  lifetime, which is why mirroring it needs no updater. */
  readonly grid: Grid;
  readonly header: FcbHeaderModel;
  /** The tile level the last commit settled on, mirrored from `handle.level`
   *  by {@link StreamStoreActions.setLevel}. `null` until the first commit —
   *  `LodSelector`'s auto read-out shows a bare "Auto" until then. */
  readonly level: number | null;
  readonly ladder: ReadonlyArray<string>;
  readonly ladderVersion: number;
  /** The first-level object groups the worker has decoded so far, mirrored
   *  from `handle.onTypes`. Monotonic and sorted, like the ladder, and empty
   *  until the first cell arrives — which is why a streaming layer's type
   *  toggles read this instead of `Layer.availableObjectTypes`. */
  readonly types: ReadonlyArray<string>;
  readonly typesVersion: number;
  /** The appearance themes the stream has seen so far (texture themes first),
   *  from `handle.onAppearanceThemes` — learned like the ladder, and what the
   *  layer row's appearance dropdown offers for a streaming layer. */
  readonly appearanceThemes: ReadonlyArray<AppearanceTheme>;
  readonly status: StreamStatus;
  readonly message: string | null;
  /** Bumped on every cell commit. The ONLY thing that changes on a commit —
   *  see the module doc comment for why. Consumers that need to react to a
   *  commit (the layer panel's feature count, the inspector's resident
   *  model) select this field, not `streams` as a whole and not
   *  `useLayerStore.layers`. */
  readonly version: number;
  /**
   * How many times this layer's HANDLE has been replaced (ruling R-E′).
   *
   * `0` is a first open; anything higher is a handle a family toggle's reopen
   * produced. The viewport's reconciler reads both halves of that: the NUMBER
   * changing is its reason to re-run when the layer id has not moved, and
   * `> 0` is what keeps the sole-layer camera fit off — a reopen must leave the
   * camera exactly where the user put it.
   *
   * Optional, reading as `0`, so the three dozen fixtures that build a
   * `StreamState` by hand keep compiling; `openStreamingLayer` always states it.
   */
  readonly generation?: number;
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
  /** Persists the LoD ladder the handle derives from what the worker has
   *  actually observed across every commit so far (see `buildLadder` in the
   *  plugin's levelPolicy). A no-op for an unregistered layer id, same
   *  race-tolerance convention as `bumpVersion`/`setStatus`. */
  setLadder: (layerId: string, ladder: ReadonlyArray<string>) => void;
  /** Persists the union of first-level object groups the handle has seen
   *  across every commit so far (`handle.onTypes`). Same race tolerance as
   *  `setLadder`: a no-op for an unregistered layer id. */
  setTypes: (layerId: string, types: ReadonlyArray<string>) => void;
  setAppearanceThemes: (
    layerId: string,
    themes: ReadonlyArray<AppearanceTheme>,
  ) => void;
  /** Mirrors `handle.level` after a commit. Separate from `bumpVersion`
   *  because the two have different audiences — `LodSelector` re-renders on
   *  the level, everything else on the version — and Zustand notifies per
   *  `set`, so folding them into one write would re-render both on either
   *  change. A no-op for an unregistered layer id. */
  setLevel: (layerId: string, level: number | null) => void;
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

  setTypes: (layerId, types) =>
    set((s) => {
      const entry = s.streams[layerId];
      if (!entry) return s;
      return {
        streams: {
          ...s.streams,
          [layerId]: {
            ...entry,
            types,
            typesVersion: entry.typesVersion + 1,
          },
        },
      };
    }),

  setAppearanceThemes: (layerId, themes) =>
    set((s) => {
      const entry = s.streams[layerId];
      if (!entry) return s;
      return {
        streams: {
          ...s.streams,
          [layerId]: { ...entry, appearanceThemes: themes },
        },
      };
    }),

  setLevel: (layerId, level) =>
    set((s) => {
      const entry = s.streams[layerId];
      if (!entry || entry.level === level) return s;
      return {
        streams: { ...s.streams, [layerId]: { ...entry, level } },
      };
    }),
}));
