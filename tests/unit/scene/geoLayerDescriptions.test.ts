/**
 * The plain-data source/layer descriptions a geospatial layer becomes.
 *
 * Pinned literally, exactly as `basemaps.ts` and `terrain.ts` are: these are
 * the only place the app states what a user-supplied GeoJSON looks like, and
 * an accidental edit to a default (a point size in metres, a polygon that no
 * longer clamps to the ground) is invisible in a screenshot and obvious here.
 */
import { describe, expect, it } from "vitest";
import {
  GEO_ACCENT_COLOR,
  GEOJSON_POINT_SIZE_PX,
  TILES3D_MAX_SSE,
  geoLayerDescription,
  geoSourceDescription,
} from "../../../src/scene/geoLayerDescriptions";
import type { GeoLayer } from "../../../src/features/geoLayers/geoLayerStore";

const SOURCE = { id: "src-1" };

function geojson(config: GeoLayer["config"], patch: Partial<GeoLayer> = {}) {
  return {
    id: "g1",
    name: "roads",
    kind: "geojson",
    visible: true,
    opacity: 1,
    config,
    ...patch,
  } as GeoLayer;
}

describe("geoSourceDescription", () => {
  // NOT tiled, and that is load-bearing: with `tiled: true` Navara 0.0.5
  // renders NOTHING for a geojson source (verified in the browser against the
  // Delft fixture — the bare form is also the only one the engine's own
  // examples use). Re-test before ever reintroducing the GeoJSON-VT index.
  it("builds a geojson source from a URL", () => {
    expect(
      geoSourceDescription(geojson({ url: "https://x/a.geojson" })),
    ).toEqual({
      type: "geojson",
      url: "https://x/a.geojson",
    });
  });

  it("builds a geojson source from an inline document", () => {
    const data = { type: "FeatureCollection", features: [] };
    expect(geoSourceDescription(geojson({ data }))).toEqual({
      type: "geojson",
      data,
    });
  });

  it("answers null for a GeoJSON layer with nothing to load", () => {
    // The restored-from-a-snapshot case: the inline document was never
    // persisted, so there is no source to add until the file is re-linked.
    expect(geoSourceDescription(geojson({}))).toBeNull();
  });

  it("omits absent raster tile bounds rather than writing undefined", () => {
    const layer = {
      id: "r1",
      name: "tiles",
      kind: "raster-xyz",
      visible: true,
      opacity: 1,
      config: { urlTemplate: "https://t/{z}/{x}/{y}.png" },
    } as GeoLayer;

    expect(geoSourceDescription(layer)).toEqual({
      type: "raster-tile",
      url: "https://t/{z}/{x}/{y}.png",
    });
  });

  it("carries the raster tile bounds it was given", () => {
    const layer = {
      id: "r1",
      name: "tiles",
      kind: "raster-xyz",
      visible: true,
      opacity: 1,
      config: {
        urlTemplate: "https://t/{z}/{x}/{y}.png",
        minZoom: 2,
        maxZoom: 19,
        tms: true,
      },
    } as GeoLayer;

    expect(geoSourceDescription(layer)).toEqual({
      type: "raster-tile",
      url: "https://t/{z}/{x}/{y}.png",
      minZoom: 2,
      maxZoom: 19,
      tms: true,
    });
  });

  it("builds a 3d-tiles source from the tileset URL", () => {
    const layer = {
      id: "t1",
      name: "tileset",
      kind: "3d-tiles",
      visible: true,
      opacity: 1,
      config: { url: "https://x/tileset.json" },
    } as GeoLayer;

    expect(geoSourceDescription(layer)).toEqual({
      type: "3d-tiles",
      url: "https://x/tileset.json",
    });
  });
});

describe("geoLayerDescription", () => {
  it("styles GeoJSON with one theme-agnostic accent, clamped to the ground", () => {
    const desc = geoLayerDescription(
      geojson({ url: "https://x/a.geojson" }),
      SOURCE,
    );

    expect(desc.type).toBe("vector");
    expect(desc.source).toBe(SOURCE);
    expect(desc.point).toEqual({
      color: GEO_ACCENT_COLOR,
      size: GEOJSON_POINT_SIZE_PX,
      // PIXELS. In metres a 24 unit sprite is invisible from a city-wide
      // camera and a blot from a rooftop one.
      sizeInMeters: false,
      clampToGround: true,
      show: true,
      opacity: 1,
    });
    expect(desc.polyline).toMatchObject({
      color: GEO_ACCENT_COLOR,
      clampToGround: true,
      show: true,
    });
    expect(desc.polygon).toMatchObject({
      color: GEO_ACCENT_COLOR,
      clampToGround: true,
      show: true,
    });
  });

  it("hides every geometry class of an invisible GeoJSON layer", () => {
    const desc = geoLayerDescription(
      geojson({ url: "https://x/a.geojson" }, { visible: false }),
      SOURCE,
    );

    for (const key of ["point", "polyline", "polygon"] as const) {
      expect((desc[key] as { show: boolean }).show).toBe(false);
    }
  });

  it("marks a translucent polygon transparent, or the opacity is ignored", () => {
    const desc = geoLayerDescription(
      geojson({ url: "https://x/a.geojson" }, { opacity: 0.4 }),
      SOURCE,
    );

    expect(desc.polygon).toMatchObject({ opacity: 0.4, transparent: true });
  });

  it("puts a raster layer's opacity and visibility on its raster material", () => {
    const layer = {
      id: "r1",
      name: "tiles",
      kind: "raster-xyz",
      visible: false,
      opacity: 0.5,
      config: { urlTemplate: "https://t/{z}/{x}/{y}.png" },
    } as GeoLayer;

    expect(geoLayerDescription(layer, SOURCE)).toEqual({
      type: "raster",
      source: SOURCE,
      raster: { opacity: 0.5, show: false },
    });
  });

  it("gives a 3D tileset the model appearance the viewer's lighting expects", () => {
    const layer = {
      id: "t1",
      name: "tileset",
      kind: "3d-tiles",
      visible: true,
      opacity: 1,
      config: { url: "https://x/tileset.json" },
    } as GeoLayer;

    expect(geoLayerDescription(layer, SOURCE)).toEqual({
      type: "3d-tiles",
      source: SOURCE,
      model: {
        castShadow: false,
        receiveShadow: true,
        maxSse: TILES3D_MAX_SSE,
        show: true,
        opacity: 1,
        transparent: false,
      },
    });
  });
});
