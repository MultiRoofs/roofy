/**
 * The details subject — resolving a selection and turning it into the
 * identity trail and summary strings. Pure, so pinned without a store.
 */
import { describe, expect, it } from "vitest";
import type {
  CityObject,
  Surface,
} from "../../../../src/domain/citymodel/types";
import type { RoofMetrics } from "@cityjson/navara-core";
import type {
  GeoFeatureSelection,
  Selection,
} from "../../../../src/domain/selection/types";
import {
  subjectOf,
  identityTrail,
  buildingSummary,
  surfaceSummary,
  geoSummary,
  shortId,
  type ResolvedBuilding,
} from "../../../../src/ui/details/subject";

function surface(overrides: Partial<Surface> = {}): Surface {
  return {
    type: "RoofSurface",
    rings: [],
    attributes: {},
    lod: null,
    ...overrides,
  };
}

function object(overrides: Partial<CityObject> = {}): CityObject {
  return {
    id: "obj-1",
    objectType: "Building",
    attributes: {},
    surfaces: [],
    bbox: null,
    children: [],
    parents: [],
    lod: "2.2",
    ...overrides,
  };
}

const OBJ = object({ id: "NL.IMBAG.Pand.0503100000025028" });

function resolveObject(
  map: Readonly<Record<string, CityObject>>,
): (layerId: string, id: string) => CityObject | null {
  return (_layerId, id) => map[id] ?? null;
}

describe("subjectOf", () => {
  const resolve = resolveObject({ [OBJ.id]: OBJ });

  it("resolves a single object selection to a building with its parts", () => {
    const part = object({ id: "part-1", objectType: "BuildingPart" });
    const parent = object({ id: OBJ.id, children: ["part-1"] });
    const s: Selection = { kind: "object", layerId: "L", objectId: OBJ.id };
    const resolveParts = resolveObject({ [OBJ.id]: parent, "part-1": part });

    const subject = subjectOf([s], null, resolveParts);
    expect(subject?.kind).toBe("building");
    if (subject?.kind === "building") {
      expect(subject.object).toBe(parent);
      expect(subject.parts).toEqual([part]);
    }
  });

  it("resolves a surface selection to its surface and owner", () => {
    const roof = surface({ type: "RoofSurface" });
    const owner = object({ id: OBJ.id, surfaces: [roof] });
    const s: Selection = {
      kind: "surface",
      layerId: "L",
      objectId: OBJ.id,
      surfaceIndex: 0,
    };
    const resolve = resolveObject({ [OBJ.id]: owner });

    const subject = subjectOf([s], null, resolve);
    expect(subject?.kind).toBe("surface");
    if (subject?.kind === "surface") {
      expect(subject.surface).toBe(roof);
      expect(subject.owner).toBe(owner);
    }
  });

  it("resolves several selections to a multi subject", () => {
    const a = object({ id: "a" });
    const b = object({ id: "b" });
    const resolve = resolveObject({ a, b });
    const selections: Selection[] = [
      { kind: "object", layerId: "L", objectId: "a" },
      { kind: "object", layerId: "L", objectId: "b" },
    ];

    const subject = subjectOf(selections, null, resolve);
    expect(subject?.kind).toBe("multi");
    if (subject?.kind === "multi") {
      expect(subject.objectIds).toEqual(["a", "b"]);
      expect(subject.objects).toEqual([a, b]);
    }
  });

  it("a geo selection wins over any city selection", () => {
    const geo: GeoFeatureSelection = {
      geoLayerId: "g1",
      batchId: 4,
      properties: { zone: "residential" },
    };
    const subject = subjectOf(
      [{ kind: "object", layerId: "L", objectId: "a" }],
      geo,
      resolve,
    );
    expect(subject).toEqual({ kind: "geo", ...geo });
  });

  it("answers null for nothing selected and for an unresolvable object", () => {
    expect(subjectOf([], null, resolve)).toBeNull();
    expect(
      subjectOf(
        [{ kind: "object", layerId: "L", objectId: "missing" }],
        null,
        resolve,
      ),
    ).toBeNull();
  });
});

