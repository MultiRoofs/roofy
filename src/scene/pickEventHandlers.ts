/**
 * Pointer/pick events -> selection store intents.
 *
 * Pure and engine-free: no `@navaramap/*`, no Three.js, no store singleton, no
 * DOM. `NavaraViewport` owns the engine seam — it turns a
 * `view.on("pointerdown"|"pointermove"|"click"|"featureClick")` payload into
 * the small structural shapes this module takes (a canvas point, an ECEF ray),
 * reads `PickMode`/`ToolMode` off the store, and pushes the resulting intent
 * back. Everything decision-shaped lives here so it is testable in Node.
 *
 * Handles resolve picks at SURFACE granularity always (see
 * `CityModelHandle.resolvePick`); narrowing to object granularity is the app's
 * job, exactly as the pre-Navara `resolvePicking.ts` documented and
 * `CitySceneR3F`'s `resolveFromEvent` did.
 *
 * `ToolMode` gating lives here too, in {@link acceptsPointer}: the old
 * `handlePointerUp` swallowed picks entirely in `measure` mode and returned
 * early in `box-select` (the overlay owned that gesture), while
 * `handlePointerMove` hovered in `select`/`box-select` alike. The router asks
 * that question BEFORE it resolves anything, so a measure click never costs a
 * raycast.
 */
import type {
  GeoFeatureSelection,
  PickMode,
  Selection,
  ToolMode,
} from "../domain/selection/types";
import {
  publicGeoProperties,
  readGeoStableFeatureId,
} from "../features/geoLayers/geoJsonRecords";
import type {
  EcefRay,
  PickedFeatureLike,
  RaycastHit,
  ScreenPoint,
} from "@cityjson/navara-cityjson";

export type PickIntent =
  | { readonly kind: "hover"; readonly selection: Selection | null }
  | { readonly kind: "select"; readonly selection: Selection | null }
  | { readonly kind: "toggle"; readonly selection: Selection };

/** The pointer gestures that produce a selection intent. `move` is a hover,
 *  `click` is a commit. Since Navara 0.1.1 the engine's `click` is itself a
 *  gesture (press and release within `CLICK_PIXEL_TOLERANCE`, never the end of
 *  a camera drag), and its `featureClick` pick is gated the same way; the
 *  router still puts a {@link createClickGate} in front of this so the two
 *  paths can never disagree about what counted as a click. */
export interface PickPointerEvent {
  readonly type: "move" | "click";
  readonly shiftKey: boolean;
}

/** The members this module needs from an interaction handle. Declared
 *  structurally (rather than importing `InteractionHandle`) so both plugins'
 *  handles and a test fake satisfy it without a cast. */
