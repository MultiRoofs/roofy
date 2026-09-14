import { describe, it, expect, beforeEach } from "vitest";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";
import { useSelectionStore } from "../../../../src/features/selection/selectionStore";

describe("workspaceStore", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      activeLayerId: null,
      name: "Untitled workspace",
    });
    useSelectionStore.setState({
      selections: [],
      hovered: null,
      geoSelection: null,
      mode: "object",
    });
  });

  it("starts with no active layer", () => {
    expect(useWorkspaceStore.getState().activeLayerId).toBeNull();
  });

  it("sets and clears the active layer id", () => {
    useWorkspaceStore.getState().setActiveLayerId("a");
    expect(useWorkspaceStore.getState().activeLayerId).toBe("a");
    useWorkspaceStore.getState().setActiveLayerId(null);
    expect(useWorkspaceStore.getState().activeLayerId).toBeNull();
  });

  describe("rule 1: activating a layer clears a foreign selection", () => {
    it("clears a city selection that belongs to another layer", () => {
      useSelectionStore
        .getState()
        .select({ kind: "object", layerId: "a", objectId: "o1" });
      useWorkspaceStore.getState().setActiveLayerId("b");
      expect(useSelectionStore.getState().selections).toEqual([]);
      expect(useWorkspaceStore.getState().activeLayerId).toBe("b");
    });

    it("keeps a selection that belongs to the layer being activated", () => {
      useSelectionStore
        .getState()
        .select({ kind: "object", layerId: "a", objectId: "o1" });
      useWorkspaceStore.getState().setActiveLayerId("a");
      expect(useSelectionStore.getState().selections).toHaveLength(1);
    });

    it("clears a geo selection that belongs to another layer", () => {
      useSelectionStore
        .getState()
        .selectGeoFeature({ geoLayerId: "g", batchId: 0, properties: {} });
      useWorkspaceStore.getState().setActiveLayerId("a");
      expect(useSelectionStore.getState().geoSelection).toBeNull();
    });

    it("clears a foreign selection when the active layer is cleared", () => {
      useSelectionStore
        .getState()
        .select({ kind: "object", layerId: "a", objectId: "o1" });
      useWorkspaceStore.getState().setActiveLayerId(null);
      expect(useSelectionStore.getState().selections).toEqual([]);
    });
  });

  describe("name", () => {
    it("defaults to Untitled workspace", () => {
      expect(useWorkspaceStore.getState().name).toBe("Untitled workspace");
    });

    it("sets a trimmed name", () => {
      useWorkspaceStore.getState().setName("  Delft city model  ");
      expect(useWorkspaceStore.getState().name).toBe("Delft city model");
    });

    it("falls back to the default when set to an empty or blank string", () => {
      useWorkspaceStore.getState().setName("Delft");
      useWorkspaceStore.getState().setName("   ");
      expect(useWorkspaceStore.getState().name).toBe("Untitled workspace");

      useWorkspaceStore.getState().setName("Delft");
      useWorkspaceStore.getState().setName("");
      expect(useWorkspaceStore.getState().name).toBe("Untitled workspace");
    });

    it("resetName restores the default", () => {
      useWorkspaceStore.getState().setName("Delft city model");
      useWorkspaceStore.getState().resetName();
      expect(useWorkspaceStore.getState().name).toBe("Untitled workspace");
    });
  });
});