describe("identityTrail", () => {
  it("nests a surface under its building under its layer", () => {
    const roof = surface();
    const owner = object({
      id: "NL.IMBAG.Pand.0503100000025028",
      surfaces: [roof],
    });
    const subject = subjectOf(
      [{ kind: "surface", layerId: "L", objectId: owner.id, surfaceIndex: 0 }],
      null,
      resolveObject({ [owner.id]: owner }),
    )!;

    expect(identityTrail(subject, "Delft")).toEqual([
      { label: "Delft", act: "activate-layer" },
      { label: "Building \u202625028", act: "narrow-to-building" },
      { label: "Roof surface 0", act: "current" },
    ]);
  });

  it("shortens long ids to their last five characters", () => {
    expect(shortId("NL.IMBAG.Pand.0503100000025028")).toBe("\u202625028");
    expect(shortId("short")).toBe("short");
  });
});

function metrics(overrides: Partial<RoofMetrics> = {}): RoofMetrics {
  return {
    areaSqM: 100,
    inclinationDeg: 45,
    azimuthDeg: 180,
    elevationM: 0,
    ...overrides,
  };
}

describe("buildingSummary", () => {
  it("sums roofs across a parent with no own geometry and roofs on two parts", () => {
    const parent = object({
      id: "parent",
      attributes: { measuredHeight: "12.4", roofType: "gabled" },
      children: ["p1", "p2"],
    });
    const p1 = object({ id: "p1" });
    const p2 = object({ id: "p2" });
    const building: ResolvedBuilding = {
      object: parent,
      parts: [p1, p2],
      roofSurfaces: [
        {
          owner: p1,
          metrics: metrics({
            areaSqM: 100,
            inclinationDeg: 45,
            azimuthDeg: 180,
          }),
        },
        {
          owner: p2,
          metrics: metrics({
            areaSqM: 50,
            inclinationDeg: 45,
            azimuthDeg: 180,
          }),
        },
      ],
      loading: false,
    };

    const rows = buildingSummary(building);
    expect(rows.find((r) => r.label === "Roof area")?.value).toBe("150.0 m²");
    expect(rows.find((r) => r.label === "Mean roof slope")?.value).toBe(
      "45.0°",
    );
    expect(rows.find((r) => r.label === "Main orientation")?.value).toBe(
      "S (180°)",
    );
    expect(rows.find((r) => r.label === "Height")?.value).toBe("12.4 m");
    expect(rows.find((r) => r.label === "Roof type")?.value).toBe("gabled");
    expect(rows.find((r) => r.label === "Parts")?.value).toBe("2");
  });
});

describe("surfaceSummary", () => {
  it("ends with a Belongs to row that selects the owner", () => {
    const owner = object({ id: "NL.IMBAG.Pand.0503100000025028" });
    const rows = surfaceSummary(
      surface({ type: "WallSurface" }),
      metrics({ areaSqM: 30, inclinationDeg: 90, azimuthDeg: 270 }),
      owner,
    );
    expect(rows.map((r) => r.label)).toEqual([
      "Area",
      "Slope",
      "Azimuth",
      "Type",
      "Belongs to",
    ]);
    expect(rows[4]!.act).toBe("owner");
    expect(rows[4]!.value).toBe("Building \u202625028");
  });
});

describe("geoSummary", () => {
  it("prefers Name and Zone", () => {
    expect(
      geoSummary({ name: "Wippolder", zone: "Residential", area_ha: 12 }),
    ).toEqual([
      { label: "Name", value: "Wippolder" },
      { label: "Zone", value: "Residential" },
    ]);
  });

  it("falls back to the first three properties", () => {
    expect(geoSummary({ use: "housing", floors: 3, code: "X" })).toEqual([
      { label: "use", value: "housing" },
      { label: "floors", value: "3" },
      { label: "code", value: "X" },
    ]);
  });
});
