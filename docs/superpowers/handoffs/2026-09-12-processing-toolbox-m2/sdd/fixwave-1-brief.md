# M2 fix wave 1 — Codex milestone review (source pass) MAJORs

Spec: docs/superpowers/specs/2026-09-10-processing-toolbox-design.md. Owner decisions: plan "Decisions recorded". TDD, red first, per item.

## F1 (MAJOR) — build/cleanup awaits never race engine death

"`src/insights/layerTables.ts:1001,1043`: Boot/build awaits never race engine death; a dropped worker request strands the shared FIFO despite table invalidation."
REQUIRED: hoist runQueue.ts's `raced(promise, signal | null)` (the abort+death race) into a shared engine-free module (e.g. `src/insights/engineAwait.ts` exporting `racedWithDeath`/`raced`), keep runQueue using it, and wrap EVERY engine await in layerTables' build pipeline and its cleanup (`initDuckDB` wait, registerBuffer, the CREATE/ALTER/DESCRIBE/count statements, `discardHalfBuilt`'s DROPs, `refreshLayerTableColumns`) so a death releases the build: the build abandons (entry stays failed "Analytics engine stopped") without issuing further SQL, and the FIFO accepts the next task. Test: a never-settling statement mid-build + engine death → the build settles, the entry is failed engine-stopped, no cleanup SQL, the next queued task runs.

## F2 (MAJOR) — offline boot leaves lazy extensions "unloaded", so scenario 6 never shows the reason or Retry

"`src/ui/processing/CatalogueView.tsx:125`: Retry requires `failed`, but offline boot leaves lazy extensions `unloaded`; scenario 6 never exposes its download reason or Retry."
RULING: at boot (in `duckdb.ts`, when the engine reaches ready), if `navigator.onLine === false` (advisory; guard for non-browser), publish `spatial` and `three_d` as `{ state: "failed", reason: <the spec's download reason for that extension> }` so the chips mute with "The spatial extension could not be downloaded; check the connection and retry" and offer Retry; Retry calls `ensureExtension`, which offline fails again with the same reason (and online succeeds and publishes loaded). Extension-free tools stay enabled. No `online`-event auto-clear (Retry is the door). Tests: boot with onLine false → both lazy extensions failed with the reason, chips muted + Retry rendered (extensionChip suite); onLine true → unchanged.

## F3 (MAJOR) — the Style-by-result median includes part rows

"`src/ui/processing/RunFooter.tsx:53`: Median still includes part rows, contradicting the ledger's explicit root-only ruling and biasing Roof metrics' style threshold."
REQUIRED: the median query restricts to ROOT rows — verify the table's convention first (M1's flat rows and the reader's rows carry `feature_id`; a root's `feature_id` is NULL or equals its `id` — check `src/insights/layerRows.ts` and the reader's column docs in `layerTables.ts`), then `WHERE "feature_id" IS NULL OR "feature_id" = "id"` (or the verified equivalent), and the tested draft value changes with unequal part counts (e.g. a root with 3 parts: the root-only median differs from the row median).

## Rules

Locate edit sites by the quoted code (line numbers drift). Every `vi.mock` of `insights/duckdb` exports what its module under test imports (incl. `onEngineDeath`, `getEngineGeneration`, `subscribeDuckDBStatus`, `getDuckDBStatusVersion`). Tests import from "vitest"; `noUncheckedIndexedAccess`; lint baseline 56; `tsc -b --noEmit` clean; commits small, by path, prefixes `fix:`/`test:`, NO trailers; no push; no subagents.
