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
  TILES3D_MAX_SSE,
  geoLayerDescription,
  geoSourceDescription,
} from "../../../src/scene/geoLayerDescriptions";
import {
  DEFAULT_GEO_LAYER_STYLE,
  hexColorToNumber,
} from "../../../src/features/geoLayers/geoLayerStyle";
import type { GeoLayer } from "../../../src/features/geoLayers/geoLayerStore";

const SOURCE = { id: "src-1" };

/** The accent the app shipped with, now reached through the style record. */
const DEFAULT_ACCENT = hexColorToNumber(DEFAULT_GEO_LAYER_STYLE.color);

function geojson(config: GeoLayer["config"], patch: Partial<GeoLayer> = {}) {
  return {
    id: "g1",
    name: "roads",
    kind: "geojson",
    visible: true,
    opacity: 1,
    style: DEFAULT_GEO_LAYER_STYLE,
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
      style: DEFAULT_GEO_LAYER_STYLE,
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
      style: DEFAULT_GEO_LAYER_STYLE,
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
      style: DEFAULT_GEO_LAYER_STYLE,
      config: { url: "https://x/tileset.json" },
    } as GeoLayer;

    expect(geoSourceDescription(layer)).toEqual({
      type: "3d-tiles",
      url: "https://x/tileset.json",
    });
  });
});

describe("geoLayerDescription", () => {
  it("styles a default-styled GeoJSON exactly as the old constants did", () => {
    const desc = geoLayerDescription(
      geojson({ url: "https://x/a.geojson" }),
      SOURCE,
    );

    expect(desc.type).toBe("vector");
    expect(desc.source).toBe(SOURCE);
    // The literal numbers, not just `DEFAULT_GEO_LAYER_STYLE` echoed back:
    // making the style editable must not have restyled anybody's workspace.
    expect(DEFAULT_ACCENT).toBe(0xf2683c);
    expect(desc.point).toEqual({
      color: 0xf2683c,
      size: 24,
      // PIXELS. In metres a 24 unit sprite is invisible from a city-wide
      // camera and a blot from a rooftop one.
      sizeInMeters: false,
      clampToGround: true,
      show: true,
      opacity: 1,
    });
    expect(desc.polyline).toMatchObject({
      color: 0xf2683c,
      width: 2,
      clampToGround: true,
      show: true,
    });
    expect(desc.polygon).toMatchObject({
      color: 0xf2683c,
      clampToGround: true,
      show: true,
      opacity: 1,
      transparent: false,
    });
  });

  it("draws GeoJSON with the layer's OWN style, not the default", () => {
    const desc = geoLayerDescription(
      geojson(
        { url: "https://x/a.geojson" },
        {
          style: {
            color: "#00ff00",
            pointSizePx: 10,
            lineWidthPx: 5,
            fillOpacity: 0.5,
          },
        },
      ),
      SOURCE,
    );

    expect(desc.point).toMatchObject({ color: 0x00ff00, size: 10 });
    expect(desc.polyline).toMatchObject({ color: 0x00ff00, width: 5 });
    // Point and polyline carry the LAYER's opacity; only the fill is scaled.
    expect(desc.point).toMatchObject({ opacity: 1 });
    expect(desc.polyline).toMatchObject({ opacity: 1 });
    expect(desc.polygon).toMatchObject({
      color: 0x00ff00,
      opacity: 0.5,
      transparent: true,
    });
  });

  it("falls back to the default accent for an unparsable stored colour", () => {
    // A hand-edited share link or snapshot document: the store normalises, but
    // the description must not hand the engine a NaN colour if one slips past.
    const desc = geoLayerDescription(
      geojson(
        { url: "https://x/a.geojson" },
        {
          style: {
            ...DEFAULT_GEO_LAYER_STYLE,
            color: "rebeccapurple",
          },
        },
      ),
      SOURCE,
    );

    expect(desc.point).toMatchObject({ color: 0xf2683c });
    expect(desc.polyline).toMatchObject({ color: 0xf2683c });
    expect(desc.polygon).toMatchObject({ color: 0xf2683c });
  });

  it("multiplies the fill opacity by the layer's own opacity", () => {
    const desc = geoLayerDescription(
      geojson(
        { url: "https://x/a.geojson" },
        {
          opacity: 0.5,
          style: { ...DEFAULT_GEO_LAYER_STYLE, fillOpacity: 0.5 },
        },
      ),
      SOURCE,
    );

    expect(desc.polygon).toMatchObject({ opacity: 0.25, transparent: true });
    // The layer opacity alone reaches the point and line passes.
    expect(desc.point).toMatchObject({ opacity: 0.5 });
    expect(desc.polyline).toMatchObject({ opacity: 0.5 });
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
      style: DEFAULT_GEO_LAYER_STYLE,
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
      style: DEFAULT_GEO_LAYER_STYLE,
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
