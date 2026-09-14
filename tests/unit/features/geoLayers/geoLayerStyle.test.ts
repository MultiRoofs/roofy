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
  styleColorNumber,
} from "../../../../src/features/geoLayers/geoLayerStyle";

describe("DEFAULT_GEO_LAYER_STYLE", () => {
  it("is the accent, point size and line width the app shipped as constants", () => {
    expect(DEFAULT_GEO_LAYER_STYLE).toEqual({
      color: "#f2683c",
      pointSizePx: 24,
      lineWidthPx: 2,
      fillOpacity: 1,
    });
  });
});

describe("hexColorToNumber", () => {
  it("reads the six-digit form the pickers emit", () => {
    expect(hexColorToNumber("#f2683c")).toBe(0xf2683c);
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

describe("styleColorNumber", () => {
  it("converts the stored hex to the engine's 0xRRGGBB number", () => {
    expect(
      styleColorNumber({ ...DEFAULT_GEO_LAYER_STYLE, color: "#00aaff" }),
    ).toBe(0x00aaff);
    expect(styleColorNumber(DEFAULT_GEO_LAYER_STYLE)).toBe(0xf2683c);
  });

  it("falls back to the default accent rather than handing the engine NaN", () => {
    // Load-bearing: the engine raises nothing on a NaN/null colour — it draws
    // the layer black or not at all, which reads as a data problem.
    expect(
      styleColorNumber({ ...DEFAULT_GEO_LAYER_STYLE, color: "not a colour" }),
    ).toBe(0xf2683c);
    expect(styleColorNumber({ ...DEFAULT_GEO_LAYER_STYLE, color: "" })).toBe(
      0xf2683c,
    );
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

  it("carries a valid colorByAttribute through, categories and all", () => {
    const style = normalizeGeoLayerStyle({
      colorByAttribute: {
        attribute: "zone",
        categories: [
          { value: "residential", color: "#8fd020" },
          { value: null, color: "#4b8ef7" },
        ],
      },
    });

    expect(style.colorByAttribute).toEqual({
      attribute: "zone",
      categories: [
        { value: "residential", color: "#8fd020" },
        { value: null, color: "#4b8ef7" },
      ],
    });
  });

  it("drops the invalid category entries but keeps the valid ones", () => {
    const style = normalizeGeoLayerStyle({
      colorByAttribute: {
        attribute: "zone",
        categories: [
          { value: "residential", color: "#8fd020" },
          { value: "retail", color: "not-a-colour" },
          { value: 5, color: "#4b8ef7" },
          "junk",
        ],
      },
    });

    expect(style.colorByAttribute).toEqual({
      attribute: "zone",
      categories: [{ value: "residential", color: "#8fd020" }],
    });
  });

  it("drops the whole colorByAttribute when its attribute or list is unusable", () => {
    for (const bad of [
      { attribute: "", categories: [{ value: "a", color: "#8fd020" }] },
      { attribute: 5, categories: [{ value: "a", color: "#8fd020" }] },
      { attribute: "zone", categories: [] },
      { attribute: "zone", categories: "nope" },
      { attribute: "zone" },
      "zone",
    ]) {
      expect(normalizeGeoLayerStyle({ colorByAttribute: bad })).toEqual(
        DEFAULT_GEO_LAYER_STYLE,
      );
    }
  });

  it("leaves colorByAttribute ABSENT when the input never named it", () => {
    // Absent, not null: an untouched style must not grow a field (the
    // snapshot schema stays put for exactly this reason).
    expect(
      "colorByAttribute" in normalizeGeoLayerStyle({ color: "#00aaff" }),
    ).toBe(false);
  });
});
