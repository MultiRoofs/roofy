/**
 * Store binding for the resident model — "the objects currently loaded for
 * this layer", merged across its resident cells, for the consumers (stats,
 * inspector, table, rule builder) that don't care about cell boundaries.
 *
 * Both halves that used to live here are gone: the merge moved to
 * `@cityjson/navara-flatcitybuf` in M7.5, and the one-memo-per-layer bookkeeping
 * moved INTO `FcbStreamLayerHandle` in Task C9 — it memoises on its own commit
 * counter, which is the only counter that can actually tell you a cell landed.
 * All that is left is resolving a layer id to its handle.
 *
 * Still deliberately a plain function, NOT a Zustand selector.
 * `useStreamStore.streams[layerId].version` bumps on every cell commit —
 * every pan/zoom settle, per the store's own doc comment — and Zustand
 * evaluates every selector on every store notification to decide whether to
 * re-render. A selector like `s => residentModel(s)` would rebuild the merged
 * Record on every single commit, whether or not anything ever reads the
 * result — exactly the eager materialization viewport streaming exists to
 * avoid. Calling this function imperatively from a mounted consumer's render
 * body means the merge only runs when something actually asks for it.
 */
import type { ResidentModel } from "@cityjson/navara-flatcitybuf";
import { useStreamStore } from "./streamStore";

export type { ResidentModel };

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
 * The merged resident model for `layerId`.
 *
 * `version` is no longer used to key a memo — the handle owns that now — but
 * it stays in the signature because it is what makes callers CORRECT: every
 * consumer reads it through a `useStreamStore` selector, so passing it here
 * is what subscribes the component to commits. Dropping the parameter would
 * silently invite call sites that never re-render when a cell lands.
 */
export function getResidentModel(
  layerId: string,
  version: number,
): ResidentModel {
  void version; // see above: a subscription marker, not a cache key
  const handle = useStreamStore.getState().streams[layerId]?.handle;
  return handle ? handle.getResidentModel() : EMPTY_MODEL;
}
