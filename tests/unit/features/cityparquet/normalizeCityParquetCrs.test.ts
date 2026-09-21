import { describe, expect, it } from "vitest";
import proj4 from "proj4";
import { assertMetricCrs, parseEpsgCode } from "@cityjson/navara-core";
import type { CityModel, Vec3 } from "../../../../src/domain/citymodel/types";
import { normalizeCityParquetCrs } from "../../../../src/features/cityparquet/normalizeCityParquetCrs";

function model(epsg = 6697): CityModel {
  // The supplied Nishitokyo WKB stores longitude first, despite the EPSG
  // authority's latitude-first axis order. Heights are already metres.
  const ring: Vec3[] = [
    [139.5272, 35.7095, 62.9],
    [139.5273, 35.7095, 62.9],
    [139.5273, 35.7096, 65],
    [139.5272, 35.7096, 65],
  ];
  return {
    sourceEncoding: "cityparquet",
    metadata: { referenceSystem: `EPSG:${epsg}`, title: "Nishitokyo" },
    bbox: [139.5272, 35.7095, 0, 139.5273, 35.7096, 65],
    vertexCount: 4,
    objects: {
      building: {
        id: "building",
        objectType: "Building",
        attributes: { height: 10 },
        parents: [],
        children: [],
        lod: "2",
        bbox: [139.5272, 35.7095, 62.9, 139.5273, 35.7096, 65],
        surfaces: [
          { type: "RoofSurface", rings: [ring], attributes: {}, lod: "2" },
        ],
      },
      parent: {
        id: "parent",
        objectType: "Building",
        attributes: {},
        parents: [],
        children: ["building"],
        lod: null,
        surfaces: [],
        bbox: [139.5272, 35.7095, 0, 139.5273, 35.7096, 65],
      },
    },
  };
}

describe("normalizeCityParquetCrs", () => {
  it("projects EPSG:6697 longitude/latitude into a local metric UTM grid, preserving heights", () => {
    const source = model();
    const result = normalizeCityParquetCrs(source);
    const epsg = parseEpsgCode(result.metadata.referenceSystem)!;
    expect(epsg).toBe(32654);
    expect(() => assertMetricCrs(epsg)).not.toThrow();
    const ring = result.objects.building!.surfaces[0]!.rings[0]!;
    const original = source.objects.building!.surfaces[0]!.rings[0]!;
    const restored = proj4(`EPSG:${epsg}`, "EPSG:4326", [...ring[0]!]);
    expect(restored[0]).toBeCloseTo(139.5272, 7);
    expect(restored[1]).toBeCloseTo(35.7095, 7);
    expect(ring.map((v) => v[2])).toEqual(original.map((v) => v[2]));
    expect(
      Math.hypot(ring[1]![0] - ring[0]![0], ring[1]![1] - ring[0]![1]),
    ).toBeCloseTo(9.05, 1);
    expect(result.objects.building!.bbox![0]).toBeGreaterThan(300_000);
    expect(result.objects.parent!.bbox![2]).toBe(0);
    expect(result.bbox![2]).toBe(0);
    expect(result.metadata.title).toBe("Nishitokyo");
    expect(result.vertexCount).toBe(4);
    expect(result.objects.building!.attributes).toEqual({ height: 10 });
    expect(source.objects.building!.surfaces[0]!.rings[0]![0]).toEqual([
      139.5272, 35.7095, 62.9,
    ]);
    for (const point of ring) {
      const bbox = result.objects.building!.bbox!;
      for (let i = 0; i < 3; i++) {
        expect(point[i]).toBeGreaterThanOrEqual(bbox[i]!);
        expect(point[i]).toBeLessThanOrEqual(bbox[i + 3]!);
      }
    }
  });

  it("rejects latitude-first or non-finite coordinates instead of misplacing geometry", () => {
    const source = model();
    for (const point of [
      [35.7, 139.5, 60],
      [139.5, 35.7, NaN],
    ] as Vec3[]) {
      const building = source.objects.building!;
      const invalid = {
        ...source,
        objects: {
          building: {
            ...building,
            surfaces: [{ ...building.surfaces[0]!, rings: [[point]] }],
          },
        },
      };
      expect(() => normalizeCityParquetCrs(invalid)).toThrow(
        /expected longitude\/latitude/,
      );
    }
  });

  it("preserves interior rings, LoD and appearance references", () => {
    const source = model();
    const building = source.objects.building!;
    const surface = building.surfaces[0]!;
    const texture = {
      day: {
        textureIndex: 0,
        uvs: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
        ] as const,
      },
    };
    const withHole = {
      ...source,
      objects: {
        building: {
          ...building,
          surfaces: [
            {
              ...surface,
              rings: [...surface.rings, surface.rings[0]!],
              texture,
              material: { day: 0 },
            },
          ],
        },
      },
    };
    const result =
      normalizeCityParquetCrs(withHole).objects.building!.surfaces[0]!;
    expect(result.rings).toHaveLength(2);
    expect(result.rings[0]).toEqual(result.rings[1]);
    expect(result.lod).toBe("2");
    expect(result.texture).toBe(texture);
    expect(result.material).toEqual({ day: 0 });
  });

  it("leaves other coordinate systems unchanged, retaining their existing CRS checks", () => {
    for (const epsg of [7415, 28992, 4326]) {
      const source = model(epsg);
      expect(normalizeCityParquetCrs(source)).toBe(source);
    }
  });
});
