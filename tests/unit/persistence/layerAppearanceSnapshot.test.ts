import { describe, it, expect } from "vitest";
import { normalizeLayers } from "../../../src/persistence/types";

describe("LayerSnapshot.appearance", () => {
  const base = {
    name: "L",
    modelRef: { type: "url" as const, url: "https://host/x.jsonl" },
    rules: [],
    rulesEnabled: true,
    visible: true,
  };

  it("passes a saved theme through normalisation untouched", () => {
    const [layer] = normalizeLayers({
      layers: [{ ...base, appearance: { kind: "texture", name: "rgb" } }],
    } as never);
    expect(layer!.appearance).toEqual({ kind: "texture", name: "rgb" });
  });

  it("keeps an explicit null, and leaves an older snapshot's field absent", () => {
    const [none, older] = normalizeLayers({
      layers: [{ ...base, appearance: null }, { ...base }],
    } as never);
    expect(none!.appearance).toBeNull();
    expect("appearance" in older!).toBe(false);
  });
});
