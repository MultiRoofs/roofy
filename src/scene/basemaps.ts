/**
 * Basemap catalogue: the raster imagery the globe is draped in.
 *
 * `DefaultPlugin.addDefaultPhotorealScene()` adds a sky, stars, a sun light and
 * the post-processing chain — and NO imagery source at all (verified against
 * the 0.0.5 bundle: it is exactly `sky`, `stars`, `skyLightProbe`, `sun`,
 * `aerialPerspective`, `lensFlare`, `toneMapping`, `smaa`/`fxaa`). That is why
 * the globe rendered black: nothing was ever draped on it. The spike said as
 * much at the time — "the globe is black in both shots because the spike adds
 * no imagery/terrain source".
 *
 * Engine-free on purpose, exactly like `googleTiles.ts`: this module is pure
 * data so it can be unit-tested under Node, where `@navaramap/three` cannot
 * even be imported (NODE_IMPORT_SAFE = false). `NavaraViewport` is the only
 * caller and the only place the result meets the engine.
 *
 * Each entry carries its own ATTRIBUTION, and that is a licence obligation, not
 * a nicety: OSM tiles are ODbL, CARTO's basemaps carry both their own and OSM's
 * credit, and Esri's terms require the service credit. `AttributionOverlay`
 * renders the active entry's lines, so an option that is not on screen credits
 * nobody and an option that is on screen always does.
 */

/** The stable id persisted in the store and shown in the picker. */
export type BasemapId =
  | "none"
  | "osm"
  | "esri-imagery"
  | "carto-positron"
  | "carto-dark"
  | "elevation-heatmap";

export interface BasemapTileSource {
  readonly type: "raster-tile";
  /** `{z}/{x}/{y}` template, as the engine's `raster-tile` source expects. */
  readonly url: string;
  readonly maxZoom: number;
}

/**
 * A DEM source: the tiles carry ELEVATION in their RGB channels, not colour.
 *
 * The engine decodes them with an `ElevationDecoder`, and the one this service
 * needs is `TERRARIUM_ELEVATION_DECODER()` — an **engine export**, i.e. exactly
 * what this module may not import (see the header: `@navaramap/three` cannot be
 * imported under Node at all). So the field carries a MARKER and
 * `NavaraViewport.addBasemap` — the engine-binding site — resolves it to the
 * real decoder. The alternative, moving the catalogue into the viewport, would
 * cost the whole catalogue its unit tests to save one lookup.
 */
export interface BasemapDemSource {
  readonly type: "raster-dem";
  readonly url: string;
  /** The decoder to resolve at the engine seam. One value today; it is an
   *  enum rather than a boolean because the engine also ships `mapbox` and
   *  `japanGSI` decoders and a second DEM service would name one of those. */
  readonly elevationDecoder: "terrarium";
  /** Pixels per tile edge. Terrarium tiles are 512, not the raster default. */
  readonly tileSize: number;
  readonly maxZoom: number;
}

export type BasemapSource = BasemapTileSource | BasemapDemSource;

/**
 * Extra `raster` LAYER options an option needs, merged into the layer descriptor
 * by `addBasemap`.
 *
 * Only the elevation heatmap uses it: a `raster` layer over a `raster-dem`
 * source renders nothing legible until it is told to colourise the decoded
 * heights. Imagery options add nothing here and pass `undefined`.
 */
export interface BasemapLayerOptions {
  readonly elevationHeatmap: {
    /** The top of the colour ramp, metres. */
    readonly maxHeight: number;
    readonly minHeight: number;
    /** A logarithmic ramp, so the first few hundred metres — where almost all
     *  inhabited land is — get most of the colour range instead of one flat
     *  band at the bottom. */
    readonly logarithmic: boolean;
    /** Where the log ramp hands over, metres. */
    readonly logBoundary: number;
  };
}

export interface BasemapOption {
  readonly id: BasemapId;
  readonly label: string;
  /** `null` for "None" — the only option that adds nothing to the scene. */
  readonly source: BasemapSource | null;
  /** Extra options for the `raster` layer this option's source is drawn by, or
   *  absent for the plain imagery ones. */
  readonly layer?: BasemapLayerOptions;
  /** Credit lines shown while this basemap is in the scene. */
  readonly attribution: readonly string[];
}

/**
 * The options offered by the picker, in menu order.
 *
 * "None" is first because it is the escape hatch (and the one option that is
 * meaningful with Google's photorealistic tiles switched on), but it is NOT the
 * default: a viewer whose globe is black out of the box reads as broken.
 */
