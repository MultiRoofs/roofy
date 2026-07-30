import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StrictMode } from "react";
import { renderHook, cleanup } from "@testing-library/react";
import { PerspectiveCamera } from "three";
import type { Vec3 } from "../../../../src/domain/citymodel/types";
import type { WorkerClient } from "../../../../src/features/streaming/workerClient";
import type {
  CellGeometry,
  WorkerResponse,
} from "../../../../src/features/streaming/workerProtocol";
import { CellCache } from "../../../../src/features/streaming/cellCache";
import type { CellEntry } from "../../../../src/features/streaming/streamStore";
import { useStreamStore } from "../../../../src/features/streaming/streamStore";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import type { Grid } from "../../../../src/features/streaming/tileGrid";
import type { FcbHeaderModel } from "../../../../src/domain/citymodel/flatcitybuf/fcbSource";
import {
  SETTLE_MS,
  LEVEL_SWAP_TIMEOUT_MS,
} from "../../../../src/features/streaming/constants";

// --- @react-three/fiber mock -------------------------------------------
// Same established pattern as tests/unit/scene/postProcessingEffects.test.tsx:
// a mutable container declared before vi.mock, captured by the factory's
// closure, whose CONTENTS (not binding) are reassigned per-test.
let fakeCamera: PerspectiveCamera;
let fakeControls: FakeControls;

class FakeControls {
  private readonly listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, cb: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
  }
  removeEventListener(type: string, cb: () => void): void {
    this.listeners.get(type)?.delete(cb);
  }
  fire(type: string): void {
    for (const cb of this.listeners.get(type) ?? []) cb();
  }
  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

vi.mock("@react-three/fiber", () => ({
  useThree: (selector: (state: unknown) => unknown) =>
    selector({ camera: fakeCamera, controls: fakeControls }),
}));

// Imported AFTER the mock is registered so the module under test picks it up.
const {
  lodToWireLabel,
  resolveLod,
  lodSelectionEquals,
  cellStatsFromGeometry,
  groundYFromBBox,
  planCommit,
  commitNormal,
  commitSwap,
  createSettleController,
  useTileStreaming,
} = await import("../../../../src/features/streaming/useTileStreaming");

function geom(
  triangleCount: number,
  overrides?: Partial<CellGeometry>,
): CellGeometry {
  const v = triangleCount * 3;
  return {
    positions: new Float32Array(v * 3).fill(1),
    normals: new Float32Array(v * 3).fill(2),
    baseColors: new Float32Array(v * 3).fill(3),
    ruleColors: null,
    objectIndices: new Uint32Array(v).fill(0),
    surfaceIndices: new Uint32Array(v).fill(0),
    objectKeys: [],
    triangleCount,
    ...overrides,
  };
}

function fakeEntry(tag: string): CellEntry {
  return {
    geometry: geom(1),
    objects: [],
    surfaceAttrKeys: [tag],
    lodsSeen: [],
  };
}

// ---------------------------------------------------------------------
describe("lodToWireLabel", () => {
  it("maps an exact selection to its label", () => {
    expect(lodToWireLabel({ kind: "exact", lod: "2" })).toBe("2");
  });
  it("maps 'all' to null (no filter)", () => {
    expect(lodToWireLabel({ kind: "all" })).toBeNull();
  });
  it("maps 'unlabelled' to null — the wire protocol has no representation for it (documented gap)", () => {
    expect(lodToWireLabel({ kind: "unlabelled" })).toBeNull();
  });
});

describe("resolveLod", () => {
  it("manual mode with a non-null selectedLod pins that exact label, ignoring the ladder", () => {
    expect(
      resolveLod({ lodMode: "manual", selectedLod: "1.2" }, ["0", "1.2"], 50),
    ).toEqual({ kind: "exact", lod: "1.2" });
  });
  it("manual mode with a null selectedLod means 'all', same as a non-streaming layer", () => {
    expect(
      resolveLod({ lodMode: "manual", selectedLod: null }, ["0", "1.2"], 50),
    ).toEqual({ kind: "all" });
  });
  it("auto mode delegates to lodForCellSize", () => {
    // n=3 ladder, cellSize 300 falls in the "middle band" -> ladder[1]
    expect(
      resolveLod({ lodMode: "auto", selectedLod: null }, ["0", "1", "2"], 300),
    ).toEqual({ kind: "exact", lod: "1" });
  });
});

describe("lodSelectionEquals", () => {
  it("true for identical exact selections", () => {
    expect(
      lodSelectionEquals(
        { kind: "exact", lod: "1" },
        { kind: "exact", lod: "1" },
      ),
    ).toBe(true);
  });
  it("false for different exact labels", () => {
    expect(
      lodSelectionEquals(
        { kind: "exact", lod: "1" },
        { kind: "exact", lod: "2" },
      ),
    ).toBe(false);
  });
  it("true for two 'all' selections", () => {
    expect(lodSelectionEquals({ kind: "all" }, { kind: "all" })).toBe(true);
  });
  it("false across different kinds", () => {
    expect(
      lodSelectionEquals({ kind: "all" }, { kind: "exact", lod: "1" }),
    ).toBe(false);
  });
});

