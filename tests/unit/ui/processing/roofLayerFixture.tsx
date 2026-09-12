/**
 * The layer the Roof metrics form suites run against: FOUR features — two
 * roof-bearing at LoD 2.2, one at 1.2, and one with geometry but no roof —
 * over FIVE rows. Shared because three suites assert counts over it and a
 * second copy would drift.
 */
import type { CityModel } from "../../../../src/domain/citymodel/types";
import type { LayerStoreActions } from "../../../../src/features/layers/layerStore";
import type { ColumnInfo } from "../../../../src/insights/columnKind";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";
import { useLayerTableStore } from "../../../../src/insights/layerTables";

/** A unit square of `type` at `lod`: area 1, inclination 0, azimuth 0. */
const surface = (type: string, lod: string) => ({
  type,
  rings: [
    [
      [0, 0, 3],
      [1, 0, 3],
      [1, 1, 3],
      [0, 1, 3],
    ],
  ],
  attributes: {},
  lod,
});

const object = (
  id: string,
  objectType: string,
  surfaces: unknown[],
  parents: string[] = [],
  children: string[] = [],
) => ({
  id,
  objectType,
  attributes: {},
  surfaces,
  bbox: null,
  children,
  parents,
  lod: null,
});

/** FEATURES: B1 (+part B1P), B4, B2, B3. ROWS: those five ids. */
export const ROOF_FIXTURE_ROWS = 5;
/** Features with a roof at 2.2 (B1 through its part, and B4). */
export const ROOF_FIXTURE_FEATURES_22 = 2;
/** Features with a roof at 1.2 (B2). */
export const ROOF_FIXTURE_FEATURES_12 = 1;

/**
 * `roofs: false` turns every RoofSurface into a WallSurface, which is how a
 * test reaches §6's "no LoD qualifies" state without an empty layer.
 */
export function roofModel(options: { roofs?: boolean } = {}): CityModel {
  const roof = options.roofs === false ? "WallSurface" : "RoofSurface";
  return {
    sourceEncoding: "cityjson",
    metadata: {},
    bbox: null,
    vertexCount: 0,
    objects: {
      B1: object("B1", "Building", [surface(roof, "2.2")], [], ["B1P"]),
      B1P: object(
        "B1P",
        "BuildingPart",
        [surface(roof, "2.2"), surface("WallSurface", "2.2")],
        ["B1"],
      ),
      B4: object("B4", "Building", [surface(roof, "2.2")]),
      B2: object("B2", "Building", [surface(roof, "1.2")]),
      // Geometry, no roof at any LoD — the contributor rule's other side, and
      // the reason the 2.2 count is 2 rather than 3.
      B3: object("B3", "Building", [surface("WallSurface", "2.2")]),
    },
  } as unknown as CityModel;
}

function column(name: string): ColumnInfo {
  return { name, type: "VARCHAR", kind: "scalar" };
}

type LayerInput = Parameters<LayerStoreActions["addLayer"]>[0];

/**
 * Adds the layer, makes it active, and gives it a READY table.
 *
 * The table entry is MERGED, and the name is an option, so a suite can stand up
 * two roof layers and switch the form's target between them.
 */
export function addRoofLayer(
  options: {
    name?: string;
    selectedLod?: string | null;
    roofs?: boolean;
    isStreaming?: boolean;
  } = {},
): string {
  const input: LayerInput = {
    name: options.name ?? "roofs",
    model: roofModel(options),
    modelRef: { type: "url", url: "https://x/roofs.city.json" },
    visible: true,
    rules: [],
    colorBy: "surface",
    isStreaming: options.isStreaming ?? false,
  };
  const id = useLayerStore.getState().addLayer(input);
  if (options.selectedLod !== undefined) {
    useLayerStore.setState((state) => ({
      layers: state.layers.map((l) =>
        l.id === id ? { ...l, selectedLod: options.selectedLod ?? null } : l,
      ),
    }));
  }
  useWorkspaceStore.getState().setActiveLayerId(id);
  useLayerTableStore.setState((state) => ({
    tables: {
      ...state.tables,
      [id]: {
        state: "ready",
        info: {
          table: "layer_1",
          sourceName: "roofs.city.json",
          source: null,
          reader: "read_cityjson",
          columns: [column("id"), column("feature_id")],
          lods: [],
          extension: "city.json",
          sourceBytes: null,
          rowCount: ROOF_FIXTURE_ROWS,
        },
      },
    },
  }));
  return id;
}
