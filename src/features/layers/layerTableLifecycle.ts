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
import { useProcessingStore } from "../processing/processingStore";
import {
  dropLayerTable,
  enqueueLayerTable,
  useLayerTableStore,
  type LayerTableOutcome,
  type LayerTableSource,
} from "../../insights/layerTables";
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
 * The export dialog's door. The debounced rebuild above only runs while one of
 * the table's CONSUMERS is looking (see `rebuildWanted`), and Export is not one
 * of them — so a user who opens Export straight from a collapsed panel would
 * otherwise write whatever was resident the last time anyone looked.
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

  /**
   * Is a run over `layerId` still going to READ its table?
   *
   * A queued run resolves its scope against the table at the head of the queue
   * and a running one is reading it now, so both want the residents the camera
   * has actually delivered. A `done` run is deliberately not a reader: its card
   * describes the table that exists, and a rebuild for its sake would only
   * retire it as stale.
   */
  const runInFlightFor = (layerId: string): boolean =>
    useProcessingStore
      .getState()
      .runs.some(
        (run) =>
          run.targetLayerId === layerId &&
          (run.status === "queued" ||
            run.status === "running" ||
            run.status === "cancelling"),
      );

  // Only while a CONSUMER of the table is looking. A stream commits on every
  // camera settle, and rebuilding a table nothing is reading is pure cost —
  // but the grid is not the only reader. The processing toolbox takes a run's
  // scope, its counts and its "currently loaded" note from this same table, so
  // a toolbox that is open (or a run of this layer still in flight behind a
  // closed one) wants the rebuild exactly as much as the panel does; without it
  // Tools opened over a collapsed grid reads "All 0 buildings" with Run
  // disabled, and a run after a pan measures rows the camera has replaced.
  // An EXPORT still does not widen this: it forces one rebuild when its dialog
  // opens (`refreshStreamingTable`) and then wants the table to hold still.
  const rebuildWanted = (layerId: string): boolean =>
    useLayerTableStore.getState().tablePanelOpen ||
    useProcessingStore.getState().open ||
    runInFlightFor(layerId);

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
        if (!rebuildWanted(layerId)) return;
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
      //
      // A DERIVED layer is neither: its table was CREATED by the run that
      // published it and adopted straight into the registry
      // (`adoptLayerTable`), and rebuilding it from a resident set would
      // replace a cut of the parent with the parent's own rows. Excluded here
      // and in `sweepStreamingLayers` below by the same test.
      if (
        !knownLayerIds.has(layer.id) &&
        layer.isStreaming &&
        layer.derivedFrom === null
      ) {
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
      if (rebuildWanted(layerId)) scheduleRebuild(layerId);
    }
  });

  /**
   * A consumer just opened: rebuild every streaming layer's table now.
   *
   * Every one of their versions moved while nothing was reading, and the tables
   * the consumer is about to read are stale by exactly that much. Shared by the
   * table panel and the processing toolbox because they read the same tables for
   * the same reason — a toolbox opened over a collapsed grid would otherwise
   * show the resident set as it was the last time the grid was up.
   */
  const sweepStreamingLayers = (): void => {
    for (const layer of useLayerStore.getState().layers) {
      if (!layer.isStreaming || layer.derivedFrom !== null) continue;
      // Disarm first: a commit that landed while a consumer was open, before it
      // was shut, can still have a timer pending. Its fire-time gate would find
      // a consumer open AGAIN and rebuild a second time, moments after this one.
      cancelRebuild(layer.id);
      // Same reason as `scheduleRebuild`: the ids belong to the table being
      // replaced, and an id query for it may still be out.
      clearMapFilter(layer.id);
      void enqueueLayerTable(layer.id, residentTableSource(layer.id));
    }
  };

  let panelWasOpen = useLayerTableStore.getState().tablePanelOpen;
  const unsubscribePanel = useLayerTableStore.subscribe((state) => {
    if (state.tablePanelOpen === panelWasOpen) return;
    panelWasOpen = state.tablePanelOpen;
    if (!panelWasOpen) return;
    sweepStreamingLayers();
  });

  // The toolbox's own door, mirroring the panel's. `open` is the whole test and
  // not `activeTab`/`panelCollapsed`: a run's scope is frozen from the stores
  // whatever tab is showing, and the drafts a collapsed toolbox holds are still
  // read against these tables.
  let toolboxWasOpen = useProcessingStore.getState().open;
  const unsubscribeProcessing = useProcessingStore.subscribe((state) => {
    if (state.open === toolboxWasOpen) return;
    toolboxWasOpen = state.open;
    if (!toolboxWasOpen) return;
    sweepStreamingLayers();
  });

  return () => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    unsubscribeLayers();
    unsubscribeStreams();
    unsubscribePanel();
    unsubscribeProcessing();
  };
}
