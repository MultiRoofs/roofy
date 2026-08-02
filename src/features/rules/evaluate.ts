/**
 * Re-export shim — rule evaluation now lives in `@cityjson/navara-core`
 * (M7.2). See `src/features/rules/types.ts` for why.
 */
export {
  evaluateCondition,
  evaluateRule,
  matchRule,
} from "@cityjson/navara-core";
