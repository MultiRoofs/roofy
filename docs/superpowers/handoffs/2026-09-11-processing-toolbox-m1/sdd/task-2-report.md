# Task 2 report — processingStore (panel state, drafts, runs, notices)

Commit: `12a602e` — `feat(processing): panel, draft and run history store` (on `develop`).

## Implemented

`src/features/processing/processingStore.ts` (new, engine-free Zustand store), verbatim per the brief:

- Exported types: `ProcessingView` (`catalogue` | `tool` | `log` with a `from` breadcrumb), `ToolDraft`.
- State: `open`, `view`, `search`, `drafts` (per `ToolId`), `runs` (newest first, capped at `MAX_RUNS = 20`), `unseenFailure`, `notice`, `noticeSeq`.
- Actions: `setOpen`, `toggle`, `openTool`, `openLog`, `back`, `setSearch`, `setDraft`, `upsertRun`, `patchRun`, `pushNotice`, `resetForTest`.
- Module function `runById(id)` returning `RunRecord | null`.
- No shell-store side effect in `setOpen` (Task 4 adds that later). No persistence, no DuckDB, no `@navaramap/*`.

Behaviour notes baked in: closing resets the view to the catalogue and clears `unseenFailure`; opening keeps the current view and clears `unseenFailure`; `upsertRun` replaces by id and re-heads the list; a `failed` status arriving while the panel is closed raises `unseenFailure`.

## Tested + results

`tests/unit/features/processing/processingStore.test.ts` (new, 5 tests, exactly the brief's cases):
open/toggle, per-tool draft retained across `back()`/`openTool`, 22 upserts capped to 20 newest-first plus `patchRun`, unseen-failure flag cleared on open, notice + sequence number.

- Focused: `npx vitest run tests/unit/features/processing/processingStore.test.ts` → **5 passed**.
- Types: `npx tsc -b --noEmit` → clean (no output).
- Full: `npx vitest run` → `Test Files 1 failed | 216 passed | 1 skipped (218)`, `Tests 1 failed | 2627 passed | 17 skipped`. The single failure is the pre-existing `tests/unit/app/appCityParquetLayers.test.tsx` (drop-zone `getByTestId`), untouched by this task. The known `DrawOverlay.tsx` lint failure is a `vp check` finding, not a vitest one, so it does not appear here.
- Pre-commit hook (`vp staged` → `vp check --fix`) ran and passed; no re-stage was needed and the tree is clean after the commit.

## TDD evidence

RED — test written first, store absent:

```
$ npx vitest run tests/unit/features/processing/processingStore.test.ts
FAIL tests/unit/features/processing/processingStore.test.ts
Error: Failed to resolve import "../../../../src/features/processing/processingStore"
       from "tests/unit/features/processing/processingStore.test.ts". Does the file exist?
Test Files  1 failed (1)
     Tests  no tests
```

GREEN — after writing `processingStore.ts`:

```
$ npx vitest run tests/unit/features/processing/processingStore.test.ts
Test Files  1 passed (1)
     Tests  5 passed (5)
$ npx tsc -b --noEmit    # (after the ?. fix below) → no output
```

All vitest runs used the pinned Node via `export PATH="$HOME/.local/share/mise/shims:$PATH"` in the same shell invocation.

## Files changed

- `src/features/processing/processingStore.ts` (new, 108 lines)
- `tests/unit/features/processing/processingStore.test.ts` (new, 94 lines)

## Self-review findings

- **One deviation from the brief's verbatim test**, forced by types: `tsconfig.app.json` sets `noUncheckedIndexedAccess`, so the brief's `runs[0].id` / `runs[0].status` produced `TS2532: Object is possibly 'undefined'` (lines 74, 76). Changed to `runs[0]?.id` and `runs[0]?.status`, matching the dominant style in `tests/unit` (e.g. `LodSelector.test.tsx`, `filterCandidates.test.ts`). The assertions are unweakened — `toBe("r21")` / `toBe("done")` still fail if the element is missing.
- Naming, state shape and action signatures match the brief exactly, so Tasks 3–14 can call `setOpen`, `toggle`, `openTool`, `openLog`, `back`, `setSearch`, `setDraft`, `upsertRun`, `patchRun`, `pushNotice`, `runById` as planned.
- YAGNI: nothing beyond the brief — no extra selectors, no notice queue, no persistence, no side effects on other stores.
- The hook's `--fix` pass changed only line wrapping in `upsertRun`/`patchRun`; semantics untouched.

## Concerns / observations

- `resetForTest` is a test-only action on a production store and has **no precedent** in this repo (`atmosphereStore`/`renderDebugStore` expose a user-facing `reset`, `queryStore` a domain `resetQuery`). The brief mandates it and the test depends on it, so it ships as specified — flagging only in case the milestone would rather standardise on `useProcessingStore.setState(initial)` in tests.
- The brief's "Produces" line lists state `{ open, view, search, drafts, runs, notice, noticeSeq }` but omits `unseenFailure`, which the brief's own interface and test both require. Cosmetic inconsistency in the brief; the code block is the spec and was followed.
- `.superpowers/.../global-constraints.md` ends with an empty `## Facts about the current code (verified 2026-09-10)` heading, and the brief does not itself carry the constraints at its top as the dispatch note said. Nothing there contradicted the code, so this was not raised as NEEDS_CONTEXT.
- Minor behavioural nuances, both as the brief specifies: `patchRun` on an id no longer in history (evicted by the 20-run cap) silently no-ops, and `unseenFailure` is only raised while the panel is closed.
