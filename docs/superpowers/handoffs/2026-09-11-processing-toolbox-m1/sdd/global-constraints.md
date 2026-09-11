## Global Constraints

- Never run bare `vite`/`vp dev`; use `npm run dev`, `npm run build`, `npx vp check`, `npx vitest run`, `npx tsc -b --noEmit`.
- `src/insights/duckdb.ts` is the ONLY importer of `@duckdb/duckdb-wasm`. Every NEW export from `duckdb.ts` must be added to every `vi.mock(".../insights/duckdb", ...)` factory (18 files, listed in Task 7). This milestone adds none, so nothing to do unless a task says otherwise.
- ONE writer of the DuckDB status (`App` state, value owned by `duckdb.ts`). This milestone does not load extensions.
- Test files import from `"vitest"`, never `"vite-plus/test"`.
- Submodule-first: commit inside `packages/cityjson-navara-plugins` first, push it (`git -C packages/cityjson-navara-plugins push origin main`), then commit the pointer bump in the parent. Always `cd` into the submodule for pnpm; never `pnpm -C`.
- Commits: small, prefixed `feat:` / `fix:` / `test:` / `docs:` / `refactor:`; commit directly on `develop`. No attribution trailers.
- UI: Soft Utility tokens from `src/app/flatControls.css` (`--control-radius` 8px, `--control-height` 38px, `--control-height-compact` 30px). Reuse `ActionIcon`. Verify new controls against peers in the browser.
- Copy: every user-visible string comes from the spec verbatim (§5 reasons, §6 labels, §6.2 card, §7.4 outputs).
- Features, not rows (spec §7): a BuildingPart never counts as a building; roll-ups are per feature (`COALESCE("feature_id","id")`).
- Nothing new is persisted (snapshot schema v4 untouched).
- Pre-commit hook runs `vp staged`; pre-push runs `vp check`, `tsc -b --noEmit`, `vp test run`. Do not bypass hooks.

## Facts about the current code (verified 2026-09-10)
