# Task 1 report — Types, tool registry and eligibility (pure)

Commit: `14701ca` — `feat(processing): tool registry, run types and eligibility rules`
Branch: `develop` (parent repo only; no submodule change in this task).

## What I implemented

Three new engine-free modules under `src/features/processing/` plus one Vitest file, exactly as
the brief's verbatim code specifies. No deviations, no additions.

- `/Users/hbbaba/tudelft/projects/multiroof/multiroof-viewer/src/features/processing/types.ts` (107 lines)
  — the toolbox vocabulary: `ToolGroup`, `ToolId` (7 ids), `ToolExtension`, `ToolDefinition`,
  `Scope`, `RunPhase`, `RunStatus`, `LogEntry`, `SkipCount`, `RunSummary`, `RunRecord`,
  `Eligibility`. All fields `readonly`, as the brief has them.
- `/Users/hbbaba/tudelft/projects/multiroof/multiroof-viewer/src/features/processing/toolRegistry.ts` (129 lines)
  — `TOOLS` (the 7 spec §5 definitions in display order, only `height-from-extent`
  `implemented: true`), `GROUP_LABELS`, `toolById(id)` (throws on unknown), `filterTools(tools, query)`.
- `/Users/hbbaba/tudelft/projects/multiroof/multiroof-viewer/src/features/processing/eligibility.ts` (86 lines)
  — `EncodingName`, `EligibilityContext`, and the pure `toolEligibility(tool, ctx)` with the spec §5
  reasons in the brief's priority order (unimplemented → engine → target kind → reader → source
  availability → vector source → extension → table).
- `/Users/hbbaba/tudelft/projects/multiroof/multiroof-viewer/tests/unit/features/processing/eligibility.test.ts` (112 lines)
  — the brief's 8 cases.

