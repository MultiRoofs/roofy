import { describe, it, expect } from "vitest";
import {
  cityGmlModuleOf,
  groupTypesByModule,
} from "../../../src/analytics/cityGmlModule";

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
