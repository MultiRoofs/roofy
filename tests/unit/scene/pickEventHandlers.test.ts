import { describe, expect, it, vi } from "vitest";
import type { InteractionHandle } from "../../../src/scene/handleSync";
import {
  applyPickIntent,
  narrowToMode,
  pickIntentFor,
  resolveFirstHit,
  type PickResolver,
} from "../../../src/scene/pickEventHandlers";

const surfaceSel = {
  kind: "surface" as const,
  layerId: "L1",
  objectId: "B1",
  surfaceIndex: 4,
};

function handle(result: unknown) {
  return { resolvePick: vi.fn(() => result) };
}

describe("resolveFirstHit", () => {
  it("returns the first handle that resolves a selection", () => {
    const a = handle(null);
    const b = handle(surfaceSel);
    expect(resolveFirstHit([a, b] as never, { x: 10, y: 20 })).toBe(surfaceSel);
    expect(a.resolvePick).toHaveBeenCalledWith({ x: 10, y: 20 });
  });

  it("stops asking once a handle has answered", () => {
    const a = handle(surfaceSel);
    const b = handle(surfaceSel);
    resolveFirstHit([a, b] as never, { x: 0, y: 0 });
    expect(a.resolvePick).toHaveBeenCalledTimes(1);
    expect(b.resolvePick).not.toHaveBeenCalled();
  });

  it("returns null when nothing is hit", () => {
    expect(resolveFirstHit([handle(null)] as never, { x: 1, y: 1 })).toBeNull();
  });

  it("accepts the app's real interaction handles", () => {
    // Compile-time assertion: whatever `interactionHandles()` hands the Task
    // B15 router — static CityModelHandles and streaming handles alike — must
    // already be a PickResolver, with no cast at the call site.
    const asResolver = (h: InteractionHandle): PickResolver => h;
    expect(typeof asResolver).toBe("function");
  });

  it("passes an engine PickedFeature through unchanged", () => {
    // The pickable-wrapper path hands the handle a PickedFeatureLike rather
    // than a screen point; this module must not care which it is.
    const feature = { batchId: 7, layerId: "L1" };
    const a = handle(surfaceSel);
    expect(resolveFirstHit([a] as never, feature)).toBe(surfaceSel);
    expect(a.resolvePick).toHaveBeenCalledWith(feature);
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
    const hit = resolveFirstHit([handle(surfaceSel)] as never, { x: 5, y: 5 });
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
    const hit = resolveFirstHit([handle(null)] as never, { x: 5, y: 5 });
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
