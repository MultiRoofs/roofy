import { it, expect } from "vitest";
import {
  drawnModel,
  modelDataUrl,
} from "../../../../src/features/drawing/geometry";
it("creates a closed extrusion with vertical height and a portable source", () => {
  const m = drawnModel(
    [
      [4, 52, 2],
      [4.001, 52, 2],
      [4.001, 52.001, 2],
      [4, 52.001, 2],
    ],
    12,
  );
  expect(m.objects.drawn?.surfaces).toHaveLength(6);
  expect(m.bbox?.[5]).toBe(14);
  expect(
    JSON.parse(decodeURIComponent(modelDataUrl(m).split(",")[1]!)).vertices,
  ).toHaveLength(24);
});
it("rejects crossing footprints", () => {
  expect(() =>
    drawnModel(
      [
        [4, 52, 0],
        [4.01, 52.01, 0],
        [4, 52.01, 0],
        [4.01, 52, 0],
      ],
      2,
    ),
  ).toThrow();
});
it("rejects nonfinite coordinates and polar footprints", () => {
  expect(() =>
    drawnModel(
      [
        [4, 90, 0],
        [4.1, 90, 0],
        [4.1, 89, 0],
      ],
      1,
    ),
  ).toThrow();
  expect(() =>
    drawnModel(
      [
        [4, 52, NaN],
        [4.1, 52, 0],
        [4.1, 52.1, 0],
      ],
      1,
    ),
  ).toThrow();
});
it("preserves semantic surface types in the portable source", () => {
  const model = drawnModel(
    [
      [4, 52, 0],
      [4.001, 52, 0],
      [4, 52.001, 0],
    ],
    5,
  );
  const json = JSON.parse(
    decodeURIComponent(modelDataUrl(model).split(",")[1]!),
  );
  expect(json.CityObjects.drawn.geometry[0].semantics.surfaces[1].type).toBe(
    "RoofSurface",
  );
});
it("reloads a serialized drawing through the normal URL loader", async () => {
  const { loadFromUrl } =
    await import("../../../../src/domain/citymodel/loadCityModel");
  const model = drawnModel(
    [
      [4, 52, 3],
      [4.001, 52, 3],
      [4, 52.001, 3],
    ],
    12,
  );
  const ref = JSON.parse(
    JSON.stringify({ type: "url", url: modelDataUrl(model) }),
  );
  const loaded = await loadFromUrl(ref.url);
  expect(loaded.model.objects.drawn?.surfaces.map((s) => s.type)).toEqual(
    model.objects.drawn?.surfaces.map((s) => s.type),
  );
  expect(loaded.model.bbox).toEqual(model.bbox);
});
