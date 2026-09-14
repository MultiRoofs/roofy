/**
 * "Color by attribute" for vector layers: which attribute keys a document
 * offers, and which colour each distinct value of an attribute wears.
 *
 * ENGINE-FREE and pure — the map side (`geoLayerSync.ts`) reads the computed
 * categories out of the style record, and the Style section recomputes them
 * from this module when the user picks an attribute. Two entry points:
 *
 *  - {@link attributeKeys}: the union of every feature's own property keys,
 *    in first-seen order — the options of the select;
 *  - {@link categoriesFor}: the first EIGHT distinct values in first-seen
 *    order, each on a `CATEGORY_PALETTE_HEX` colour, plus ONE trailing
 *    `{ value: null, color: CATEGORY_OTHER_HEX }` row when — and only when —
 *    the data overflowed or has missing-value features that did not make the
 *    cut. That row is the OTHER bucket the evaluator paints every unmatched
 *    feature with (a ninth value, or a missing value past the cut). Its
 *    absence from the list is precisely "the base colour wins by omission":
 *    with ≤ 8 distinct values every observed value IS in the list, so a
 *    non-overflowing list needs no bucket and a feature can never miss it.
 *
 * Both take the GeoJSON DOCUMENT (`config.data` / a fetched body) rather than
 * a store record: this module predates any knowledge of the layer and a
 * single `Feature` or a bare array is as good an input as a
 * `FeatureCollection` — junk answers empty lists, never a throw.
 */
import {
  CATEGORY_OTHER_HEX,
  CATEGORY_PALETTE_HEX,
} from "../../scene/cityColors";

/** One category of a `colorByAttribute`: the stringified value (or `null`
 *  for a feature missing the attribute) and the colour it is painted in. */
export interface AttributeCategory {
  readonly value: string | null;
  readonly color: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The feature objects of a document — a `FeatureCollection`, one bare
 *  `Feature`, a raw array of them, or junk (an empty list). A member that is
 *  not a feature is skipped rather than failing the whole walk. */
function featuresOf(data: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(data)) return data.filter(isRecord);
  if (!isRecord(data)) return [];
  if (data.type === "FeatureCollection" && Array.isArray(data.features)) {
    return data.features.filter(isRecord);
  }
  if (data.type === "Feature") return [data];
  return [];
}

/** A feature's own properties as a record, or `null` — a GeoJSON feature is
 *  allowed to carry none, and one is allowed to be junk. */
function propertiesOf(
  feature: Record<string, unknown>,
): Record<string, unknown> | null {
  return isRecord(feature.properties) ? feature.properties : null;
}

/**
 * The attribute keys a document offers for colouring: the union of every
 * feature's OWN property keys (a tampered prototype is not data), in the
 * order the keys are first met reading the features in order.
 */
export function attributeKeys(data: unknown): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const feature of featuresOf(data)) {
    const properties = propertiesOf(feature);
    if (properties === null) continue;
    for (const key of Object.keys(properties)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  return keys;
}

/**
 * The categories of one attribute: the first eight distinct values in
 * first-seen order on the categorical palette, plus the OTHER bucket when
 * something overflowed.
 *
 * A value is `String(value)` — numbers and booleans colour as their digits —
 * and every feature MISSING the attribute (`undefined` or an explicit `null`,
 * the two indistinguishable-in-the-scene cases) groups into the one `null`
 * value, which competes for a palette slot like any other. A literal
 * `"Other"` string in the data is an ordinary value and takes a palette
 * colour; only the overflow wears `CATEGORY_OTHER_HEX`.
 */
export function categoriesFor(
  data: unknown,
  attribute: string,
): ReadonlyArray<AttributeCategory> {
  const categories: AttributeCategory[] = [];
  const seen = new Set<string | null>();
  let overflow = false;
  for (const feature of featuresOf(data)) {
    const properties = propertiesOf(feature);
    if (properties === null) continue;
    const raw = properties[attribute];
    const value = raw === undefined || raw === null ? null : String(raw);
    if (seen.has(value)) continue;
    seen.add(value);
    if (categories.length < CATEGORY_PALETTE_HEX.length) {
      categories.push({
        value,
        color: CATEGORY_PALETTE_HEX[categories.length]!,
      });
    } else {
      overflow = true;
    }
  }
  return overflow
    ? [...categories, { value: null, color: CATEGORY_OTHER_HEX }]
    : categories;
}
