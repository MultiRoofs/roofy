/**
 * Pointer/pick events -> selection store intents.
 *
 * Pure and engine-free: no `@navaramap/*`, no Three.js, no store singleton, no
 * DOM. The Navara router (Task B15) owns the engine seam — it turns a
 * `view.on("pick"|"click"|"mouseMove")` payload into the small structural
 * event this module takes, reads `PickMode` off the store, and pushes the
 * resulting intent back. Everything decision-shaped lives here so it is
 * testable in Node.
 *
 * Handles resolve picks at SURFACE granularity always (see
 * `CityModelHandle.resolvePick`); narrowing to object granularity is the app's
 * job, exactly as the pre-Navara `resolvePicking.ts` documented and
 * `CitySceneR3F`'s `resolveFromEvent` did.
 *
 * PARITY SCOPE (deliberate omission, carried to Task B15): `ToolMode` is not
 * modelled here. The old `handlePointerUp` swallowed picks entirely in
 * `measure` mode and returned early in `box-select` (the overlay owned that
 * gesture), while `handlePointerMove` hovered in `select`/`box-select` only.
 * Measure and box-select are out of the Navara parity scope, so the router
 * must gate on `toolMode` before calling into this module once those tools
 * come back.
 */
import type { PickMode, Selection } from "../domain/selection/types";
import type { PickedFeatureLike, ScreenPoint } from "@cityjson/navara-cityjson";

export type PickIntent =
  | { readonly kind: "hover"; readonly selection: Selection | null }
  | { readonly kind: "select"; readonly selection: Selection | null }
  | { readonly kind: "toggle"; readonly selection: Selection };

/** The pointer gestures that produce a selection intent. `move` is a hover,
 *  `click` is a commit — B1 established that the engine only fires a pick on
 *  mouseup with no intervening mousemove, so a drag (camera gesture) never
 *  reaches here as a `click`. */
export interface PickPointerEvent {
  readonly type: "move" | "click";
  readonly shiftKey: boolean;
}

/** The only member this module needs from an interaction handle. Declared
 *  structurally (rather than importing `InteractionHandle`) so both plugins'
 *  handles and a test fake satisfy it without a cast. */
export interface PickResolver {
  resolvePick(pick: ScreenPoint | PickedFeatureLike): Selection | null;
}

/** The slice of `SelectionActions` a pick intent can reach. Narrow on purpose:
 *  a pick may never call `setMode`, `selectMany` or `clear`. */
export interface SelectionActionsSubset {
  hover(selection: Selection | null): void;
  select(selection: Selection | null): void;
  toggleSelect(selection: Selection): void;
}

/**
 * Ask each handle in turn and take the first answer.
 *
 * `handles` arrives in layer order (`interactionHandles`), so this is
 * first-layer-wins, not nearest-hit-wins across layers: each handle already
 * returns the nearest hit among its OWN meshes (own-raycast, Task B1), and
 * layers rarely overlap in depth. Iteration stops at the first hit, so the
 * common case costs one raycast.
 */
export function resolveFirstHit(
  handles: Iterable<PickResolver>,
  pick: ScreenPoint | PickedFeatureLike,
): Selection | null {
  for (const handle of handles) {
    const hit = handle.resolvePick(pick);
    if (hit) return hit;
  }
  return null;
}

/**
 * Collapse a resolved (always surface-granular) selection to the granularity
 * the active `PickMode` asks for.
 */
export function narrowToMode(
  selection: Selection | null,
  mode: PickMode,
): Selection | null {
  if (!selection) return null;
  if (mode === "surface") return selection;
  return {
    kind: "object",
    layerId: selection.layerId,
    objectId: selection.objectId,
  };
}

/**
 * Map a gesture + what it hit to the store action it means.
 *
 * Shift semantics are the old app's, exactly: shift+click on something toggles
 * it (multi-select), while shift+click on empty space is a plain `select(null)`
 * — a clear, not a no-op, because `toggleSelect` has nothing to toggle.
 */
export function pickIntentFor(
  event: PickPointerEvent,
  selection: Selection | null,
): PickIntent {
  if (event.type === "move") return { kind: "hover", selection };
  if (event.shiftKey && selection) return { kind: "toggle", selection };
  return { kind: "select", selection };
}

/** Dispatch one intent. The store keeps the multi-select invariants (same-layer
 *  filtering, add/remove) — this only routes. */
export function applyPickIntent(
  intent: PickIntent,
  store: SelectionActionsSubset,
): void {
  if (intent.kind === "hover") {
    store.hover(intent.selection);
    return;
  }
  if (intent.kind === "toggle") {
    store.toggleSelect(intent.selection);
    return;
  }
  store.select(intent.selection);
}
