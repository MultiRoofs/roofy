import { describe, expect, it, vi } from "vitest";
import type { EcefRay, Selection } from "@cityjson/navara-cityjson";
import type { InteractionHandle } from "../../../src/scene/handleSync";
import {
  acceptsPointer,
  applyPickIntent,
  canvasPointOf,
  createClickGate,
  narrowToMode,
  pickIntentFor,
  resolveNearestHit,
  sameSelection,
  type RaycastResolver,
} from "../../../src/scene/pickEventHandlers";

const surfaceSel = {
  kind: "surface" as const,
  layerId: "L1",
  objectId: "B1",
  surfaceIndex: 4,
};

const RAY: EcefRay = {
  origin: { x: 0, y: 0, z: 0 },
  direction: { x: 0, y: 0, z: 1 },
};

/** A handle that reports a hit `distance` metres away and resolves it to
 *  a selection carrying its own layer id. */
function rayHandle(id: string, distance: number | null) {
  return {
    id,
    resolveRaycast: vi.fn(() =>
      distance === null ? null : { objectIndex: 2, surfaceIndex: 4, distance },
    ),
    resolvePick: vi.fn(
      (): Selection => ({
        kind: "surface",
        layerId: id,
        objectId: "B1",
        surfaceIndex: 4,
      }),
    ),
  };
}

describe("resolveNearestHit", () => {
  it("returns the NEAREST hit across handles, not the first layer that answers", () => {
    // The whole point of Task B12's review ruling: layer order must not decide
    // what you picked. `far` comes first and would win under first-layer-wins.
    const far = rayHandle("FAR", 900);
    const near = rayHandle("NEAR", 12);
    const hit = resolveNearestHit([far, near] as never, RAY);
    expect(hit).toEqual({
      kind: "surface",
      layerId: "NEAR",
      objectId: "B1",
      surfaceIndex: 4,
    });
    // Every handle is asked — you cannot know which is nearest without asking.
    expect(far.resolveRaycast).toHaveBeenCalledWith(RAY);
    expect(near.resolveRaycast).toHaveBeenCalledWith(RAY);
    // ...but only the winner is asked to interpret its own indices: a batchId
    // or vertex index is only meaningful inside the mesh that produced it.
    expect(far.resolvePick).not.toHaveBeenCalled();
    expect(near.resolvePick).toHaveBeenCalledTimes(1);
  });

  it("hands the winning handle its OWN indices, stamped with its layer id", () => {
    const near = rayHandle("NEAR", 12);
    resolveNearestHit([near] as never, RAY);
    expect(near.resolvePick).toHaveBeenCalledWith({
      layerId: "NEAR",
      properties: {
        layerId: "NEAR",
        objectIndex: 2,
        surfaceIndex: 4,
      },
    });
  });

  it("keeps the first of two hits at the same distance (stable layer order)", () => {
    const a = rayHandle("A", 12);
    const b = rayHandle("B", 12);
    expect(resolveNearestHit([a, b] as never, RAY)).toMatchObject({
      layerId: "A",
    });
  });

  it("ignores handles that report no hit", () => {
    const miss = rayHandle("MISS", null);
    const hit = rayHandle("HIT", 500);
    expect(resolveNearestHit([miss, hit] as never, RAY)).toMatchObject({
      layerId: "HIT",
    });
    expect(miss.resolvePick).not.toHaveBeenCalled();
  });

  it("never lets a NaN distance beat a real hit", () => {
    const real = rayHandle("REAL", 42);
    const broken = rayHandle("BROKEN", Number.NaN);
    expect(resolveNearestHit([real, broken] as never, RAY)).toMatchObject({
      layerId: "REAL",
    });
  });

  it("returns null when nothing is hit", () => {
    expect(resolveNearestHit([rayHandle("A", null)] as never, RAY)).toBeNull();
  });

  it("passes a null through when the winning handle cannot resolve its own hit", () => {
    const h = rayHandle("A", 12);
    h.resolvePick.mockReturnValue(null as never);
    expect(resolveNearestHit([h] as never, RAY)).toBeNull();
  });

  it("accepts the app's real interaction handles", () => {
    // Compile-time assertion: whatever `interactionHandles()` hands the router
    // — static CityModelHandles and streaming handles alike — must already be a
    // RaycastResolver, with no cast at the call site.
    const asResolver = (h: InteractionHandle): RaycastResolver => h;
    expect(typeof asResolver).toBe("function");
  });
});

