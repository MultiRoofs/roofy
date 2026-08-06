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
  | "carto-dark";

export interface BasemapSource {
  readonly type: "raster-tile";
  /** `{z}/{x}/{y}` template, as the engine's `raster-tile` source expects. */
  readonly url: string;
  readonly maxZoom: number;
}

export interface BasemapOption {
  readonly id: BasemapId;
  readonly label: string;
  /** `null` for "None" — the only option that adds nothing to the scene. */
  readonly source: BasemapSource | null;
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