Every one of the brief's "Produces" names is exported and none is renamed: `ToolId`,
`ToolDefinition`, `TOOLS`, `toolById`, `Scope`, `RunRecord`, `RunStatus`, `RunPhase`, `LogEntry`,
`RunSummary`, `SkipCount`, `Eligibility`, `toolEligibility` (plus `ToolGroup`, `ToolExtension`,
`GROUP_LABELS`, `filterTools`, `EncodingName`, `EligibilityContext` from the brief's code).

## Pre-flight verification against the real code

Before writing I checked the brief's context vocabulary against the modules it mirrors; all four
line up, so no `NEEDS_CONTEXT` was warranted:

- `src/features/layers/layerPresentation.ts:27` — `LayerKind = "city" | "streaming" | "vector" | "raster" | "tiles"`, matching `EligibilityContext.targetKind` (plus the brief's extra `"none"` for no active layer).
- `src/insights/duckdb.ts:41` — `DuckDBStatus` states are `uninitialized | initializing | ready | failed`, matching `engineState`.
- `src/insights/duckdb.ts:28` — `ExtensionStatus` is `unloaded | loading | loaded` plus a `failed` variant, matching `extensionState`.
- `src/insights/layerTables.ts:140` — `LayerTableState` is `queued | building | ready | failed`, matching `tableState` (plus the brief's `"none"`).
- Every user-visible reason string is verbatim from spec §5 (`docs/superpowers/specs/2026-09-10-processing-toolbox-design.md:201–222`). The one exception is `"Not available yet"` for an unimplemented tool, which is the plan's own string (not in the spec) — the plan/brief is binding, so I used it as written.

## TDD evidence

Order followed the brief: types + registry first (no behaviour to test), then the test, then the
implementation — so the RED failure is specifically the missing `eligibility` module.

**RED** — `npx vitest run tests/unit/features/processing/eligibility.test.ts`

```
 FAIL  tests/unit/features/processing/eligibility.test.ts [ tests/unit/features/processing/eligibility.test.ts ]
Error: Failed to resolve import "../../../../src/features/processing/eligibility" from "tests/unit/features/processing/eligibility.test.ts". Does the file exist?
  Plugin: vite:import-analysis
 Test Files  1 failed (1)
      Tests  no tests
```

Failed for the intended reason (the module under test does not exist yet), and the registry import
on the next line resolved fine.

**GREEN** — same command, after writing `eligibility.ts`

```
 Test Files  1 passed (1)
      Tests  8 passed (8)
   Duration  494ms
```

Re-run after the commit: still `1 passed (1)` / `8 passed (8)`.

## Other checks

- `npx tsc -b --noEmit` — exit 0, no output. `tsconfig.app.json:51` includes `tests`, so the test file is genuinely type-checked, not just transpiled.
- `npx vp check` — formatter passes on all 547 files; my 4 files raise no lint or type finding. The run reports 1 pre-existing error and 55 pre-existing warnings elsewhere (see Concerns).
- `npx vitest run` (full suite) — on the project's pinned Node 24 (mise shims): `215 passed | 1 failed | 1 skipped` files, `2622 passed | 1 failed | 17 skipped` tests. The single failure is pre-existing (Concern 2). On the sandbox's default Node 26 the same run shows 39 failures, all of them a runtime artefact (Concern 1); either way my files add 8 passing tests and break nothing, proven by A/B.
- Engine-free: `grep -ln "react\|duckdb\|navara" src/features/processing/*.ts` returns nothing.
- Pre-commit hook (`vp staged` → `vp check --fix`) ran and rewrote nothing; the working tree is clean after the commit and `git show --stat HEAD` lists exactly the 4 intended files (434 insertions, no modifications to existing files).
- Nothing else touched: no `progress.md` edit, no submodule change, no `duckdb.ts` export added (the plan's Global Constraints say this milestone adds none).

## Self-review findings

- Verified all 13 brief "Produces" names exported, none renamed — later tasks (2, 3, 4, 9, 11) bind to these.
- Verified `TOOLS` has exactly 7 entries and `implemented: true` appears exactly once (`height-from-extent`, line 59).
- `GROUP_LABELS` and `filterTools` are in the brief's registry code but not in its "Produces" list. I wrote them as given (the code is binding) and confirmed `vp check` does not flag them as unused exports. Verified consumer: Task 4 declares both under "Consumes" (plan line 1029) and its `CatalogueView` uses them (plan lines 1230–1232, 1256, 1281).
- `sourceAvailable` is only consulted when `tool.needsReader` is true. That is the brief's code as written and the test only exercises reader-backed tools for that branch. Flagging it as a deliberate non-deviation, not a defect: a non-reader tool on a restored dropped-file layer stays eligible because it works off the DuckDB table, not the file.
- No stray output in the test run beyond a pre-existing Vite config-loader warning (see Concerns).

## Concerns

None blocking this task — my own change is clean. Four things the controller should act on; items 2
and 3 will fail the pre-push hook for whoever pushes this milestone, and item 1 will waste every
later task's time if not passed on:

1. **Run the suite on the project's pinned Node, not the sandbox default.** My first full run showed
   39 failures across 6 files. `mise.toml` pins `node = "24"`, but the default `node` on this host is
   v26.5.0, where Node's own experimental `localStorage` global shadows jsdom's and is `undefined`
   (`localStorage is not available because --localstorage-file was not provided`), so every test
   using the shared `afterEach`'s `localStorage.clear()` dies with
   `TypeError: Cannot read properties of undefined (reading 'clear')`.

   Re-running with the pinned runtime — `export PATH="$HOME/.local/share/mise/shims:$PATH"`
   (`node --version` → v24.18.1) — drops it to **1 failure / 2622 passed**. 38 of the 39 were the
   wrong runtime. Later tasks in this milestone should export that PATH before `npx vitest run`,
   otherwise they will chase 38 phantom failures.

2. **One genuine pre-existing test failure on `develop`**, reproducible under the pinned Node and
   deterministic across two runs:
   `tests/unit/app/appCityParquetLayers.test.tsx > App — a failed group add is reported > leaves an
error row in the layer list inside the viewer shell` fails with
   `TestingLibraryElementError: Unable to find an element by: [data-testid="source-picker-drop-zone"]`.
   Not mine — my commit only adds files nothing yet imports, and the earlier A/B (both new
   directories moved aside) reproduced this same failure without them. It looks like fallout from the
   recent `b6c8a39 feat: improve UI`; the controller should decide whether to fix it in this
   milestone, because pre-push runs `vp test run` and this alone will fail it.
3. **1 pre-existing `vp check` error** (same under both Node versions): `src/ui/viewport/DrawOverlay.tsx:130` —
   `eslint(no-unused-expressions)` on `extruding ? void finish(height) : finishFootprint();`. Not my
   file (my only changes are the 4 new files) and it will fail the pre-push `vp check`.
4. **Commit-trailer discrepancy**: `CLAUDE.md` asks for a `Co-Authored-By` trailer; the controller's
   dispatch and the plan's Global Constraints both say "No attribution trailers." I followed the
   controller/plan and committed without a trailer. Worth settling once for all 13 tasks so the
   milestone's history is consistent.

Also noted, harmless: `vitest.config.ts:3` imports `./vite.config` without a file extension, so every
vitest run prints a `configLoader: 'native'` deprecation warning. Pre-existing, untouched by me.
