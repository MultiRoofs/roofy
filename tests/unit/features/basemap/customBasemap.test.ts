import { expect, it } from "vitest";
import { customBasemapOption } from "../../../../src/features/basemap/customBasemap";
it("builds an XYZ source and rejects incomplete or unsafe templates", () => {
  expect(
    customBasemapOption({
      title: " My map ",
      url: "https://tiles.example/{z}/{x}/{y}.png",
    })?.source,
  ).toMatchObject({
    type: "raster-tile",
    url: "https://tiles.example/{z}/{x}/{y}.png",
  });
  expect(
    customBasemapOption({
      title: "",
      url: "https://tiles.example/{z}/{x}/{y}",
    }),
  ).toBeNull();
  expect(
    customBasemapOption({ title: "Map", url: "javascript:{z}/{x}/{y}" }),
  ).toBeNull();
  expect(
    customBasemapOption({ title: "Map", url: "https://tiles.example/{z}/{x}" }),
  ).toBeNull();
});
import {
  captureBasemap,
  restoreBasemap,
} from "../../../../src/features/basemap/basemapPersistence";
import { useBasemapStore } from "../../../../src/features/basemap/basemapStore";
it("restores custom map settings and defaults for older workspaces", () => {
  useBasemapStore
    .getState()
    .setCustom({ title: "Map", url: "https://tiles.example/{z}/{x}/{y}.png" });
  const saved = captureBasemap();
  useBasemapStore.getState().setBasemapId("none");
  restoreBasemap(saved);
  expect(useBasemapStore.getState().basemapId).toBe("custom");
  expect(useBasemapStore.getState().custom?.title).toBe("Map");
  restoreBasemap(undefined);
  expect(useBasemapStore.getState().basemapId).not.toBe("custom");
});
