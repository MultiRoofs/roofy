### Findings

- **Resolved — Important: run-log availability after eviction.** The `LayerList.tsx` diff replaces the one-shot `runById` lookup with a boolean store subscription for the row’s specific run. It preserves absent, enabled, and disabled menu states without rerendering on unchanged selector results. The mounted `LayerList` regression test opens the menu, evicts the run through 20 `upsertRun` calls, verifies eviction, and checks the item becomes disabled without remounting or reopening.
- **Resolved — Minor: combined real-engine derived export.** The added integration case exercises `buildCityParquetSourceSql` and the actual CityParquet writer together. Exact row assertions retain the selected root and its part, exclude the sibling, verify distinct computed values on both retained rows, and verify those rows and values in `building.parquet`. The two-building fixture discriminates every requested behavior; multiple retained roots are not exercised, but that does not leave the original finding open.

### Regressions

None found in the scoped diff. The production change preserves ordinary-row behavior and applies to both layer kinds; the added export output directory is included in cleanup. Static review only; no tests rerun.

### Assessment — Task 24 quality: Approved

Both scoped findings are resolved with targeted regression coverage and no identified regression.
