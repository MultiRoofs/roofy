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
import { afterEach, describe, expect, it, vi } from "vitest";
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
  computeBoxSelection,
  computeTriangleCount,
  disposeLayerState,
  reapplyHighlight,
  resolveFromEvent,
  resolveMeshOwner,
  sceneToCrsImpl,
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
} from "../../../src/features/streaming/tileGrid";
import { sourceToScene } from "../../../src/features/streaming/sceneTransform";

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
): CellSceneState {
  const { mesh, pickingIndex, baseColors } = makeMesh(
    layerId,
    objectKeys,
    objectIndices,
    surfaceIndices,
    cellKey,
  );
  return { mesh, pickingIndex, baseColors, ruleColors: null };
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
