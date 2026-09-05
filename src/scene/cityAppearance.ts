/**
 * How Roofy colours a city: the brand's answer to the plugins' `appearance`
 * parameter (`CityAppearance` in `@cityjson/navara-cityjson`).
 *
 * The plugins ship neutral defaults and never see the brand; this ONE object
 * is what both plugin constructors receive (`NavaraViewport`), so a picked
 * surface in a static layer and in a streamed cell are painted from the same
 * values, and so the inspector's surface dots (`SURFACE_COLOR_HEX` here, not
 * core's) show the palette the meshes are actually baked with.
 *
 * Theme-AGNOSTIC on purpose, like the geospatial layer styles: these colours
 * sit on imagery, whose brightness has nothing to do with the chrome, so the
 * dark-theme brand values are used in both themes.
 *
 * COLLISIONS are the constraint that chose the values. A highlight equal to a
 * rule colour makes a selected ruled surface look unselected, and a base roof
 * equal to a rule colour makes that rule look like a no-op, so nothing below
 * is byte-equal to a preset (`features/rules/presets.ts`), the new-rule
 * default (`RuleBuilderTab`) or the default geospatial colour
 * (`DEFAULT_GEO_LAYER_STYLE`). That is why the "Large roofs" preset sits on
 * lime-700 while the selection owns lime-500, and why the roof is the darker
 * orange rather than the accent the geo default wears.
 */
import {
  resolveCityAppearance,
  type CityAppearance,
} from "@cityjson/navara-cityjson";

export const CITY_APPEARANCE: CityAppearance = {
  /** lime-500 — the brand primary: "selected" is the same colour as the
   *  chrome's active states. */
  highlightColor: "#a7e32b",
  /** lime-300 — a lift under the cursor that keeps its hue against the
   *  light walls under the exposure-10 atmosphere (lime-100 would drift to
   *  white there), distinct from the lime-500 selection and from every
   *  preset. */
  hoverColor: "#cdf176",
  surfaceColors: {
    /** The subject of the app, in the brand's darker orange. */
    RoofSurface: "#d9481c",
    /** Warm light grey, from the light theme's own paper tones. */
    WallSurface: "#d9dcd4",
    GroundSurface: "#6f7566",
    ClosureSurface: "#9aa0a8",
    OuterCeilingSurface: "#b3b8bf",
    OuterFloorSurface: "#8a8f80",
    /** The brand blue, in its light-theme depth. */
    Window: "#1e5fd8",
    Door: "#8a6100",
    /** `--layer-unassigned`. */
    unknown: "#8b93a3",
  },
};

const resolved = resolveCityAppearance(CITY_APPEARANCE);

/** The selection colour as the `0xRRGGBB` number the engine's geo layers
 *  take — one "selected" colour across city and geospatial features. */
export const CITY_HIGHLIGHT_COLOR_HEX = resolved.highlightColor;

/** Full palette, CSS hex, for the inspector's surface-type dots. */
export const SURFACE_COLOR_HEX = resolved.surfaceColors;
