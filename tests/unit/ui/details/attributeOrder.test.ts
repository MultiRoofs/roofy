import { expect, it } from "vitest";
import {
  attributeKeys,
  reorderAttribute,
  normalizeAttributeOrders,
} from "../../../../src/features/attributes/attributeOrder";
it("keeps saved positions, appends new keys, and tolerates missing attributes", () => {
  expect(attributeKeys({ c: 3, a: 1, d: 4 }, ["b", "a", "c"])).toEqual([
    "a",
    "c",
    "d",
  ]);
  expect(reorderAttribute(["b", "a", "c"], ["a", "c", "d"], "c", "a")).toEqual([
    "b",
    "c",
    "a",
    "d",
  ]);
});
it("normalizes untrusted saved orders without losing valid type names", () => {
  expect(
    normalizeAttributeOrders({ Building: ["b", "a", "b"], Road: 1 }),
  ).toEqual({ Building: ["b", "a"] });
  expect(normalizeAttributeOrders(null)).toBeUndefined();
});
