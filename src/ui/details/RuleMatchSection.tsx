/**
 * The RULE MATCH section — which rule (if any) coloured the selection.
 *
 * A surface subject shows the one matching rule, or "Unmatched — no rule
 * applies". A building subject shows per-rule roof-surface counts plus the
 * unmatched count. Identity, never colour: two rules may share a colour, so
 * each row shows the rule's name, condition and swatch, not just its colour.
 */
import type { Rule } from "../../features/rules/types";
import type { RuleMatchResult } from "./ruleMatch";

function conditionText(rule: Rule): string {
  if (rule.conditions.length === 0) return "All roofs";
  return rule.conditions
    .map((c) => `${c.field} ${c.operator} ${c.value}`)
    .join(` ${rule.logic} `);
}

export function RuleMatchSection({
  result,
}: {
  readonly result: RuleMatchResult;
}) {
  return (
    <section className="details-section">
      <h3 className="details-section-title">Rule match</h3>
      {result.kind === "surface" ? (
        result.rule === null ? (
          <div className="details-placeholder">Unmatched — no rule applies</div>
        ) : (
          <RuleMatchRow rule={result.rule} />
        )
      ) : result.matched.length === 0 ? (
        <div className="details-placeholder">Unmatched — no rule applies</div>
      ) : (
        result.matched.map(({ rule, surfaces }) => (
          <RuleMatchRow key={rule.id} rule={rule} surfaces={surfaces} />
        ))
      )}
      {result.kind === "building" && result.unmatched > 0 && (
        <div className="legend-item">
          <div className="legend-dot" />
          <span>Unmatched · {result.unmatched}</span>
        </div>
      )}
    </section>
  );
}

function RuleMatchRow({
  rule,
  surfaces,
}: {
  readonly rule: Rule;
  readonly surfaces?: number;
}) {
  return (
    <div className="legend-item">
      <div className="legend-dot" style={{ background: rule.color }} />
      <span className="rule-match-name">{rule.name}</span>
      <span className="rule-match-condition">{conditionText(rule)}</span>
      {surfaces !== undefined && (
        <span className="rule-match-count">· {surfaces}</span>
      )}
    </div>
  );
}
