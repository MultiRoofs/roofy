/**
 * The legend's data model, pure: which rows each visible layer contributes.
 *
 * The grouping rules are pinned here so the overlay stays a dumb renderer:
 * a hidden layer, a raster and a 3D tileset contribute nothing; a city layer
 * contributes the surface palette, the user's rules plus "Unmatched", or one
 * single-colour row — never a synthetic catch-all, which lives only inside
 * `effectiveRules` and never in the store; a vector layer contributes its
 * category list or one fill row.
 */
import { describe, expect, it } from "vitest";
import { legendGroups } from "../../../../src/ui/viewport/legendModel";
import type { Layer } from "../../../../src/features/layers/layerStore";
import type { GeoLayer } from "../../../../src/features/geoLayers/geoLayerStore";
import { DEFAULT_GEO_LAYER_STYLE } from "../../../../src/features/geoLayers/geoLayerStyle";
import type { Rule } from "../../../../src/features/rules/types";
import type { CityModel } from "../../../../src/domain/citymodel/types";
import {
  CATEGORY_OTHER_HEX,
  CATEGORY_PALETTE_HEX,
  SINGLE_COLOR_HEX,
  SURFACE_COLOR_HEX,
  UNMATCHED_COLOR_HEX,
} from "../../../../src/scene/cityColors";

function emptyModel(): CityModel {
  return {
    sourceEncoding: "cityjson",
    metadata: {},
    bbox: null,
    objects: {},
    vertexCount: 0,
  };
}

function city(overrides: Partial<Layer> = {}): Layer {
  return {
    id: "L",
    name: "test layer",
    model: emptyModel(),
    modelRef: { type: "url", url: "https://x/a.city.json" },
    visible: true,
    rules: [],
    colorBy: "surface",
    singleColor: SINGLE_COLOR_HEX,
    unmatchedColor: UNMATCHED_COLOR_HEX,
    selectedLod: null,
    availableLods: [],
    lodMode: "auto",
    cameraSync: true,
    hiddenTypes: [],
    visibleObjectIds: null,
    availableObjectTypes: [],
    appearanceThemes: [],
    selectedAppearance: null,
    derivedFrom: null,
    isStreaming: false,
    ...overrides,
  };
}

function rule(overrides: Partial<Rule> & { id: string; name: string }): Rule {
  return {
    color: "#ff0000",
    conditions: [],
    logic: "AND",
    enabled: true,
    ...overrides,
  };
}

function geojson(overrides: Partial<GeoLayer> = {}): GeoLayer {
  return {
    id: "g1",
    name: "parcels",
    kind: "geojson",
    visible: true,
    opacity: 1,
    style: DEFAULT_GEO_LAYER_STYLE,
    config: { data: { type: "FeatureCollection", features: [] } },
    ...overrides,
  } as GeoLayer;
}

describe("legendGroups — city layers", () => {
  it("shows the surface palette by default", () => {
    expect(legendGroups([city()], [])).toEqual([
      {
        layerId: "L",
        name: "test layer",
        kind: "city",
        rows: [
          {
            label: "Roof",
            color: SURFACE_COLOR_HEX.RoofSurface,
            kind: "surface",
          },
          {
            label: "Wall",
            color: SURFACE_COLOR_HEX.WallSurface,
            kind: "surface",
          },
          {
            label: "Ground",
            color: SURFACE_COLOR_HEX.GroundSurface,
            kind: "surface",
          },
          {
            label: "Other",
            color: SURFACE_COLOR_HEX.unknown,
            kind: "surface",
          },
        ],
      },
    ]);
  });

  it("lists the enabled user rules in order, then Unmatched", () => {
    const groups = legendGroups(
      [
        city({
          colorBy: "rules",
          rules: [
            rule({ id: "r1", name: "Flat roofs", color: "#ff0000" }),
            rule({
              id: "r2",
              name: "Off rule",
              enabled: false,
              color: "#0000ff",
            }),
            rule({ id: "r3", name: "Steep roofs", color: "#00ff00" }),
          ],
        }),
      ],
      [],
    );

    expect(groups[0]!.rows).toEqual([
      { label: "Flat roofs", color: "#ff0000", kind: "rule" },
      { label: "Steep roofs", color: "#00ff00", kind: "rule" },
      { label: "Unmatched", color: UNMATCHED_COLOR_HEX, kind: "unmatched" },
    ]);
  });

  it("shows Unmatched even with no user rules, and one row for Single colour", () => {
    expect(legendGroups([city({ colorBy: "rules" })], [])[0]!.rows).toEqual([
      { label: "Unmatched", color: UNMATCHED_COLOR_HEX, kind: "unmatched" },
    ]);

    expect(legendGroups([city({ colorBy: "single" })], [])[0]!.rows).toEqual([
      { label: "Single colour", color: SINGLE_COLOR_HEX, kind: "single" },
    ]);
  });

  it("never lists a synthetic rule — the modes surface as their own rows", () => {
    // A single-colour layer draws through a catch-all whose id is synthetic;
    // the legend reports the mode, not the rendering device.
    const groups = legendGroups([city({ colorBy: "single" })], []);
    expect(groups[0]!.rows).toHaveLength(1);
    expect(groups[0]!.rows[0]!.kind).toBe("single");
  });
});

describe("legendGroups — vector layers", () => {
  it("shows the category list, labelling the null bucket Missing and the overflow Other", () => {
    const groups = legendGroups(
      [],
      [
        geojson({
          style: {
            ...DEFAULT_GEO_LAYER_STYLE,
            colorByAttribute: {
              attribute: "zone",
              categories: [
                { value: "residential", color: CATEGORY_PALETTE_HEX[0]! },
                { value: null, color: CATEGORY_PALETTE_HEX[1]! },
                { value: null, color: CATEGORY_OTHER_HEX },
              ],
            },
          },
        }),
      ],
    );

    expect(groups[0]!.rows).toEqual([
      {
        label: "residential",
        color: CATEGORY_PALETTE_HEX[0],
        kind: "category",
      },
      { label: "Missing", color: CATEGORY_PALETTE_HEX[1], kind: "category" },
      { label: "Other", color: CATEGORY_OTHER_HEX, kind: "category" },
    ]);
  });

  it("shows one fill row in the layer colour when not coloured by attribute", () => {
    const groups = legendGroups(
      [],
      [geojson({ style: DEFAULT_GEO_LAYER_STYLE })],
    );
    expect(groups[0]!.rows).toEqual([
      { label: "Fill", color: DEFAULT_GEO_LAYER_STYLE.color, kind: "fill" },
    ]);
  });
});

describe("legendGroups — exclusion", () => {
  it("omits hidden layers", () => {
    expect(legendGroups([city({ visible: false })], [])).toEqual([]);
    expect(legendGroups([], [geojson({ visible: false })])).toEqual([]);
  });

  it("omits raster and 3D tileset layers entirely", () => {
    expect(
      legendGroups(
        [],
        [
          geojson({
            kind: "raster-xyz",
            config: { urlTemplate: "https://t/{z}/{x}/{y}.png" },
          } as GeoLayer),
          geojson({
            kind: "3d-tiles",
            config: { url: "https://t/tileset.json" },
          } as GeoLayer),
        ],
      ),
    ).toEqual([]);
  });
});
