import { describe, it, expect, beforeEach } from "vite-plus/test";
import { useSelectionStore } from "../../../../src/features/selection/selectionStore";

describe("selectionStore", () => {
  beforeEach(() => {
    useSelectionStore.setState({
      mode: "object",
      selection: null,
      hovered: null,
    });
  });

  describe("select", () => {
    it("sets object selection", () => {
      useSelectionStore.getState().select({ kind: "object", objectId: "b1" });

      expect(useSelectionStore.getState().selection).toEqual({
        kind: "object",
        objectId: "b1",
      });
    });

    it("sets surface selection", () => {
      useSelectionStore
        .getState()
        .select({ kind: "surface", objectId: "b1", surfaceIndex: 2 });

      expect(useSelectionStore.getState().selection).toEqual({
        kind: "surface",
        objectId: "b1",
        surfaceIndex: 2,
      });
    });

    it("clears selection when passed null", () => {
      useSelectionStore.getState().select({ kind: "object", objectId: "b1" });
      useSelectionStore.getState().select(null);

      expect(useSelectionStore.getState().selection).toBeNull();
    });
  });

  describe("hover", () => {
    it("sets hovered state", () => {
      useSelectionStore.getState().hover({ kind: "object", objectId: "b2" });

      expect(useSelectionStore.getState().hovered).toEqual({
        kind: "object",
        objectId: "b2",
      });
    });
  });

  describe("setMode", () => {
    it("changes mode and clears selection and hover", () => {
      useSelectionStore.getState().select({ kind: "object", objectId: "b1" });
      useSelectionStore.getState().hover({ kind: "object", objectId: "b2" });

      useSelectionStore.getState().setMode("surface");

      const state = useSelectionStore.getState();
      expect(state.mode).toBe("surface");
      expect(state.selection).toBeNull();
      expect(state.hovered).toBeNull();
    });
  });

  describe("clear", () => {
    it("clears both selection and hover", () => {
      useSelectionStore.getState().select({ kind: "object", objectId: "b1" });
      useSelectionStore.getState().hover({ kind: "object", objectId: "b2" });

      useSelectionStore.getState().clear();

      const state = useSelectionStore.getState();
      expect(state.selection).toBeNull();
      expect(state.hovered).toBeNull();
    });

    it("preserves mode when clearing", () => {
      useSelectionStore.getState().setMode("surface");
      useSelectionStore.getState().select({
        kind: "surface",
        objectId: "b1",
        surfaceIndex: 0,
      });

      useSelectionStore.getState().clear();

      expect(useSelectionStore.getState().mode).toBe("surface");
    });
  });
});