describe("acceptsPointer", () => {
  it("routes both gestures in select mode", () => {
    expect(acceptsPointer("select", "move")).toBe(true);
    expect(acceptsPointer("select", "click")).toBe(true);
  });

  it("hovers but never commits in box-select (the overlay owns the gesture)", () => {
    expect(acceptsPointer("box-select", "move")).toBe(true);
    expect(acceptsPointer("box-select", "click")).toBe(false);
  });

  it("swallows everything in measure mode", () => {
    // Old-app parity: `handlePointerUp` returned before resolving anything and
    // `handlePointerMove` hovered only in select/box-select.
    expect(acceptsPointer("measure", "move")).toBe(false);
    expect(acceptsPointer("measure", "click")).toBe(false);
  });
});

describe("canvasPointOf", () => {
  it("prefers canvas-relative offsets over client coordinates", () => {
    // Both `getPickRay` and `pickDepthPosition` measure from the canvas'
    // top-left; clientX is measured from the VIEWPORT, so with the app's left
    // sidebar on screen the two differ by the sidebar's width and every pick
    // would land to the right of the cursor.
    expect(
      canvasPointOf({ offsetX: 10, offsetY: 20, clientX: 310, clientY: 20 }),
    ).toEqual({ x: 10, y: 20 });
  });

  it("falls back to client coordinates when no offset is reported", () => {
    expect(canvasPointOf({ clientX: 7, clientY: 8 })).toEqual({ x: 7, y: 8 });
  });

  it("treats a missing pair as the origin rather than NaN", () => {
    expect(canvasPointOf({})).toEqual({ x: 0, y: 0 });
  });
});

describe("createClickGate", () => {
  it("passes a click that did not move", () => {
    const gate = createClickGate();
    gate.down({ x: 100, y: 100 });
    gate.move({ x: 100, y: 100 });
    expect(gate.isClean()).toBe(true);
  });

  it("absorbs hand jitter within the tolerance", () => {
    const gate = createClickGate(3);
    gate.down({ x: 100, y: 100 });
    gate.move({ x: 102, y: 100 });
    expect(gate.isClean()).toBe(true);
  });

  it("blocks a click that ended a camera DRAG", () => {
    // The engine's `click` is the raw DOM click, which fires after a drag too.
    // Without this gate, orbiting the camera would clear the selection on every
    // mouseup — the engine's own pick event guards the same way.
    const gate = createClickGate(3);
    gate.down({ x: 100, y: 100 });
    gate.move({ x: 140, y: 100 });
    gate.move({ x: 100, y: 100 }); // back where it started: still a drag
    expect(gate.isClean()).toBe(false);
  });

  it("rearms on the next mousedown", () => {
    const gate = createClickGate(3);
    gate.down({ x: 0, y: 0 });
    gate.move({ x: 90, y: 0 });
    expect(gate.isClean()).toBe(false);
    gate.down({ x: 50, y: 50 });
    expect(gate.isClean()).toBe(true);
  });

  it("treats a move with no preceding mousedown as clean", () => {
    // A hover across the canvas must not disarm the next click.
    const gate = createClickGate(3);
    gate.move({ x: 400, y: 400 });
    expect(gate.isClean()).toBe(true);
  });
});

describe("sameSelection", () => {
  it("compares by value, not identity", () => {
    expect(sameSelection(surfaceSel, { ...surfaceSel })).toBe(true);
  });

  it("separates two nulls from a null and a selection", () => {
    expect(sameSelection(null, null)).toBe(true);
    expect(sameSelection(null, surfaceSel)).toBe(false);
    expect(sameSelection(surfaceSel, null)).toBe(false);
  });

  it("distinguishes surface index, object, layer and granularity", () => {
    expect(sameSelection(surfaceSel, { ...surfaceSel, surfaceIndex: 5 })).toBe(
      false,
    );
    expect(sameSelection(surfaceSel, { ...surfaceSel, objectId: "B2" })).toBe(
      false,
    );
    expect(sameSelection(surfaceSel, { ...surfaceSel, layerId: "L2" })).toBe(
      false,
    );
    expect(
      sameSelection(surfaceSel, {
        kind: "object",
        layerId: "L1",
        objectId: "B1",
      }),
    ).toBe(false);
  });
});

