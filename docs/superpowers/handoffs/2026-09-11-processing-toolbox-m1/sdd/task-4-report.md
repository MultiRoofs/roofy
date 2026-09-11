# Task 4 report — Right-panel Tools tab, catalogue view, pill and Escape order

Branch `develop`. Two commits:

- `d6ebf06` fix(processing): clear the unseen-failure dot on every panel opener, ignore a patch for an unheld run
- `7b128d2` feat(processing): Tools tab with catalogue, collapsed pills and Escape order

## Implemented

**Store fixes folded in from the Task 2 review** (`src/features/processing/processingStore.ts`)

- `openTool` and `openLog` now set `unseenFailure: false` — they open the panel, so the amber dot has been seen.
- `patchRun` returns `{}` unless `runs` actually holds the id, so a patch for an evicted/reset run neither rewrites the list nor lights the dot.

**New UI** (`src/ui/processing/`)

- `useEligibilityContext.ts` — one `EligibilityContext` for a candidate target from `layerTables`, `getDuckDBStatus()`, `geoLayerStore` and `layerKindOf`. `getDuckDBStatus()` stays a plain read; the docblock records why (the table subscription re-renders on every engine transition that matters this milestone).
- `CatalogueView.tsx` — spec §5: search box, the three groups in order with headings hidden when empty, tool rows with description, capability chip (`Spatial` / `3D`) and its cost tooltip, the disabled reason as a second line and a `title`, and a click that opens the tool view even when disabled. Ends with `RecentRuns`.
- `RecentRuns.tsx` — the "RECENT RUNS" heading and the "Runs you start appear here" empty state only; rows land with the executor.
- `ProcessingPanel.tsx` — spec §4.2 tab strip: Tools always, Details only with a selection, a × that closes the toolbox. A pick never switches the tab; the Details tab gains a lime dot instead.
- `ToolView.tsx` / `LogView.tsx` — placeholders (name, long description, a back button) that Task 11 replaces.
- `processing.css` — panel, tab strip, catalogue and chip styles on the Soft Utility tokens.

**Wiring**

- `App.tsx` names `hasSelection` / `detailsNode` / `detailsTitle` once and hands the right column either `ProcessingPanel` (with the details as a tab) or the details panel alone, plus `rightMode` and `hasSelection`.
- `ViewerShell.tsx` gains optional `rightMode` (default `"details"`, existing single-pill markup untouched) and `hasSelection`. In `"tools"` mode it renders `.details-pills` with a `Tools` / `Tools · running` pill and the Details pill behind a selection. `app.css` gains `.details-pills` (which takes over the absolute placement `.details-pill` carries alone).
- `ToolsButton.tsx` — spec §4.1: expands a collapsed right panel on open, and reveals an open-but-collapsed toolbox rather than closing something the user cannot see.
- `useEscapeClearsSelection.ts` — the tool form/log step sits after the scene sheet and before the text-entry check; the docblock's numbered order is corrected (it never listed the sheet).

## Tests

TDD throughout, RED observed each time:

| Test                                     | RED                                                                                                        | GREEN       |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------- |
| `processingStore.test.ts` (+2)           | `2 failed / 5 passed` — `unseenFailure` stayed true after `openTool`, and a patch for `"nope"` lit the dot | `7 passed`  |
| `CatalogueView.test.tsx` (7 new)         | transform error, module not found                                                                          | `7 passed`  |
| `ProcessingPanel.test.tsx` (5 new)       | transform error, module not found                                                                          | `5 passed`  |
| `useEscapeClearsSelection.test.tsx` (+2) | `1 failed` — view stayed `{kind:"tool"}`                                                                   | `8 passed`  |
| `ViewerShell.test.tsx` (+3)              | `3 failed` — no Tools pill                                                                                 | `24 passed` |
| `ToolsButton.test.tsx` (+2)              | `2 failed` — panel stayed collapsed                                                                        | `4 passed`  |

Full run before the final commit: **219 files passed, 2650 tests passed, 1 file failed** — `tests/unit/app/appCityParquetLayers.test.tsx`, the pre-existing failure named in the brief. `npx tsc -b --noEmit` clean. `npx vp check` reports only the pre-existing `DrawOverlay.tsx` `no-unused-expressions` error; nothing in the files this task touches.