describe("cellStatsFromGeometry", () => {
  it("sums triangleCount and every typed array's byteLength, excluding ruleColors when null", () => {
    const g = geom(2); // v=6; positions/normals/baseColors len 18 f32 (72B each); indices len 6 u32 (24B each)
    const stats = cellStatsFromGeometry(g);
    expect(stats.triangles).toBe(2);
    expect(stats.bytes).toBe(72 + 72 + 72 + 24 + 24);
  });
  it("includes ruleColors bytes when present", () => {
    const g = geom(1, { ruleColors: new Float32Array(9).fill(0) }); // v=3, len9 f32 = 36B
    const withRule = cellStatsFromGeometry(g);
    const without = cellStatsFromGeometry({ ...g, ruleColors: null });
    expect(withRule.bytes - without.bytes).toBe(36);
  });
});

describe("groundYFromBBox", () => {
  it("returns 0 for a null bbox", () => {
    expect(groundYFromBBox(null)).toBe(0);
  });
  it("returns -(extentZ/2) - 0.01, mirroring CitySceneR3F's groundY formula", () => {
    // extentZ = maxZ - minZ = 40 - 10 = 30
    expect(groundYFromBBox([0, 0, 10, 100, 100, 40])).toBeCloseTo(-15.01, 6);
  });
});

// ---------------------------------------------------------------------
// planCommit — hand-derived grid/bbox fixture, not re-derived through
// chooseLevel/keysCovering in the assertions themselves (Task 4's lesson:
// deriving the expectation via the same helper under test is tautological).
//
// Grid: origin (0,0), rootCell 900, maxLevel 3 -> cell sizes 900/450/225/112.5
// bbox [0,0,675,675] (span 675):
//   L0(900): 1x1=1 cell        L1(450): 2x2=4 cells
//   L2(225): 4x4=16 cells  <- first level with count in [9,64] -> chosen
//   (L3 never reached)
// desired = 16 keys "2/c/r" for c,r in 0..3.
// ---------------------------------------------------------------------
const GRID: Grid = { originX: 0, originY: 0, rootCell: 900, maxLevel: 3 };
const BBOX: [number, number, number, number] = [0, 0, 675, 675];
const FOOTPRINT = {
  bbox: BBOX,
  span: 675,
  centre: [337.5, 337.5] as [number, number],
};
const DESIRED_16: string[] = [];
for (let c = 0; c < 4; c++)
  for (let r = 0; r < 4; r++) DESIRED_16.push(`2/${c}/${r}`);

function newCache(): CellCache<CellEntry> {
  return new CellCache<CellEntry>({
    maxTriangles: Infinity,
    maxBytes: Infinity,
  });
}

