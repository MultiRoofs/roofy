import { afterEach, it, expect } from "vitest";
import { useDrawStore } from "../../../../src/features/drawing/drawStore";
import { useGeoLayerStore } from "../../../../src/features/geoLayers/geoLayerStore";
afterEach(() => {
  useDrawStore.getState().finish();
  useGeoLayerStore.setState({ layers: [] });
});
it("reuses an existing draft but replaces a deleted draft", () => {
  useDrawStore.getState().create();
  const first = useDrawStore.getState().layerId!;
  useDrawStore.getState().start();
  expect(useGeoLayerStore.getState().layers).toHaveLength(1);
  useGeoLayerStore.getState().removeGeoLayer(first);
  useDrawStore.getState().create();
  useDrawStore.getState().start();
  expect(useDrawStore.getState().layerId).not.toBe(first);
  expect(useDrawStore.getState().active).toBe(true);
});
it("cannot enter draw mode without selecting its draw layer", async () => {
  const { useWorkspaceStore } =
    await import("../../../../src/features/workspace/workspaceStore");
  useDrawStore.getState().create();
  useWorkspaceStore.setState({ activeLayerId: "another-layer" });
  useDrawStore.getState().start();
  expect(useDrawStore.getState().active).toBe(false);
  expect(useWorkspaceStore.getState().activeLayerId).toBe("another-layer");
});
it("stops drawing as soon as a different layer is selected", async () => {
  const { useWorkspaceStore } =
    await import("../../../../src/features/workspace/workspaceStore");
  useDrawStore.getState().create();
  useDrawStore.getState().start();
  expect(useDrawStore.getState().active).toBe(true);
  useWorkspaceStore.setState({ activeLayerId: "other" });
  expect(useDrawStore.getState().active).toBe(false);
});