export interface RaycastResolver {
  readonly id: string;
  /** ECEF ray in, hit surface + ray distance out. The distance is what makes
   *  nearest-across-layers possible at all. */
  resolveRaycast(ray: EcefRay): RaycastHit | null;
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
 * Ask EVERY handle and take the globally nearest hit.
 *
 * Not first-layer-wins. Each handle already returns the nearest hit among its
 * own meshes (own-raycast, Task B1), but layer order is a UI ordering, not a
 * depth ordering: with two overlapping layers — or a streaming layer's cells
 * drawn over a static model — stopping at the first answer picks whatever
 * happens to sit higher in the layer list, which is the building BEHIND the one
 * under the cursor as often as not. `RaycastHit.distance` is exactly the
 * tie-breaker that makes the right answer available, so the router pays for
 * every handle's raycast and keeps the closest.
 *
 * The winner — and only the winner — is then asked to interpret its own hit:
 * an `objectIndex`/`surfaceIndex` pair is meaningful only inside the mesh that
 * produced it, so handing it to another layer would yield a real-looking but
 * WRONG selection rather than none.
 */
export function resolveNearestHit(
  handles: Iterable<RaycastResolver>,
  ray: EcefRay,
): Selection | null {
  let best: RaycastHit | null = null;
  let owner: RaycastResolver | null = null;
  for (const handle of handles) {
    const hit = handle.resolveRaycast(ray);
    if (!hit) continue;
    // `<` (rather than `>=` inverted) on purpose: a NaN distance compares false
    // against everything, so a broken hit can never displace a real one, and
    // equal distances keep the earlier layer for a stable result.
    if (best !== null && !(hit.distance < best.distance)) continue;
    best = hit;
    owner = handle;
  }
  if (best === null || owner === null) return null;
  return owner.resolvePick({
    layerId: owner.id,
    properties: {
      layerId: owner.id,
      objectIndex: best.objectIndex,
      surfaceIndex: best.surfaceIndex,
      // Forwarded VERBATIM and never interpreted here: a multi-mesh handle — a
      // streaming layer, whose resident cells each have their own index space —
      // needs it to know which of its cells the two indices were measured in.
      // Absent for a single-mesh `CityModelHandle`, and dropped rather than
      // passed as `undefined` so a handle can tell "no cell named" from "a cell
      // named nothing".
      ...(best.cellKey === undefined ? {} : { cellKey: best.cellKey }),
    },
  });
}

/**
 * Does the active tool want this gesture routed to a pick at all?
 *
 * Old-app parity, verbatim: `measure` owns both gestures (its clicks place
 * measurement points and it never hovers), `box-select` hovers but leaves the
 * commit to its drag overlay, `select` takes both. Asked BEFORE resolving, so
 * a gesture the tool owns never costs a raycast.
 */
export function acceptsPointer(
  toolMode: ToolMode,
  type: PickPointerEvent["type"],
): boolean {
  if (toolMode === "measure") return false;
  if (toolMode === "box-select") return type === "move";
  return true;
}

/** Value equality for selections — the same rule `selectionStore` uses
 *  internally. Exported because the router needs it BEFORE the store does:
 *  every resolved pick is a fresh object, so hovering one surface would push a
 *  new `hovered` on every mousemove and repaint every layer's vertex colors at
 *  pointer rate. */
export function sameSelection(
  a: Selection | null,
  b: Selection | null,
): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.layerId !== b.layerId || a.objectId !== b.objectId) return false;
  if (a.kind === "surface" && b.kind === "surface") {
    return a.surfaceIndex === b.surfaceIndex;
  }
  return true;
}

/**
 * The pointer position in CANVAS-relative CSS pixels.
 *
 * Both engine seams the router uses — `getPickRay` and `pickDepthPosition` —
 * measure from the canvas' top-left corner, while a `MouseEvent`'s `x`/`y`
 * (i.e. `clientX`/`clientY`) measure from the viewport. The app renders the
 * canvas beside a left sidebar, so the two differ by the sidebar's width and
 * using the wrong one puts every pick that far to the right of the cursor.
 * `offsetX`/`offsetY` are already canvas-relative because the engine binds its
 * listeners directly to the canvas element.
 */
export function canvasPointOf(event: {
  readonly offsetX?: number;
  readonly offsetY?: number;
  readonly clientX?: number;
  readonly clientY?: number;
}): ScreenPoint {
  return {
    x: firstFinite(event.offsetX, event.clientX),
    y: firstFinite(event.offsetY, event.clientY),
  };
}

function firstFinite(...values: ReadonlyArray<number | undefined>): number {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return 0;
}

/** How far the pointer may travel between pointerdown and click and still
 *  count as a click rather than a camera drag.
 *
 *  MIRRORS the engine's `CLICK_PIXEL_TOLERANCE` (5 px in Navara 0.1.1, after
 *  Cesium's `_clickPixelTolerance`), which gates both its `click` event and the
 *  `featureClick` pick — a local constant rather than an import because this
 *  module is engine-free. Keeping the two equal is what makes the city path
 *  (own raycast on `click`) and the geo path (the engine's pick) agree on what
 *  was a click: on 0.0.5 the engine's pick had ZERO tolerance while this gate
 *  allowed 3 px, so a 1 px jitter selected a city object but cleared a geo
 *  one. Touch taps get 30 px in the engine (`TAP_PIXEL_TOLERANCE`); the gate
 *  does not special-case them, so a jittery tap that the engine still counts
 *  can be refused here — a miss, never a wrong selection. */
