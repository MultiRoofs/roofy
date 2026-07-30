/**
 * Merges a streaming layer's resident cells into a flat view for consumers
 * (stats, inspector, table, rule builder) that need "the objects currently
 * loaded for this layer" without caring about cell boundaries.
 *
 * Deliberately a plain memoised function, NOT a Zustand selector.
 * `useStreamStore.streams[layerId].version` bumps on every cell commit —
 * every pan/zoom settle, per the store's own doc comment — and Zustand
 * evaluates every selector on every store notification to decide whether to
 * re-render. A selector like `s => residentModel(s)` would rebuild this
 * merged Record on every single commit, whether or not anything ever reads
 * the result — exactly the eager materialization viewport streaming exists
 * to avoid. Calling this function imperatively from a mounted consumer's
 * render body means the merge only runs when something actually asks for
 * it, and the single-entry-per-layer memo below means even repeated calls
 * at the same version are free (a Map lookup, not a rebuild).
 */
import { useStreamStore } from "./streamStore";
import type { ResidentObjectRecord } from "./workerProtocol";

export interface ResidentModel {
  readonly objects: Readonly<Record<string, ResidentObjectRecord>>;
  readonly cellCount: number;
  readonly featureCount: number;
  readonly surfaceAttrKeys: ReadonlyArray<string>;
}

interface MemoEntry {
  readonly version: number;
  readonly model: ResidentModel;
}

/** Single entry per layer: this layer's most recently computed model, and
 *  the version it was computed at. A newer/older version request just
 *  overwrites the one entry — there is no history to keep. */
const memo = new Map<string, MemoEntry>();

/**
 * Returns the merged resident model for `layerId` at `version`. Recomputes
 * only when `version` differs from what's cached for this layer; otherwise
 * returns the identical cached object (reference equality), so callers can
 * use it directly as a `useMemo`/`useEffect` dependency without extra work.
 *
 * `version` is supplied by the caller (typically read via a `useStreamStore`
 * selector on `streams[layerId]?.version`) rather than read from the store
 * internally here — that split keeps this function pure and cheap to call
 * from a render body without inventing its own subscription.
 */
export function getResidentModel(
  layerId: string,
  version: number,
): ResidentModel {
  const cached = memo.get(layerId);
  if (cached && cached.version === version) return cached.model;

  const model = buildResidentModel(layerId);
  memo.set(layerId, { version, model });
  return model;
}

function buildResidentModel(layerId: string): ResidentModel {
  const stream = useStreamStore.getState().streams[layerId];
  const objects: Record<string, ResidentObjectRecord> = {};
  const attrKeys = new Set<string>();
  let cellCount = 0;

  if (stream) {
    for (const key of stream.cache.keys()) {
      const entry = stream.cache.get(key);
      if (!entry) continue; // evicted between keys() and get() — skip, don't fabricate
      cellCount++;
      for (const obj of entry.objects) {
        objects[obj.id] = obj;
      }
      for (const attrKey of entry.surfaceAttrKeys) attrKeys.add(attrKey);
    }
  }

  return {
    objects,
    cellCount,
    featureCount: Object.keys(objects).length,
    surfaceAttrKeys: [...attrKeys].sort(),
  };
}

/** Test-only: clears the memo so tests don't leak state across cases. */
export function __resetMemo(): void {
  memo.clear();
}