describe("planCommit", () => {
  it("too-far when the footprint is null", () => {
    const plan = planCommit({
      footprint: null,
      probeCount: null,
      grid: GRID,
      cache: newCache(),
      prevLevel: null,
      prevCommit: null,
      prevLod: null,
      ladder: [],
      lodMode: "auto",
      selectedLod: null,
    });
    expect(plan).toEqual({ kind: "too-far", reason: "footprint" });
  });

  it("too-far when probeCount is null despite a valid footprint (defensive: unreachable via the current driver wiring, but part of this function's own contract)", () => {
    const plan = planCommit({
      footprint: FOOTPRINT,
      probeCount: null,
      grid: GRID,
      cache: newCache(),
      prevLevel: null,
      prevCommit: null,
      prevLod: null,
      ladder: [],
      lodMode: "auto",
      selectedLod: null,
    });
    expect(plan).toEqual({ kind: "too-far", reason: "no-probe" });
  });

  it("too-far when probeCount exceeds VIEWPORT_FEATURE_BUDGET", () => {
    const plan = planCommit({
      footprint: FOOTPRINT,
      probeCount: 20001,
      grid: GRID,
      cache: newCache(),
      prevLevel: null,
      prevCommit: null,
      prevLod: null,
      ladder: [],
      lodMode: "auto",
      selectedLod: null,
    });
    expect(plan).toEqual({ kind: "too-far", reason: "feature-budget" });
  });

  it("too-far when no level's cover count falls in [MIN_COVER_CELLS, MAX_COVER_CELLS] (tiny footprint)", () => {
    const plan = planCommit({
      footprint: { bbox: [0, 0, 10, 10], span: 10, centre: [5, 5] },
      probeCount: 0,
      grid: GRID,
      cache: newCache(),
      prevLevel: null,
      prevCommit: null,
      prevLod: null,
      ladder: [],
      lodMode: "auto",
      selectedLod: null,
    });
    expect(plan).toEqual({ kind: "too-far", reason: "no-level" });
  });

  it("chooses level 2 with a 16-cell cover for the canonical fixture (literal, not re-derived)", () => {
    const plan = planCommit({
      footprint: FOOTPRINT,
      probeCount: 0,
      grid: GRID,
      cache: newCache(),
      prevLevel: null,
      prevCommit: null,
      prevLod: null,
      ladder: [],
      lodMode: "auto",
      selectedLod: null,
    });
    expect(plan.kind).toBe("commit");
    if (plan.kind !== "commit") throw new Error("expected commit");
    expect(plan.level).toBe(2);
    expect(plan.desired).toHaveLength(16);
    expect([...plan.desired].sort()).toEqual([...DESIRED_16].sort());
  });

  it("skips a fully-covered, unmoved view (hysteresis, no bypass)", () => {
    const cache = newCache();
    for (const k of DESIRED_16)
      cache.set(k, fakeEntry(k), { triangles: 1, bytes: 1 });
    const plan = planCommit({
      footprint: FOOTPRINT,
      probeCount: 0,
      grid: GRID,
      cache,
      prevLevel: 2,
      prevCommit: { centre: FOOTPRINT.centre, span: FOOTPRINT.span },
      prevLod: { kind: "all" },
      ladder: [],
      lodMode: "auto",
      selectedLod: null,
    });
    expect(plan).toEqual({ kind: "skip" });
  });

  it("commits (isSwap=false, toFetch=missing) when the cover has holes, even with zero movement", () => {
    const cache = newCache();
    // Populate only 10 of 16 desired cells -> 6 missing.
    for (const k of DESIRED_16.slice(0, 10)) {
      cache.set(k, fakeEntry(k), { triangles: 1, bytes: 1 });
    }
    const plan = planCommit({
      footprint: FOOTPRINT,
      probeCount: 0,
      grid: GRID,
      cache,
      prevLevel: 2,
      prevCommit: { centre: FOOTPRINT.centre, span: FOOTPRINT.span }, // identical -> no hysteresis trigger
      prevLod: { kind: "all" },
      ladder: [],
      lodMode: "auto",
      selectedLod: null,
    });
    expect(plan.kind).toBe("commit");
    if (plan.kind !== "commit") throw new Error("expected commit");
    expect(plan.isSwap).toBe(false);
    expect([...plan.toFetch].sort()).toEqual(DESIRED_16.slice(10).sort());
  });

  it("commits as a SWAP (toFetch=desired, including already-resident keys) when the level changed", () => {
    const cache = newCache();
    for (const k of DESIRED_16)
      cache.set(k, fakeEntry(k), { triangles: 1, bytes: 1 }); // fully resident at the NEW level's keys
    const plan = planCommit({
      footprint: FOOTPRINT,
      probeCount: 0,
      grid: GRID,
      cache,
      prevLevel: 1, // different from the chosen level 2
      prevCommit: { centre: FOOTPRINT.centre, span: FOOTPRINT.span },
      prevLod: { kind: "all" },
      ladder: [],
      lodMode: "auto",
      selectedLod: null,
    });
    expect(plan.kind).toBe("commit");
    if (plan.kind !== "commit") throw new Error("expected commit");
    expect(plan.isSwap).toBe(true);
    expect([...plan.toFetch].sort()).toEqual([...DESIRED_16].sort());
  });

  it("commits as a SWAP when only the LoD changed at the same level", () => {
    const cache = newCache();
    for (const k of DESIRED_16)
      cache.set(k, fakeEntry(k), { triangles: 1, bytes: 1 });
    const ladder = ["0", "1", "2"]; // cellSize(grid,2)=225 -> middle band -> ladder[1]="1"
    const plan = planCommit({
      footprint: FOOTPRINT,
      probeCount: 0,
      grid: GRID,
      cache,
      prevLevel: 2, // SAME level
      prevCommit: { centre: FOOTPRINT.centre, span: FOOTPRINT.span },
      prevLod: { kind: "exact", lod: "0" }, // different from the resolved "1"
      ladder,
      lodMode: "auto",
      selectedLod: null,
    });
    expect(plan.kind).toBe("commit");
    if (plan.kind !== "commit") throw new Error("expected commit");
    expect(plan.lod).toEqual({ kind: "exact", lod: "1" });
    expect(plan.isSwap).toBe(true);
    expect([...plan.toFetch].sort()).toEqual([...DESIRED_16].sort());
  });

  it("commits (not a swap) with an EMPTY toFetch when hysteresis alone triggers a refresh of an already fully-covered view", () => {
    const cache = newCache();
    for (const k of DESIRED_16)
      cache.set(k, fakeEntry(k), { triangles: 1, bytes: 1 });
    const plan = planCommit({
      footprint: FOOTPRINT, // centre [337.5, 337.5], span 675
      probeCount: 0,
      grid: GRID,
      cache,
      prevLevel: 2,
      prevCommit: { centre: [0, 0], span: 675 }, // moved = hypot(337.5,337.5)=477.3 > 675*0.2=135
      prevLod: { kind: "all" },
      ladder: [],
      lodMode: "auto",
      selectedLod: null,
    });
    expect(plan.kind).toBe("commit");
    if (plan.kind !== "commit") throw new Error("expected commit");
    expect(plan.isSwap).toBe(false);
    expect(plan.toFetch).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
describe("commitNormal", () => {
  it("touches every desired cell (protecting it from LRU eviction) before evicting to budget", () => {
    const cache = new CellCache<CellEntry>({
      maxTriangles: 100,
      maxBytes: Infinity,
    });
    cache.set("resident", fakeEntry("resident"), { triangles: 60, bytes: 0 }); // lastSeen 1
    cache.set("stale", fakeEntry("stale"), { triangles: 60, bytes: 0 }); // lastSeen 2, total 120 > 100
    const evicted = commitNormal(cache, ["resident"], new Map());
    expect(evicted).toEqual(["stale"]);
    expect(cache.has("resident")).toBe(true);
  });

  it("inserts newly fetched cells and leaves off-screen (non-desired) cells untouched — never calls retain()", () => {
    const cache = newCache();
    cache.set("off-screen", fakeEntry("off"), { triangles: 1, bytes: 1 });
    const fetched = new Map([
      [
        "new-cell",
        { entry: fakeEntry("new"), stats: { triangles: 1, bytes: 1 } },
      ],
    ]);
    const evicted = commitNormal(cache, ["new-cell"], fetched);
    expect(evicted).toEqual([]);
    expect(cache.has("off-screen")).toBe(true);
    expect(cache.get("new-cell")).toEqual(fetched.get("new-cell")!.entry);
  });
});

describe("commitSwap", () => {
  it("inserts the new cover's cells then retain()s, dropping everything outside it", () => {
    const cache = newCache();
    cache.set("old/A", fakeEntry("A"), { triangles: 1, bytes: 1 });
    cache.set("old/B", fakeEntry("B"), { triangles: 1, bytes: 1 });
    const fetched = new Map([
      [
        "new/A",
        { entry: fakeEntry("newA"), stats: { triangles: 1, bytes: 1 } },
      ],
    ]);
    const evicted = commitSwap(cache, ["new/A"], fetched);
    expect([...evicted].sort()).toEqual(["old/A", "old/B"]);
    expect(cache.has("old/A")).toBe(false);
    expect(cache.has("old/B")).toBe(false);
    expect(cache.has("new/A")).toBe(true);
  });
});

// ---------------------------------------------------------------------
describe("createSettleController", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("calls onFirstChange synchronously on the first change of a burst, not onSettle", () => {
    const onFirstChange = vi.fn();
    const onSettle = vi.fn();
    const c = createSettleController({
      settleMs: 100,
      onFirstChange,
      onSettle,
    });
    c.onChange();
    expect(onFirstChange).toHaveBeenCalledTimes(1);
    expect(onSettle).not.toHaveBeenCalled();
  });

  it("does not call onFirstChange again for subsequent changes in the same burst", () => {
    const onFirstChange = vi.fn();
    const c = createSettleController({
      settleMs: 100,
      onFirstChange,
      onSettle: vi.fn(),
    });
    c.onChange();
    c.onChange();
    c.onChange();
    expect(onFirstChange).toHaveBeenCalledTimes(1);
  });

  it("fires onSettle once, settleMs after the LAST change (debounce), not the first", () => {
    const onSettle = vi.fn();
    const c = createSettleController({
      settleMs: 100,
      onFirstChange: vi.fn(),
      onSettle,
    });
    c.onChange();
    vi.advanceTimersByTime(60);
    c.onChange(); // resets the timer
    vi.advanceTimersByTime(60); // 120ms since the 1st change, only 60ms since the 2nd
    expect(onSettle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(40); // now 100ms since the 2nd (last) change
    expect(onSettle).toHaveBeenCalledTimes(1);
  });

  it("treats the change after a settle as the start of a new burst", () => {
    const onFirstChange = vi.fn();
    const c = createSettleController({
      settleMs: 100,
      onFirstChange,
      onSettle: vi.fn(),
    });
    c.onChange();
    vi.advanceTimersByTime(100);
    expect(onFirstChange).toHaveBeenCalledTimes(1);
    c.onChange();
    expect(onFirstChange).toHaveBeenCalledTimes(2);
  });

  it("dispose cancels a pending timer — onSettle never fires", () => {
    const onSettle = vi.fn();
    const c = createSettleController({
      settleMs: 100,
      onFirstChange: vi.fn(),
      onSettle,
    });
    c.onChange();
    c.dispose();
    vi.advanceTimersByTime(500);
    expect(onSettle).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------
// useTileStreaming — the hook itself. Two things are proven here without a
// live camera: (1) it subscribes/unsubscribes to the controls' `change`
// event (the trigger contract), and (2) end-to-end with a REAL top-down
// PerspectiveCamera and a fake WorkerClient, firing `change` a few times and
// waiting past SETTLE_MS drives the whole pipeline through to a store
// update. Real timers are used here (not fake) because this test also
// awaits real Promises from the fake WorkerClient methods, and mixing fake
// timers with unflushed microtasks is a known source of flakiness this repo
// has no existing pattern for.
// ---------------------------------------------------------------------

function makeFakeClient() {
  let epoch = 0;
  const sendCalls: Array<Record<string, unknown>> = [];
  const sendStreamingCalls: Array<Record<string, unknown>> = [];
  const client = {
    newEpoch: vi.fn(() => ++epoch),
    isCurrent: vi.fn((e: number) => e === epoch),
    send: vi.fn(async (msg: Record<string, unknown>) => {
      sendCalls.push(msg);
      if (msg.type === "probe") {
        return { type: "probed", id: 0, count: 5 } satisfies WorkerResponse;
      }
      return { type: "done", id: 0 } satisfies WorkerResponse;
    }),
    sendStreaming: vi.fn(
      async (
        msg: Record<string, unknown>,
        onMessage: (r: WorkerResponse) => void,
      ) => {
        sendStreamingCalls.push(msg);
        // Returns exactly the requested cells, mirroring the worker's real
        // "cell per requested key, then done" streaming contract.
        for (const key of msg.cells as string[]) {
          onMessage({
            type: "cell",
            id: 0,
            key,
            geometry: geom(1),
            objects: [],
            surfaceAttrKeys: [],
            lodsSeen: [],
          });
        }
        onMessage({ type: "done", id: 0 });
      },
    ),
    terminate: vi.fn(),
  };
  return {
    client: client as unknown as WorkerClient,
    sendCalls,
    sendStreamingCalls,
    getEpoch: () => epoch,
  };
}

const HEADER: FcbHeaderModel = {
  version: "1.0",
  featuresCount: 100,
  extent: [-500, -500, 0, 500, 500, 50],
  referenceSystem: "https://www.opengis.net/def/crs/EPSG/0/28992",
  epsg: 28992,
};

// Grid sized generously around the real top-down camera footprint's
// analytically-estimated span (~800m x ~470m at 50deg fov, height 500) so
// SOME level lands in [MIN_COVER_CELLS, MAX_COVER_CELLS] regardless of
// small fixture-to-fixture drift; unlike the planCommit fixtures above,
// this test is about the WIRING, not a literal level number.
const INTEGRATION_GRID: Grid = {
  originX: -5000,
  originY: -5000,
  rootCell: 10000,
  maxLevel: 8,
};

describe("useTileStreaming", () => {
  beforeEach(() => {
    useLayerStore.getState().removeAllLayers();
    useStreamStore.setState({ streams: {} });
    fakeCamera = new PerspectiveCamera(50, 16 / 9, 1, 50000);
    fakeCamera.position.set(0, 500, 0);
    fakeCamera.up.set(0, 0, -1);
    fakeCamera.lookAt(0, 0, 0);
    fakeCamera.updateMatrixWorld(true);
    fakeCamera.updateProjectionMatrix();
    fakeControls = new FakeControls();
  });

  afterEach(() => {
    cleanup();
  });

  it("subscribes to controls' change event on mount and unsubscribes on unmount", () => {
    const { unmount } = renderHook(() =>
      useTileStreaming({ current: [0, 0, 0] }, 0),
    );
    expect(fakeControls.listenerCount("change")).toBe(1);
    unmount();
    expect(fakeControls.listenerCount("change")).toBe(0);
  });

  it("does nothing when no layer is streaming (documented baseline: nothing sets isStreaming=true yet)", async () => {
    renderHook(() => useTileStreaming({ current: [0, 0, 0] }, 0));
    fakeControls.fire("change");
    await new Promise((r) => setTimeout(r, SETTLE_MS + 100));
    // no assertion target exists (no streaming layer) — the point is that
    // this does not throw and leaves no stream state behind.
    expect(Object.keys(useStreamStore.getState().streams)).toHaveLength(0);
  });

  it("end-to-end: first change aborts (cancel + newEpoch), settling after SETTLE_MS runs the pipeline and commits cells to the store", async () => {
    const layerId = useLayerStore.getState().addLayer({
      name: "s.fcb",
      model: {
        sourceEncoding: "flatcitybuf",
        metadata: {},
        bbox: null,
        objects: {},
        vertexCount: 0,
      },
      modelRef: { type: "url", url: "https://x/s.fcb" },
      visible: true,
      rules: [],
      rulesEnabled: true,
    });
    useLayerStore.setState((s) => ({
      layers: s.layers.map((l) =>
        l.id === layerId ? { ...l, isStreaming: true } : l,
      ),
    }));

    const { client, sendCalls, sendStreamingCalls, getEpoch } =
      makeFakeClient();

    useStreamStore.getState().register(layerId, {
      client,
      grid: INTEGRATION_GRID,
      header: HEADER,
      cache: new CellCache<CellEntry>({
        maxTriangles: Infinity,
        maxBytes: Infinity,
      }),
      level: null,
      ladder: [],
      ladderVersion: 0,
      status: "idle",
      message: null,
      lastCommit: null,
      version: 0,
    });

    renderHook(() => useTileStreaming({ current: [0, 0, 0] }, 0));

    fakeControls.fire("change");
    fakeControls.fire("change"); // simulate damping-decay repeats

    // First-change abort must be synchronous, not waiting for settle.
    expect(sendCalls.some((m) => m.type === "cancel")).toBe(true);
    const epochAfterFirstChange = getEpoch();
    expect(epochAfterFirstChange).toBeGreaterThan(0);

    await new Promise((r) => setTimeout(r, SETTLE_MS + 200));

    // The probe must have run before any fetch.
    expect(sendCalls.some((m) => m.type === "probe")).toBe(true);
    expect(sendStreamingCalls.length).toBe(1);
    const fetchMsg = sendStreamingCalls[0]!;
    expect(fetchMsg.type).toBe("fetch");
    const desired = fetchMsg.cells as string[];
    expect(desired.length).toBeGreaterThanOrEqual(9); // MIN_COVER_CELLS

    const stream = useStreamStore.getState().get(layerId)!;
    expect(stream.level).not.toBeNull();
    expect(stream.lastCommit).not.toBeNull();
    expect(stream.version).toBeGreaterThan(0);
    expect(stream.cache.keys().length).toBe(desired.length);
  }, 10000);

  // -------------------------------------------------------------------
  // Origin/groundY sharing (Task 17, item B): useTileStreaming must use the
  // CALLER-supplied sceneOriginRef/groundY, not recompute its own per-layer
  // values — otherwise a streaming layer's footprint math disagrees with
  // where CitySceneR3F actually places its cell meshes (the shared-origin
  // scene design's whole point).
  // -------------------------------------------------------------------

  function registerStreamingLayerForOriginTest() {
    const layerId = useLayerStore.getState().addLayer({
      name: "s.fcb",
      model: {
        sourceEncoding: "flatcitybuf",
        metadata: {},
        bbox: null,
        objects: {},
        vertexCount: 0,
      },
      modelRef: { type: "url", url: "https://x/s.fcb" },
      visible: true,
      rules: [],
      rulesEnabled: true,
    });
    useLayerStore.setState((s) => ({
      layers: s.layers.map((l) =>
        l.id === layerId ? { ...l, isStreaming: true } : l,
      ),
    }));
    const fake = makeFakeClient();
    useStreamStore.getState().register(layerId, {
      client: fake.client,
      grid: INTEGRATION_GRID,
      header: HEADER,
      cache: new CellCache<CellEntry>({
        maxTriangles: Infinity,
        maxBytes: Infinity,
      }),
      level: null,
      ladder: [],
      ladderVersion: 0,
      status: "idle",
      message: null,
      lastCommit: null,
      version: 0,
    });
    return { layerId, ...fake };
  }

  it("uses the caller's sceneOriginRef, not a hardcoded [0,0,0], when computing the footprint", async () => {
    const { layerId } = registerStreamingLayerForOriginTest();
    const originRef: { current: Vec3 | null } = { current: [1000, 2000, 0] };

    renderHook(() => useTileStreaming(originRef, 0));
    fakeControls.fire("change");
    await new Promise((r) => setTimeout(r, SETTLE_MS + 200));

    const stream = useStreamStore.getState().get(layerId)!;
    expect(stream.lastCommit).not.toBeNull();
    // Camera looks straight down at scene-space (0,0,0); sceneToSource adds
    // the origin back, so the source-CRS footprint centre should land near
    // the origin itself, not near [0, 0].
    expect(stream.lastCommit!.centre[0]).toBeCloseTo(1000, 0);
    expect(stream.lastCommit!.centre[1]).toBeCloseTo(2000, 0);
  }, 10000);

  it("falls back to [0,0,0] when sceneOriginRef.current is null (no layer has established the shared origin yet)", async () => {
    const { layerId } = registerStreamingLayerForOriginTest();
    const originRef: { current: Vec3 | null } = { current: null };

    renderHook(() => useTileStreaming(originRef, 0));
    fakeControls.fire("change");
    await new Promise((r) => setTimeout(r, SETTLE_MS + 200));

    const stream = useStreamStore.getState().get(layerId)!;
    expect(stream.lastCommit).not.toBeNull();
    expect(stream.lastCommit!.centre[0]).toBeCloseTo(0, 0);
    expect(stream.lastCommit!.centre[1]).toBeCloseTo(0, 0);
  }, 10000);

  it("uses the caller's groundY, not a hardcoded 0 — a higher groundY shrinks the footprint span (ray travels less far)", async () => {
    const atGroundZero = registerStreamingLayerForOriginTest();
    renderHook(() => useTileStreaming({ current: [0, 0, 0] }, 0));
    fakeControls.fire("change");
    await new Promise((r) => setTimeout(r, SETTLE_MS + 200));
    const spanAtZero = useStreamStore.getState().get(atGroundZero.layerId)!
      .lastCommit!.span;

    cleanup();
    fakeControls = new FakeControls();
    const atGroundHigh = registerStreamingLayerForOriginTest();
    renderHook(() => useTileStreaming({ current: [0, 0, 0] }, 250));
    fakeControls.fire("change");
    await new Promise((r) => setTimeout(r, SETTLE_MS + 200));
    const spanAtHigh = useStreamStore.getState().get(atGroundHigh.layerId)!
      .lastCommit!.span;

    // eye.y=500: distance-to-ground halves from 500 to 250, so the footprint
    // (proportional to distance for a straight-down camera) should shrink
    // by roughly the same factor.
    expect(spanAtHigh).toBeLessThan(spanAtZero * 0.6);
  }, 15000);

  // -------------------------------------------------------------------
  // Teardown safety (Task 17): terminate() now REJECTS in-flight
  // send()/sendStreaming() calls (workerClient.ts) instead of hanging them
  // forever. commitStreamingLayer must not turn that into an unhandled
  // promise rejection, and must not resurrect a status entry for a layer
  // whose stream was already unregistered by the same teardown.
  // -------------------------------------------------------------------

  it("a worker rejection mid-commit (e.g. terminate() racing a layer removal) sets status:error rather than throwing unhandled, IF the stream is still registered", async () => {
    const layerId = useLayerStore.getState().addLayer({
      name: "s.fcb",
      model: {
        sourceEncoding: "flatcitybuf",
        metadata: {},
        bbox: null,
        objects: {},
        vertexCount: 0,
      },
      modelRef: { type: "url", url: "https://x/s.fcb" },
      visible: true,
      rules: [],
      rulesEnabled: true,
    });
    useLayerStore.setState((s) => ({
      layers: s.layers.map((l) =>
        l.id === layerId ? { ...l, isStreaming: true } : l,
      ),
    }));

    let epoch = 0;
    const client = {
      newEpoch: vi.fn(() => ++epoch),
      isCurrent: vi.fn((e: number) => e === epoch),
      send: vi.fn(() => Promise.reject(new Error("WorkerClient terminated"))),
      sendStreaming: vi.fn(async () => {}),
      terminate: vi.fn(),
    };
    useStreamStore.getState().register(layerId, {
      client: client as unknown as WorkerClient,
      grid: INTEGRATION_GRID,
      header: HEADER,
      cache: new CellCache<CellEntry>({
        maxTriangles: Infinity,
        maxBytes: Infinity,
      }),
      level: null,
      ladder: [],
      ladderVersion: 0,
      status: "idle",
      message: null,
      lastCommit: null,
      version: 0,
    });

    renderHook(() => useTileStreaming({ current: [0, 0, 0] }, 0));
    fakeControls.fire("change");
    // If this rejection weren't caught, it would surface as an unhandled
    // promise rejection — vitest fails the run on those, so simply reaching
    // this point without the test process erroring is part of the proof.
    await new Promise((r) => setTimeout(r, SETTLE_MS + 100));

    const stream = useStreamStore.getState().get(layerId)!;
    expect(stream.status).toBe("error");
    expect(stream.message).toMatch(/terminated/i);
  }, 10000);

  it("does NOT resurrect a status entry when the stream was unregistered before the rejection arrives", async () => {
    const layerId = useLayerStore.getState().addLayer({
      name: "s.fcb",
      model: {
        sourceEncoding: "flatcitybuf",
        metadata: {},
        bbox: null,
        objects: {},
        vertexCount: 0,
      },
      modelRef: { type: "url", url: "https://x/s.fcb" },
      visible: true,
      rules: [],
      rulesEnabled: true,
    });
    useLayerStore.setState((s) => ({
      layers: s.layers.map((l) =>
        l.id === layerId ? { ...l, isStreaming: true } : l,
      ),
    }));

    let epoch = 0;
    let rejectProbe: ((e: Error) => void) | null = null;
    const client = {
      newEpoch: vi.fn(() => ++epoch),
      isCurrent: vi.fn((e: number) => e === epoch),
      send: vi.fn(
        () =>
          new Promise<never>((_, reject) => {
            rejectProbe = reject;
          }),
      ),
      sendStreaming: vi.fn(async () => {}),
      terminate: vi.fn(),
    };
    useStreamStore.getState().register(layerId, {
      client: client as unknown as WorkerClient,
      grid: INTEGRATION_GRID,
      header: HEADER,
      cache: new CellCache<CellEntry>({
        maxTriangles: Infinity,
        maxBytes: Infinity,
      }),
      level: null,
      ladder: [],
      ladderVersion: 0,
      status: "idle",
      message: null,
      lastCommit: null,
      version: 0,
    });

    renderHook(() => useTileStreaming({ current: [0, 0, 0] }, 0));
    fakeControls.fire("change");
    await new Promise((r) => setTimeout(r, SETTLE_MS + 100));
    expect(rejectProbe).not.toBeNull();

    // Simulate the SAME teardown commitStreamingLayer's caller performs on
    // layer removal: unregister the stream before the pending promise ever
    // settles.
    useStreamStore.getState().unregister(layerId);
    rejectProbe!(new Error("WorkerClient terminated"));
    await new Promise((r) => setTimeout(r, 20));

    expect(useStreamStore.getState().get(layerId)).toBeUndefined();
  }, 10000);

  // -------------------------------------------------------------------
  // React StrictMode double-invoke safety (Task 17): effects mount →
  // cleanup → mount once in dev/StrictMode. The subscribe/unsubscribe
  // effect must leave exactly one listener attached and must not run the
  // settle pipeline twice for one settled interaction.
  // -------------------------------------------------------------------

  it("is safe under React StrictMode's mount→cleanup→mount: exactly one listener survives, one commit runs per settle", async () => {
    const { layerId, sendStreamingCalls } =
      registerStreamingLayerForOriginTest();

    const { unmount } = renderHook(
      () => useTileStreaming({ current: [0, 0, 0] }, 0),
      { wrapper: StrictMode },
    );
    expect(fakeControls.listenerCount("change")).toBe(1);

    fakeControls.fire("change");
    await new Promise((r) => setTimeout(r, SETTLE_MS + 200));

    expect(sendStreamingCalls.length).toBe(1);
    const stream = useStreamStore.getState().get(layerId)!;
    expect(stream.version).toBe(1);

    unmount();
    expect(fakeControls.listenerCount("change")).toBe(0);
  }, 10000);

  it("discards a stale commit's result when a new interaction starts before the probe response arrives (epoch guard)", async () => {
    const layerId = useLayerStore.getState().addLayer({
      name: "s.fcb",
      model: {
        sourceEncoding: "flatcitybuf",
        metadata: {},
        bbox: null,
        objects: {},
        vertexCount: 0,
      },
      modelRef: { type: "url", url: "https://x/s.fcb" },
      visible: true,
      rules: [],
      rulesEnabled: true,
    });
    useLayerStore.setState((s) => ({
      layers: s.layers.map((l) =>
        l.id === layerId ? { ...l, isStreaming: true } : l,
      ),
    }));

    let epoch = 0;
    let resolveProbe: ((r: WorkerResponse) => void) | null = null;
    const client = {
      newEpoch: vi.fn(() => ++epoch),
      isCurrent: vi.fn((e: number) => e === epoch),
      send: vi.fn((msg: Record<string, unknown>) => {
        if (msg.type === "probe") {
          // Deliberately never resolves until the test does it manually —
          // simulates a probe response that arrives AFTER a new
          // interaction has already superseded it.
          return new Promise<WorkerResponse>((resolve) => {
            resolveProbe = resolve;
          });
        }
        return Promise.resolve({
          type: "done",
          id: 0,
        } satisfies WorkerResponse);
      }),
      sendStreaming: vi.fn(async () => {}),
      terminate: vi.fn(),
    };

    useStreamStore.getState().register(layerId, {
      client: client as unknown as WorkerClient,
      grid: INTEGRATION_GRID,
      header: HEADER,
      cache: new CellCache<CellEntry>({
        maxTriangles: Infinity,
        maxBytes: Infinity,
      }),
      level: null,
      ladder: [],
      ladderVersion: 0,
      status: "idle",
      message: null,
      lastCommit: null,
      version: 0,
    });

    renderHook(() => useTileStreaming({ current: [0, 0, 0] }, 0));

    fakeControls.fire("change");
    await new Promise((r) => setTimeout(r, SETTLE_MS + 100));

    // The settled commit reached the probe call and is now stuck awaiting
    // it — this is the "in-flight work" the epoch guard exists for.
    expect(resolveProbe).not.toBeNull();
    const epochWhileProbePending = epoch;

    // A NEW interaction starts before that probe resolves.
    fakeControls.fire("change");
    expect(epoch).toBeGreaterThan(epochWhileProbePending);

    // Now the STALE probe response finally arrives.
    resolveProbe!({ type: "probed", id: 0, count: 1 });
    await new Promise((r) => setTimeout(r, 20));

    // It must have been discarded: no fetch was ever issued from it, and
    // the store's level (which only a completed commit sets) stays null.
    expect(client.sendStreaming).not.toHaveBeenCalled();
    expect(useStreamStore.getState().get(layerId)!.level).toBeNull();
  }, 10000);

  it("on a level swap, a LEVEL_SWAP_TIMEOUT_MS timeout discards the partial new cover and leaves the old level's cache untouched", async () => {
    const layerId = useLayerStore.getState().addLayer({
      name: "s.fcb",
      model: {
        sourceEncoding: "flatcitybuf",
        metadata: {},
        bbox: null,
        objects: {},
        vertexCount: 0,
      },
      modelRef: { type: "url", url: "https://x/s.fcb" },
      visible: true,
      rules: [],
      rulesEnabled: true,
    });
    useLayerStore.setState((s) => ({
      layers: s.layers.map((l) =>
        l.id === layerId ? { ...l, isStreaming: true } : l,
      ),
    }));

    const cache = new CellCache<CellEntry>({
      maxTriangles: Infinity,
      maxBytes: Infinity,
    });
    // A cell resident under a DIFFERENT (stale) level than whatever the
    // real camera footprint will resolve to below — its presence AND its
    // key (level 999 can never be chosen by chooseLevel) forces this
    // commit down the level-SWAP path, not the normal-commit path.
    cache.set("999/0/0", fakeEntry("old-level-cell"), {
      triangles: 1,
      bytes: 1,
    });

    let epoch = 0;
    const client = {
      newEpoch: vi.fn(() => ++epoch),
      isCurrent: vi.fn((e: number) => e === epoch),
      send: vi.fn(async (msg: Record<string, unknown>) => {
        if (msg.type === "probe") {
          return { type: "probed", id: 0, count: 5 } satisfies WorkerResponse;
        }
        return { type: "done", id: 0 } satisfies WorkerResponse;
      }),
      // Never resolves and never calls onMessage — simulates a fetch that
      // is still in flight when LEVEL_SWAP_TIMEOUT_MS elapses.
      sendStreaming: vi.fn(() => new Promise<void>(() => {})),
      terminate: vi.fn(),
    };

    useStreamStore.getState().register(layerId, {
      client: client as unknown as WorkerClient,
      grid: INTEGRATION_GRID,
      header: HEADER,
      cache,
      level: 999, // stale level -> the real footprint's chosen level differs -> isSwap
      ladder: [],
      ladderVersion: 0,
      status: "idle",
      message: null,
      lastCommit: null,
      version: 0,
    });

    renderHook(() => useTileStreaming({ current: [0, 0, 0] }, 0));
    fakeControls.fire("change");

    await new Promise((r) =>
      setTimeout(r, SETTLE_MS + LEVEL_SWAP_TIMEOUT_MS + 300),
    );

    const stream = useStreamStore.getState().get(layerId)!;
    // The old level and its cache entry must be untouched: no retain()
    // happened, no level bump happened.
    expect(stream.level).toBe(999);
    expect(stream.cache.has("999/0/0")).toBe(true);
    expect(stream.status).toBe("error");
  }, 10000);
});
