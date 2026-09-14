import { beforeEach, expect, it } from "vitest";
import { useGeoLayerStore } from "../../../../src/features/geoLayers/geoLayerStore";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";
import {
  ensureDelftLandUse,
  DELFT_LANDUSE_URL,
} from "../../../../src/features/walkthrough/delftLandUse";
beforeEach(() => {
  useGeoLayerStore.setState({ layers: [] });
  useWorkspaceStore.setState({ activeLayerId: "city" });
});
it("adds the URL-backed land-use overlay once without changing the active city", () => {
  const first = ensureDelftLandUse();
  expect(ensureDelftLandUse()).toBe(first);
  expect(useGeoLayerStore.getState().layers).toHaveLength(1);
  expect(useGeoLayerStore.getState().layers[0]).toMatchObject({
    kind: "geojson",
    config: { url: DELFT_LANDUSE_URL },
  });
  expect(useWorkspaceStore.getState().activeLayerId).toBe("city");
});
