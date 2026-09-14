# Inputs for Task 28 (documentation) — compiled by the commander from the M3 ledger (2026-09-13)

## Engine facts found during M3 (DuckDB 1.5.5 / duckdb-wasm 1.33.1-dev64.0; every one pinned by a probe in tests/integration/duckdb/)

- D1 `ST_3DValidationReport(s)` on a runtime-NULL solid returns UNINITIALISED memory (flags flip between runs; reading `message` once crashed the wasm). Every report field is read as `CASE WHEN s IS NOT NULL THEN r.<field> END`; volume as `CASE WHEN s IS NOT NULL AND r.is_valid THEN ST_3DVolume(s) END`; `r.code`/`r.message` never selected.
- D2 `ST_3DValidationReport` and `ST_GeomFromGeoJSON` have two overloads; a bare NULL literal is a Binder error (tests cast).
- D3 the report struct has 13 fields incl. `orientation_error_count`.
- D4 a CompositeSolid's WKB type name is "GeometryCollection Z" — solid detection keys on the CityJSON geometry type (`Surface.geometryType`, `geometry_properties_lod*.type`), never on `cityjson_wkb_geometry_type`.
- D5 `ST_NDims` is absent in this spatial build; `ST_HasZ` exists.
- D6 `ST_Within` is interior-only; §7.5's "within (boundary included)" is `ST_CoveredBy`.
- D7 `ST_GeomFromGeoJSON(NULL)` raises only while the `json` extension is unloaded; NULL once `read_json` autoloads it. `ST_Centroid`/`ST_Union_Agg` KEEP Z; only `ST_Force2D` drops it.
- D8 `ST_Union_Agg` over an empty set returns `GEOMETRYCOLLECTION EMPTY`, not NULL (the proxy wraps it to NULL: `g IS NULL` is the one "no proxy" signal); the reader names LoD "0" as `geometry_lod0_0`; DuckDB prunes unreferenced projections.
- D9 `read_json_auto` over the values file infers JSON for a VARCHAR that first appears after 20,480 NULLs and stores the two-character string `""` (non-empty late text is quoted too) — the write now reads the values file with the DECLARED column types (`read_json(columns=…)`).
- D10 core `ST_Distance`/`ST_DWithin` return 0 for ANY polygon↔polygon pair — Distance to nearest uses `ST_Distance_GEOS` (present in the wasm_eh binary).
- `mode()` is non-deterministic on ties — the most-frequent value is `GROUP BY … ORDER BY n DESC, v ASC LIMIT 1` over root rows, NULLs excluded.
- `median()` over DECIMAL arrives as a Uint32Array (M2) — every median CASTs to DOUBLE.
- `two-buildings.city.json`: `NL.IMBAG.Pand.0001` has a MultiSurface PART at LoD 2.2, so by §7's contributor rule the feature is skipped "not a solid"; `fixtures/invalid-solid.city.json` (one unclosed Solid) and `fixtures/composite-solid.city.json` (two unit cubes, volume 2) were added — README rows needed with provenance (authored in-repo for the M3 probes).

## User-visible decisions (owner-approved or commander rulings) to record

- Everything remaining shipped: Measure solids, Validate solids, Join attributes by location, Aggregate buildings per area, Distance to nearest, New layer for every tool (city copies cut from the parent TABLE by feature roots, reader-backed by metadata + `sourceFeatureIds`; vector copies plain GeoJSON).
- New layer is DISABLED for a streaming (FlatCityBuf) target (A2) — resident records carry no geometry; scenario 10's streaming variant is unmet.
- Adapted copy A1–A17 (list in the plan's copy table) accepted; a distinct rule palette (#7cb518, #2563eb, #c2410c, #7e22ce, #0f766e, #be185d, #b45309, #15803d).
- A Style-by-result draft's Save switches Color by to Rules from ANY mode; a manual rule keeps the surface-only flip; nothing repaints before Save.
- Aggregate's count column is `<prefix>buildings_n` (`bld_buildings_n`); its scope radios stay under TARGET with A12.
- Log ENTRY labels are descriptive (M1 precedent), not spec copy.
- A derived layer dropped from a SHARE link gets no notice (§8 words the sentence for Save only).
- After an engine death past Undo's COMMIT the card stays "done" and every Undo is revoked by the session flag (§6.1); a "cancelling" later run counts as using a derived copy.
- Vector runs: a SOURCE city-table rebuild retires a vector run (computeLayerId keying); a vector Undo is revoked on engine death like every other.

## Carried to M4 / roadmap (each from a ruling)

- The contributor-id `IN (…)` list on scope "All" is unbounded (solids + cross-layer footprint path) — watched at the gate on the Delft sample; pushing contributor selection into SQL is the fix if it bites.
- Provenance is not cleared when a layer is REMOVED (pre-existing; only the rebuild path clears it).
- `queryParquetBuffer`'s VFS awaits and `ensureExtension`'s in-flight INSTALL/LOAD are unraced against a death (outside design (h)'s six primitives).
- The FCB attribute write-back stays a future consideration; streaming targets cannot use New layer.
- "Show run log" on a derived layer's row is disabled once its run leaves the 20-run history (ancestry itself is kept on the record).
- Minors deferred to the final review are listed per task in the ledger (`grep "Minor (deferred" progress.md`).
