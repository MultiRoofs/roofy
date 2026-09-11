import { describe, expect, it } from "vitest";
import {
  columnLabel,
  derivedColumnTitle,
  defaultColumns,
} from "../../../../src/ui/drawer/columnPolicy";
const columns = [
  { name: "id", type: "VARCHAR", kind: "scalar" as const },
  { name: "roof_area", type: "VARCHAR", kind: "scalar" as const },
  { name: "object_type", type: "VARCHAR", kind: "scalar" as const },
  { name: "parents", type: "VARCHAR[]", kind: "nested" as const },
];
describe("record column policy", () => {
  it("keeps a raw source roof_area and uses collision-safe derived keys for buildings", () => {
    expect(
      defaultColumns(columns, "raw").map((column) => column.name),
    ).toContain("roof_area");
    expect(
      defaultColumns(columns, "buildings").map((column) => column.name),
    ).toContain("__roofy_roof_area");
    expect(columnLabel("__roofy_roof_area")).toBe("Roof area");
    expect(derivedColumnTitle("__roofy_roof_area")).toBe("Roof area (m²)");
    expect(derivedColumnTitle("__roofy_mean_slope")).toBe("Mean slope (°)");
    expect(derivedColumnTitle("__roofy_parts")).toBe("Parts (count)");
  });
});

describe("computed columns in the default set", () => {
  const withComputed = [
    ...columns,
    { name: "extent_height_m", type: "DOUBLE", kind: "scalar" as const },
  ];

  it("shows a registered computed column by default, after the file's columns", () => {
    const names = defaultColumns(
      withComputed,
      "buildings",
      new Set(["extent_height_m"]),
    ).map((column) => column.name);
    expect(names).toContain("extent_height_m");
    expect(names.indexOf("extent_height_m")).toBeGreaterThan(
      names.indexOf("id"),
    );
  });

  it("never lists a computed column twice", () => {
    const names = defaultColumns(
      withComputed,
      "raw",
      new Set(["extent_height_m"]),
    ).map((column) => column.name);
    expect(names.filter((name) => name === "extent_height_m")).toHaveLength(1);
  });
});
