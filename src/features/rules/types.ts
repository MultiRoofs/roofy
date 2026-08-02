/**
 * Re-export shim — the colorization-rule schema now lives in
 * `@cityjson/navara-core` (M7.2), because the FlatCityBuf worker evaluates
 * rules off the main thread. The app keeps the presets, the editing UI and
 * the per-layer rule state; only the schema moved.
 */
export type {
  Condition,
  ConditionOperator,
  LogicMode,
  Rule,
} from "@cityjson/navara-core";
