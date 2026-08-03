/**
 * The colorization-rule schema.
 *
 * The declarations moved to `@cityjson/navara-core` in M7.2, because the
 * FlatCityBuf worker evaluates rules off the main thread. The app keeps the
 * presets, the editing UI and the per-layer rule state; only the schema moved.
 *
 * KEPT as a re-export by Task C22, on the same test as
 * `domain/citymodel/types.ts`: ~13 modules name this path and `Rule`/
 * `Condition` are app vocabulary, so repointing them would be churn rather
 * than a simplification. `evaluate.ts` next to it had zero importers left and
 * is gone — call `evaluateRule`/`matchRule` on `@cityjson/navara-core`.
 */
export type {
  Condition,
  ConditionOperator,
  LogicMode,
  Rule,
} from "@cityjson/navara-core";
