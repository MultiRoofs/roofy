import { describe, expect, it } from "vitest";
import { selectedObjectBounds } from "../../src/scene/selectedObjectBounds";

const object = (
  bbox: readonly [number, number, number, number, number, number] | null,
  children: readonly string[] = [],
) => ({
  id: "",
  objectType: "Building",
  attributes: {},
  surfaces: [],
  bbox,
  children,
  parents: [],
  lod: null,
});

describe("selectedObjectBounds", () => {
  it("unions selected objects with nested parts and tolerates cycles", () => {
    expect(
      selectedObjectBounds(
        {
          objects: {
            building: object(null, ["part-a", "part-b"]),
            "part-a": object([1, 2, 3, 4, 5, 6], ["building"]),
            "part-b": object([0, 3, 2, 7, 9, 8]),
          },
        },
        ["building"],
      ),
    ).toEqual([0, 2, 2, 7, 9, 8]);
  });

  it("returns null for unavailable selected geometry", () => {
    expect(
      selectedObjectBounds({ objects: { empty: object(null) } }, [
        "empty",
        "missing",
      ]),
    ).toBeNull();
  });
});
