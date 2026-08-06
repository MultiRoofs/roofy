/**
 * The case these pin is the one that was actually broken in the app: a
 * geometry-bearing `BuildingPart` with no attributes of its own, whose parent
 * `Building` holds every attribute in the dataset.
 */
import { describe, expect, it } from "vitest";
import { resolveInheritedAttributes } from "../../../../src/domain/citymodel/inheritedAttributes";
import type { CityObject } from "../../../../src/domain/citymodel/types";

function obj(patch: Partial<CityObject> & { id: string }): CityObject {
  return {
    objectType: "Building",
    attributes: {},
    surfaces: [],
    bbox: null,
    children: [],
    parents: [],
    lod: null,
    ...patch,
  } as CityObject;
}

describe("resolveInheritedAttributes", () => {
  it("gives a BuildingPart its parent Building's attributes", () => {
    const building = obj({
      id: "NL.IMBAG.Pand.0503100000025026",
      attributes: { b3_dak_type: "slanted", b3_h_dak_50p: 12.3 },
      children: ["NL.IMBAG.Pand.0503100000025026-0"],
    });
    const part = obj({
      id: "NL.IMBAG.Pand.0503100000025026-0",
      objectType: "BuildingPart",
      parents: [building.id],
    });
    const objects = { [building.id]: building, [part.id]: part };

    const resolved = resolveInheritedAttributes(objects, part);
    expect(resolved.attributes).toEqual({
      b3_dak_type: "slanted",
      b3_h_dak_50p: 12.3,
    });
    // Named, so the UI can say where the values came from rather than
    // implying the part owns them.
    expect(resolved.inheritedFrom).toBe(building.id);
  });

  it("lets the object's OWN value win — inheritance fills gaps, never overrides", () => {
    const parent = obj({ id: "p", attributes: { shared: "parent", only: 1 } });
    const child = obj({
      id: "c",
      attributes: { shared: "child" },
      parents: ["p"],
    });
    const resolved = resolveInheritedAttributes({ p: parent, c: child }, child);
    expect(resolved.attributes).toEqual({ shared: "child", only: 1 });
  });

  it("reports nothing inherited when the object already has everything", () => {
    const parent = obj({ id: "p", attributes: { a: 1 } });
    const child = obj({ id: "c", attributes: { a: 2 }, parents: ["p"] });
    const resolved = resolveInheritedAttributes({ p: parent, c: child }, child);
    expect(resolved.inheritedFrom).toBeNull();
  });

  it("leaves a parentless object exactly as it is", () => {
    const lone = obj({ id: "l", attributes: { a: 1 } });
    const resolved = resolveInheritedAttributes({ l: lone }, lone);
    expect(resolved.attributes).toEqual({ a: 1 });
    expect(resolved.inheritedFrom).toBeNull();
  });

  it("prefers the NEAREST ancestor for a contested key", () => {
    const grand = obj({ id: "g", attributes: { who: "grand", g: 1 } });
    const parent = obj({
      id: "p",
      attributes: { who: "parent" },
      parents: ["g"],
    });
    const child = obj({ id: "c", parents: ["p"] });
    const resolved = resolveInheritedAttributes(
      { g: grand, p: parent, c: child },
      child,
    );
    expect(resolved.attributes["who"]).toBe("parent");
    expect(resolved.attributes["g"]).toBe(1);
  });

  it("survives a parent cycle rather than hanging the UI", () => {
    const a = obj({ id: "a", attributes: { fromA: 1 }, parents: ["b"] });
    const b = obj({ id: "b", attributes: { fromB: 2 }, parents: ["a"] });
    const resolved = resolveInheritedAttributes({ a, b }, a);
    expect(resolved.attributes).toEqual({ fromA: 1, fromB: 2 });
  });

  it("ignores a parent id the model does not contain", () => {
    const child = obj({ id: "c", attributes: { a: 1 }, parents: ["missing"] });
    const resolved = resolveInheritedAttributes({ c: child }, child);
    expect(resolved.attributes).toEqual({ a: 1 });
    expect(resolved.inheritedFrom).toBeNull();
  });
});
