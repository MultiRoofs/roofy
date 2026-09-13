import { describe, expect, it } from "vitest";
import {
  appendColumns,
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
    expect(derivedColumnTitle("__roofy_mean_slope")).toBe("Mean slope (°)");
    expect(derivedColumnTitle("__roofy_parts")).toBe("Parts (count)");
  });

  it("explains how the synthetic roof area differs from the computed one", () => {
    // §7.1 keeps the synthetic column AND ships a computed `roof_area_m2`, and
    // the two disagree on any building that stores roof surfaces on both
    // itself and its parts — so the header says which is which.
    const title = derivedColumnTitle("__roofy_roof_area");
    expect(title.startsWith("Roof area (m²)")).toBe(true);
    expect(title).toContain("the drawer's own per-page figure");
    expect(title).toContain("counts it once");
  });

  it("leaves the other two synthetic titles alone", () => {
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

  it("lists a computed column that collides with a base name once, and last", () => {
    // The buildings view's own six names are the collision risk: a tool whose
    // OUTPUT is `measuredHeight` must not be both a base column and a computed
    // one, and the run's result is the copy that survives.
    const names = defaultColumns(
      [
        { name: "id", type: "VARCHAR", kind: "scalar" as const },
        { name: "measuredHeight", type: "DOUBLE", kind: "scalar" as const },
        { name: "function", type: "VARCHAR", kind: "scalar" as const },
      ],
      "buildings",
      new Set(["measuredHeight"]),
    ).map((column) => column.name);
    expect(names.filter((name) => name === "measuredHeight")).toHaveLength(1);
    expect(names.at(-1)).toBe("measuredHeight");
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

describe("appending a run's columns to a customised list", () => {
  it("appends the names the list does not already carry, in order", () => {
    expect(
      appendColumns(
        ["id", "function"],
        ["extent_height_m", "extent_zmin_m", "extent_zmax_m"],
      ),
    ).toEqual([
      "id",
      "function",
      "extent_height_m",
      "extent_zmin_m",
      "extent_zmax_m",
    ]);
  });

  it("returns the very same list when every name is already there", () => {
    // Identity, not just equality: the caller skips `setColumns` on it, and
    // `setColumns` would reset the page under a user who changed nothing.
    const current = ["id", "extent_height_m"];
    expect(appendColumns(current, ["extent_height_m"])).toBe(current);
  });

  it("adds a repeated name once", () => {
    expect(
      appendColumns(["id"], ["extent_height_m", "extent_height_m"]),
    ).toEqual(["id", "extent_height_m"]);
  });

  it("leaves the default list alone", () => {
    // A null list is the DEFAULT path, which already appends the registered
    // computed columns; pinning it here would freeze today's default.
    expect(appendColumns(null, ["extent_height_m"])).toBeNull();
  });
});
