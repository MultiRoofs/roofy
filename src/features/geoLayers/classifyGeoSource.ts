/**
 * What a pasted URL is, and whether a dropped file is GeoJSON at all.
 *
 * Both answers are derived from the input alone — nothing here fetches
 * anything — so the Add-Layer dialog can classify as the user types and this
 * module stays a pure, table-tested unit. Engine-free by construction; it does
 * not even import the store's runtime, only its types.
 */
import type { GeoLayerInput, GeoLayerKind } from "./geoLayerStore";

/** The XYZ placeholders. One is enough: a service may hard-code the others
 *  into its path (`/12/{x}/{y}.png` is a real, if odd, template), and nothing
 *  else in this app's vocabulary uses braces in a URL. */
const XYZ_PLACEHOLDER = /\{\s*[zxy]\s*\}/i;

/** The path a 3D Tiles tileset always ends in. Matched against the PATH only,
 *  so `…/tileset.json?key=…` still classifies — an API key on the end of the
 *  URL is the norm, not the exception. */
const TILESET_PATH = /tileset\.json$/i;

/** The part of a URL before any query string or fragment. */
function pathOf(url: string): string {
  return url.split("#")[0]!.split("?")[0]!;
}

/**
 * Classify a URL by SHAPE.
 *
 * Template first: a URL with `{z}`/`{x}`/`{y}` in it is a tile template
 * whatever its tail says, because nothing fetches one tileset per tile. Then
 * the tileset path. Everything else is treated as GeoJSON — the honest
 * default, since it is the only one of the three that can be an arbitrary
 * endpoint (`/api/features?bbox=…`) with no telltale in the URL at all.
 *
 * A guess, and presented as one: the dialog shows the result in an override
 * select, so a user with a `.geojson`-shaped tile server is one click from
 * correcting it.
 */
export function classifyGeoUrl(url: string): GeoLayerKind {
  const trimmed = url.trim();
  if (XYZ_PLACEHOLDER.test(trimmed)) return "raster-xyz";
  if (TILESET_PATH.test(pathOf(trimmed))) return "3d-tiles";
  return "geojson";
}

/**
 * A readable default name for a URL-backed layer: its last path segment, or
 * the host when the path carries nothing (an API endpoint, a bare domain).
 *
 * A tile template's segments are placeholders, so those fall back to the host
 * too — "{y}.png" would name every tile layer identically.
 */
export function geoLayerNameFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  const raw = segments[segments.length - 1];
  if (raw === undefined) return parsed.hostname;
  // DECODED first: `new URL` percent-encodes the braces of a tile template
  // (`{y}.png` becomes `%7By%7D.png`), so the placeholder test below would
  // miss every template and name each tile layer after its own last
  // placeholder.
  let last = raw;
  try {
    last = decodeURIComponent(raw);
  } catch {
    // A malformed escape: keep the raw segment rather than losing the name.
  }
  if (XYZ_PLACEHOLDER.test(last)) return parsed.hostname;
  return last;
}

/**
 * Turn a URL into something {@link GeoLayerInput}-shaped, or `null` when it is
 * not a URL at all.
 *
 * `kind` overrides the classification — the dialog's select — rather than
 * re-deriving it, so what the user sees selected is exactly what is added.
 */
export function geoLayerFromUrl(
  url: string,
  kind?: GeoLayerKind,
): GeoLayerInput | null {
  const trimmed = url.trim();
  if (trimmed === "") return null;
  const name = geoLayerNameFromUrl(trimmed);
  if (name === null) return null;
  const resolved = kind ?? classifyGeoUrl(trimmed);
  switch (resolved) {
    case "raster-xyz":
      return { name, kind: "raster-xyz", config: { urlTemplate: trimmed } };
    case "3d-tiles":
      return { name, kind: "3d-tiles", config: { url: trimmed } };
    case "geojson":
      return { name, kind: "geojson", config: { url: trimmed } };
  }
}

export type GeoJsonParseResult =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly error: string };

/**
 * Validate a dropped file's text as GeoJSON the engine can render.
 *
 * The CityJSON branch is the reason this is not a one-line `JSON.parse`. A
 * CityJSON file is valid JSON with a `type` of its own, and this viewer's
 * primary format is CityJSON — so dropping one on the geospatial tab is the
 * likeliest mistake anybody will make here. Rendering it as an empty layer, or
 * saying "not GeoJSON", both leave the user stuck at the wrong tab; naming the
 * format and the tab that reads it does not.
 *
 * A bare `Geometry` is refused as well, even though the GeoJSON spec allows
 * one as a document: the engine's vector layer renders FEATURES, and a lone
 * geometry has no properties for anything downstream to show.
 */
export function parseGeoJsonText(text: string): GeoJsonParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file is not valid JSON." };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "This file is not a GeoJSON document." };
  }

  const type = (parsed as { type?: unknown }).type;
  if (type === "CityJSON" || type === "CityJSONFeature") {
    return {
      ok: false,
      error:
        "This is a CityJSON file, not GeoJSON. Add it on the City model tab, " +
        "where it is parsed, georeferenced and styled by rules.",
    };
  }
  if (type === "FeatureCollection") {
    if (!Array.isArray((parsed as { features?: unknown }).features)) {
      return {
        ok: false,
        error: "This FeatureCollection has no `features` array.",
      };
    }
    return { ok: true, data: parsed };
  }
  if (type === "Feature") {
    return { ok: true, data: parsed };
  }
  return {
    ok: false,
    error:
      "A GeoJSON layer must be a Feature or a FeatureCollection" +
      (typeof type === "string" ? ` — this file is a ${type}.` : "."),
  };
}
