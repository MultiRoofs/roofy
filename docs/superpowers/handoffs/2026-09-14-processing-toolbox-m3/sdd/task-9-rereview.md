### Findings

- **Resolved — deterministic most-frequent tie-break.** The `src/insights/sql.ts` diff replaces `mode()` with grouped counts and `ORDER BY "n" DESC, "v" ASC LIMIT 1`, retaining root-only filtering and NULL exclusion. Added real-engine cases cover tied values, reversed insertion order, unequal part counts, NULLs, and frequency taking precedence over value ordering.
- **Resolved — picked-column empty test.** The fixture now uses Validate solids with nonempty first column `solid_closed` and empty fourth column `solid_valid`, distinguishing picked-column checking from first-column checking.
- **Resolved — function-form resolver coverage.** A synthetic descriptor returns different operators and value sources for VARCHAR and DOUBLE. Tests assert both resolvers directly and exercise both paths through the real footer, checking SQL and resulting drafts.

### Regressions

None identified. The query now returns zero rows for empty input; the footer already handles missing rows and NULL values equivalently. Tests were not rerun.

### Assessment — Task quality: Approved

All three findings are resolved by the supplied diff, with no regression identified within scope.
