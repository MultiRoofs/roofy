/**
 * The one place that knows where a layer's geometry lives — the parsed model
 * for a static layer, the resident set for a streaming one — and the one place
 * that decides how much of it is measured.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
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

/** Counts the calls the CPU contract is about. */
const measured: string[] = [];
vi.mock("@cityjson/navara-core", async () => {
  const actual = await vi.importActual<typeof import("@cityjson/navara-core")>(
    "@cityjson/navara-core",
  );
  return {
    ...actual,
    computeRoofMetrics: vi.fn((surface: { lod: string | null }) => {
      measured.push(String(surface.lod));
      return actual.computeRoofMetrics(
        surface as Parameters<typeof actual.computeRoofMetrics>[0],
      );
    }),
  };
});

const { featureIdsByObject, lodOptionsBy, roofGeometrySource, roofLodOptions } =
  await import("../../../../src/features/processing/roofGeometrySource");

/** A unit square of `type` at `lod`; area 1, inclination 0. */
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

/**
 * TWO roof-bearing features, not one:
 *  - B1 (Building) roof at 2.2, with part B1P (roof + wall at 2.2)
 *  - B4 (Building) roof at 2.2, no parts
 *  - B2 (Building) roof at 1.2, no parts
 *  - B3 (Building) WALL only at 2.2 — geometry, but no roof
 */
function staticLayer(): Layer {
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
  return {
    id: "L1",
    name: "roofs",
    isStreaming: false,
    selectedLod: "2.2",
    availableLods: ["2.2", "1.2"],
    model: {
      sourceEncoding: "cityjson",
      metadata: {},
      bbox: null,
      vertexCount: 0,
      objects: {
        B1: object(
          "B1",
          "Building",
          [surface("RoofSurface", "2.2")],
          [],
          ["B1P"],
        ),
        B1P: object(
          "B1P",
          "BuildingPart",
          [surface("RoofSurface", "2.2"), surface("WallSurface", "2.2")],
          ["B1"],
        ),
        B4: object("B4", "Building", [surface("RoofSurface", "2.2")]),
        B2: object("B2", "Building", [surface("RoofSurface", "1.2")]),
        B3: object("B3", "Building", [surface("WallSurface", "2.2")]),
      },
    },
  } as unknown as Layer;
}

afterEach(() => {
  residents.objects = {};
  measured.length = 0;
});

describe("roofLodOptions", () => {
  it("counts FEATURES per LoD, parts folded into their building", () => {
    // 2.2: B1 (through its part, which has a roof there) and B4 — TWO
    // features. 1.2: B2.
    expect(roofLodOptions(staticLayer())).toEqual([
      { lod: "2.2", features: 2 },
      { lod: "1.2", features: 1 },
    ]);
  });

  it("applies the CONTRIBUTOR rule, so a displaced root roof does not count", () => {
    // B1's part keeps its wall at 2.2 but loses its roof. §7 still makes the
    // PART the contributor (it has geometry there), so B1 has no roof at 2.2
    // and must not appear in the count — the same answer the run will give.
    const layer = staticLayer();
    const objects = (
      layer.model as unknown as {
        objects: Record<string, { surfaces: unknown[] }>;
      }
    ).objects;
    objects["B1P"]!.surfaces = [surface("WallSurface", "2.2")];
    expect(roofLodOptions(layer)).toEqual([
      { lod: "2.2", features: 1 }, // B4 only
      { lod: "1.2", features: 1 },
    ]);
    expect(measured).toEqual([]);
  });

  it("counts the ROOT when no part has geometry at that LoD", () => {
    const layer = staticLayer();
    const objects = (
      layer.model as unknown as {
        objects: Record<string, { surfaces: unknown[] }>;
      }
    ).objects;
    objects["B1P"]!.surfaces = [surface("RoofSurface", "1.2")];
    // At 2.2 the part contributes nothing, so B1 falls back to its own roof.
    expect(roofLodOptions(layer)).toEqual([
      { lod: "2.2", features: 2 }, // B1 (root) and B4
      { lod: "1.2", features: 2 }, // B1 (through its part) and B2
    ]);
  });

  it("measures NOTHING — it reads the surfaces' tags only", () => {
    roofLodOptions(staticLayer());
    expect(measured).toEqual([]);
  });

  it("offers no LoD for a layer whose only geometry is walls", () => {
    const layer = staticLayer();
    const objects = (
      layer.model as unknown as { objects: Record<string, unknown> }
    ).objects;
    for (const id of ["B1", "B1P", "B4", "B2"]) delete objects[id];
    expect(roofLodOptions(layer)).toEqual([]);
  });

  it("reads a streaming layer's RESIDENT records, which are pre-measured", () => {
    residents.objects = {
      r1: {
        id: "r1",
        parents: [],
        children: [],
        geometryLods: ["2"],
        roofMetrics: [
          {
            lod: "2",
            areaSqM: 12,
            inclinationDeg: 30,
            azimuthDeg: 180,
            elevationM: 4,
          },
        ],
      },
      r2: {
        id: "r2",
        parents: [],
        children: [],
        geometryLods: ["2"],
        roofMetrics: [],
      },
    };
    const layer = {
      id: "S1",
      name: "delft",
      isStreaming: true,
      model: { sourceEncoding: "flatcitybuf", objects: {} },
    } as unknown as Layer;
    expect(roofLodOptions(layer)).toEqual([{ lod: "2", features: 1 }]);
    expect(measured).toEqual([]);
  });
});

