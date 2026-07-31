/**
 * Regression coverage for the two-level layer/cell scene map introduced to
 * support streaming layers (Task 13 of the fcb-viewport-streaming plan).
 *
 * `tests/integration/loadToInspect.test.ts` and `loadCityJSONSeq.test.ts`
 * exercise `resolveSelection`/`highlightMesh` directly — they never import
 * `CitySceneR3F.tsx` and so cover NONE of the call sites rewritten here
 * (cleanup, visibility, triangle count, rule colors, cursor conversion, box
 * select, picking). Every describe block below targets one of those sites
 * directly, using real `three` objects (no React/R3F render needed) so the
 * production functions (extracted from the component for testability) run
 * unmodified.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
} from "three";
import {
  applyVisibility,
  buildCellMesh,
  computeBoxSelection,
  computeTriangleCount,
  disposeLayerState,
  reapplyHighlight,
  recolorStreamingCells,
  resolveFromEvent,
  resolveMeshOwner,
  sceneToCrsImpl,
  syncStreamingCells,
  teardownRemovedLayer,
  updateRuleColors,
  type CellSceneState,
  type LayerSceneState,
} from "../../../src/scene/CitySceneR3F";
import type { PickingIndex } from "../../../src/scene/buildCityMesh";
import type {
  BBox3,
  CityModel,
  CityObject,
  Surface,
  Vec3,
} from "../../../src/domain/citymodel/types";
import type { Layer } from "../../../src/features/layers/layerStore";
import type { Rule } from "../../../src/features/rules/types";
import { useSelectionStore } from "../../../src/features/selection/selectionStore";
import {
  cellCentre,
  makeGrid,
  meshOffset,
  type Grid,
} from "../../../src/features/streaming/tileGrid";
import { sourceToScene } from "../../../src/features/streaming/sceneTransform";
import { useStreamStore } from "../../../src/features/streaming/streamStore";
import type {
  CellEntry,
  StreamState,
} from "../../../src/features/streaming/streamStore";
import { CellCache } from "../../../src/features/streaming/cellCache";
import { __resetMemo } from "../../../src/features/streaming/residentModel";
import type {
  CellGeometry,
  ResidentObjectRecord,
  WorkerResponse,
} from "../../../src/features/streaming/workerProtocol";
import type { WorkerClient } from "../../../src/features/streaming/workerClient";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeGeometry(
  objectIndices: number[],
  surfaceIndices: number[],
): BufferGeometry {
  const vertexCount = objectIndices.length;
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(vertexCount * 3), 3),
  );
  geometry.setAttribute(
    "color",
    new BufferAttribute(new Float32Array(vertexCount * 3), 3),
  );
  geometry.setAttribute(
    "objectIndex",
    new BufferAttribute(new Int32Array(objectIndices), 1),
  );
  geometry.setAttribute(
    "surfaceIndex",
    new BufferAttribute(new Int32Array(surfaceIndices), 1),
  );
  return geometry;
}

function makeMesh(
  layerId: string,
  objectKeys: string[],
  objectIndices: number[],
  surfaceIndices: number[],
  cellKey?: string,
): { mesh: Mesh; pickingIndex: PickingIndex; baseColors: Float32Array } {
  const geometry = makeGeometry(objectIndices, surfaceIndices);
  const mesh = new Mesh(geometry, new MeshBasicMaterial());
  mesh.userData.layerId = layerId;
  if (cellKey !== undefined) mesh.userData.cellKey = cellKey;
  const pickingIndex: PickingIndex = { layerId, objectKeys };
  const baseColors = Float32Array.from(
    geometry.getAttribute("color").array as Float32Array,
  );
  return { mesh, pickingIndex, baseColors };
}

function makeCellState(
  layerId: string,
  cellKey: string,
  objectKeys: string[],
  objectIndices: number[],
  surfaceIndices: number[],
  sourceEntry: CellEntry = makeCellEntry(),
): CellSceneState {
  const { mesh, pickingIndex, baseColors } = makeMesh(
    layerId,
    objectKeys,
    objectIndices,
    surfaceIndices,
    cellKey,
  );
  return { mesh, pickingIndex, baseColors, ruleColors: null, sourceEntry };
}

function makeLayerState(
  layerId: string,
  objectKeys: string[],
  objectIndices: number[],
  surfaceIndices: number[],
  originOffset: Vec3 = [0, 0, 0],
): LayerSceneState {
  const { mesh, pickingIndex, baseColors } = makeMesh(
    layerId,
    objectKeys,
    objectIndices,
    surfaceIndices,
  );
  return {
    mesh,
    pickingIndex,
    baseColors,
    ruleColors: null,
    selectedLod: null,
    originOffset,
    cells: new Map(),
  };
}

function makeStreamingLayerState(
  originOffset: Vec3 = [0, 0, 0],
): LayerSceneState {
  return {
    mesh: null,
    pickingIndex: null,
    baseColors: null,
    ruleColors: null,
    selectedLod: null,
    originOffset,
    cells: new Map(),
  };
}

/** A minimal, internally-consistent CellGeometry (1 triangle, 3 vertices),
 *  with a distinct fill per array so a copy-paste field-swap bug would be
 *  visible in an assertion, following the established fixture convention in
 *  workerClient.test.ts/useTileStreaming.test.ts. */
function makeCellGeometry(overrides: Partial<CellGeometry> = {}): CellGeometry {
  return {
    positions: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    baseColors: new Float32Array([0.1, 0.2, 0.3, 0.1, 0.2, 0.3, 0.1, 0.2, 0.3]),
    ruleColors: null,
    objectIndices: new Uint32Array([0, 0, 0]),
    surfaceIndices: new Uint32Array([0, 0, 0]),
    objectKeys: ["obj-a"],
    triangleCount: 1,
    ...overrides,
  };
}

function makeCellEntry(overrides: Partial<CellEntry> = {}): CellEntry {
  return {
    geometry: makeCellGeometry(),
    objects: [],
    surfaceAttrKeys: [],
    lodsSeen: [],
    builtWithRulesEnabled: false,
    builtWithRules: [],
    ...overrides,
  };
}

function makeResidentRecord(id: string, bbox: BBox3): ResidentObjectRecord {
  return {
    id,
    objectType: "Building",
    attributes: {},
    bbox,
    lod: "2",
    surfaceCount: 1,
    roofMetrics: [],
    footprintAreaSqM: 0,
    volumeCuM: null,
    parents: [],
    children: [],
  };
}

const fakeClient = {} as unknown as WorkerClient;

function makeSurface(
  type: Surface["type"],
  attributes: Record<string, unknown> = {},
): Surface {
  return {
    type,
    rings: [
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ],
    ],
    attributes,
    lod: "2",
  };
}

function makeObject(
  id: string,
  surfaces: Surface[],
  bbox: BBox3 | null = null,
): CityObject {
  return {
    id,
    objectType: "Building",
    attributes: {},
    surfaces,
    bbox,
    children: [],
    parents: [],
    lod: "2",
  };
}

function makeModel(objects: Record<string, CityObject>): CityModel {
  return {
    sourceEncoding: "cityjson",
    metadata: {},
    bbox: null,
    objects,
    vertexCount: 0,
  };
}

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "r1",
    name: "r1",
    color: "#ff0000",
    conditions: [],
    logic: "AND",
    enabled: true,
    ...overrides,
  };
}

