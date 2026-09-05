/**
 * What keeps the layer-table registry in step with the stores.
 *
 * A store SUBSCRIPTION rather than a React effect, and rather than calls
 * sprinkled through the removal paths, because there are three ways a layer
 * leaves — `removeLayer` from the sidebar, `removeAllLayers` from "Close file"
 * and from a restore — and covering them one at a time is how the second one
 * gets missed. Diffing the id list covers all of them and anything added later.
 *
 * Installed ONCE from `App`'s mount effect, not at module scope: tests import
 * this module, and a module-scope subscription would leak between them.
 *
 * It deliberately does NOT own the engine retry. `retryEngine` (in
 * `layerTables`) is driven by `App`, which is the only place that already
 * awaits the boot and re-reads the status — the DuckDB status is not a store,
 * so a subscription here would have to POLL for a transition App observes for
 * free.
 */

import { useStreamStore } from "../streaming/streamStore";
import { getResidentModel } from "../streaming/residentModel";
import { clearMapFilter, forgetMapFilter } from "../query/mapFilterSync";
import { useQueryStore } from "../query/queryStore";
import {
  dropLayerTable,
  enqueueLayerTable,
  useLayerTableStore,
  type LayerTableOutcome,
  type LayerTableSource,
} from "../../analytics/layerTables";
import { useLayerStore } from "./layerStore";

/**
 * How long a streaming layer's cell commits are coalesced before its table is
 * rebuilt. A commit lands on every camera settle, and a rebuild re-reads the
 * whole resident set — half a second is long enough that a pan costs one
 * rebuild rather than one per cell, and short enough that the grid catches up
 * before the user has read the row count.
 */
export const STREAM_REBUILD_DEBOUNCE_MS = 500;

/** A streaming layer's rows, read at BUILD time — the resident set is
 *  whatever has landed by then. */
export function residentTableSource(layerId: string): LayerTableSource {
  return {
    kind: "resident",
    // The `0` is NOT a version we are pinning. `getResidentModel`'s second
    // parameter is a SUBSCRIPTION MARKER for React callers — it exists so a
    // component that reads the resident model also subscribes to commits, and
    // the function itself does `void version` (the handle memoises on its own
    // commit counter). This is not a component: it reads whatever is resident
    // at the moment the queued build runs, which is exactly what it wants.
    records: () => Object.values(getResidentModel(layerId, 0).objects),
  };
}

/**
 * Rebuild one streaming layer's table immediately.
 *
 * The export dialog's door. The debounced rebuild above only runs while the
 * table panel is open, so a user who opens Export straight from a collapsed
 * panel would otherwise write whatever was resident the last time anyone
 * looked.
 *
 * RETURNS THE OUTCOME, and the caller is expected to read it. A failed rebuild
 * deliberately restores the previous table as `ready` — right for a grid, and
 * indistinguishable in the store from a refresh that worked, which is exactly
 * the confusion that let an export write a stale resident set. Nothing is
 * thrown: a failure is still recorded on the entry as always.
 */
export async function refreshStreamingTable(
  layerId: string,
): Promise<LayerTableOutcome> {
  return await enqueueLayerTable(layerId, residentTableSource(layerId));
}

