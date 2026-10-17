/**
 * "Color by" — surface type, rules with an editable unmatched colour, or a
 * single colour — as ONE effective rule list.
 *
 * The whole design rests on one fact about the shared rule engine, verified in
 * a real browser on `fixtures/delft.fcb` before a line of this was written
 * (Task 26 step 0): `evaluateRule` returns true for a rule with ZERO
 * conditions, on the static path AND in the FlatCityBuf worker, for cells that
 * were already resident and for cells that streamed in afterwards. So:
 *
 * - "a single colour" is one catch-all rule;
 * - "the unmatched colour" is a TRAILING catch-all after the user's rules;
 * - "surface type" is no rules at all.
 *
 * Which means the renderers need to learn nothing. `handleSync`'s static path
 * still hands `compileRuleEvaluator` an array, the streaming path still hands
 * `setRules` an array, and neither has a second colouring mode to reason
 * about. It is also why the plugin submodule is untouched by this slice.
 *
 * Two rules the rest of the app depends on:
 *
 * 1. The synthetic rules exist ONLY inside the effective list. They never
 *    enter the store, a snapshot, a share link, the editor or the legend —
 *    they are derived from the mode, and a serialised one would be the same
 *    fact written twice. {@link isSyntheticRule} is how a consumer that does
 *    see the effective list (the inspector's RULE MATCH) tells them apart.
 * 2. {@link effectiveRules} is MEMOISED on the four inputs that can change it
 *    (the rules array's identity, the mode and the two colours), because both
 *    consumers' "did the styling change?" test is array identity
 *    and both repaints are expensive (`setStyle` recolours every vertex;
 *    `setRules` re-bakes every resident cell in the worker). A fresh array per
 *    render would repaint on every unrelated store change.
 */
import {
  evaluateRule,
  rulesToStyleExpression,
  type RoofMetrics,
} from "@cityjson/navara-core";
import type { Rule } from "./types";
import { SINGLE_COLOR_HEX, UNMATCHED_COLOR_HEX } from "../../scene/cityColors";

/**
 * How a layer decides what colour a surface is drawn in. "expression" is the
 * one mode that is not a rule list: a MapLibre style-spec colour expression
 * over every surface ({@link effectiveExpression}), which the renderers
 * compile with `compileStyleExpression`.
 */
export type ColorBy = "surface" | "rules" | "single" | "expression";

export const COLOR_BY_MODES: ReadonlyArray<ColorBy> = [
  "surface",
  "rules",
  "single",
  "expression",
];

/**
 * A layer's colour expression as stored: the JSON the user wrote, an array
 * (or a constant colour string). Deliberately looser than the style spec's
 * own `ExpressionSpecification`: whether it compiles is answered by
 * `compileStyleExpression` at render time, never by the type.
 */
export type LayerStyleExpression = ReadonlyArray<unknown> | string;

export function isColorBy(value: unknown): value is ColorBy {
  return (
    value === "surface" ||
    value === "rules" ||
    value === "single" ||
    value === "expression"
  );
}

/**
 * The half of a `Layer` this module reads. Declared structurally so a layer,
 * a restored snapshot row and a test fixture all satisfy it without importing
 * the store.
 */
export interface ColorByInput {
  readonly rules: ReadonlyArray<Rule>;
  readonly colorBy: ColorBy;
  readonly singleColor: string;
  readonly unmatchedColor: string;
  /** Absent reads as none. Kept while another mode is active, like the two
   *  colours, so switching away and back does not lose the expression. */
  readonly styleExpression?: LayerStyleExpression | null;
}

/**
 * Every synthetic rule's id starts with this, and no user rule can: ids are
 * minted with `crypto.randomUUID()`, and an imported rule's id is replaced
 * with a fresh UUID on the way in (`RulesEditor.handleImport`).
 */
export const CATCH_ALL_RULE_ID_PREFIX = "__roofy_";

const SINGLE_RULE_ID = `${CATCH_ALL_RULE_ID_PREFIX}single`;
const UNMATCHED_RULE_ID = `${CATCH_ALL_RULE_ID_PREFIX}unmatched`;

export function isSyntheticRule(rule: Rule): boolean {
  return rule.id.startsWith(CATCH_ALL_RULE_ID_PREFIX);
}

