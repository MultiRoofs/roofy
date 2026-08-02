/**
 * Store binding for the resident model — the merge itself moved to
 * `@cityjson/navara-flatcitybuf` in M7.5 (`buildResidentModel` /
 * `createResidentModelMemo`, which are store-free and take the cache as an
 * argument). What stays app-side is exactly what the package must not know:
 * where a layer id's cache comes from (`useStreamStore`) and the one memo per
 * layer id that keeps repeated calls at the same version free.
 *
 * Still deliberately a plain memoised function, NOT a Zustand selector.
 * `useStreamStore.streams[layerId].version` bumps on every cell commit —
 * every pan/zoom settle, per the store's own doc comment — and Zustand
 * evaluates every selector on every store notification to decide whether to
 * re-render. A selector like `s => residentModel(s)` would rebuild the merged
 * Record on every single commit, whether or not anything ever reads the
 * result — exactly the eager materialization viewport streaming exists to
 * avoid. Calling this function imperatively from a mounted consumer's render
 * body means the merge only runs when something actually asks for it.
 */
import {
  createResidentModelMemo,
  type ResidentModel,
} from "@cityjson/navara-flatcitybuf";
import { useStreamStore } from "./streamStore";

export type { ResidentModel };

/** One memo per layer: that layer's most recently computed model and the
 *  (cache, version) it was computed at. Layers never share an entry — a
 *  shared one would thrash as consumers ask about different layers. */
const memos = new Map<string, ReturnType<typeof createResidentModelMemo>>();

/** What a layer id with no stream registered gets: a non-streaming layer, or
 *  one asked about after `unregister`. Shared and frozen, so the answer is
 *  reference-stable for hook dependencies and can't be mutated by a caller. */
const EMPTY_MODEL: ResidentModel = Object.freeze({
  objects: Object.freeze({}),
  cellCount: 0,
  featureCount: 0,
  surfaceAttrKeys: Object.freeze([]) as ReadonlyArray<string>,
});

/**
 * Returns the merged resident model for `layerId` at `version`. Recomputes
 * only when `version` (or the layer's cache object) differs from what's cached
 * for this layer; otherwise returns the identical cached object (reference
 * equality), so callers can use it directly as a `useMemo`/`useEffect`
 * dependency without extra work.
 *
 * `version` is supplied by the caller (typically read via a `useStreamStore`
 * selector on `streams[layerId]?.version`) rather than read from the store
 * internally here — that split keeps this cheap to call from a render body
 * without inventing its own subscription.
 */
export function getResidentModel(
  layerId: string,
  version: number,
): ResidentModel {
  const streams = useStreamStore.getState().streams;

  // A memo entry pins both the merged model and the layer's whole cell cache
  // (its decoded geometry, up to the byte budget), so an entry for a layer
  // that has been unregistered is a real leak, not a stale-but-cheap one.
  // Layers come and go rarely and there are only ever a handful, so the
  // cheapest reliable release point is here: drop every memo whose layer no
  // longer has a stream. Non-streaming layers never get an entry at all.
  for (const id of memos.keys()) {
    if (!Object.hasOwn(streams, id)) memos.delete(id);
  }

  const stream = streams[layerId];
  if (!stream) return EMPTY_MODEL;

  let memo = memos.get(layerId);
  if (!memo) {
    memo = createResidentModelMemo();
    memos.set(layerId, memo);
  }
  return memo(stream.cache, version);
}

/** Test-only: clears the memos so tests don't leak state across cases. */
export function __resetMemo(): void {
  memos.clear();
}
