/**
 * Which rule matched a selection's roof surface(s), pure.
 *
 * RULE MATCH reports identity, never colour: two rules may share a colour,
 * so the answer is the `Rule` object (or `null` for "no rule applies"). The
 * match is computed over the layer's USER rules via `firstMatchingRule` — the
 * same precedence the renderers use — and only when the layer is actually
 * colouring by rules; any other mode answers `null` and the panel hides the
 * section.
 */
import type { Layer } from "../../features/layers/layerStore";
import type { Surface } from "../../domain/citymodel/types";
import type { Rule } from "../../features/rules/types";
import type { RoofMetrics } from "@cityjson/navara-core";
import { firstMatchingRule } from "../../features/rules/colorBy";
import type { ResolvedBuilding } from "./subject";

/** A surface subject: the one surface and its metrics, as `useResolvedSubject`
 *  produces for a `kind: "surface"` selection. */
export interface ResolvedSurfaceSubject {
  readonly surface: Surface;
  readonly owner: ResolvedBuilding["object"];
  readonly metrics: RoofMetrics;
}

export type RuleMatchResult =
  | { readonly kind: "surface"; readonly rule: Rule | null }
  | {
      readonly kind: "building";
      readonly matched: ReadonlyArray<{
        readonly rule: Rule;
        readonly surfaces: number;
      }>;
      readonly unmatched: number;
    };

export function ruleMatchFor(
  resolved: ResolvedBuilding | ResolvedSurfaceSubject,
  layer: Layer,
): RuleMatchResult | null {
  if (layer.colorBy !== "rules") return null;

  if ("roofSurfaces" in resolved) {
    const counts = new Map<string, { rule: Rule; count: number }>();
    let unmatched = 0;
    for (const roof of resolved.roofSurfaces) {
      const rule = firstMatchingRule(
        roof.owner.attributes,
        roof.metrics,
        layer.rules,
      );
      if (rule === null) {
        unmatched++;
        continue;
      }
      const entry = counts.get(rule.id);
      if (entry) entry.count++;
      else counts.set(rule.id, { rule, count: 1 });
    }
    return {
      kind: "building",
      matched: [...counts.values()].map((c) => ({
        rule: c.rule,
        surfaces: c.count,
      })),
      unmatched,
    };
  }

  const rule = firstMatchingRule(
    resolved.owner.attributes,
    resolved.metrics,
    layer.rules,
  );
  return { kind: "surface", rule };
}
