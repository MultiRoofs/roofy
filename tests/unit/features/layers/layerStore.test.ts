import { describe, it, expect, beforeEach } from "vitest";
import {
  computeAvailableObjectTypes,
  useLayerStore,
} from "../../../../src/features/layers/layerStore";
import type { CityModel } from "../../../../src/domain/citymodel/types";
import type { Rule } from "../../../../src/features/rules/types";

function makeModel(id = "m1"): CityModel {
  return {
    objects: {
      [id]: {
        id,
        objectType: "Building",
        surfaces: [],
        attributes: {},
        children: [],
        parents: [],
        bbox: null,
        lod: null,
      },
    },
    metadata: { referenceSystem: undefined },
    bbox: null,
  } as unknown as CityModel;
}

/** A model whose objects carry the given `objectType`s, one object each. */
function modelWithTypes(types: readonly string[]): CityModel {
  return {
    objects: Object.fromEntries(
      types.map((objectType, i) => [
        `o${i}`,
        {
          id: `o${i}`,
          objectType,
          surfaces: [],
          attributes: {},
          children: [],
          parents: [],
          bbox: null,
          lod: null,
        },
      ]),
    ),
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
    useLayerStore.setState({ layers: [] });
  });

  it("does not carry an active id (the workspace store owns it)", () => {
    expect("activeLayerId" in useLayerStore.getState()).toBe(false);
  });

  describe("addLayer", () => {
    it("adds a layer", () => {
      useLayerStore.getState().addLayer({
        name: "Layer 1",
        model: makeModel(),
        modelRef: { type: "file", fileName: "a.city.json" },
        visible: true,
        rules: [],
        rulesEnabled: true,
      });

      const { layers } = useLayerStore.getState();
      expect(layers).toHaveLength(1);
      expect(layers[0]!.name).toBe("Layer 1");
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
    it("clears all layers", () => {
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

      const layer = useLayerStore
        .getState()
        .layers.find((l) => l.id === layerId)!;
      expect(layer.rules).toHaveLength(1);
      expect(layer.rules[0]!.name).toBe("test rule");
    });

    it("updates a rule on a specific layer", () => {
      const rule = makeRule();
      useLayerStore.getState().addRule(layerId, rule);
      useLayerStore
        .getState()
        .updateRule(layerId, rule.id, { name: "updated" });

      const layer = useLayerStore
        .getState()
        .layers.find((l) => l.id === layerId)!;
      expect(layer.rules[0]!.name).toBe("updated");
    });

    it("deletes a rule from a specific layer", () => {
      const rule = makeRule();
      useLayerStore.getState().addRule(layerId, rule);
      useLayerStore.getState().deleteRule(layerId, rule.id);

      const layer = useLayerStore
        .getState()
        .layers.find((l) => l.id === layerId)!;
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

      const layer = useLayerStore
        .getState()
        .layers.find((l) => l.id === layerId)!;
      expect(layer.rules.map((r) => r.name)).toEqual(["B", "C", "A"]);
    });

    it("toggles rulesEnabled for a specific layer", () => {
      useLayerStore.getState().toggleRulesEnabled(layerId);
      const layer = useLayerStore
        .getState()
        .layers.find((l) => l.id === layerId)!;
      expect(layer.rulesEnabled).toBe(false);

      useLayerStore.getState().toggleRulesEnabled(layerId);
      const updated = useLayerStore
        .getState()
        .layers.find((l) => l.id === layerId)!;
      expect(updated.rulesEnabled).toBe(true);
    });

    it("clears all rules from a specific layer", () => {
      useLayerStore.getState().addRule(layerId, makeRule());
      useLayerStore.getState().addRule(layerId, makeRule({ name: "second" }));
      useLayerStore.getState().clearRules(layerId);

      const layer = useLayerStore
        .getState()
        .layers.find((l) => l.id === layerId)!;
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

      const other = useLayerStore
        .getState()
        .layers.find((l) => l.id === otherId)!;
      expect(other.rules).toHaveLength(0);
    });
  });

  describe("object type visibility", () => {
    it("computeAvailableObjectTypes folds second-level types into their group, dedupes and sorts", () => {
      // BuildingPart carries the geometry and Building the semantics, so a
      // list that reported both would offer two toggles for one thing.
      expect(
        computeAvailableObjectTypes(
          modelWithTypes([
            "BuildingPart",
            "Building",
            "Road",
            "BridgeInstallation",
            "BuildingPart",
          ]),
        ),
      ).toEqual(["Bridge", "Building", "Road"]);
    });

    it("computeAvailableObjectTypes keeps an unrecognised type as its own group", () => {
      expect(
        computeAvailableObjectTypes(modelWithTypes(["+Noise", "Building"])),
      ).toEqual(["+Noise", "Building"]);
    });

    it("addLayer computes availableObjectTypes and starts with nothing hidden", () => {
      const id = useLayerStore.getState().addLayer({
        name: "L",
        model: modelWithTypes(["BuildingPart", "Road"]),
        modelRef: { type: "file", fileName: "a.city.json" },
        visible: true,
        rules: [],
        rulesEnabled: true,
      });

      const layer = useLayerStore.getState().layers.find((l) => l.id === id)!;
      expect(layer.availableObjectTypes).toEqual(["Building", "Road"]);
      expect(layer.hiddenTypes).toEqual([]);
    });

    it("setHiddenTypes REPLACES the array, so downstream identity comparison sees the change", () => {
      const id = useLayerStore.getState().addLayer({
        name: "L",
        model: makeModel(),
        modelRef: { type: "file", fileName: "a.city.json" },
        visible: true,
        rules: [],
        rulesEnabled: true,
      });
      const before = useLayerStore.getState().layers[0]!.hiddenTypes;

      useLayerStore.getState().setHiddenTypes(id, ["Building"]);

      const after = useLayerStore.getState().layers[0]!.hiddenTypes;
      expect(after).toEqual(["Building"]);
      expect(after).not.toBe(before);
    });

    it("setHiddenTypes leaves other layers alone", () => {
      const first = useLayerStore.getState().addLayer({
        name: "A",
        model: makeModel(),
        modelRef: { type: "file", fileName: "a.city.json" },
        visible: true,
        rules: [],
        rulesEnabled: true,
      });
      const second = useLayerStore.getState().addLayer({
        name: "B",
        model: makeModel("m2"),
        modelRef: { type: "file", fileName: "b.city.json" },
        visible: true,
        rules: [],
        rulesEnabled: true,
      });

      useLayerStore.getState().setHiddenTypes(first, ["Building"]);

      const other = useLayerStore
        .getState()
        .layers.find((l) => l.id === second)!;
      expect(other.hiddenTypes).toEqual([]);
    });

    it("a streaming layer lists no types — its groups are discovered from the cells the worker decodes", () => {
      const id = useLayerStore.getState().addLayer({
        name: "S",
        model: modelWithTypes([]),
        modelRef: { type: "url", url: "https://x/a.fcb" },
        visible: true,
        rules: [],
        rulesEnabled: true,
        isStreaming: true,
      });

      const layer = useLayerStore.getState().layers.find((l) => l.id === id)!;
      expect(layer.availableObjectTypes).toEqual([]);
    });
  });
});