function catchAll(id: string, name: string, color: string): Rule {
  // Zero conditions is the whole trick: `evaluateRule` short-circuits to true.
  return { id, name, color, conditions: [], logic: "AND", enabled: true };
}

/** "Color by surface type" — the semantic palette, undisturbed. One frozen
 *  array, so the identity test above answers "unchanged" for free. */
const NO_RULES: ReadonlyArray<Rule> = Object.freeze([]);

/**
 * Keyed on the `rules` array's identity (the store replaces it on every edit),
 * then on the three scalars that matter. Two levels because the scalars are
 * strings and the array is not: a WeakMap lets a layer that is closed take its
 * cache with it.
 */
const cache = new WeakMap<
  ReadonlyArray<Rule>,
  Map<string, ReadonlyArray<Rule>>
>();

/** Dragging a colour picker mints a key per frame; a handful of live modes per
 *  rules array is all that is ever asked for again. */
const MAX_KEYS_PER_RULES_ARRAY = 8;

/**
 * Keyed on the mode and the two colours — the three inputs besides the rules
 * array that can change the output. A key that included a field the output
 * does not depend on would let two callers who merely disagree about it mint
 * two equal-but-distinct arrays, which both memos read as "changed" and pay
 * for with a full repaint or a worker re-bake of every resident cell.
 */
function cacheKey(input: ColorByInput): string {
  return `${input.colorBy}|${input.singleColor}|${input.unmatchedColor}`;
}

/**
 * The ONE `Rule[]` both renderers draw a layer from.
 *
 * Always passed together with {@link effectiveRulesEnabled} — the pair is the
 * complete answer, and passing anything beside this array would re-introduce
 * the toggle the mode replaced.
 */
export function effectiveRules(input: ColorByInput): ReadonlyArray<Rule> {
  // Anything that is not one of the two painting modes is "surface" — the mode
  // that colours nothing. Written as an allow-list rather than
  // `=== "surface"` so a value the type system did not catch (a hand-edited
  // document that slipped a validator, a fixture built before the field
  // existed) fails SAFE: an unrecognised mode leaves the semantic palette
  // alone rather than silently painting rule colours.
  if (input.colorBy !== "single" && input.colorBy !== "rules") return NO_RULES;

  let byKey = cache.get(input.rules);
  if (byKey === undefined) {
    byKey = new Map();
    cache.set(input.rules, byKey);
  }
  const key = cacheKey(input);
  const hit = byKey.get(key);
  if (hit !== undefined) return hit;

  const built: ReadonlyArray<Rule> =
    input.colorBy === "single"
      ? [catchAll(SINGLE_RULE_ID, "Single colour", input.singleColor)]
      : [
          // Disabled rules are dropped rather than carried: `matchRule` skips
          // them anyway, and a streaming layer pays for every rule it ships to
          // the worker.
          ...input.rules.filter((r) => r.enabled),
          catchAll(UNMATCHED_RULE_ID, "Unmatched", input.unmatchedColor),
        ];

  if (byKey.size >= MAX_KEYS_PER_RULES_ARRAY) byKey.clear();
  byKey.set(key, built);
  return built;
}

/** The flag that goes with {@link effectiveRules}. "Surface type" is the one
 *  mode that paints nothing, and `compileRuleEvaluator` reads `false` as
 *  "return null", which is what clears a mesh back to its semantic colours. */
export function effectiveRulesEnabled(input: ColorByInput): boolean {
  return input.colorBy === "single" || input.colorBy === "rules";
}

/**
 * The expression a layer is drawn with, or null when it is drawn from
 * {@link effectiveRules}. Returned as stored, so its identity is the
 * renderers' "did the style change?" test, as the rules array's is.
 */
export function effectiveExpression(
  input: ColorByInput,
): LayerStyleExpression | null {
  return input.colorBy === "expression"
    ? (input.styleExpression ?? null)
    : null;
}

/** What a layer with nothing to carry opens on: roofs shaded by pitch, flat
 *  blue to steep red, everything else at its surface colour. A working
 *  example of the three things an expression reads most. */
const STARTER_EXPRESSION: LayerStyleExpression = Object.freeze([
  "case",
  ["==", ["get", "$surface"], "RoofSurface"],
  [
    "interpolate",
    ["linear"],
    ["get", "inclinationDeg"],
    0,
    "#2b83ba",
    45,
    "#d7191c",
  ],
  ["get", "$base"],
]);

