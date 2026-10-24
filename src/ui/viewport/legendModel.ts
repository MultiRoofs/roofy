/**
 * The legend's data, pure: which rows each visible layer contributes, grouped
 * by layer.
 *
 * Extracted from the overlay for the same reason `handleSync` is split from
 * the viewport — the grouping rules are pure and cheap to pin with a test,
 * where the overlay's only real behaviour is "render these rows, and open the
 * layer's Style when its heading is clicked". A group is built from the layer's
 * OWN fields, never from `effectiveRules`: the synthetic catch-all rules (the
 * single colour, the unmatched trailing rule) are a rendering device, and the
 * legend must show what the user wrote — the modes surface as their own row
 * kinds instead.
 *
 * A layer contributes a group only when it is VISIBLE and has at least one
 * row; a hidden layer, a raster, a 3D tileset and an empty rule list all
 * contribute nothing, so an empty legend never renders a bare heading.
 */
import type { Layer } from "../../features/layers/layerStore";
import type { GeoLayer } from "../../features/geoLayers/geoLayerStore";
import { CATEGORY_OTHER_HEX, SURFACE_COLOR_HEX } from "../../scene/cityColors";

/** What a row's colour MEANS, so the overlay (and a future count column) can
 *  treat a category row differently from a rule row. */
export type LegendRowKind =
  | "surface"
  | "rule"
  | "unmatched"
  | "single"
  | "expression"
  | "category"
  | "fill";

export interface LegendRow {
  readonly label: string;
  readonly color: string;
  readonly kind: LegendRowKind;
}

export interface LegendGroup {
  readonly layerId: string;
  readonly name: string;
  readonly kind: "city" | "vector";
  readonly rows: ReadonlyArray<LegendRow>;
}

export function legendGroups(
  layers: ReadonlyArray<Layer>,
  geoLayers: ReadonlyArray<GeoLayer>,
): LegendGroup[] {
  const groups: LegendGroup[] = [];
  for (const layer of layers) {
    if (!layer.visible) continue;
    const rows = cityRows(layer);
    if (rows.length === 0) continue;
    groups.push({ layerId: layer.id, name: layer.name, kind: "city", rows });
  }
  for (const geo of geoLayers) {
    if (!geo.visible) continue;
    const rows = geoRows(geo);
    if (rows.length === 0) continue;
    groups.push({ layerId: geo.id, name: geo.name, kind: "vector", rows });
  }
  return groups;
}

/** A city layer's rows, from its own `colorBy` — the modes the Style section
 *  offers, and nothing read off the effective rule list. */
export function cityRows(layer: Layer): LegendRow[] {
  const expression =
    layer.colorBy === "expression" ? (layer.styleExpression ?? null) : null;
  if (expression !== null) {
    // An expression has no rows to name, only colours: one row, swatched with
    // the literal colours it can paint.
    return [
      { label: "Expression", color: swatch(expression), kind: "expression" },
    ];
  }
  switch (layer.colorBy) {
    case "rules":
      return [
        ...layer.rules
          .filter((r) => r.enabled)
          .map(
            (r): LegendRow => ({
              label: r.name,
              color: r.color,
              kind: "rule",
            }),
          ),
        {
          label: "Unmatched",
          color: layer.unmatchedColor,
          kind: "unmatched",
        },
      ];
    case "single":
      return [
        { label: "Single colour", color: layer.singleColor, kind: "single" },
      ];
    default:
      // The default is the safe reading of an unrecognised mode, exactly as
      // `effectiveRules` treats one: "surface" paints nothing, so this is the
      // palette the layer is actually drawn in.
      return [
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
      ];
  }
}

const COLOUR_LITERAL =
  /^(#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(rgb|rgba|hsl|hsla)\(.*\))$/i;
const MAX_SWATCH_COLOURS = 6;

/** The literal colours an expression names, in order, as a CSS background:
 *  flat for one, a gradient for several, the roof colour for none (it
 *  computes every colour it paints). */
function swatch(expression: unknown): string {
  const colours: string[] = [];
  const walk = (node: unknown): void => {
    if (colours.length >= MAX_SWATCH_COLOURS) return;
    if (typeof node === "string") {
      if (COLOUR_LITERAL.test(node) && !colours.includes(node)) {
        colours.push(node);
      }
    } else if (Array.isArray(node)) {
      for (const child of node) walk(child);
    }
  };
  walk(expression);
  if (colours.length === 0) return SURFACE_COLOR_HEX.RoofSurface;
  if (colours.length === 1) return colours[0]!;
  return `linear-gradient(90deg, ${colours.join(", ")})`;
}

/** A vector layer's rows: the category list when the layer colours by an
 *  attribute, else one fill row in the layer's own colour. A raster or a 3D
 *  tileset has no legend entry at all. */
export function geoRows(layer: GeoLayer): LegendRow[] {
  if (layer.kind !== "geojson") return [];
  const colorByAttribute = layer.style.colorByAttribute;
  if (colorByAttribute !== undefined) {
    return colorByAttribute.categories.map((category): LegendRow => {
      // The OTHER sentinel is the null-valued row in the reserved colour —
      // the same identification the Style section and the evaluator use.
      const isOther =
        category.value === null &&
        category.color.toLowerCase() === CATEGORY_OTHER_HEX.toLowerCase();
      const label = category.value ?? (isOther ? "Other" : "Missing");
      return { label, color: category.color, kind: "category" };
    });
  }
  return [{ label: "Fill", color: layer.style.color, kind: "fill" }];
}
