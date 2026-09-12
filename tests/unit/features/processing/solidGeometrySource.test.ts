/**
 * "Does this building have a SOLID at LoD X?" — answered from surface TAGS
 * only, for the LoD select (spec §6). Nothing here measures anything: opening
 * a dropdown must not triangulate a city.
 */
import { describe, expect, it, vi } from "vitest";
import type { Layer } from "../../../../src/features/layers/layerStore";

const residents: {
  objects: Record<string, unknown>;
  cellCount: number;
  featureCount: number;
  surfaceAttrKeys: string[];
} = { objects: {}, cellCount: 0, featureCount: 0, surfaceAttrKeys: [] };
vi.mock("../../../../src/features/streaming/residentModel", () => ({
  getResidentModel: vi.fn(() => residents),
}));

const { hasSolidAt, solidLodOptions } =
  await import("../../../../src/features/processing/solidGeometrySource");

/** A surface tagged with the geometry it came from. */
const surface = (
  type: string,
  lod: string,
  geometryType: string | null | undefined,
) => ({
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
  ...(geometryType === undefined ? {} : { geometryType }),
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

/**
 * FOUR features over five rows:
 *  - S1 (Building, Solid at 2.2) with part S1P (Solid at 2.2)
 *  - S2 (Building, Solid at 1.2 only)
 *  - S3 (Building, MultiSurface at 2.2 — geometry, but not a solid)
 *  - S4 (Building, a surface with NO geometryType tag at 2.2)
 */
function staticLayer(): Layer {
  return {
    id: "L1",
    name: "solids",
    isStreaming: false,
    selectedLod: "2.2",
    availableLods: ["2.2", "1.2"],
    model: {
      sourceEncoding: "cityjson",
      metadata: {},
      bbox: null,
      vertexCount: 0,
      objects: {
        S1: object(
          "S1",
          "Building",
          [surface("RoofSurface", "2.2", "Solid")],
          [],
          ["S1P"],
        ),
        S1P: object(
          "S1P",
          "BuildingPart",
          [surface("WallSurface", "2.2", "Solid")],
          ["S1"],
        ),
        S2: object("S2", "Building", [surface("RoofSurface", "1.2", "Solid")]),
        S3: object("S3", "Building", [
          surface("RoofSurface", "2.2", "MultiSurface"),
        ]),
        S4: object("S4", "Building", [
          surface("RoofSurface", "2.2", undefined),
        ]),
      },
    },
  } as unknown as Layer;
}

describe("hasSolidAt", () => {
  it("is true for Solid, CompositeSolid and MultiSolid, at that LoD only", () => {
    const layer = staticLayer();
    const objects = (
      layer.model as unknown as {
        objects: Record<string, { surfaces: unknown[] }>;
      }
    ).objects;
    objects["S2"]!.surfaces = [
      surface("RoofSurface", "1.2", "CompositeSolid"),
      surface("RoofSurface", "0", "MultiSolid"),
    ];
    const has = hasSolidAt(layer);
    expect(has("S1", "2.2")).toBe(true);
    expect(has("S1", "1.2")).toBe(false);
    expect(has("S2", "1.2")).toBe(true);
    expect(has("S2", "0")).toBe(true);
  });

  it("reads a MultiSurface, a missing tag and an unknown object as NOT a solid", () => {
    const has = hasSolidAt(staticLayer());
    expect(has("S3", "2.2")).toBe(false);
    expect(has("S4", "2.2")).toBe(false);
    expect(has("nope", "2.2")).toBe(false);
  });

  it("answers false for every object of a STREAMING layer", () => {
    // A resident record carries `geometryLods` and pre-computed roof metrics
    // and nothing about geometry type, so there is no honest "true" here. The
    // solids tools need a reader, which a streaming layer never has.
    residents.objects = { A: { parents: [], geometryLods: ["2.2"] } };
    const has = hasSolidAt({
      id: "S",
      isStreaming: true,
      model: { objects: {} },
    } as unknown as Layer);
    expect(has("A", "2.2")).toBe(false);
    residents.objects = {};
  });
});

describe("solidLodOptions", () => {
  it("counts FEATURES per LoD, parts folded in, highest detail first", () => {
    // 2.2: S1 (through its part, which has a solid there) — S3 and S4 have
    // geometry but no solid. 1.2: S2.
    expect(solidLodOptions(staticLayer())).toEqual([
      { lod: "2.2", features: 1 },
      { lod: "1.2", features: 1 },
    ]);
  });

  it("applies the CONTRIBUTOR rule, so a non-solid part displaces the root", () => {
    // §7: the PART has geometry at 2.2, so it is the contributor and the
    // root's own solid is ignored. Choosing contributors by "has a solid"
    // instead would silently re-introduce the 3D BAG double count.
    const layer = staticLayer();
    const objects = (
      layer.model as unknown as {
        objects: Record<string, { surfaces: unknown[] }>;
      }
    ).objects;
    objects["S1P"]!.surfaces = [surface("WallSurface", "2.2", "MultiSurface")];
    expect(solidLodOptions(layer)).toEqual([{ lod: "1.2", features: 1 }]);
  });

  it("falls back to the ROOT when no part has geometry at that LoD", () => {
    const layer = staticLayer();
    const objects = (
      layer.model as unknown as {
        objects: Record<string, { surfaces: unknown[] }>;
      }
    ).objects;
    objects["S1P"]!.surfaces = [surface("WallSurface", "1.2", "MultiSurface")];
    expect(solidLodOptions(layer)).toEqual([
      { lod: "2.2", features: 1 }, // S1, through its own solid
      { lod: "1.2", features: 1 }, // S2 — S1 contributes its part, no solid
    ]);
  });

  it("offers nothing for a layer with geometry but no solids", () => {
    const layer = staticLayer();
    const objects = (
      layer.model as unknown as { objects: Record<string, unknown> }
    ).objects;
    for (const id of ["S1", "S1P", "S2"]) delete objects[id];
    expect(solidLodOptions(layer)).toEqual([]);
  });

  it("offers nothing for a streaming layer", () => {
    residents.objects = {
      A: { parents: [], geometryLods: ["2.2"], roofMetrics: [] },
    };
    expect(
      solidLodOptions({
        id: "S",
        isStreaming: true,
        model: { objects: {} },
      } as unknown as Layer),
    ).toEqual([]);
    residents.objects = {};
  });
});