/**
 * The expression "Color by expression" opens on when the layer has none yet:
 * the one that draws what the layer drew a moment ago (its rules, or its
 * single colour), or — from surface type — its rules if it has any, so a
 * rule set can be carried into an expression and edited from there.
 */
export function seedStyleExpression(input: ColorByInput): LayerStyleExpression {
  const from =
    input.colorBy === "single" || input.colorBy === "rules"
      ? input
      : input.rules.some((r) => r.enabled)
        ? { ...input, colorBy: "rules" as const }
        : null;
  return from === null
    ? STARTER_EXPRESSION
    : rulesToStyleExpression(effectiveRules(from));
}

/**
 * WHICH rule a surface matched — the inspector's RULE MATCH row, and the
 * per-rule roof counts on a building.
 *
 * A rule, never a colour: two rules may share a colour (a user duplicating one
 * to split its conditions), and reporting the colour would merge them. A
 * synthetic catch-all reads as `null`, i.e. "Unmatched — no rule applies",
 * because the catch-all is a rendering device, not something the user wrote.
 *
 * Same precedence as the renderers, from the same core primitive: first
 * enabled rule wins.
 */
export function firstMatchingRule(
  attributes: Readonly<Record<string, unknown>>,
  metrics: RoofMetrics,
  rules: ReadonlyArray<Rule>,
): Rule | null {
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (evaluateRule(attributes, metrics, rule)) {
      return isSyntheticRule(rule) ? null : rule;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reading the three fields back off an untrusted document
// ---------------------------------------------------------------------------

/** The shape a saved snapshot row or a decoded share layer arrives in: any of
 *  the five fields may be missing, or be anything at all. */
export interface RawColorByFields {
  readonly colorBy?: unknown;
  readonly singleColor?: unknown;
  readonly unmatchedColor?: unknown;
  readonly rules?: unknown;
  readonly rulesEnabled?: unknown;
  readonly styleExpression?: unknown;
}

export interface ColorByFields {
  readonly colorBy: ColorBy;
  readonly singleColor: string;
  readonly unmatchedColor: string;
  readonly styleExpression: LayerStyleExpression | null;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** `#rrggbb` only — the three-digit form is deliberately refused, because
 *  these values are compared byte-for-byte against the reserved palette. */
function hex(value: unknown): string | null {
  return typeof value === "string" && HEX.test(value) ? value : null;
}

/**
 * The ONE validator both restore paths use — the snapshot's `normalizeLayers`
 * and the share hash's `readShareHash`.
 *
 * TOTAL and per-field, like `normalizeGeoLayerStyle` beside it: an absent or
 * unreadable mode reads as an absent one and is DERIVED from the old
 * `rules`/`rulesEnabled` pair, which is what makes every document written
 * before "Color by" existed restore as the rendering it was saved from —
 * "there are rules and they are on" was exactly `colorBy: "rules"`. One bad
 * colour costs only itself.
 */
export function normalizeColorBy(raw: RawColorByFields): ColorByFields {
  const styleExpression = expression(raw.styleExpression);
  // "expression" with nothing to draw is no mode at all: it reads as absent.
  const colorBy =
    isColorBy(raw.colorBy) &&
    (raw.colorBy !== "expression" || styleExpression !== null)
      ? raw.colorBy
      : derivedColorBy(raw);
  return {
    colorBy,
    singleColor: hex(raw.singleColor) ?? SINGLE_COLOR_HEX,
    unmatchedColor: hex(raw.unmatchedColor) ?? UNMATCHED_COLOR_HEX,
    styleExpression,
  };
}

/** An expression is an array or a constant (a colour string). Whether it
 *  COMPILES is the renderer's question, not the restore's: one that does not
 *  is kept, so the style panel can show its errors and the user can fix it. */
function expression(value: unknown): LayerStyleExpression | null {
  return Array.isArray(value) || typeof value === "string"
    ? (value as LayerStyleExpression)
    : null;
}

function derivedColorBy(raw: RawColorByFields): ColorBy {
  const hasRules = Array.isArray(raw.rules) && raw.rules.length > 0;
  // `rulesEnabled` absent means true, the default every reader of an older
  // document already applied.
  return hasRules && raw.rulesEnabled !== false ? "rules" : "surface";
}
