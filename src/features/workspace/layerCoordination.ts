/**
 * The rules that keep the active layer, the two layer stores and the
 * selection telling one story.
 *
 * Four rules, and nothing else in the app may restate them:
 *   1. Activating a layer clears a selection that belongs to another layer —
 *      EXCEPT a city selection when the layer taking the focus is a vector one
 *      (`keepsCitySelection`, gate defect F5: §7.6's "Selected" scope counts
 *      the SOURCE city layer and the tool is only offered on the vector
 *      target). Enforced inside `useWorkspaceStore.setActiveLayerId`, so no
 *      caller can bypass it; {@link activateLayer} is the documented entry
 *      point.
 *   2. A pick activates the layer it landed on.
 *   3. A selection whose owning layer is removed or hidden is cleared.
 *   4. Removing the active layer hands over to the next layer in the unified
 *      order, else the previous one, else nothing.
 *
 * Rules 2-4 are reactions to store writes rather than extra work bolted onto
 * every action, which is why they live in {@link installWorkspaceInvariants}:
 * a layer can be removed from a dozen places (the layer list, Close, a
 * restore, a failed load), and each of those would otherwise have to remember
 * to hand the active id over and tidy the selection.
 *
 * Imports flow one way: this module imports the workspace store, never the
 * reverse.
 */
import { useLayerStore } from "../layers/layerStore";
import { useGeoLayerStore } from "../geoLayers/geoLayerStore";
import { useSelectionStore } from "../selection/selectionStore";
import { useWorkspaceStore, selectionLayerId } from "./workspaceStore";
import { unifiedLayerOrder } from "./activeLayer";

export { selectionLayerId };

/** Rule 1 lives in the store's own `setActiveLayerId`; this is the documented
 *  entry point for the UI. Never moves the camera. */
export function activateLayer(id: string | null): void {
  useWorkspaceStore.getState().setActiveLayerId(id);
}

/**
 * Rule 4: who takes over from `removedId`.
 *
 * `order` is the unified order BEFORE the removal and `removedIndex` the
 * removed layer's index within it — the next row down, else the one above,
 * else nothing. `removedIndex === -1` (the caller could not place it) falls
 * back to the first survivor.
 */
export function nextActiveAfterRemoval(
  order: ReadonlyArray<string>,
  removedId: string,
  removedIndex: number,
): string | null {
  const remaining = order.filter((id) => id !== removedId);
  if (remaining.length === 0) return null;
  if (removedIndex < 0) return remaining[0]!;
  const next = remaining[removedIndex];
  return (
    next ??
    remaining[removedIndex - 1] ??
    remaining[remaining.length - 1] ??
    null
  );
}

let disposeInstalled: (() => void) | null = null;

/**
 * Subscribe to the layer, geo-layer and selection stores and hold rules 2-4.
 *
 * Installed once, by the app shell. A second install disposes the first, so a
 * hot reload cannot end up with two reconcilers fighting. The returned
 * disposer unhooks ONLY its own subscriptions, and clears the module pointer
 * only while it still points at itself — so disposing a superseded installer
 * never unhooks the live one.
 */
export function installWorkspaceInvariants(): () => void {
  disposeInstalled?.();
  let previousOrder = unifiedLayerOrder(
    useLayerStore.getState().layers,
    useGeoLayerStore.getState().layers,
  );

  const reconcileLayers = () => {
    const layers = useLayerStore.getState().layers;
    const geoLayers = useGeoLayerStore.getState().layers;
    const order = unifiedLayerOrder(layers, geoLayers);
    const { activeLayerId } = useWorkspaceStore.getState();
    const selection = useSelectionStore.getState();
    const owner = selectionLayerId(selection);

    // Rule 3: a selection whose owner is gone or hidden is cleared.
    if (owner !== null) {
      const present =
        layers.find((l) => l.id === owner) ??
        geoLayers.find((l) => l.id === owner);
      if (!present || !present.visible) selection.clear();
    }

    if (activeLayerId === null) {
      // No active layer while layers exist is not a durable state.
      if (order.length > 0)
        useWorkspaceStore.getState().setActiveLayerId(order[0]!);
    } else if (!order.includes(activeLayerId)) {
      // Rule 4. Only the rows that SURVIVED are candidates: one event can
      // remove many layers at once (Close, a restore), and handing over to
      // another layer that went in the same event would leave the active id
      // pointing at nothing, with no further store write to correct it.
      const candidates = previousOrder.filter(
        (id) => id === activeLayerId || order.includes(id),
      );
      useWorkspaceStore
        .getState()
        .setActiveLayerId(
          nextActiveAfterRemoval(
            candidates,
            activeLayerId,
            candidates.indexOf(activeLayerId),
          ),
        );
    }
    // Post-condition, re-reading the id rather than trusting the value read at
    // the top: "layers exist but none is active" is never a durable state, and
    // the hand-over above can legitimately land on `null` when ONE write both
    // removed the active layer and introduced its replacement (a restore, a
    // wholesale `setState`) — the survivors were not in the previous order, so
    // there was nothing to hand over to.
    if (
      useWorkspaceStore.getState().activeLayerId === null &&
      order.length > 0
    ) {
      useWorkspaceStore.getState().setActiveLayerId(order[0]!);
    }
    previousOrder = order;
  };

  // Rule 2: a pick activates the layer it landed on.
  //
  // A PICK, not any write to the selection store. The store carries the hover,
  // the pick mode and the tool mode beside the selection, and every one of
  // those notifies this subscriber - so a user who selected two buildings,
  // activated a vector target and then moved the mouse was thrown back to the
  // city layer, taking the "Selected" scope of a run with them (gate defect
  // F5).
  //
  // `selectionVersion` is the store's own pick counter, and it is the ONLY
  // thing compared here. Comparing what is SELECTED instead (round 2's fix)
  // gets the hover right and the RE-PICK wrong: clicking the building that is
  // already selected is an honest pick - the user is asking to be taken back
  // to it - and it changes no id. Comparing the state, or the selections
  // array's identity, gets the re-pick right and `setMode` wrong, because
  // narrowing surface picks to their objects rebuilds that array without
  // anything having been picked.
  //
  // `null` until the first reconcile, so installing over a restored selection
  // still lets that selection name the active layer.
  let pick: number | null = null;
  const reconcileSelection = () => {
    const state = useSelectionStore.getState();
    if (pick === state.selectionVersion) return;
    pick = state.selectionVersion;
    const owner = selectionLayerId(state);
    if (
      owner !== null &&
      owner !== useWorkspaceStore.getState().activeLayerId
    ) {
      useWorkspaceStore.getState().setActiveLayerId(owner);
    }
  };

  const unsubs = [
    useLayerStore.subscribe(reconcileLayers),
    useGeoLayerStore.subscribe(reconcileLayers),
    useSelectionStore.subscribe(reconcileSelection),
  ];
  // `reconcileSelection` FIRST: installing over a workspace that already has a
  // selection (a restore, a hot reload) must let that selection name the active
  // layer. The other order would find no active id, activate the FIRST layer,
  // and rule 1 would then clear the very selection that should have decided it.
  reconcileSelection();
  reconcileLayers();
  const dispose = () => {
    unsubs.forEach((u) => u());
    if (disposeInstalled === dispose) disposeInstalled = null;
  };
  disposeInstalled = dispose;
  return dispose;
}
