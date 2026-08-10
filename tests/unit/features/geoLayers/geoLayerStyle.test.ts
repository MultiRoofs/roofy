/**
 * The per-layer style record for geospatial layers.
 *
 * Two properties are pinned here rather than in the scene: the DEFAULTS (they
 * are the values the app shipped as hardcoded constants, so a change to them is
 * a visible change to every existing layer) and TOTALITY — `normalizeGeoLayerStyle`
 * is the only door a style comes through, and its callers include a restored
 * snapshot document a user may have hand-edited. Junk in must be a valid style
 * out, per field, or a single bad number reaches the engine as a NaN.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_GEO_LAYER_STYLE,
  hexColorToNumber,
  normalizeGeoLayerStyle,
} from "../../../../src/features/geoLayers/geoLayerStyle";

describe("DEFAULT_GEO_LAYER_STYLE", () => {
  it("is the accent, point size and line width the app shipped as constants", () => {
    expect(DEFAULT_GEO_LAYER_STYLE).toEqual({
      color: "#ff5a3c",
      pointSizePx: 24,
      lineWidthPx: 2,
      fillOpacity: 1,
    });
  });
});

describe("hexColorToNumber", () => {
  it("reads the six-digit form the pickers emit", () => {
    expect(hexColorToNumber("#ff5a3c")).toBe(0xff5a3c);
    expect(hexColorToNumber("#000000")).toBe(0x000000);
    expect(hexColorToNumber("#FFFFFF")).toBe(0xffffff);
  });

  it("expands the three-digit shorthand", () => {
    expect(hexColorToNumber("#f53")).toBe(0xff5533);
    expect(hexColorToNumber("#fff")).toBe(0xffffff);
  });

  it("answers null for anything that is not a hex triplet", () => {
    expect(hexColorToNumber("red")).toBeNull();
    expect(hexColorToNumber("")).toBeNull();
    expect(hexColorToNumber("#ff5a3")).toBeNull();
    expect(hexColorToNumber("ff5a3c")).toBeNull();
    expect(hexColorToNumber("#gggggg")).toBeNull();
  });
});

describe("normalizeGeoLayerStyle", () => {
  it("answers the defaults for anything that is not an object", () => {
    expect(normalizeGeoLayerStyle(undefined)).toEqual(DEFAULT_GEO_LAYER_STYLE);
    expect(normalizeGeoLayerStyle(null)).toEqual(DEFAULT_GEO_LAYER_STYLE);
    expect(normalizeGeoLayerStyle("#fff")).toEqual(DEFAULT_GEO_LAYER_STYLE);
    expect(normalizeGeoLayerStyle([])).toEqual(DEFAULT_GEO_LAYER_STYLE);
  });

  it("keeps a valid style value-for-value", () => {
    const style = {
      color: "#00aaff",
      pointSizePx: 8,
      lineWidthPx: 5,
      fillOpacity: 0.4,
    };

    expect(normalizeGeoLayerStyle(style)).toEqual(style);
  });

  it("falls back PER FIELD, so one bad value does not discard the others", () => {
    expect(
      normalizeGeoLayerStyle({
        color: "nope",
        pointSizePx: -3,
        lineWidthPx: Number.POSITIVE_INFINITY,
        fillOpacity: 2,
      }),
    ).toEqual({
      color: DEFAULT_GEO_LAYER_STYLE.color,
      pointSizePx: DEFAULT_GEO_LAYER_STYLE.pointSizePx,
      lineWidthPx: DEFAULT_GEO_LAYER_STYLE.lineWidthPx,
      // Clamped rather than defaulted: an out-of-range OPACITY has an obvious
      // intent ("fully opaque"), where a negative size has none.
      fillOpacity: 1,
    });
  });

  it("clamps fillOpacity into [0, 1] and defaults a non-numeric one", () => {
    expect(normalizeGeoLayerStyle({ fillOpacity: -1 }).fillOpacity).toBe(0);
    expect(normalizeGeoLayerStyle({ fillOpacity: 0 }).fillOpacity).toBe(0);
    expect(
      normalizeGeoLayerStyle({ fillOpacity: Number.NaN }).fillOpacity,
    ).toBe(DEFAULT_GEO_LAYER_STYLE.fillOpacity);
    expect(normalizeGeoLayerStyle({ fillOpacity: "0.5" }).fillOpacity).toBe(
      DEFAULT_GEO_LAYER_STYLE.fillOpacity,
    );
  });

  it("requires sizes to be finite and positive", () => {
    expect(normalizeGeoLayerStyle({ pointSizePx: 0 }).pointSizePx).toBe(
      DEFAULT_GEO_LAYER_STYLE.pointSizePx,
    );
    expect(normalizeGeoLayerStyle({ lineWidthPx: 0 }).lineWidthPx).toBe(
      DEFAULT_GEO_LAYER_STYLE.lineWidthPx,
    );
    expect(normalizeGeoLayerStyle({ pointSizePx: "24" }).pointSizePx).toBe(
      DEFAULT_GEO_LAYER_STYLE.pointSizePx,
    );
    expect(normalizeGeoLayerStyle({ lineWidthPx: 0.5 }).lineWidthPx).toBe(0.5);
  });

  it("accepts the shorthand hex form as a colour", () => {
    expect(normalizeGeoLayerStyle({ color: "#f53" }).color).toBe("#f53");
  });
});