export const CLICK_DRAG_TOLERANCE_PX = 5;

export interface ClickGate {
  down(point: ScreenPoint): void;
  move(point: ScreenPoint): void;
  /** The browser cancelled the gesture (`pointercancel`): no click may ride on
   *  the press that started it. Cleared by the next `down`. */
  cancel(): void;
  /** True when the pointer has not travelled past the tolerance since the last
   *  pointerdown — i.e. this really is a click and not the end of a drag. */
  isClean(): boolean;
}

/**
 * Suppress a click that does not belong to a clean press-and-release.
 *
 * Since Navara 0.1.1 the engine's `click` is a gesture rather than the raw DOM
 * click — it never fires after an orbit or a pan — so this gate is defence in
 * depth rather than the only guard: it refuses a click whose press this
 * component never saw as clean (a `pointercancel` in between, a press over the
 * sky that the engine emitted nothing for), and it keeps the tolerance the
 * own-raycast path applies identical to the one the engine's pick applies.
 */
export function createClickGate(
  tolerancePx: number = CLICK_DRAG_TOLERANCE_PX,
): ClickGate {
  let origin: ScreenPoint | null = null;
  let dragged = false;
  return {
    down(point) {
      origin = point;
      dragged = false;
    },
    move(point) {
      // A hover with no button down has no origin, and must not disarm the
      // click that may follow.
      if (origin === null || dragged) return;
      const dx = point.x - origin.x;
      const dy = point.y - origin.y;
      if (dx * dx + dy * dy > tolerancePx * tolerancePx) dragged = true;
    },
    cancel() {
      origin = null;
      dragged = true;
    },
    isClean() {
      return !dragged;
    },
  };
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

/**
 * What the viewport stashes from the engine's own `featureClick` event.
 *
 * Geo (GeoJSON) layers are drawn BY the engine, so their picks arrive through
 * the engine's `featureClick` event (`pick` before Navara 0.1.0) — which fires
 * only for a clean press-and-release, just before the `click` of the same
 * gesture — rather than through the own-raycast path the city plugins use. The
 * viewport cannot act on it there and then (the click that follows is what
 * commits a selection), so it stashes this much and asks the router on the
 * next `click`.
 *
 * `engineLayerId` is `unknown` on purpose: it is `FeatureInfo.layerId`, the
 * ENGINE's id — an opaque token from an alpha engine whose type we do not
 * control, and one this module must never compare, only hand back.
 */
export interface EnginePickStash {
  readonly engineLayerId: unknown;
  readonly batchId: number;
  readonly properties: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Resolve a stashed engine pick to a geo selection, or `null`.
 *
 * The engine picks everything it draws — basemap tiles and Google's
 * photorealistic tiles included — so a stash is not evidence that a geo layer
 * was hit. `resolveGeoLayerId` (the viewport's engine-id -> geo-layer-id map)
 * is the only authority on that, and it is asked for EVERY stash, including one
 * whose `engineLayerId` is `undefined`: whether that names nothing is the map's
 * answer to give, not a shortcut to take here.
 */
export function geoSelectionFromStash(
  stash: EnginePickStash | null,
  resolveGeoLayerId: (engineLayerId: unknown) => string | null,
): GeoFeatureSelection | null {
  if (stash === null) return null;
  const geoLayerId = resolveGeoLayerId(stash.engineLayerId);
  if (geoLayerId === null) return null;
  // `?? {}` so a consumer can read `properties` without a guard: a feature with
  // no properties is a real, selectable feature, not a failed pick.
  return {
    geoLayerId,
    batchId: stash.batchId,
    stableFeatureId: readGeoStableFeatureId(stash.properties) ?? undefined,
    properties: publicGeoProperties(stash.properties ?? {}),
  };
}
