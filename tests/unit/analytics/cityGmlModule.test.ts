import { describe, it, expect } from "vitest";
import {
  CITY_GML_MODULES,
  cityGmlModuleOf,
  groupTypesByModule,
} from "../../../src/analytics/cityGmlModule";

describe("CITY_GML_MODULES", () => {
  it("names only tables cityparquet_write accepts", () => {
    // Provenance: the extension's own error text, which lists the accepted
    // object-table names verbatim. A name outside this set is refused at
    // write time, so the list is a contract with the extension, not taste.
    const ACCEPTED = new Set([
      "building",
      "bridge",
      "tunnel",
      "construction",
      "transportation",
      "vegetation",
      "relief",
      "water_body",
      "land_use",
      "city_furniture",
      "generics",
    ]);
    for (const module of CITY_GML_MODULES) {
      expect(ACCEPTED.has(module)).toBe(true);
    }
    expect(CITY_GML_MODULES.length).toBe(ACCEPTED.size);
    expect(new Set(CITY_GML_MODULES).size).toBe(CITY_GML_MODULES.length);
  });
});

describe("cityGmlModuleOf", () => {
  it("maps every Building* type to building", () => {
    expect(cityGmlModuleOf("Building")).toBe("building");
    expect(cityGmlModuleOf("BuildingPart")).toBe("building");
    expect(cityGmlModuleOf("BuildingInstallation")).toBe("building");
    expect(cityGmlModuleOf("BuildingRoom")).toBe("building");
  });

  it("maps the other prefixed families", () => {
    expect(cityGmlModuleOf("Bridge")).toBe("bridge");
    expect(cityGmlModuleOf("BridgePart")).toBe("bridge");
    expect(cityGmlModuleOf("Tunnel")).toBe("tunnel");
    expect(cityGmlModuleOf("TunnelConstructiveElement")).toBe("tunnel");
  });

  it("maps the exact-name types", () => {
    expect(cityGmlModuleOf("OtherConstruction")).toBe("construction");
    expect(cityGmlModuleOf("Road")).toBe("transportation");
    expect(cityGmlModuleOf("Railway")).toBe("transportation");
    expect(cityGmlModuleOf("TransportSquare")).toBe("transportation");
    expect(cityGmlModuleOf("Waterway")).toBe("transportation");
    expect(cityGmlModuleOf("PlantCover")).toBe("vegetation");
    expect(cityGmlModuleOf("SolitaryVegetationObject")).toBe("vegetation");
    expect(cityGmlModuleOf("TINRelief")).toBe("relief");
    expect(cityGmlModuleOf("WaterBody")).toBe("water_body");
    expect(cityGmlModuleOf("LandUse")).toBe("land_use");
    expect(cityGmlModuleOf("CityFurniture")).toBe("city_furniture");
  });

  it("sends anything unrecognised to generics", () => {
    expect(cityGmlModuleOf("GenericCityObject")).toBe("generics");
    expect(cityGmlModuleOf("Zonkity")).toBe("generics");
  });
});

describe("groupTypesByModule", () => {
  it("groups in CITY_GML_MODULES order, keeping the caller's type order", () => {
    expect(
      groupTypesByModule([
        "SolitaryVegetationObject",
        "Building",
        "Bridge",
        "PlantCover",
      ]),
    ).toEqual([
      { module: "building", types: ["Building"] },
      { module: "bridge", types: ["Bridge"] },
      {
        module: "vegetation",
        types: ["SolitaryVegetationObject", "PlantCover"],
      },
    ]);
  });

  it("omits a module nothing maps to", () => {
    expect(groupTypesByModule(["Building"])).toEqual([
      { module: "building", types: ["Building"] },
    ]);
  });

  it("is empty for no types", () => {
    expect(groupTypesByModule([])).toEqual([]);
  });
});