describe("roofGeometrySource", () => {
  it("answers hasGeometryAt from TAGS, for surfaces of every type", () => {
    const source = roofGeometrySource(staticLayer());
    // The case §7's contributor rule turns on.
    expect(source.hasGeometryAt("B3", "2.2")).toBe(true);
    expect(source.roofSurfacesAt("B3", "2.2")).toEqual([]);
    expect(source.hasGeometryAt("B2", "2.2")).toBe(false);
    expect(source.hasGeometryAt("B2", "1.2")).toBe(true);
  });

  it("distinguishes an object it has never heard of from one with nothing", () => {
    const source = roofGeometrySource(staticLayer());
    expect(source.has("B3")).toBe(true);
    expect(source.has("gone")).toBe(false);
    expect(source.hasGeometryAt("gone", "2.2")).toBe(false);
    expect(source.roofSurfacesAt("gone", "2.2")).toEqual([]);
  });

  it("measures only the object and LoD it is asked for, once", () => {
    const source = roofGeometrySource(staticLayer());
    const first = source.roofSurfacesAt("B1P", "2.2");
    expect(first).toHaveLength(1);
    expect(first[0]!.areaSqM).toBeCloseTo(1, 6);
    expect(measured).toEqual(["2.2"]);
    source.roofSurfacesAt("B1P", "2.2");
    source.roofSurfacesAt("B1P", "2.2");
    expect(measured).toEqual(["2.2"]); // memoised
    source.roofSurfacesAt("B1P", "1.2");
    expect(measured).toEqual(["2.2"]); // nothing of B1P's is tagged 1.2
  });

  it("filters a streaming record's pre-measured metrics by LoD", () => {
    residents.objects = {
      r1: {
        id: "r1",
        parents: [],
        children: [],
        geometryLods: ["1.2", "2"],
        roofMetrics: [
          {
            lod: "2",
            areaSqM: 12,
            inclinationDeg: 30,
            azimuthDeg: 180,
            elevationM: 4,
          },
          {
            lod: "1.2",
            areaSqM: 3,
            inclinationDeg: 0,
            azimuthDeg: 0,
            elevationM: 1,
          },
        ],
      },
    };
    const layer = {
      id: "S1",
      name: "delft",
      isStreaming: true,
      model: { sourceEncoding: "flatcitybuf", objects: {} },
    } as unknown as Layer;
    const source = roofGeometrySource(layer);
    expect(source.roofSurfacesAt("r1", "2")).toEqual([
      { lod: "2", areaSqM: 12, inclinationDeg: 30, azimuthDeg: 180 },
    ]);
    expect(source.hasGeometryAt("r1", "1.2")).toBe(true);
    expect(measured).toEqual([]);
  });
});

describe("lodOptionsBy", () => {
  it("applies `qualifies` AFTER the contributor rule, never as the selector", () => {
    // The rule the doc comment states, as an executable fact. B1's part has
    // geometry at 2.2 but does not QUALIFY; B1 must therefore not count at
    // 2.2 — a qualifier used as the contributor SELECTOR would pick the root
    // instead and count it, which is the 3D BAG double count.
    const qualifying = new Set(["B1", "B4"]);
    expect(
      lodOptionsBy(
        staticLayer(),
        (id, lod) => lod === "2.2" && qualifying.has(id),
      ),
    ).toEqual([{ lod: "2.2", features: 1 }]); // B4 only
  });

  it("measures nothing", () => {
    lodOptionsBy(staticLayer(), () => true);
    expect(measured).toEqual([]);
  });
});

describe("featureIdsByObject", () => {
  it("resolves a part to its building and a root to itself", () => {
    const features = featureIdsByObject(staticLayer());
    expect(features.get("B1")).toBe("B1");
    expect(features.get("B1P")).toBe("B1");
    expect(features.get("B4")).toBe("B4");
  });
});