function makeLayer(
  overrides: Partial<Layer> & { id: string; model: CityModel },
): Layer {
  return {
    name: "layer",
    modelRef: { type: "file", fileName: "test.city.json" },
    visible: true,
    rules: [],
    rulesEnabled: false,
    selectedLod: null,
    availableLods: [],
    lodMode: "auto",
    isStreaming: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// resolveMeshOwner — required by the task brief verbatim
// ---------------------------------------------------------------------------

describe("resolveMeshOwner", () => {
  it("resolves a static layer mesh", () => {
    const m = new Mesh();
    m.userData.layerId = "L";
    expect(resolveMeshOwner(m)).toEqual({ layerId: "L", cellKey: undefined });
  });

  it("resolves a streaming cell mesh to both ids", () => {
    const m = new Mesh();
    m.userData.layerId = "L";
    m.userData.cellKey = "2/1/0";
    expect(resolveMeshOwner(m)).toEqual({ layerId: "L", cellKey: "2/1/0" });
  });

  it("returns null for a mesh with no layer", () => {
    expect(resolveMeshOwner(new Mesh())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// :409 cleanup — disposeLayerState
// ---------------------------------------------------------------------------

describe("disposeLayerState", () => {
  it("removes and disposes the layer mesh AND every cell mesh, then clears cells", () => {
    const group = new Group();
    const state = makeLayerState("L", ["a"], [0, 0, 0], [0, 0, 0]);
    const cell = makeCellState("L", "0/0/0", ["b"], [0, 0, 0], [0, 0, 0]);
    state.cells.set("0/0/0", cell);

    group.add(state.mesh!);
    group.add(cell.mesh);

    const layerGeomDispose = vi.spyOn(state.mesh!.geometry, "dispose");
    const cellGeomDispose = vi.spyOn(cell.mesh.geometry, "dispose");
    const layerMatDispose = vi.spyOn(
      state.mesh!.material as MeshBasicMaterial,
      "dispose",
    );
    const cellMatDispose = vi.spyOn(
      cell.mesh.material as MeshBasicMaterial,
      "dispose",
    );

    disposeLayerState(group, state);

    expect(group.children).toHaveLength(0);
    expect(layerGeomDispose).toHaveBeenCalledTimes(1);
    expect(cellGeomDispose).toHaveBeenCalledTimes(1);
    expect(layerMatDispose).toHaveBeenCalledTimes(1);
    expect(cellMatDispose).toHaveBeenCalledTimes(1);
    expect(state.cells.size).toBe(0);
  });

  it("disposes only cell meshes when the layer mesh is null (streaming layer)", () => {
    const group = new Group();
    const state = makeStreamingLayerState();
    const cell = makeCellState("L", "0/0/0", ["b"], [0, 0, 0], [0, 0, 0]);
    state.cells.set("0/0/0", cell);
    group.add(cell.mesh);

    const cellGeomDispose = vi.spyOn(cell.mesh.geometry, "dispose");

    expect(() => disposeLayerState(group, state)).not.toThrow();
    expect(group.children).toHaveLength(0);
    expect(cellGeomDispose).toHaveBeenCalledTimes(1);
    expect(state.cells.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// teardownRemovedLayer — the worker/StreamState teardown on layer removal
// (Task 17). Nothing else in the app calls this on `removeLayer`; without
// it a removed streaming layer's worker thread and cache leak for the
// lifetime of the tab.
// ---------------------------------------------------------------------------

describe("teardownRemovedLayer", () => {
  afterEach(() => {
    useStreamStore.setState({ streams: {} });
  });

  it("disposes the GPU state (delegates to disposeLayerState)", () => {
    const group = new Group();
    const state = makeLayerState("L", ["a"], [0, 0, 0], [0, 0, 0]);
    group.add(state.mesh!);

    teardownRemovedLayer(group, state, "L");

    expect(group.children).toHaveLength(0);
  });

  it("terminates the worker and unregisters the stream for a streaming layer", () => {
    const group = new Group();
    const state = makeStreamingLayerState();
    const terminate = vi.fn();
    useStreamStore.getState().register("L", {
      client: { terminate } as unknown as WorkerClient,
      grid: { originX: 0, originY: 0, rootCell: 100, maxLevel: 1 },
      header: {
        version: "1.0",
        featuresCount: 1,
        extent: [0, 0, 0, 100, 100, 10],
        referenceSystem: undefined,
        epsg: null,
      },
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

    teardownRemovedLayer(group, state, "L");

    expect(terminate).toHaveBeenCalledTimes(1);
    expect(useStreamStore.getState().get("L")).toBeUndefined();
  });

  it("is a no-op for the streaming teardown when the layer never had a registered stream (static layer)", () => {
    const group = new Group();
    const state = makeLayerState("L", ["a"], [0, 0, 0], [0, 0, 0]);

    expect(() => teardownRemovedLayer(group, state, "L")).not.toThrow();
    expect(useStreamStore.getState().get("L")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// :495 visibility — applyVisibility
// ---------------------------------------------------------------------------

describe("applyVisibility", () => {
  it("sets visible on the layer mesh AND every cell mesh", () => {
    const state = makeLayerState("L", ["a"], [0, 0, 0], [0, 0, 0]);
    const cell = makeCellState("L", "0/0/0", ["b"], [0, 0, 0], [0, 0, 0]);
    state.cells.set("0/0/0", cell);
    const map = new Map([["L", state]]);
    const layer = makeLayer({ id: "L", model: makeModel({}), visible: false });

    applyVisibility(map, [layer]);

    expect(state.mesh!.visible).toBe(false);
    expect(cell.mesh.visible).toBe(false);

    // Flip back and re-check both follow the flag, not a one-shot default.
    applyVisibility(map, [{ ...layer, visible: true }]);
    expect(state.mesh!.visible).toBe(true);
    expect(cell.mesh.visible).toBe(true);
  });

  it("skips a layer with no scene state without throwing", () => {
    const map = new Map<string, LayerSceneState>();
    const layer = makeLayer({ id: "missing", model: makeModel({}) });
    expect(() => applyVisibility(map, [layer])).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// :502-510 triangle count — computeTriangleCount
// ---------------------------------------------------------------------------

describe("computeTriangleCount", () => {
  it("sums the layer mesh's triangles plus every cell's", () => {
    // Layer mesh: 9 vertices = 3 triangles. Cell: 6 vertices = 2 triangles.
    const state = makeLayerState(
      "L",
      ["a"],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
    );
    const cell = makeCellState(
      "L",
      "0/0/0",
      ["b"],
      [0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0],
    );
    state.cells.set("0/0/0", cell);
    const map = new Map([["L", state]]);
    const layer = makeLayer({ id: "L", model: makeModel({}), visible: true });

    expect(computeTriangleCount(map, [layer])).toBe(5);
  });

  it("contributes nothing for an invisible layer", () => {
    const state = makeLayerState(
      "L",
      ["a"],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
    );
    const map = new Map([["L", state]]);
    const layer = makeLayer({ id: "L", model: makeModel({}), visible: false });

    expect(computeTriangleCount(map, [layer])).toBe(0);
  });

  it("counts cell triangles even when the layer mesh is null (streaming layer)", () => {
    const state = makeStreamingLayerState();
    const cell = makeCellState("L", "0/0/0", ["b"], [0, 0, 0], [0, 0, 0]); // 1 triangle
    state.cells.set("0/0/0", cell);
    const map = new Map([["L", state]]);
    const layer = makeLayer({ id: "L", model: makeModel({}), visible: true });

    expect(computeTriangleCount(map, [layer])).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// :571 rule colors — updateRuleColors
// ---------------------------------------------------------------------------

describe("updateRuleColors", () => {
  it("computes ruleColors independently for the layer mesh and each cell mesh", () => {
    // b1 (layer mesh's only object) is a RoofSurface -> matched by a
    // vacuously-true rule. b2 (the cell's only object) is a WallSurface ->
    // never matched (buildRuleColors only colors RoofSurface vertices).
    // If the cell's ruleColors were merely copied from the layer's (instead
    // of computed from the cell's OWN geometry/pickingIndex/baseColors),
    // this would incorrectly come out non-null.
    const model = makeModel({
      b1: makeObject("b1", [makeSurface("RoofSurface")]),
      b2: makeObject("b2", [makeSurface("WallSurface")]),
    });
    const layer = makeLayer({
      id: "L",
      model,
      rulesEnabled: true,
      rules: [makeRule({ conditions: [] })],
    });

    const state = makeLayerState("L", ["b1"], [0, 0, 0], [0, 0, 0]);
    const cell = makeCellState("L", "0/0/0", ["b2"], [0, 0, 0], [0, 0, 0]);
    state.cells.set("0/0/0", cell);
    const map = new Map([["L", state]]);

    updateRuleColors(map, [layer]);

    expect(state.ruleColors).not.toBeNull();
    expect(cell.ruleColors).toBeNull();
  });

  it("resets ruleColors on both the layer mesh and every cell when rules are disabled", () => {
    const model = makeModel({
      b1: makeObject("b1", [makeSurface("RoofSurface")]),
    });
    const layer = makeLayer({ id: "L", model, rulesEnabled: false, rules: [] });

    const state = makeLayerState("L", ["b1"], [0, 0, 0], [0, 0, 0]);
    state.ruleColors = new Float32Array([1, 1, 1]);
    const cell = makeCellState("L", "0/0/0", ["b1"], [0, 0, 0], [0, 0, 0]);
    cell.ruleColors = new Float32Array([1, 1, 1]);
    state.cells.set("0/0/0", cell);
    const map = new Map([["L", state]]);

    updateRuleColors(map, [layer]);

    expect(state.ruleColors).toBeNull();
    expect(cell.ruleColors).toBeNull();
  });

  it("does NOT touch a streaming layer's cell ruleColors — buildRuleColors against an empty model.objects would wrongly wipe the worker-computed value", () => {
    // A streaming layer's model is a stub (objects: {}) by design; if this
    // function ran buildRuleColors(layer.model, ...) for the cell branch
    // anyway, EVERY vertex lookup fails and the result is null — silently
    // discarding whatever the worker computed at fetch time on every
    // unrelated `layers`-array change. The sentinel value below must
    // survive completely untouched.
    const model = makeModel({}); // empty, as a real streaming layer's stub model always is
    const layer = makeLayer({
      id: "L",
      model,
      isStreaming: true,
      rulesEnabled: true,
      rules: [makeRule({ conditions: [] })],
    });

    const state = makeStreamingLayerState();
    const cell = makeCellState("L", "0/0/0", ["b1"], [0, 0, 0], [0, 0, 0]);
    const sentinel = new Float32Array([9, 9, 9]);
    cell.ruleColors = sentinel;
    state.cells.set("0/0/0", cell);
    const map = new Map([["L", state]]);

    updateRuleColors(map, [layer]);

    expect(cell.ruleColors).toBe(sentinel); // exact same reference — untouched
  });
});

// ---------------------------------------------------------------------------
// recolorStreamingCells — the streaming counterpart `updateRuleColors`
// deliberately can't be (see its own doc comment): a real worker `recolor`
// round trip, wired for the first time by this fix (B2, 2026-07-28 final
// review). Task 11 implemented and mutation-tested the worker side of this
// months ago; nothing ever sent the request until now.
// ---------------------------------------------------------------------------

function fakeStreamState(
  sendStreaming: WorkerClient["sendStreaming"],
): StreamState {
  return {
    client: { sendStreaming } as unknown as WorkerClient,
    grid: { originX: 0, originY: 0, rootCell: 100, maxLevel: 1 },
    header: {
      version: "1.0",
      featuresCount: 1,
      extent: [0, 0, 0, 100, 100, 10],
      referenceSystem: undefined,
      epsg: null,
    },
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
  };
}

describe("recolorStreamingCells", () => {
  afterEach(() => {
    useStreamStore.setState({ streams: {} });
  });

  it("sends a recolor request for every resident cell of a streaming layer, carrying its CURRENT rules, and applies the returned colors onto CellSceneState", async () => {
    const layer = makeLayer({
      id: "L",
      model: makeModel({}),
      isStreaming: true,
      rulesEnabled: true,
      rules: [makeRule({ conditions: [] })],
    });
    const state = makeStreamingLayerState();
    const cellA = makeCellState("L", "0/0/0", ["a"], [0], [0]);
    const cellB = makeCellState("L", "0/1/0", ["b"], [0], [0]);
    state.cells.set("0/0/0", cellA);
    state.cells.set("0/1/0", cellB);
    const map = new Map([["L", state]]);

    const sendStreaming = vi.fn(
      async (
        msg: Record<string, unknown>,
        onMessage: (r: WorkerResponse) => void,
      ) => {
        for (const key of msg.cells as string[]) {
          onMessage({
            type: "recolored",
            id: 0,
            key,
            ruleColors: new Float32Array([1, 2, 3]),
          });
        }
        onMessage({ type: "done", id: 0 });
      },
    );
    useStreamStore.getState().register("L", fakeStreamState(sendStreaming));

    await recolorStreamingCells(map, [layer]);

    expect(sendStreaming).toHaveBeenCalledTimes(1);
    const sentMsg = sendStreaming.mock.calls[0]![0] as Record<string, unknown>;
    expect(sentMsg.type).toBe("recolor");
    expect([...(sentMsg.cells as string[])].sort()).toEqual(["0/0/0", "0/1/0"]);
    expect(sentMsg.rules).toBe(layer.rules);
    expect(sentMsg.rulesEnabled).toBe(true);

    expect(cellA.ruleColors).toEqual(new Float32Array([1, 2, 3]));
    expect(cellB.ruleColors).toEqual(new Float32Array([1, 2, 3]));
  });

  it("skips a streaming layer with no resident cells — no worker round trip at all", async () => {
    const layer = makeLayer({
      id: "L",
      model: makeModel({}),
      isStreaming: true,
    });
    const state = makeStreamingLayerState();
    const map = new Map([["L", state]]);
    const sendStreaming = vi.fn();
    useStreamStore.getState().register("L", fakeStreamState(sendStreaming));

    await recolorStreamingCells(map, [layer]);
    expect(sendStreaming).not.toHaveBeenCalled();
  });

  it("skips a non-streaming layer entirely — never even reads its stream state", async () => {
    const layer = makeLayer({
      id: "L",
      model: makeModel({}),
      isStreaming: false,
    });
    const state = makeLayerState("L", ["a"], [0, 0, 0], [0, 0, 0]);
    const map = new Map([["L", state]]);
    // No stream registered for "L" at all — if the `isStreaming` filter were
    // ever removed, this would still resolve (no cells to recolor via the
    // static layer's `state.cells`, which is always empty), so the dedicated
    // proof is the `sendStreaming` spy in the OTHER tests never firing for a
    // non-streaming layer even when one WAS registered — covered together
    // with the "no resident cells" case above by construction (there is no
    // `state.cells` entry for a static layer's LayerSceneState either).
    await expect(recolorStreamingCells(map, [layer])).resolves.toBeUndefined();
  });

  it("skips a streaming layer with no registered stream, rather than throwing", async () => {
    const layer = makeLayer({
      id: "L",
      model: makeModel({}),
      isStreaming: true,
    });
    const state = makeStreamingLayerState();
    const cell = makeCellState("L", "0/0/0", ["a"], [0], [0]);
    state.cells.set("0/0/0", cell);
    const map = new Map([["L", state]]);
    // Deliberately NOT registered in useStreamStore.
    await expect(recolorStreamingCells(map, [layer])).resolves.toBeUndefined();
    expect(cell.ruleColors).toBeNull();
  });

  it("does not throw when the worker rejects mid-request (e.g. terminate() racing a layer removal)", async () => {
    const layer = makeLayer({
      id: "L",
      model: makeModel({}),
      isStreaming: true,
      rulesEnabled: true,
      rules: [makeRule({ conditions: [] })],
    });
    const state = makeStreamingLayerState();
    const cell = makeCellState("L", "0/0/0", ["a"], [0], [0]);
    state.cells.set("0/0/0", cell);
    const map = new Map([["L", state]]);

    const sendStreaming = vi.fn(() =>
      Promise.reject(new Error("WorkerClient terminated")),
    );
    useStreamStore.getState().register("L", fakeStreamState(sendStreaming));

    await expect(recolorStreamingCells(map, [layer])).resolves.toBeUndefined();
    expect(cell.ruleColors).toBeNull(); // untouched — the request never completed
  });

  it("discards a 'recolored' response for a cell that was REBUILT (same key, new CellSceneState) since the request was sent, instead of misapplying a wrong-length array onto it (code-review finding)", async () => {
    const layer = makeLayer({
      id: "L",
      model: makeModel({}),
      isStreaming: true,
      rulesEnabled: true,
      rules: [makeRule({ conditions: [] })],
    });
    const state = makeStreamingLayerState();
    const oldCell = makeCellState("L", "0/0/0", ["a"], [0], [0]);
    const oldSentinel = new Float32Array([9, 9, 9]);
    oldCell.ruleColors = oldSentinel;
    state.cells.set("0/0/0", oldCell);
    const map = new Map([["L", state]]);

    let deliver!: (r: WorkerResponse) => void;
    let resolveSend!: () => void;
    const sendStreaming = vi.fn(
      (
        _msg: Record<string, unknown>,
        onMessage: (r: WorkerResponse) => void,
      ) => {
        // Mirrors WorkerClient.sendStreaming's own contract: resolve only
        // once a 'done'/'error' message has been delivered — lets the test
        // control exactly when the response "arrives", well after a swap
        // has already rebuilt the cell below.
        deliver = (r) => {
          onMessage(r);
          if (r.type === "done" || r.type === "error") resolveSend();
        };
        return new Promise<void>((resolve) => {
          resolveSend = resolve;
        });
      },
    );
    useStreamStore.getState().register("L", fakeStreamState(sendStreaming));

    const pending = recolorStreamingCells(map, [layer]);
    // A level/LoD swap rebuilds the SAME key with a brand-new
    // CellSceneState — new mesh, new object identity — exactly what
    // `syncStreamingCells` does on a same-key cache-entry change, entirely
    // independent of this in-flight recolor request.
    const newCell = makeCellState("L", "0/0/0", ["a", "b"], [0, 0], [0, 0]);
    state.cells.set("0/0/0", newCell);

    // Now the STALE response for the OLD cell's geometry finally arrives.
    deliver({
      type: "recolored",
      id: 0,
      key: "0/0/0",
      ruleColors: new Float32Array([1, 2, 3, 4, 5, 6]), // sized for the OLD cell
    });
    deliver({ type: "done", id: 0 });
    await pending;

    // The NEW cell must be untouched by the stale response...
    expect(newCell.ruleColors).toBeNull();
    // ...and the OLD (now-detached) cell must be untouched too — proving
    // this was actually discarded via identity, not accidentally applied to
    // whichever object happens to still be reachable.
    expect(oldCell.ruleColors).toBe(oldSentinel);
  });
});

// ---------------------------------------------------------------------------
// :1017/:1030 picking — resolveFromEvent
// ---------------------------------------------------------------------------

describe("resolveFromEvent", () => {
  it("resolves via the static layer's pickingIndex when userData has no cellKey", () => {
    const state = makeLayerState(
      "L",
      ["b1", "b2"],
      [0, 0, 0, 1, 1, 1],
      [0, 0, 0, 0, 0, 0],
    );
    const map = new Map([["L", state]]);

    const e = {
      face: { a: 3 }, // vertex 3 -> objectIndex 1 -> "b2"
      point: { x: 0, y: 0, z: 0 },
      object: { userData: { layerId: "L" }, geometry: state.mesh!.geometry },
      stopPropagation: () => {},
    };

    expect(resolveFromEvent(e, map)).toEqual({
      kind: "object",
      layerId: "L",
      objectId: "b2",
    });
  });

  it("resolves via the OWNING CELL's pickingIndex, not the layer's, when userData has a cellKey", () => {
    // The layer mesh's own pickingIndex only knows "layer-obj"; the cell's
    // only knows "cell-obj". A pick on the cell mesh must resolve to
    // "cell-obj" — falling back to state.pickingIndex would either resolve
    // the wrong id or throw on an out-of-range index.
    const state = makeLayerState("L", ["layer-obj"], [0, 0, 0], [0, 0, 0]);
    const cell = makeCellState(
      "L",
      "0/0/0",
      ["cell-obj"],
      [0, 0, 0],
      [0, 0, 0],
    );
    state.cells.set("0/0/0", cell);
    const map = new Map([["L", state]]);

    const e = {
      face: { a: 0 },
      point: { x: 0, y: 0, z: 0 },
      object: {
        userData: { layerId: "L", cellKey: "0/0/0" },
        geometry: cell.mesh.geometry,
      },
      stopPropagation: () => {},
    };

    expect(resolveFromEvent(e, map)).toEqual({
      kind: "object",
      layerId: "L",
      objectId: "cell-obj",
    });
  });

  it("returns null when cellKey references a cell that does not exist", () => {
    const state = makeLayerState("L", ["b1"], [0, 0, 0], [0, 0, 0]);
    const map = new Map([["L", state]]);

    const e = {
      face: { a: 0 },
      point: { x: 0, y: 0, z: 0 },
      object: {
        userData: { layerId: "L", cellKey: "9/9/9" },
        geometry: state.mesh!.geometry,
      },
      stopPropagation: () => {},
    };

    expect(resolveFromEvent(e, map)).toBeNull();
  });

  it("returns null when there is no face (no hit)", () => {
    const state = makeLayerState("L", ["b1"], [0, 0, 0], [0, 0, 0]);
    const map = new Map([["L", state]]);

    const e = {
      face: null,
      point: { x: 0, y: 0, z: 0 },
      object: { userData: { layerId: "L" }, geometry: state.mesh!.geometry },
      stopPropagation: () => {},
    };

    expect(resolveFromEvent(e, map)).toBeNull();
  });

  it("returns null for an unknown layer id", () => {
    const map = new Map<string, LayerSceneState>();
    const geometry = makeGeometry([0], [0]);

    const e = {
      face: { a: 0 },
      point: { x: 0, y: 0, z: 0 },
      object: { userData: { layerId: "ghost" }, geometry },
      stopPropagation: () => {},
    };

    expect(resolveFromEvent(e, map)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// :597 cursor conversion — sceneToCrsImpl
// ---------------------------------------------------------------------------

describe("sceneToCrsImpl", () => {
  it("matches the pre-refactor static-layer formula: [x+o0, -z+o1, y+o2]", () => {
    const origin: Vec3 = [100, 200, 10];
    const state = makeLayerState("L", ["a"], [0, 0, 0], [0, 0, 0], origin);
    const map = new Map([["L", state]]);
    const point = { x: 12, y: 34, z: 56 };

    const result = sceneToCrsImpl(map, "L", undefined, point);

    expect(result).toEqual([
      point.x + origin[0],
      -point.z + origin[1],
      point.y + origin[2],
    ]);
  });

  it("round-trips through a cell's mesh-position offset back to the original source point", () => {
    // Uses the REAL production meshOffset/cellCentre/sourceToScene to build
    // the fixture (not a re-implementation), so this exercises the actual
    // contract a future cell-mesh producer would rely on: a cell mesh
    // positioned at meshOffset(cellCentre(...), sceneOrigin) round-trips
    // through sceneToCrsImpl back to the exact source-CRS point.
    const sceneOrigin: Vec3 = [100, 200, 10];
    const grid = makeGrid([0, 0, 0, 2000, 2000, 0]);
    const key = "1/1/0";
    const centre = cellCentre(grid, key, 0);
    const offset = meshOffset(centre, sceneOrigin);

    const state = makeLayerState("L", ["a"], [0, 0, 0], [0, 0, 0], sceneOrigin);
    const cell = makeCellState("L", key, ["b"], [0, 0, 0], [0, 0, 0]);
    cell.mesh.position.set(offset[0], offset[1], offset[2]);
    state.cells.set(key, cell);
    const map = new Map([["L", state]]);

    const sourcePoint: Vec3 = [centre[0] + 5, centre[1] - 3, centre[2] + 1];
    const scenePoint = sourceToScene(sourcePoint, sceneOrigin, offset);

    const result = sceneToCrsImpl(map, "L", key, {
      x: scenePoint[0],
      y: scenePoint[1],
      z: scenePoint[2],
    });

    expect(result![0]).toBeCloseTo(sourcePoint[0], 6);
    expect(result![1]).toBeCloseTo(sourcePoint[1], 6);
    expect(result![2]).toBeCloseTo(sourcePoint[2], 6);
  });

  it("gives a DIFFERENT answer for a cell offset than for the static [0,0,0] offset — proving the cell branch is load-bearing", () => {
    const origin: Vec3 = [0, 0, 0];
    const state = makeLayerState("L", ["a"], [0, 0, 0], [0, 0, 0], origin);
    const cell = makeCellState("L", "0/0/0", ["b"], [0, 0, 0], [0, 0, 0]);
    cell.mesh.position.set(50, 0, -20); // non-zero offset
    state.cells.set("0/0/0", cell);
    const map = new Map([["L", state]]);
    const point = { x: 1, y: 2, z: 3 };

    const staticResult = sceneToCrsImpl(map, "L", undefined, point);
    const cellResult = sceneToCrsImpl(map, "L", "0/0/0", point);

    expect(cellResult).not.toEqual(staticResult);
  });

  it("returns null when the cell key is not present in state.cells", () => {
    const state = makeLayerState("L", ["a"], [0, 0, 0], [0, 0, 0]);
    const map = new Map([["L", state]]);

    expect(sceneToCrsImpl(map, "L", "9/9/9", { x: 0, y: 0, z: 0 })).toBeNull();
  });

  it("returns null for an unknown layer id", () => {
    const map = new Map<string, LayerSceneState>();
    expect(
      sceneToCrsImpl(map, "ghost", undefined, { x: 0, y: 0, z: 0 }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// :687 box selection — computeBoxSelection
// ---------------------------------------------------------------------------

describe("computeBoxSelection", () => {
  function makeCamera(): PerspectiveCamera {
    const camera = new PerspectiveCamera(60, 800 / 600, 1, 1000);
    camera.position.set(0, 0, 100);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    return camera;
  }

  const centerBox = { left: 380, top: 280, right: 420, bottom: 320 };

  it("selects an object whose projected bbox-center falls in the drag rectangle", () => {
    const model = makeModel({
      b1: makeObject("b1", [], [-1, -1, -1, 1, 1, 1]), // center at scene origin
    });
    const layer = makeLayer({ id: "L", model, visible: true });
    const state = makeLayerState("L", ["b1"], [0, 0, 0], [0, 0, 0]);
    const map = new Map([["L", state]]);

    const selected = computeBoxSelection(
      [layer],
      map,
      makeCamera(),
      800,
      600,
      centerBox,
      "object",
    );

    expect(selected).toEqual([
      { kind: "object", layerId: "L", objectId: "b1" },
    ]);
  });

  it("excludes an object whose projection falls outside the drag rectangle", () => {
    const model = makeModel({
      b1: makeObject("b1", [], [299, -1, -1, 301, 1, 1]), // center far off to the side
    });
    const layer = makeLayer({ id: "L", model, visible: true });
    const state = makeLayerState("L", ["b1"], [0, 0, 0], [0, 0, 0]);
    const map = new Map([["L", state]]);

    const selected = computeBoxSelection(
      [layer],
      map,
      makeCamera(),
      800,
      600,
      centerBox,
      "object",
    );

    expect(selected).toEqual([]);
  });

  it("never selects in surface mode, even for an object inside the box", () => {
    const model = makeModel({
      b1: makeObject("b1", [], [-1, -1, -1, 1, 1, 1]),
    });
    const layer = makeLayer({ id: "L", model, visible: true });
    const state = makeLayerState("L", ["b1"], [0, 0, 0], [0, 0, 0]);
    const map = new Map([["L", state]]);

    const selected = computeBoxSelection(
      [layer],
      map,
      makeCamera(),
      800,
      600,
      centerBox,
      "surface",
    );

    expect(selected).toEqual([]);
  });

  it("skips an invisible layer entirely", () => {
    const model = makeModel({
      b1: makeObject("b1", [], [-1, -1, -1, 1, 1, 1]),
    });
    const layer = makeLayer({ id: "L", model, visible: false });
    const state = makeLayerState("L", ["b1"], [0, 0, 0], [0, 0, 0]);
    const map = new Map([["L", state]]);

    const selected = computeBoxSelection(
      [layer],
      map,
      makeCamera(),
      800,
      600,
      centerBox,
      "object",
    );

    expect(selected).toEqual([]);
  });

  it("projects an object owned by a cell from the CELL's mesh offset, not [0,0,0]", () => {
    // b1's bbox center is at source (500,0,0), which projects far outside
    // centerBox under the static [0,0,0] assumption. The cell mesh's
    // position exactly cancels that offset, so the object should project
    // to the viewport center and fall INSIDE centerBox — but only if
    // computeBoxSelection actually consults the cell's offset lookup
    // instead of defaulting every object to [0,0,0].
    const model = makeModel({
      b1: makeObject("b1", [], [499, -1, -1, 501, 1, 1]),
    });
    const layer = makeLayer({ id: "L", model, visible: true });
    const state = makeLayerState("L", [], [], []);
    const cell = makeCellState("L", "0/0/0", ["b1"], [0], [0]);
    cell.mesh.position.set(-500, 0, 0);
    state.cells.set("0/0/0", cell);
    const map = new Map([["L", state]]);

    const selected = computeBoxSelection(
      [layer],
      map,
      makeCamera(),
      800,
      600,
      centerBox,
      "object",
    );

    expect(selected).toEqual([
      { kind: "object", layerId: "L", objectId: "b1" },
    ]);
  });

  describe("streaming layer — box-select decision (Task 17)", () => {
    beforeEach(() => {
      useStreamStore.setState({ streams: {} });
      __resetMemo();
    });
    afterEach(() => {
      useStreamStore.setState({ streams: {} });
      __resetMemo();
    });

    it("selects a resident object from getResidentModel — layer.model.objects stays empty, so this is the ONLY source of candidates for a streaming layer", () => {
      const layer = makeLayer({
        id: "L",
        model: makeModel({}), // empty stub, as real streaming layers always are
        isStreaming: true,
        visible: true,
      });
      const state = makeLayerState("L", [], [], []);
      const map = new Map([["L", state]]);

      const grid: Grid = {
        originX: 0,
        originY: 0,
        rootCell: 1000,
        maxLevel: 2,
      };
      const cache = new CellCache<CellEntry>({
        maxTriangles: Infinity,
        maxBytes: Infinity,
      });
      cache.set(
        "0/0/0",
        makeCellEntry({
          objects: [makeResidentRecord("b1", [-1, -1, -1, 1, 1, 1])], // center at scene origin
        }),
        { triangles: 1, bytes: 1 },
      );
      useStreamStore.getState().register("L", {
        client: fakeClient,
        grid,
        header: {
          version: "1.0",
          featuresCount: 1,
          extent: [0, 0, 0, 1000, 1000, 10],
          referenceSystem: undefined,
          epsg: null,
        },
        cache,
        level: 0,
        ladder: [],
        ladderVersion: 0,
        status: "idle",
        message: null,
        lastCommit: null,
        version: 1,
      });

      const selected = computeBoxSelection(
        [layer],
        map,
        makeCamera(),
        800,
        600,
        centerBox,
        "object",
      );

      expect(selected).toEqual([
        { kind: "object", layerId: "L", objectId: "b1" },
      ]);
    });

    it("selects nothing for a streaming layer with no registered stream, rather than throwing", () => {
      const layer = makeLayer({
        id: "L",
        model: makeModel({}),
        isStreaming: true,
        visible: true,
      });
      const state = makeLayerState("L", [], [], []);
      const map = new Map([["L", state]]);

      expect(() =>
        computeBoxSelection(
          [layer],
          map,
          makeCamera(),
          800,
          600,
          centerBox,
          "object",
        ),
      ).not.toThrow();
      expect(
        computeBoxSelection(
          [layer],
          map,
          makeCamera(),
          800,
          600,
          centerBox,
          "object",
        ),
      ).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// buildCellMesh / syncStreamingCells — the streaming cell-mesh producer
// (Task 17): turns useStreamStore's per-layer CellEntry cache into GPU
// meshes attached to LayerSceneState.cells. Without this, useStreamStore
// fills up as the driver commits, but nothing ever renders or is pickable.
// ---------------------------------------------------------------------------

describe("buildCellMesh", () => {
  const grid: Grid = { originX: 0, originY: 0, rootCell: 1000, maxLevel: 2 };

  it("wraps the entry's typed arrays into geometry attributes matching its objectKeys", () => {
    const entry = makeCellEntry();
    const cellState = buildCellMesh(
      "L",
      "0/0/0",
      entry,
      grid,
      [0, 0, 0],
      "standard",
      false,
    );

    expect(cellState.pickingIndex).toEqual({
      layerId: "L",
      objectKeys: ["obj-a"],
    });
    const posAttr = cellState.mesh.geometry.getAttribute("position");
    expect(Array.from(posAttr.array as Float32Array)).toEqual(
      Array.from(entry.geometry.positions),
    );
    const objIdxAttr = cellState.mesh.geometry.getAttribute("objectIndex");
    expect(Array.from(objIdxAttr.array as Uint32Array)).toEqual(
      Array.from(entry.geometry.objectIndices),
    );
  });

  it("tags the mesh's userData with layerId and cellKey, for resolveMeshOwner", () => {
    const cellState = buildCellMesh(
      "L",
      "2/3/4",
      makeCellEntry(),
      grid,
      [0, 0, 0],
      "standard",
      false,
    );
    expect(resolveMeshOwner(cellState.mesh)).toEqual({
      layerId: "L",
      cellKey: "2/3/4",
    });
  });

  it("positions the mesh at meshOffset(cellCentre(grid, key, 0), sceneOrigin) — the exact contract sceneToCrsImpl/computeBoxSelection depend on", () => {
    const sceneOrigin: Vec3 = [100, 200, 10];
    const key = "1/1/0";
    const expected = meshOffset(cellCentre(grid, key, 0), sceneOrigin);

    const cellState = buildCellMesh(
      "L",
      key,
      makeCellEntry(),
      grid,
      sceneOrigin,
      "standard",
      false,
    );

    expect(cellState.mesh.position.x).toBeCloseTo(expected[0], 9);
    expect(cellState.mesh.position.y).toBeCloseTo(expected[1], 9);
    expect(cellState.mesh.position.z).toBeCloseTo(expected[2], 9);
  });

  it("returns a baseColors COPY, not the live GPU buffer — mutating the GPU buffer must not affect it", () => {
    const entry = makeCellEntry();
    const cellState = buildCellMesh(
      "L",
      "0/0/0",
      entry,
      grid,
      [0, 0, 0],
      "standard",
      false,
    );

    expect(cellState.baseColors).not.toBe(entry.geometry.baseColors);
    expect(Array.from(cellState.baseColors)).toEqual(
      Array.from(entry.geometry.baseColors),
    );

    const colorAttr = cellState.mesh.geometry.getAttribute("color");
    (colorAttr.array as Float32Array).fill(999);
    // The snapshot must be unaffected by mutating the live GPU buffer.
    expect(cellState.baseColors[0]).not.toBe(999);
  });

  it("carries the entry's ruleColors through as the cell's initial ruleColors (already computed by the worker at fetch time)", () => {
    const ruleColors = new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]);
    const entry = makeCellEntry({
      geometry: makeCellGeometry({ ruleColors }),
    });
    const cellState = buildCellMesh(
      "L",
      "0/0/0",
      entry,
      grid,
      [0, 0, 0],
      "standard",
      false,
    );
    expect(cellState.ruleColors).toBe(ruleColors);
  });
});

describe("syncStreamingCells", () => {
  const grid: Grid = { originX: 0, originY: 0, rootCell: 1000, maxLevel: 2 };

  beforeEach(() => {
    useStreamStore.setState({ streams: {} });
  });
  afterEach(() => {
    useStreamStore.setState({ streams: {} });
  });

  function registerStream(layerId: string, cache: CellCache<CellEntry>) {
    useStreamStore.getState().register(layerId, {
      client: fakeClient,
      grid,
      header: {
        version: "1.0",
        featuresCount: 1,
        extent: [0, 0, 0, 1000, 1000, 10],
        referenceSystem: undefined,
        epsg: null,
      },
      cache,
      level: 0,
      ladder: [],
      ladderVersion: 0,
      status: "idle",
      message: null,
      lastCommit: null,
      version: 1,
    });
  }

  it("builds and attaches a mesh for a newly-resident cell, adding it to the cityGroup", () => {
    const group = new Group();
    const layer = makeLayer({
      id: "L",
      model: makeModel({}),
      isStreaming: true,
    });
    const state = makeStreamingLayerState();
    const map = new Map([["L", state]]);

    const cache = new CellCache<CellEntry>({
      maxTriangles: Infinity,
      maxBytes: Infinity,
    });
    cache.set("0/0/0", makeCellEntry(), { triangles: 1, bytes: 1 });
    registerStream("L", cache);

    syncStreamingCells(group, map, [layer], {
      materialMode: "standard",
      doubleSided: false,
      shadows: false,
    });

    expect(state.cells.size).toBe(1);
    expect(state.cells.has("0/0/0")).toBe(true);
    expect(group.children).toContain(state.cells.get("0/0/0")!.mesh);
  });

  it("removes and disposes a cell mesh no longer in the cache (evicted)", () => {
    const group = new Group();
    const layer = makeLayer({
      id: "L",
      model: makeModel({}),
      isStreaming: true,
    });
    const state = makeStreamingLayerState();
    const stale = makeCellState("L", "9/9/9", ["x"], [0], [0]);
    state.cells.set("9/9/9", stale);
    group.add(stale.mesh);
    const map = new Map([["L", state]]);

    const cache = new CellCache<CellEntry>({
      maxTriangles: Infinity,
      maxBytes: Infinity,
    });
    registerStream("L", cache); // empty cache — "9/9/9" is no longer resident

    const disposeSpy = vi.spyOn(stale.mesh.geometry, "dispose");

    syncStreamingCells(group, map, [layer], {
      materialMode: "standard",
      doubleSided: false,
      shadows: false,
    });

    expect(state.cells.has("9/9/9")).toBe(false);
    expect(group.children).not.toContain(stale.mesh);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it("skips a non-streaming layer entirely", () => {
    const group = new Group();
    const layer = makeLayer({
      id: "L",
      model: makeModel({}),
      isStreaming: false,
    });
    const state = makeStreamingLayerState();
    const map = new Map([["L", state]]);

    const cache = new CellCache<CellEntry>({
      maxTriangles: Infinity,
      maxBytes: Infinity,
    });
    cache.set("0/0/0", makeCellEntry(), { triangles: 1, bytes: 1 });
    registerStream("L", cache);

    syncStreamingCells(group, map, [layer], {
      materialMode: "standard",
      doubleSided: false,
      shadows: false,
    });

    expect(state.cells.size).toBe(0);
  });

  it("skips a streaming layer with no registered stream, rather than throwing", () => {
    const group = new Group();
    const layer = makeLayer({
      id: "L",
      model: makeModel({}),
      isStreaming: true,
    });
    const state = makeStreamingLayerState();
    const map = new Map([["L", state]]);

    expect(() =>
      syncStreamingCells(group, map, [layer], {
        materialMode: "standard",
        doubleSided: false,
        shadows: false,
      }),
    ).not.toThrow();
    expect(state.cells.size).toBe(0);
  });

  it("applies the layer's current visible/shadow settings to a newly-built cell mesh", () => {
    const group = new Group();
    const layer = makeLayer({
      id: "L",
      model: makeModel({}),
      isStreaming: true,
      visible: false,
    });
    const state = makeStreamingLayerState();
    const map = new Map([["L", state]]);

    const cache = new CellCache<CellEntry>({
      maxTriangles: Infinity,
      maxBytes: Infinity,
    });
    cache.set("0/0/0", makeCellEntry(), { triangles: 1, bytes: 1 });
    registerStream("L", cache);

    syncStreamingCells(group, map, [layer], {
      materialMode: "standard",
      doubleSided: false,
      shadows: true,
    });

    const cellMesh = state.cells.get("0/0/0")!.mesh;
    expect(cellMesh.visible).toBe(false);
    expect(cellMesh.castShadow).toBe(true);
    expect(cellMesh.receiveShadow).toBe(true);
  });

  it("rebuilds a cell mesh whose CACHE ENTRY changed under an UNCHANGED key — e.g. a level/LoD swap re-fetching a key that was already resident (B1, 2026-07-28 final review; permanent regression test for the reviewer's temporary same-key-replacement probe, which failed against the old shape)", () => {
    const group = new Group();
    const layer = makeLayer({
      id: "L",
      model: makeModel({}),
      isStreaming: true,
    });
    const state = makeStreamingLayerState();
    const map = new Map([["L", state]]);

    const cache = new CellCache<CellEntry>({
      maxTriangles: Infinity,
      maxBytes: Infinity,
    });
    const firstEntry = makeCellEntry({
      geometry: makeCellGeometry({ objectKeys: ["obj-a"] }),
    });
    cache.set("0/0/0", firstEntry, { triangles: 1, bytes: 1 });
    registerStream("L", cache);

    syncStreamingCells(group, map, [layer], {
      materialMode: "standard",
      doubleSided: false,
      shadows: false,
    });
    const firstMesh = state.cells.get("0/0/0")!.mesh;
    const firstDisposeSpy = vi.spyOn(firstMesh.geometry, "dispose");
    expect(group.children).toContain(firstMesh);
    expect(state.cells.get("0/0/0")!.pickingIndex.objectKeys).toEqual([
      "obj-a",
    ]);

    // The SAME key gets a DIFFERENT cache entry (a re-fetch, not an evict +
    // re-add) — commitNormal/commitSwap (useTileStreaming.ts) both do
    // exactly this via `cache.set()`, which always installs a fresh object.
    const secondEntry = makeCellEntry({
      geometry: makeCellGeometry({ objectKeys: ["obj-b"] }),
    });
    cache.set("0/0/0", secondEntry, { triangles: 1, bytes: 1 });

    syncStreamingCells(group, map, [layer], {
      materialMode: "standard",
      doubleSided: false,
      shadows: false,
    });

    const secondMesh = state.cells.get("0/0/0")!.mesh;
    // The OLD mesh must be gone — not left behind under the same key, which
    // is exactly what the reviewer's temporary test caught: "the old mesh
    // and picking index remained."
    expect(secondMesh).not.toBe(firstMesh);
    expect(group.children).not.toContain(firstMesh);
    expect(group.children).toContain(secondMesh);
    expect(firstDisposeSpy).toHaveBeenCalledTimes(1);
    expect(state.cells.size).toBe(1);
    expect(state.cells.get("0/0/0")!.pickingIndex.objectKeys).toEqual([
      "obj-b",
    ]);
    expect(state.cells.get("0/0/0")!.sourceEntry).toBe(secondEntry);
  });

  it("does NOT rebuild a cell whose cache entry is unchanged (same object reference) — no dispose, no new mesh, across repeated syncs", () => {
    const group = new Group();
    const layer = makeLayer({
      id: "L",
      model: makeModel({}),
      isStreaming: true,
    });
    const state = makeStreamingLayerState();
    const map = new Map([["L", state]]);

    const cache = new CellCache<CellEntry>({
      maxTriangles: Infinity,
      maxBytes: Infinity,
    });
    const entry = makeCellEntry();
    cache.set("0/0/0", entry, { triangles: 1, bytes: 1 });
    registerStream("L", cache);

    syncStreamingCells(group, map, [layer], {
      materialMode: "standard",
      doubleSided: false,
      shadows: false,
    });
    const mesh = state.cells.get("0/0/0")!.mesh;
    const disposeSpy = vi.spyOn(mesh.geometry, "dispose");

    // Re-sync with NOTHING changed in the cache (same entry, same key).
    syncStreamingCells(group, map, [layer], {
      materialMode: "standard",
      doubleSided: false,
      shadows: false,
    });

    expect(state.cells.get("0/0/0")!.mesh).toBe(mesh); // same mesh, not rebuilt
    expect(disposeSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// syncStreamingCells + recolorStreamingCells — a rule change racing an
// in-flight fetch (B2, 2026-07-28 final review). The rule-colors effect
// (CitySceneR3F.tsx's `updateRuleColors`/`recolorStreamingCells` pair) only
// ever recolors cells that are ALREADY resident when the user edits a rule.
// A fetch dispatched BEFORE the edit, landing AFTER it, installs a cell via
// `syncStreamingCells` carrying colors baked from the OLD rules — and
// nothing revisits it, because that effect's dependency is `layers`, not
// the cache commit. `syncStreamingCells` must flag such a cell so its
// caller can recolor it immediately with the CURRENT rules.
// ---------------------------------------------------------------------------

describe("syncStreamingCells + recolorStreamingCells — rule change races a fetch (B2, 2026-07-28 final review)", () => {
  const grid: Grid = { originX: 0, originY: 0, rootCell: 1000, maxLevel: 2 };

  afterEach(() => {
    useStreamStore.setState({ streams: {} });
  });

  function registerStream(
    layerId: string,
    cache: CellCache<CellEntry>,
    sendStreaming: WorkerClient["sendStreaming"],
  ) {
    useStreamStore.getState().register(layerId, {
      client: { sendStreaming } as unknown as WorkerClient,
      grid,
      header: {
        version: "1.0",
        featuresCount: 1,
        extent: [0, 0, 0, 1000, 1000, 10],
        referenceSystem: undefined,
        epsg: null,
      },
      cache,
      level: 0,
      ladder: [],
      ladderVersion: 0,
      status: "idle",
      message: null,
      lastCommit: null,
      version: 1,
    });
  }

  it("flags a newly-installed cell whose fetch carried OLD rules, and recoloring it with the CURRENT rules replaces its colours", async () => {
    const group = new Group();
    const oldRule = makeRule({ id: "old", color: "#0000ff", conditions: [] });
    const newRule = makeRule({ id: "new", color: "#ff0000", conditions: [] });

    // The layer's rules as they stand NOW — the user already edited them.
    const layer = makeLayer({
      id: "L",
      model: makeModel({}),
      isStreaming: true,
      rulesEnabled: true,
      rules: [newRule],
    });
    const state = makeStreamingLayerState();
    const map = new Map([["L", state]]);

    // A fetch dispatched BEFORE the edit (baked with the OLD rule) that is
    // only landing in the cache NOW, after the edit.
    const staleColors = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]); // old-rule blue
    const staleEntry = makeCellEntry({
      geometry: makeCellGeometry({ ruleColors: staleColors }),
      builtWithRulesEnabled: true,
      builtWithRules: [oldRule],
    });
    const cache = new CellCache<CellEntry>({
      maxTriangles: Infinity,
      maxBytes: Infinity,
    });
    cache.set("0/0/0", staleEntry, { triangles: 1, bytes: 1 });

    const newColors = new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]); // new-rule red
    const sendStreaming = vi.fn(
      async (
        msg: Record<string, unknown>,
        onMessage: (r: WorkerResponse) => void,
      ) => {
        for (const key of msg.cells as string[]) {
          onMessage({ type: "recolored", id: 0, key, ruleColors: newColors });
        }
        onMessage({ type: "done", id: 0 });
      },
    );
    registerStream("L", cache, sendStreaming);

    const staleKeys = syncStreamingCells(group, map, [layer], {
      materialMode: "standard",
      doubleSided: false,
      shadows: false,
    });

    // The cell was installed carrying the fetch's OLD-rule colors first...
    expect(state.cells.get("0/0/0")!.ruleColors).toBe(staleColors);
    // ...and syncStreamingCells must have flagged it as stale so the caller
    // knows to recolor it.
    expect(staleKeys.get("L")).toEqual(["0/0/0"]);

    await recolorStreamingCells(map, [layer], staleKeys);

    expect(sendStreaming).toHaveBeenCalledTimes(1);
    const sentMsg = sendStreaming.mock.calls[0]![0] as Record<string, unknown>;
    expect(sentMsg.cells).toEqual(["0/0/0"]);
    expect(sentMsg.rules).toBe(layer.rules); // the CURRENT (new) rules, not the stale entry's

    // The installed cell now carries the CURRENT rules' colours.
    expect(state.cells.get("0/0/0")!.ruleColors).toEqual(newColors);
  });

  it("does NOT flag a newly-installed cell whose fetch already matches the layer's current rules", () => {
    const group = new Group();
    const rule = makeRule({ id: "r1", color: "#ff0000", conditions: [] });
    const layer = makeLayer({
      id: "L",
      model: makeModel({}),
      isStreaming: true,
      rulesEnabled: true,
      rules: [rule],
    });
    const state = makeStreamingLayerState();
    const map = new Map([["L", state]]);

    const entry = makeCellEntry({
      builtWithRulesEnabled: true,
      builtWithRules: [rule],
    });
    const cache = new CellCache<CellEntry>({
      maxTriangles: Infinity,
      maxBytes: Infinity,
    });
    cache.set("0/0/0", entry, { triangles: 1, bytes: 1 });
    registerStream(
      "L",
      cache,
      vi.fn() as unknown as WorkerClient["sendStreaming"],
    );

    const staleKeys = syncStreamingCells(group, map, [layer], {
      materialMode: "standard",
      doubleSided: false,
      shadows: false,
    });

    expect(staleKeys.size).toBe(0);
  });

  it("recolorStreamingCells with onlyKeys targets ONLY the flagged cell, leaving an already-correct sibling cell untouched", async () => {
    const group = new Group();
    const rule = makeRule({ id: "r1", color: "#ff0000", conditions: [] });
    const layer = makeLayer({
      id: "L",
      model: makeModel({}),
      isStreaming: true,
      rulesEnabled: true,
      rules: [rule],
    });
    const state = makeStreamingLayerState();
    const map = new Map([["L", state]]);

    const freshColors = new Float32Array([9, 9, 9, 9, 9, 9, 9, 9, 9]);
    const freshEntry = makeCellEntry({
      geometry: makeCellGeometry({ ruleColors: freshColors }),
      builtWithRulesEnabled: true,
      builtWithRules: [rule], // already matches — NOT stale
    });
    const staleEntry = makeCellEntry({
      geometry: makeCellGeometry({ ruleColors: new Float32Array(9) }),
      builtWithRulesEnabled: false,
      builtWithRules: [], // built before rules were enabled — IS stale
    });
    const cache = new CellCache<CellEntry>({
      maxTriangles: Infinity,
      maxBytes: Infinity,
    });
    cache.set("0/0/0", freshEntry, { triangles: 1, bytes: 1 });
    cache.set("0/1/0", staleEntry, { triangles: 1, bytes: 1 });

    const sendStreaming = vi.fn(
      async (
        msg: Record<string, unknown>,
        onMessage: (r: WorkerResponse) => void,
      ) => {
        for (const key of msg.cells as string[]) {
          onMessage({
            type: "recolored",
            id: 0,
            key,
            ruleColors: new Float32Array([2, 2, 2, 2, 2, 2, 2, 2, 2]),
          });
        }
        onMessage({ type: "done", id: 0 });
      },
    );
    registerStream("L", cache, sendStreaming);

    const staleKeys = syncStreamingCells(group, map, [layer], {
      materialMode: "standard",
      doubleSided: false,
      shadows: false,
    });
    expect(staleKeys.get("L")).toEqual(["0/1/0"]);

    await recolorStreamingCells(map, [layer], staleKeys);

    expect(sendStreaming).toHaveBeenCalledTimes(1);
    const sentMsg = sendStreaming.mock.calls[0]![0] as Record<string, unknown>;
    expect(sentMsg.cells).toEqual(["0/1/0"]); // NOT "0/0/0"

    // The already-correct cell was never touched.
    expect(state.cells.get("0/0/0")!.ruleColors).toBe(freshColors);
  });
});

// ---------------------------------------------------------------------------
// reapplyHighlight — used by both the rule-colors and highlight effects;
// must apply/clear independently per cell in addition to the layer mesh.
// ---------------------------------------------------------------------------

describe("reapplyHighlight", () => {
  afterEach(() => {
    useSelectionStore.getState().clear();
  });

  it("highlights the layer mesh's selected object and independently the cell's hovered object", () => {
    const state = makeLayerState("L", ["b1"], [0, 0, 0], [0, 0, 0]);
    const cell = makeCellState("L", "0/0/0", ["b2"], [0, 0, 0], [0, 0, 0]);
    state.cells.set("0/0/0", cell);
    const map = new Map([["L", state]]);
    const layer = makeLayer({ id: "L", model: makeModel({}) });

    useSelectionStore.setState({
      selections: [{ kind: "object", layerId: "L", objectId: "b1" }],
      hovered: { kind: "object", layerId: "L", objectId: "b2" },
    });

    reapplyHighlight(map, [layer]);

    const layerColor = state.mesh!.geometry.getAttribute("color");
    const cellColor = cell.mesh.geometry.getAttribute("color");
    const HIGHLIGHT = new Color(0xe8973f);
    const HOVER = new Color(0xfbbf24);

    expect(layerColor.getX(0)).toBeCloseTo(HIGHLIGHT.r, 2);
    expect(cellColor.getX(0)).toBeCloseTo(HOVER.r, 2);
  });

  it("clears both the layer mesh and every cell when the layer is not a target", () => {
    const state = makeLayerState("L", ["b1"], [0, 0, 0], [0, 0, 0]);
    const cell = makeCellState("L", "0/0/0", ["b2"], [0, 0, 0], [0, 0, 0]);
    state.cells.set("0/0/0", cell);
    const map = new Map([["L", state]]);
    const layer = makeLayer({ id: "L", model: makeModel({}) });

    // Selection/hover belong to a different layer entirely.
    useSelectionStore.setState({
      selections: [{ kind: "object", layerId: "other", objectId: "x" }],
      hovered: null,
    });

    reapplyHighlight(map, [layer]);

    const layerColor = state.mesh!.geometry.getAttribute("color")
      .array as Float32Array;
    const cellColor = cell.mesh.geometry.getAttribute("color")
      .array as Float32Array;

    expect(Array.from(layerColor)).toEqual(Array.from(state.baseColors!));
    expect(Array.from(cellColor)).toEqual(Array.from(cell.baseColors));
  });
});