export function installLayerTableLifecycle(): () => void {
  let knownLayerIds = new Set(useLayerStore.getState().layers.map((l) => l.id));
  const knownVersions = new Map<string, number>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  // Only while somebody is LOOKING. A stream commits on every camera settle,
  // and rebuilding a table nothing is reading is pure cost. An EXPORT does not
  // widen this: it forces one rebuild when its dialog opens
  // (`refreshStreamingTable`) and then wants the table to hold still.
  const rebuildWanted = (): boolean =>
    useLayerTableStore.getState().tablePanelOpen;

  /** Cancel `layerId`'s armed rebuild, if it has one. */
  const cancelRebuild = (layerId: string): void => {
    const existing = timers.get(layerId);
    if (existing === undefined) return;
    clearTimeout(existing);
    timers.delete(layerId);
  };

  const scheduleRebuild = (layerId: string): void => {
    cancelRebuild(layerId);
    timers.set(
      layerId,
      setTimeout(() => {
        timers.delete(layerId);
        // Re-checked at FIRE time, not only when the timer was armed: half a
        // second is long enough to close the panel inside the window, and a
        // rebuild for a grid nobody is looking at any more is the exact cost
        // this gate exists to avoid.
        if (!rebuildWanted()) return;
        // The drawn set was computed from the table this rebuild REPLACES.
        // The panel's own effect recomputes it once the new table lands;
        // leaving the old ids in place would draw a filter over a table that
        // no longer exists. Through `clearMapFilter`, never straight to the
        // store: the id query for the retired table can still be in flight,
        // and only the generation bump stops its answer landing after this.
        clearMapFilter(layerId);
        void enqueueLayerTable(layerId, residentTableSource(layerId));
      }, STREAM_REBUILD_DEBOUNCE_MS),
    );
  };

  const unsubscribeLayers = useLayerStore.subscribe((state) => {
    const ids = new Set(state.layers.map((l) => l.id));

    for (const id of knownLayerIds) {
      if (ids.has(id)) continue;
      cancelRebuild(id);
      knownVersions.delete(id);
      // The query is written against THAT table's columns; a re-added layer is
      // a different table and must not inherit a predicate naming columns it
      // may not have.
      useQueryStore.getState().resetQuery(id);
      // The layer is gone, so its drawn set went with it — but the sync's
      // per-layer generation would outlive it, and a re-add under the same id
      // would inherit the number.
      forgetMapFilter(id);
      void dropLayerTable(id);
    }

    for (const layer of state.layers) {
      // A STATIC layer's table was enqueued by `addCityLayer`, which is the
      // only place that has its bytes. A STREAMING layer has none to give, so
      // it is enqueued here — empty at first, then rebuilt as cells land.
      if (!knownLayerIds.has(layer.id) && layer.isStreaming) {
        void enqueueLayerTable(layer.id, residentTableSource(layer.id));
      }
    }

    knownLayerIds = ids;
  });

  const unsubscribeStreams = useStreamStore.subscribe((state) => {
    for (const [layerId, stream] of Object.entries(state.streams)) {
      const version = stream?.version ?? 0;
      if (knownVersions.get(layerId) === version) continue;
      // The membership check comes FIRST. A stream that commits before its
      // layer reaches the store would otherwise record its version here, and
      // the layer's real first commit — arriving at that same version — would
      // then be read as "nothing changed" and never rebuild anything.
      if (!knownLayerIds.has(layerId)) continue;
      knownVersions.set(layerId, version);
      if (rebuildWanted()) scheduleRebuild(layerId);
    }
  });

  let panelWasOpen = useLayerTableStore.getState().tablePanelOpen;
  const unsubscribePanel = useLayerTableStore.subscribe((state) => {
    if (state.tablePanelOpen === panelWasOpen) return;
    panelWasOpen = state.tablePanelOpen;
    if (!panelWasOpen) return;
    // Opening the panel: every streaming layer's version moved while it was
    // shut, and the tables it is about to show are stale by exactly that much.
    for (const layer of useLayerStore.getState().layers) {
      if (!layer.isStreaming) continue;
      // Disarm first: a commit that landed while the panel was open, before it
      // was shut, can still have a timer pending. Its fire-time gate would find
      // the panel open AGAIN and rebuild a second time, moments after this one.
      cancelRebuild(layer.id);
      // Same reason as `scheduleRebuild`: the ids belong to the table being
      // replaced, and an id query for it may still be out.
      clearMapFilter(layer.id);
      void enqueueLayerTable(layer.id, residentTableSource(layer.id));
    }
  });

  return () => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    unsubscribeLayers();
    unsubscribeStreams();
    unsubscribePanel();
  };
}