describe("narrowToMode", () => {
  it("keeps surface granularity in surface mode", () => {
    expect(narrowToMode(surfaceSel, "surface")).toEqual(surfaceSel);
  });

  it("collapses to an object selection in object mode", () => {
    expect(narrowToMode(surfaceSel, "object")).toEqual({
      kind: "object",
      layerId: "L1",
      objectId: "B1",
    });
  });

  it("passes null through", () => {
    expect(narrowToMode(null, "object")).toBeNull();
  });
});

describe("pickIntentFor", () => {
  it("maps a move to a hover intent", () => {
    expect(
      pickIntentFor({ type: "move", shiftKey: false }, surfaceSel),
    ).toEqual({ kind: "hover", selection: surfaceSel });
  });

  it("maps a move off the model to a hover-nothing intent", () => {
    expect(pickIntentFor({ type: "move", shiftKey: true }, null)).toEqual({
      kind: "hover",
      selection: null,
    });
  });

  it("maps a plain click to select and a shift-click to toggle", () => {
    expect(
      pickIntentFor({ type: "click", shiftKey: false }, surfaceSel),
    ).toEqual({ kind: "select", selection: surfaceSel });
    expect(
      pickIntentFor({ type: "click", shiftKey: true }, surfaceSel),
    ).toEqual({ kind: "toggle", selection: surfaceSel });
  });

  it("maps a shift-click on empty space to a clearing select", () => {
    expect(pickIntentFor({ type: "click", shiftKey: true }, null)).toEqual({
      kind: "select",
      selection: null,
    });
  });
});

describe("applyPickIntent", () => {
  it("dispatches to the matching store action", () => {
    const store = { hover: vi.fn(), select: vi.fn(), toggleSelect: vi.fn() };
    applyPickIntent({ kind: "hover", selection: null }, store);
    applyPickIntent({ kind: "select", selection: surfaceSel }, store);
    applyPickIntent({ kind: "toggle", selection: surfaceSel }, store);
    expect(store.hover).toHaveBeenCalledWith(null);
    expect(store.select).toHaveBeenCalledWith(surfaceSel);
    expect(store.toggleSelect).toHaveBeenCalledWith(surfaceSel);
  });

  it("dispatches only the intent it was given", () => {
    const store = { hover: vi.fn(), select: vi.fn(), toggleSelect: vi.fn() };
    applyPickIntent({ kind: "select", selection: null }, store);
    expect(store.select).toHaveBeenCalledWith(null);
    expect(store.hover).not.toHaveBeenCalled();
    expect(store.toggleSelect).not.toHaveBeenCalled();
  });
});

describe("pick pipeline (old-app parity)", () => {
  // The four exports compose into exactly what CitySceneR3F's
  // handlePointerUp did: resolve -> narrow by PickMode -> intent -> store.
  const store = () => ({
    hover: vi.fn(),
    select: vi.fn(),
    toggleSelect: vi.fn(),
  });

  it("shift-clicking a surface in object mode toggles the whole object", () => {
    const s = store();
    const hit = resolveNearestHit([rayHandle("L1", 3)] as never, RAY);
    applyPickIntent(
      pickIntentFor(
        { type: "click", shiftKey: true },
        narrowToMode(hit, "object"),
      ),
      s,
    );
    expect(s.toggleSelect).toHaveBeenCalledWith({
      kind: "object",
      layerId: "L1",
      objectId: "B1",
    });
    expect(s.select).not.toHaveBeenCalled();
  });

  it("clicking empty space clears the selection", () => {
    const s = store();
    const hit = resolveNearestHit([rayHandle("L1", null)] as never, RAY);
    applyPickIntent(
      pickIntentFor(
        { type: "click", shiftKey: false },
        narrowToMode(hit, "surface"),
      ),
      s,
    );
    expect(s.select).toHaveBeenCalledWith(null);
    expect(s.toggleSelect).not.toHaveBeenCalled();
  });
});
