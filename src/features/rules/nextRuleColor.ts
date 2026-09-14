/**
 * Which colour the NEXT rule on a layer opens with (spec §6.2).
 *
 * Under `features/rules/` rather than in `cityColors.ts` because it is a
 * DECISION about a layer's rules, and `cityColors` is the brand's values; and
 * not in `RulesEditor` because Style by result needs the same answer without
 * the editor being mounted — two callers, one rotation, or the second rule a
 * result card drafts is the same colour as the first.
 */
import type { Rule } from "./types";
import { RULE_PALETTE_HEX } from "../../scene/cityColors";

export function nextRuleColor(rules: ReadonlyArray<Rule>): string {
  // ENABLED rules only: a disabled rule paints nothing, so its colour is not
  // taken and re-offering it is the right answer rather than a collision.
  const taken = new Set(
    rules
      .filter((rule) => rule.enabled !== false)
      .map((rule) => rule.color.toLowerCase()),
  );
  const free = RULE_PALETTE_HEX.find((hex) => !taken.has(hex.toLowerCase()));
  // Every palette colour is in use, so the rotation restarts by COUNT — eight
  // rules in, the ninth wears the first colour again. Two rules sharing a
  // colour is a legible state (the legend names them); a ninth rule with no
  // colour at all is not.
  return free ?? RULE_PALETTE_HEX[rules.length % RULE_PALETTE_HEX.length]!;
}
