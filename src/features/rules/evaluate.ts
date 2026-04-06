/**
 * Rule evaluation engine.
 *
 * Evaluates conditions against surface metrics and attributes.
 * Rules are evaluated in priority order — first match wins.
 */

import type { RoofMetrics } from "../../domain/roofMetrics/types";
import type { Condition, Rule } from "./types";

/**
 * Evaluate a single condition against a resolved field value.
 * Returns false for null/undefined values.
 */
export function evaluateCondition(
  fieldValue: unknown,
  condition: Condition,
): boolean {
  if (fieldValue === null || fieldValue === undefined) return false;

  const { operator, value } = condition;

  if (operator === "=") {
    return fieldValue === value;
  }

  // Numeric operators require both sides to be numbers
  if (typeof fieldValue !== "number" || typeof value !== "number") {
    return false;
  }

  switch (operator) {
    case ">":
      return fieldValue > value;
    case "<":
      return fieldValue < value;
    case ">=":
      return fieldValue >= value;
    case "<=":
      return fieldValue <= value;
    default:
      return false;
  }
}

/**
 * Resolve a field name to its value from metrics or attributes.
 * Metrics take precedence over attributes for known metric field names.
 */
function resolveField(
  field: string,
  attributes: Readonly<Record<string, unknown>>,
  metrics: RoofMetrics,
): unknown {
  if (field in metrics) {
    return metrics[field as keyof RoofMetrics];
  }
  return attributes[field];
}

/**
 * Evaluate whether a rule matches given attributes and metrics.
 * Empty conditions list is vacuously true (matches everything).
 */
export function evaluateRule(
  attributes: Readonly<Record<string, unknown>>,
  metrics: RoofMetrics,
  rule: Rule,
): boolean {
  if (rule.conditions.length === 0) return true;

  if (rule.logic === "AND") {
    return rule.conditions.every((cond) =>
      evaluateCondition(resolveField(cond.field, attributes, metrics), cond),
    );
  }

  // OR logic
  return rule.conditions.some((cond) =>
    evaluateCondition(resolveField(cond.field, attributes, metrics), cond),
  );
}

/**
 * Find the first matching enabled rule and return its color.
 * Returns null if no rule matches.
 */
export function matchRule(
  attributes: Readonly<Record<string, unknown>>,
  metrics: RoofMetrics,
  rules: ReadonlyArray<Rule>,
): string | null {
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (evaluateRule(attributes, metrics, rule)) {
      return rule.color;
    }
  }
  return null;
}
