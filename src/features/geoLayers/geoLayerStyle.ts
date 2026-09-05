/**
 * How a geospatial layer is DRAWN: colour, point size, line width, fill
 * opacity.
 *
 * Its own module rather than four more fields on `GeoLayerBase`, because these
 * are the values that used to be hardcoded constants in
 * `scene/geoLayerDescriptions.ts` and are now per-layer and user-editable —
 * which means they arrive from a colour picker, from a restored snapshot
 * document a user may have hand-edited, and from a share link. This module is
 * the single door: {@link normalizeGeoLayerStyle} is TOTAL, so no caller has to
 * validate and none of them can disagree about what a bad value means. The
 * engine cannot defend itself here — a NaN width silently drops a whole
 * polyline pass.
 *
 * ENGINE-FREE (it lives under `src/features/`), and deliberately CSS-hex rather
 * than the `0xRRGGBB` number the engine's materials take: hex strings are what
 * `<input type="color">` reads and writes, what survives `JSON.stringify` into
 * localStorage legibly, and what a hand-edited share link can carry. The
 * conversion to a number happens once, at the description boundary, through
 * {@link hexColorToNumber}.
 */

export interface GeoLayerStyle {
  /** `"#rgb"` or `"#rrggbb"` CSS hex. */
  readonly color: string;
  /** Point size for GeoJSON points, in PIXELS. */
  readonly pointSizePx: number;
  /** Line width for GeoJSON polylines, in pixels. */
  readonly lineWidthPx: number;
  /** 0…1 for GeoJSON polygons; MULTIPLIES the layer's own opacity. */
  readonly fillOpacity: number;
}

/**
 * The values every layer starts at — the ones the app shipped as the
 * hardcoded `GEO_ACCENT_COLOR` / `GEOJSON_POINT_SIZE_PX` /
 * `GEOJSON_LINE_WIDTH_PX` constants, kept byte-for-byte so making them
 * editable did not silently restyle anybody's existing workspace.
 *
 * `color` — one accent for every user-supplied vector layer. THEME-AGNOSTIC on
 * purpose: the app's own accent follows the light/dark toggle, but a
 * geospatial layer is drawn on the globe, over imagery whose brightness has
 * nothing to do with the chrome — a colour that flipped with the UI theme
 * would be legible over Esri imagery in one theme and lost in it in the other.
 * This orange-red reads against the Esri basemap, the default photoreal globe
 * and the city meshes' grey alike, and it is deliberately not a hue the roof
 * rule palettes use, so a styled roof is never mistaken for imported data.
 *
 * `pointSizePx` — PIXELS, not metres (`sizeInMeters: false` at the description
 * boundary). Navara's `PointMaterial` defaults `sizeInMeters` to true, which is
 * the wrong default for imported data: a 24 m sprite is a blot from a rooftop
 * camera and a sub-pixel speck from a city-wide one. In pixels a point is a map
 * symbol — the same size at every altitude, which is what a POI layer wants.
 *
 * `lineWidthPx` — two, so a road network reads as lines rather than as a smear
 * at city zoom.
 *
 * `fillOpacity` — 1: a layer the user just added must be as solid as they
 * expect, and fading it is the deliberate act.
 */
export const DEFAULT_GEO_LAYER_STYLE: GeoLayerStyle = {
  color: "#f2683c",
  pointSizePx: 24,
  lineWidthPx: 2,
  fillOpacity: 1,
};

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * `"#rgb"` / `"#rrggbb"` → `0xRRGGBB`, or `null` for anything else.
 *
 * `null`, not a fallback colour: the caller that converts for the engine
 * already holds the default and can say so in its own terms, and a silent
 * substitution here would hide a stored value that never renders.
 */
export function hexColorToNumber(hex: string): number | null {
  if (!HEX_COLOR.test(hex)) return null;
  const digits = hex.slice(1);
  const full =
    digits.length === 3
      ? // "f53" → "ff5533": each digit doubled, the CSS shorthand rule.
        digits
          .split("")
          .map((d) => d + d)
          .join("")
      : digits;
  return Number.parseInt(full, 16);
}

/**
 * A style's colour as the `0xRRGGBB` number the engine's materials take,
 * falling back to the default accent when the stored string is not a colour.
 *
 * One function rather than one per call site (the layer description and the
 * highlight evaluator both need it) because the FALLBACK IS LOAD-BEARING and
 * two copies could drift: {@link hexColorToNumber} answers `null` rather than
 * guessing, and handing the engine `NaN` or `null` raises NOTHING — it draws
 * the layer black, or not at all, which reads as a data problem rather than a
 * style one. `normalizeGeoLayerStyle` guards the store's own doors, so an
 * unparsable value arriving here means a record that came some other way.
 */
export function styleColorNumber(style: GeoLayerStyle): number {
  return (
    hexColorToNumber(style.color) ??
    // Non-null: `DEFAULT_GEO_LAYER_STYLE.color` is a literal `#rrggbb`, and
    // this module's own tests pin that it parses.
    hexColorToNumber(DEFAULT_GEO_LAYER_STYLE.color)!
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A size is only meaningful finite and above zero — a zero-width line and a
 *  zero-pixel point are both invisible, which no user asked for. */
function size(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

/** CLAMPED rather than defaulted, unlike a size: an out-of-range opacity has an
 *  obvious intent at either end, where a negative width has none. */
function opacity(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

/**
 * Any junk in, a valid style out — per FIELD, so one bad number does not
 * discard three good ones the user chose.
 */
export function normalizeGeoLayerStyle(value: unknown): GeoLayerStyle {
  if (!isRecord(value)) return DEFAULT_GEO_LAYER_STYLE;
  const color =
    typeof value.color === "string" && HEX_COLOR.test(value.color)
      ? value.color
      : DEFAULT_GEO_LAYER_STYLE.color;
  return {
    color,
    pointSizePx: size(value.pointSizePx, DEFAULT_GEO_LAYER_STYLE.pointSizePx),
    lineWidthPx: size(value.lineWidthPx, DEFAULT_GEO_LAYER_STYLE.lineWidthPx),
    fillOpacity: opacity(
      value.fillOpacity,
      DEFAULT_GEO_LAYER_STYLE.fillOpacity,
    ),
  };
}