## Browser check (dev server on 5173, Delft sample, 1600×1000)

Verified, 0 console errors:

- Tools → the right panel shows the tab strip and the catalogue with ROOF / 3D MEASUREMENTS / CROSS-LAYER, the `3D` and `Spatial` chips with their cost tooltips, "Not available yet" on every unimplemented row, **Height from extent enabled**, and "Runs you start appear here".
- Picking a building adds `Details · …0000025028-0` with the lime dot; the Tools tab stays selected and the catalogue stays up.
- × closes the toolbox and the panel goes back to the details panel alone.
- Collapsing the panel with the toolbox open stacks the `Tools` and `Details · …` pills at the map's right edge; clicking Tools again expands rather than closes.
- Opening a tool then pressing Escape returns to the catalogue with the selection and the Details tab intact.
- Computed styles: search 30px / 8px radius, tool row transparent with the shared hover, chip 999px pill on `--lime-100`, tab 8px top radius. Light and dark both checked by screenshot.

## Self-review

- Copy checked verbatim against §4.2/§5: group labels, chip tooltips, the empty-search sentence, "Runs you start appear here".
- No dead code: every new class is used, the placeholders are the smallest thing the catalogue and the Escape order need.
- Tests assert behaviour (store state, rendered text, aria state), not implementation.
- Working tree clean; no stray artefacts (the Playwright output dir was removed).

## Deviations from the brief (all deliberate)

1. **Catalogue test assertion.** The brief expects `"Add a vector layer to join with"` on the join row, but Task 1's `toolEligibility` returns `"Not available yet"` first for any `implemented: false` tool — and every cross-layer tool is unimplemented, so that string cannot render. The test asserts the row is `aria-disabled` and that a disabled row renders its reason line (`"Not available yet"`, and `"Needs a city model layer"` with no active layer). The spec's per-cause copy is already pinned in `eligibility.test.ts`.
2. **The collapse coupling is in `ToolsButton`, not `processingStore`.** Brief Step 6 asks `processingStore.setOpen` to import `useShellStore`. `shellStore.ts` documents "nothing under `features/` may import this module", and `features/layers/crsCode.ts` documents the same rule from the other side — so the import would break a recorded architecture rule. `ToolsButton` (spec §4.1's own component, in `ui/`) does it instead, with its own two tests, and it also covers the case the store hook could not: a click while the toolbox is open behind a collapsed panel now reveals it rather than closing it.
3. **The Details emphasis is derived, not an effect with an eslint-disable.** `seenTitle` (initialised to the title at mount) plus `emphasis = hasDetails && !showDetails && seenTitle !== detailsTitle`. Same behaviour, no suppressed lint rule, and opening the toolbox over an existing selection correctly shows no dot.
4. **The catalogue test builds its layer inline** (the `layerInput` shape from `layerCoordination.test.ts`) rather than parsing `fixtures/two-buildings.city.json`: `addLayer` needs `visible` / `rules` / `colorBy`, and none of the assertions depend on real geometry.

## Concerns / known gaps

- **Spec §4.1's "switches to Tools when the Details tab is showing" is not implemented.** The active tab is local `ProcessingPanel` state, so the map header's Tools button cannot reach it: clicking Tools while the Details tab is showing closes the toolbox instead of switching to Tools. Fixing it means lifting the tab into `processingStore`, which is a store-shape change later tasks build on — flagging it rather than doing it unilaterally.
- A disabled row is announced `disabled` (via `aria-disabled`) yet is still clickable, because §5 wants a disabled row to open the tool view. That is the spec's intent, but it is an accessibility mismatch worth a second look when the tool view lands.
- In a disabled row the reason line reads at full muted contrast while the name and description are dimmed to 0.55, so the reason is the most prominent text in the row. It looks deliberate (the reason is the actionable part) but it inverts the usual hierarchy; easy to retune in `processing.css` if it reads wrong.
- `useEligibilityContext` does not subscribe to the DuckDB status. Fine while nothing loads an extension lazily; M2 must add the subscription when `ensureExtension` starts running.
