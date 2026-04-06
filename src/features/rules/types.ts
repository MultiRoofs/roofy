/**
 * Rule system types for conditional colorization.
 *
 * A Rule has a list of Conditions combined with AND or OR logic.
 * Each Condition tests a field (metric or attribute) against a value
 * using a comparison operator. Rules are evaluated in priority order
 * (array position) — first match wins.
 */

export type ConditionOperator = ">" | "<" | "=" | ">=" | "<=";

export interface Condition {
  readonly field: string;
  readonly operator: ConditionOperator;
  readonly value: number | string | boolean;
}

export type LogicMode = "AND" | "OR";

export interface Rule {
  readonly id: string;
  readonly name: string;
  /** CSS hex color, e.g. "#4ec84e". */
  readonly color: string;
  readonly conditions: ReadonlyArray<Condition>;
  readonly logic: LogicMode;
  readonly enabled: boolean;
}
