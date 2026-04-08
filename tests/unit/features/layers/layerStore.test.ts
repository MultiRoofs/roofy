import { describe, it, expect, beforeEach } from "vitest";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import type { CityModel } from "../../../../src/domain/citymodel/types";
import type { Rule } from "../../../../src/features/rules/types";

function makeModel(id = "m1"): CityModel {
  return {
    objects: { [id]: { id, objectType: "Building", surfaces: [], attributes: {}, children: [], parents: [], bbox: null, lod: null } },
    metadata: { referenceSystem: undefined },
    bbox: null,
  } as unknown as CityModel;
}

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: crypto.randomUUID(),
    name: "test rule",
    color: "#ff0000",
    logic: "AND",
    conditions: [{ field: "inclinationDeg", operator: "<", value: 10 }],
    enabled: true,
    ...overrides,
  };
}

describe("layerStore", () => {
  beforeEach(() => {
    useLayerStore.setState({ layers: [], activeLayerId: null });
  });

  describe("addLayer", () => {
    it("adds a layer and sets it as active when none exist", () => {
      const id = useLayerStore.getState().addLayer({
        name: "Layer 1",
        model: makeModel(),
        modelRef: { type: "file", fileName: "a.city.json" },
        visible: true,
        rules: [],
        rulesEnabled: true,
      });

      const { layers, activeLayerId } = useLayerStore.getState();
      expect(layers).toHaveLength(1);
      expect(layers[0]!.name).toBe("Layer 1");
      expect(activeLayerId).toBe(id);
    });

    it("does not change activeLayerId when adding a second layer", () => {
      const first = useLayerStore.getState().addLayer({
        name: "First",
        model: makeModel(),
        modelRef: { type: "file", fileName: "a.city.json" },
        visible: true,
        rules: [],
        rulesEnabled: true,
      });

      useLayerStore.getState().addLayer({
        name: "Second",
        model: makeModel("m2"),
        modelRef: { type: "file", fileName: "b.city.json" },
        visible: true,
        rules: [],
        rulesEnabled: true,
      });

      expect(useLayerStore.getState().activeLayerId).toBe(first);
      expect(useLayerStore.getState().layers).toHaveLength(2);
    });
  });

  describe("removeLayer", () => {
    it("removes a layer by id", () => {
      const id = useLayerStore.getState().addLayer({
        name: "L",
        model: makeModel(),
        modelRef: { type: "file", fileName: "a.city.json" },
        visible: true,
        rules: [],
        rulesEnabled: true,
      });

      useLayerStore.getState().removeLayer(id);
      expect(useLayerStore.getState().layers).toHaveLength(0);
    });

    it("switches activeLayerId to last remaining layer when active is removed", () => {
      const first = useLayerStore.getState().addLayer({
        name: "First",
        model: makeModel(),
        modelRef: { type: "file", fileName: "a.city.json" },
        visible: true,
        rules: [],
        rulesEnabled: true,
      });

      const second = useLayerStore.getState().addLayer({
        name: "Second",
        model: makeModel("m2"),
        modelRef: { type: "file", fileName: "b.city.json" },
        visible: true,
        rules: [],
        rulesEnabled: true,
      });

      useLayerStore.getState().removeLayer(first);
      expect(useLayerStore.getState().activeLayerId).toBe(second);
    });

    it("sets activeLayerId to null when last layer removed", () => {
      const id = useLayerStore.getState().addLayer({
        name: "L",
        model: makeModel(),
        modelRef: { type: "file", fileName: "a.city.json" },
        visible: true,
        rules: [],
        rulesEnabled: true,
      });

      useLayerStore.getState().removeLayer(id);
      expect(useLayerStore.getState().activeLayerId).toBeNull();
    });
  });

  describe("updateLayer", () => {
    it("updates name", () => {
      const id = useLayerStore.getState().addLayer({
        name: "Old",
        model: makeModel(),
        modelRef: { type: "file", fileName: "a.city.json" },
        visible: true,
        rules: [],
        rulesEnabled: true,
      });

      useLayerStore.getState().updateLayer(id, { name: "New" });
      expect(useLayerStore.getState().layers[0]!.name).toBe("New");
    });

    it("toggles visibility", () => {
      const id = useLayerStore.getState().addLayer({
        name: "L",
        model: makeModel(),
        modelRef: { type: "file", fileName: "a.city.json" },
        visible: true,
        rules: [],
        rulesEnabled: true,
      });

      useLayerStore.getState().updateLayer(id, { visible: false });
      expect(useLayerStore.getState().layers[0]!.visible).toBe(false);
    });
  });

  describe("removeAllLayers", () => {
    it("clears all layers and activeLayerId", () => {
      useLayerStore.getState().addLayer({
        name: "L1",
        model: makeModel(),
        modelRef: { type: "file", fileName: "a.city.json" },
        visible: true,
        rules: [],
        rulesEnabled: true,
      });
      useLayerStore.getState().addLayer({
        name: "L2",
        model: makeModel("m2"),
        modelRef: { type: "file", fileName: "b.city.json" },
        visible: true,
        rules: [],
        rulesEnabled: true,
      });

      useLayerStore.getState().removeAllLayers();
      expect(useLayerStore.getState().layers).toHaveLength(0);
      expect(useLayerStore.getState().activeLayerId).toBeNull();
    });
  });

  describe("per-layer rules", () => {
    let layerId: string;

    beforeEach(() => {
      layerId = useLayerStore.getState().addLayer({
        name: "L",
        model: makeModel(),
        modelRef: { type: "file", fileName: "a.city.json" },
        visible: true,
        rules: [],
        rulesEnabled: true,
      });
    });

    it("adds a rule to a specific layer", () => {
      const rule = makeRule();
      useLayerStore.getState().addRule(layerId, rule);

      const layer = useLayerStore.getState().layers.find((l) => l.id === layerId)!;
      expect(layer.rules).toHaveLength(1);
      expect(layer.rules[0]!.name).toBe("test rule");
    });

    it("updates a rule on a specific layer", () => {
      const rule = makeRule();
      useLayerStore.getState().addRule(layerId, rule);
      useLayerStore.getState().updateRule(layerId, rule.id, { name: "updated" });

      const layer = useLayerStore.getState().layers.find((l) => l.id === layerId)!;
      expect(layer.rules[0]!.name).toBe("updated");
    });

    it("deletes a rule from a specific layer", () => {
      const rule = makeRule();
      useLayerStore.getState().addRule(layerId, rule);
      useLayerStore.getState().deleteRule(layerId, rule.id);

      const layer = useLayerStore.getState().layers.find((l) => l.id === layerId)!;
      expect(layer.rules).toHaveLength(0);
    });

    it("reorders rules within a layer", () => {
      const r1 = makeRule({ name: "A" });
      const r2 = makeRule({ name: "B" });
      const r3 = makeRule({ name: "C" });
      useLayerStore.getState().addRule(layerId, r1);
      useLayerStore.getState().addRule(layerId, r2);
      useLayerStore.getState().addRule(layerId, r3);

      useLayerStore.getState().reorderRules(layerId, 0, 2);

      const layer = useLayerStore.getState().layers.find((l) => l.id === layerId)!;
      expect(layer.rules.map((r) => r.name)).toEqual(["B", "C", "A"]);
    });

    it("toggles rulesEnabled for a specific layer", () => {
      useLayerStore.getState().toggleRulesEnabled(layerId);
      const layer = useLayerStore.getState().layers.find((l) => l.id === layerId)!;
      expect(layer.rulesEnabled).toBe(false);

      useLayerStore.getState().toggleRulesEnabled(layerId);
      const updated = useLayerStore.getState().layers.find((l) => l.id === layerId)!;
      expect(updated.rulesEnabled).toBe(true);
    });

    it("clears all rules from a specific layer", () => {
      useLayerStore.getState().addRule(layerId, makeRule());
      useLayerStore.getState().addRule(layerId, makeRule({ name: "second" }));
      useLayerStore.getState().clearRules(layerId);

      const layer = useLayerStore.getState().layers.find((l) => l.id === layerId)!;
      expect(layer.rules).toHaveLength(0);
    });

    it("does not affect rules on other layers", () => {
      const otherId = useLayerStore.getState().addLayer({
        name: "Other",
        model: makeModel("m2"),
        modelRef: { type: "file", fileName: "b.city.json" },
        visible: true,
        rules: [],
        rulesEnabled: true,
      });

      const rule = makeRule();
      useLayerStore.getState().addRule(layerId, rule);

      const other = useLayerStore.getState().layers.find((l) => l.id === otherId)!;
      expect(other.rules).toHaveLength(0);
    });
  });
});
