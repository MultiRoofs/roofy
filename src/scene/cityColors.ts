/**
 * How Roofy colours a city: the brand's answer to the plugins' `appearance`
 * parameter (`CityColors` in `@cityjson/navara-cityjson` — not to be confused
 * with a CityJSON *appearance*, the textures and materials a file carries).
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
import { resolveCityColors, type CityColors } from "@cityjson/navara-cityjson";

export const CITY_COLORS: CityColors = {
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

const resolved = resolveCityColors(CITY_COLORS);

/** The selection colour as the `0xRRGGBB` number the engine's geo layers
 *  take — one "selected" colour across city and geospatial features. */
export const CITY_HIGHLIGHT_COLOR_HEX = resolved.highlightColor;

/** Full palette, CSS hex, for the inspector's surface-type dots. */
export const SURFACE_COLOR_HEX = resolved.surfaceColors;

// ---------------------------------------------------------------------------
// Color by — the colours the three modes need that are not rule colours
//
// Same collision constraint as everything above, now pinned by
// `tests/unit/scene/cityColors.test.ts`: none of these may be byte-equal to
// the highlight, the hover, a base surface colour, the default geospatial
// colour, a rule preset or the new-rule default. What is left of the brand
// after those are spoken for is what chose the four values below.
// ---------------------------------------------------------------------------

/**
 * The colour a fresh rule opens with in the rule builder.
 *
 * Here rather than inline in the editor because it is a RULE colour, and the
 * collision rule this file is built around has to be able to see every one of
 * them: a user's very first rule wears this, so a base surface or an accent
 * equal to it would be exactly the confusion the rule exists to prevent
 * (`tests/unit/scene/cityColors.test.ts` pins it).
 *
 * `RulesEditor.tsx` still spells the literal for now — Task 28 rewrites that
 * file and makes it import this constant.
 */
export const NEW_RULE_COLOR_HEX = "#7cb518";

/**
 * What a roof wears in "Color by rules" when NO rule matches it — the editable
 * trailing catch-all's default.
 *
 * `--fg-muted` from the LIGHT sheet: a slate grey that says "nothing to report"
 * in the same voice the chrome's secondary text does. Deliberately darker than
 * `--layer-unassigned` (the `unknown` surface colour, #8b93a3): "no rule
 * applies to this roof" and "this surface has no type" are different facts and
 * must not arrive in the same grey.
 */
export const UNMATCHED_COLOR_HEX = "#5c636e";

/**
 * The default for "Color by a single colour" — the mode a user picks to tell
 * one layer from another at a glance, so it wants a saturated brand hue rather
 * than a neutral.
 *
 * `--lime-900`, the ramp's darkest rung and the only lime not already spoken
 * for: lime-500 is the selection, lime-300 the hover, lime-700 both the "Large
 * roofs" preset and the new-rule default.
 */
export const SINGLE_COLOR_HEX = "#4a7a0f";

/**
 * Eight categorical colours for "Color by attribute" (geospatial layers,
 * T29), in the order distinct values are first seen.
 *
 * DERIVED from the brand rather than lifted from it: the four layer hues are
 * each shifted off their token (which is taken by a preset or an interaction
 * accent) and joined by four neighbours — teal, violet, rose and moss — chosen
 * for hue separation, because a categorical scale's whole job is that two
 * adjacent entries never read as the same category. Ordered so the first few
 * values a small dataset uses are maximally far apart.
 */
export const CATEGORY_PALETTE_HEX: readonly string[] = [
  "#8fd020", // lime, off the nature hue
  "#4b8ef7", // blue, off the water hue
  "#ff7a45", // orange, off the social hue
  "#8b5cf6", // violet
  "#ffb020", // amber, off the energy hue
  "#17a2a2", // teal
  "#e8467c", // rose
  "#2f7d5c", // moss
];

/**
 * The reserved bucket every value past the eighth falls into.
 *
 * `--fg-muted` from the DARK sheet — a muted grey, so "Other" reads as the
 * absence of a category rather than as a ninth one. A literal "Other" in the
 * data is an ordinary value and takes a palette colour like any other; only
 * the overflow lands here.
 */
export const CATEGORY_OTHER_HEX = "#8a93a0";
