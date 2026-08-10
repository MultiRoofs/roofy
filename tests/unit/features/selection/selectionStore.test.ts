import { describe, it, expect, beforeEach } from "vitest";
import { useSelectionStore } from "../../../../src/features/selection/selectionStore";

describe("selectionStore", () => {
  beforeEach(() => {
    useSelectionStore.setState({
      mode: "object",
      toolMode: "select",
      selections: [],
      hovered: null,
      geoSelection: null,
    });
  });

  const geoSel = {
    geoLayerId: "geo-1",
    batchId: 7,
    properties: { name: "Parcel A" },
  };
  const citySel = {
    kind: "object",
    layerId: "layer-1",
    objectId: "b1",
  } as const;

  describe("select", () => {
    it("sets object selection", () => {
      useSelectionStore
        .getState()
        .select({ kind: "object", layerId: "layer-1", objectId: "b1" });

      expect(useSelectionStore.getState().selections).toEqual([
        { kind: "object", layerId: "layer-1", objectId: "b1" },
      ]);
    });

    it("sets surface selection", () => {
      useSelectionStore.getState().select({
        kind: "surface",
        layerId: "layer-1",
        objectId: "b1",
        surfaceIndex: 2,
      });

      expect(useSelectionStore.getState().selections).toEqual([
        {
          kind: "surface",
          layerId: "layer-1",
          objectId: "b1",
          surfaceIndex: 2,
        },
      ]);
    });

    it("replaces any existing selections with a single item", () => {
      useSelectionStore
        .getState()
        .select({ kind: "object", layerId: "layer-1", objectId: "b1" });
      useSelectionStore
        .getState()
        .select({ kind: "object", layerId: "layer-1", objectId: "b2" });

      expect(useSelectionStore.getState().selections).toEqual([
        { kind: "object", layerId: "layer-1", objectId: "b2" },
      ]);
    });

    it("clears selection when passed null", () => {
      useSelectionStore
        .getState()
        .select({ kind: "object", layerId: "layer-1", objectId: "b1" });
      useSelectionStore.getState().select(null);

      expect(useSelectionStore.getState().selections).toEqual([]);
    });
  });

  describe("toggleSelect", () => {
    it("adds a new selection to the same layer", () => {
      useSelectionStore
        .getState()
        .select({ kind: "object", layerId: "layer-1", objectId: "b1" });
      useSelectionStore
        .getState()
        .toggleSelect({ kind: "object", layerId: "layer-1", objectId: "b2" });

      expect(useSelectionStore.getState().selections).toEqual([
        { kind: "object", layerId: "layer-1", objectId: "b1" },
        { kind: "object", layerId: "layer-1", objectId: "b2" },
      ]);
    });

    it("removes an already-selected item", () => {
      useSelectionStore
        .getState()
        .select({ kind: "object", layerId: "layer-1", objectId: "b1" });
      useSelectionStore
        .getState()
        .toggleSelect({ kind: "object", layerId: "layer-1", objectId: "b1" });

      expect(useSelectionStore.getState().selections).toEqual([]);
    });

    it("drops selections from other layers when adding", () => {
      useSelectionStore
        .getState()
        .select({ kind: "object", layerId: "layer-1", objectId: "b1" });
      useSelectionStore
        .getState()
        .toggleSelect({ kind: "object", layerId: "layer-2", objectId: "b2" });

      expect(useSelectionStore.getState().selections).toEqual([
        { kind: "object", layerId: "layer-2", objectId: "b2" },
      ]);
    });
  });

  describe("selectMany", () => {
    it("replaces selections with a batch from a single layer", () => {
      useSelectionStore.getState().selectMany([
        { kind: "object", layerId: "layer-1", objectId: "b1" },
        { kind: "object", layerId: "layer-1", objectId: "b2" },
      ]);

      expect(useSelectionStore.getState().selections).toEqual([
        { kind: "object", layerId: "layer-1", objectId: "b1" },
        { kind: "object", layerId: "layer-1", objectId: "b2" },
      ]);
    });

    it("filters out selections from other layers", () => {
      useSelectionStore.getState().selectMany([
        { kind: "object", layerId: "layer-1", objectId: "b1" },
        { kind: "object", layerId: "layer-2", objectId: "b2" },
      ]);

      expect(useSelectionStore.getState().selections).toEqual([
        { kind: "object", layerId: "layer-1", objectId: "b1" },
      ]);
    });

    it("clears selections when passed an empty array", () => {
      useSelectionStore
        .getState()
        .select({ kind: "object", layerId: "layer-1", objectId: "b1" });
      useSelectionStore.getState().selectMany([]);

      expect(useSelectionStore.getState().selections).toEqual([]);
    });
  });

  describe("hover", () => {
    it("sets hovered state", () => {
      useSelectionStore
        .getState()
        .hover({ kind: "object", layerId: "layer-1", objectId: "b2" });

      expect(useSelectionStore.getState().hovered).toEqual({
        kind: "object",
        layerId: "layer-1",
        objectId: "b2",
      });
    });
  });

  describe("setMode", () => {
    it("changes mode and clears selection and hover", () => {
      useSelectionStore
        .getState()
        .select({ kind: "object", layerId: "layer-1", objectId: "b1" });
      useSelectionStore
        .getState()
        .hover({ kind: "object", layerId: "layer-1", objectId: "b2" });

      useSelectionStore.getState().setMode("surface");

      const state = useSelectionStore.getState();
      expect(state.mode).toBe("surface");
      expect(state.selections).toEqual([]);
      expect(state.hovered).toBeNull();
    });
  });

  describe("setToolMode", () => {
    it("changes tool mode and clears hover", () => {
      useSelectionStore
        .getState()
        .hover({ kind: "object", layerId: "layer-1", objectId: "b2" });

      useSelectionStore.getState().setToolMode("box-select");

      const state = useSelectionStore.getState();
      expect(state.toolMode).toBe("box-select");
      expect(state.hovered).toBeNull();
    });
  });

  describe("clear", () => {
    it("clears both selection and hover", () => {
      useSelectionStore
        .getState()
        .select({ kind: "object", layerId: "layer-1", objectId: "b1" });
      useSelectionStore
        .getState()
        .hover({ kind: "object", layerId: "layer-1", objectId: "b2" });

      useSelectionStore.getState().clear();

      const state = useSelectionStore.getState();
      expect(state.selections).toEqual([]);
      expect(state.hovered).toBeNull();
    });

    it("preserves mode when clearing", () => {
      useSelectionStore.getState().setMode("surface");
      useSelectionStore.getState().select({
        kind: "surface",
        layerId: "layer-1",
        objectId: "b1",
        surfaceIndex: 0,
      });

      useSelectionStore.getState().clear();

      expect(useSelectionStore.getState().mode).toBe("surface");
    });
  });

  describe("selectGeoFeature", () => {
    it("sets the geo selection and clears city selections", () => {
      useSelectionStore.getState().select(citySel);

      useSelectionStore.getState().selectGeoFeature(geoSel);

      const state = useSelectionStore.getState();
      expect(state.geoSelection).toEqual(geoSel);
      expect(state.selections).toEqual([]);
    });

    it("clears only the geo selection when passed null", () => {
      useSelectionStore.getState().selectGeoFeature(geoSel);
      useSelectionStore.getState().selectGeoFeature(null);

      expect(useSelectionStore.getState().geoSelection).toBeNull();
    });

    it("leaves a later city selection intact when cleared with null", () => {
      useSelectionStore.getState().selectGeoFeature(geoSel);
      useSelectionStore.getState().select(citySel);
      useSelectionStore.getState().selectGeoFeature(null);

      const state = useSelectionStore.getState();
      expect(state.geoSelection).toBeNull();
      expect(state.selections).toEqual([citySel]);
    });

    it("starts null", () => {
      expect(useSelectionStore.getState().geoSelection).toBeNull();
    });
  });

  describe("geo selection is mutually exclusive with city selection", () => {
    it("select clears the geo selection", () => {
      useSelectionStore.getState().selectGeoFeature(geoSel);
      useSelectionStore.getState().select(citySel);

      const state = useSelectionStore.getState();
      expect(state.geoSelection).toBeNull();
      expect(state.selections).toEqual([citySel]);
    });

    it("select(null) — a miss — clears the geo selection too", () => {
      useSelectionStore.getState().selectGeoFeature(geoSel);
      useSelectionStore.getState().select(null);

      const state = useSelectionStore.getState();
      expect(state.geoSelection).toBeNull();
      expect(state.selections).toEqual([]);
    });

    it("toggleSelect clears the geo selection", () => {
      useSelectionStore.getState().selectGeoFeature(geoSel);
      useSelectionStore.getState().toggleSelect(citySel);

      const state = useSelectionStore.getState();
      expect(state.geoSelection).toBeNull();
      expect(state.selections).toEqual([citySel]);
    });

    it("toggleSelect clears the geo selection when removing an item", () => {
      useSelectionStore.getState().selectGeoFeature(geoSel);
      useSelectionStore.setState({ selections: [citySel] });

      useSelectionStore.getState().toggleSelect(citySel);

      const state = useSelectionStore.getState();
      expect(state.geoSelection).toBeNull();
      expect(state.selections).toEqual([]);
    });

    it("selectMany clears the geo selection", () => {
      useSelectionStore.getState().selectGeoFeature(geoSel);
      useSelectionStore.getState().selectMany([citySel]);

      const state = useSelectionStore.getState();
      expect(state.geoSelection).toBeNull();
      expect(state.selections).toEqual([citySel]);
    });

    it("selectMany with an empty batch clears the geo selection", () => {
      useSelectionStore.getState().selectGeoFeature(geoSel);
      useSelectionStore.getState().selectMany([]);

      const state = useSelectionStore.getState();
      expect(state.geoSelection).toBeNull();
      expect(state.selections).toEqual([]);
    });

    it("clear clears both", () => {
      useSelectionStore.getState().selectGeoFeature(geoSel);
      useSelectionStore.setState({ selections: [citySel] });

      useSelectionStore.getState().clear();

      const state = useSelectionStore.getState();
      expect(state.geoSelection).toBeNull();
      expect(state.selections).toEqual([]);
      expect(state.hovered).toBeNull();
    });

    it("setMode clears both", () => {
      useSelectionStore.getState().selectGeoFeature(geoSel);
      useSelectionStore.setState({ selections: [citySel] });

      useSelectionStore.getState().setMode("surface");

      const state = useSelectionStore.getState();
      expect(state.mode).toBe("surface");
      expect(state.geoSelection).toBeNull();
      expect(state.selections).toEqual([]);
    });
  });
});