export const BASEMAPS: readonly BasemapOption[] = [
  { id: "none", label: "None", source: null, attribution: [] },
  {
    id: "osm",
    label: "OpenStreetMap",
    source: {
      type: "raster-tile",
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      maxZoom: 19,
    },
    attribution: ["© OpenStreetMap contributors"],
  },
  {
    id: "esri-imagery",
    label: "Esri World Imagery",
    source: {
      type: "raster-tile",
      // NOTE the axis order: this service is `{z}/{y}/{x}`, not `{z}/{x}/{y}`.
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      maxZoom: 19,
    },
    // The service's OWN `copyrightText`, verbatim from
    // `…/World_Imagery/MapServer?f=json`. Not a shortened "© Esri": the
    // imagery is a composite and the terms require the whole line.
    attribution: [
      "Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community",
    ],
  },
  {
    id: "carto-positron",
    label: "CartoDB Positron",
    source: {
      type: "raster-tile",
      url: "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      maxZoom: 19,
    },
    attribution: ["© CARTO", "© OpenStreetMap contributors"],
  },
  {
    id: "carto-dark",
    label: "CartoDB Dark Matter",
    // Positron's twin — same service, same tile scheme, the `dark_all` style.
    // A normal option in its own right, and the sheet the CYBER theme is drawn
    // on: it keeps STREETS legible under a night look, where "none" leaves a
    // black void with buildings floating in it.
    source: {
      type: "raster-tile",
      url: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      maxZoom: 19,
    },
    attribution: ["© CARTO", "© OpenStreetMap contributors"],
  },
  {
    id: "elevation-heatmap",
    label: "Elevation heatmap",
    // NOT imagery: a DEM read as data and colourised by the engine, which is
    // why this is the one option with a `layer` block. The terrarium tiles are
    // the same Re:Earth service the terrain mesh and the geoid already come
    // from (`terrain.ts`, `geoidHeight.ts`), so nothing new is fetched from
    // anywhere new — only decoded differently.
    source: {
      type: "raster-dem",
      url: "https://terrain.reearth.land/terrarium/elevation/{z}/{x}/{y}.png",
      // A marker; `NavaraViewport.addBasemap` swaps in the engine's real
      // `TERRARIUM_ELEVATION_DECODER()`.
      elevationDecoder: "terrarium",
      tileSize: 512,
      maxZoom: 15,
    },
    // The engine's own example's numbers. `maxHeight` is deliberately well
    // below Everest: a ramp that has to reach 8848 m spends its whole range on
    // land nobody is analysing rooftops on, and the log ramp below 1000 m is
    // what keeps a Dutch city from being one flat colour.
    layer: {
      elevationHeatmap: {
        maxHeight: 3200,
        minHeight: 0,
        logarithmic: true,
        logBoundary: 1000,
      },
    },
    // `terrain.ts` credits only what the geoid lines do not already say, and
    // the same reasoning gives a DIFFERENT answer here. The overlay dedupes by
    // exact string, and the geoid's Mapterhorn line is
    // "Geoid (EGM2008): © Mapterhorn, CC BY 4.0" — a credit for the geoid
    // dataset specifically. This option puts Mapterhorn's ELEVATION data on
    // screen as the picture itself, which CC BY 4.0 asks be credited in its
    // own right, so the bare line stands beside the geoid's rather than being
    // folded into it.
    attribution: ["Elevation: © Re:Earth Terrain", "© Mapterhorn, CC BY 4.0"],
  },
] as const;

/**
 * What a fresh session shows: imagery, so the globe is never blank.
 *
 * SATELLITE, not the cartographic OSM sheet. Under the physical-atmosphere
 * calibration the globe is unlit albedo lit by the aerial-perspective pass at
 * exposure ~10, and OSM's tiles are essentially white paper: they blow out
 * where photographic imagery reads naturally (measured — see
 * docs/superpowers/research/2026-08-04-overbright-scene-diagnosis.md). OSM and
 * Positron stay in the picker; they are just not what a fresh session opens on.
 */
export const DEFAULT_BASEMAP_ID: BasemapId = "esri-imagery";

/** The option for an id, falling back to the default for anything unknown (a
 *  stale share link, a hand-edited snapshot). Never throws — a bad id must not
 *  cost the user their scene. */
export function basemapById(id: string): BasemapOption {
  return (
    BASEMAPS.find((b) => b.id === id) ??
    BASEMAPS.find((b) => b.id === DEFAULT_BASEMAP_ID)!
  );
}
