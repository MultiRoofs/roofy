import { describe, it, expect } from "vitest";
import {
  parentsIndexOf,
  rootFeatureId,
} from "../../../../src/domain/citymodel/featureId";

describe("rootFeatureId", () => {
  const index = parentsIndexOf({
    B1: { parents: [] },
    "B1-0": { parents: ["B1"] },
    "B1-0-a": { parents: ["B1-0"] },
    Tree: { parents: [] },
  });

  it("is the object's own id when it has no parents", () => {
    expect(rootFeatureId("B1", index)).toBe("B1");
    expect(rootFeatureId("Tree", index)).toBe("Tree");
  });

  it("walks a part up to its Building", () => {
    expect(rootFeatureId("B1-0", index)).toBe("B1");
  });

  it("walks a whole chain, not just one step", () => {
    expect(rootFeatureId("B1-0-a", index)).toBe("B1");
  });

  it("stops at a parent that is not in the model", () => {
    const orphan = parentsIndexOf({ P: { parents: ["Missing"] } });
    expect(rootFeatureId("P", orphan)).toBe("Missing");
  });

  it("is cycle-safe", () => {
    const cyclic = parentsIndexOf({
      A: { parents: ["B"] },
      B: { parents: ["A"] },
    });
    expect(rootFeatureId("A", cyclic)).toBe("B");
  });

  it("returns the id unchanged for an object the index never saw", () => {
    expect(rootFeatureId("Nope", index)).toBe("Nope");
  });

  it("treats a missing parents array as no parents", () => {
    const index2 = parentsIndexOf({ X: {} });
    expect(rootFeatureId("X", index2)).toBe("X");
  });
});
