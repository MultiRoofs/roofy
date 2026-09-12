# Task 13 — Switch the tool on — report

Branch `develop`, base 95f053a. Two commits, not pushed.

- `46f8d77` feat(processing): switch Roof metrics to attributes on
- `885858d` fix(processing): the tool form's captions and controls share one column

## Implemented

**The flip.** `src/features/processing/toolRegistry.ts`: the `roof-metrics` entry
is `implemented: true`, and Task 8's "Task 13 flips this" comment is gone. Nothing
else in the registry changed.

**The scaffolding the flip replaces.**

- `tests/unit/ui/processing/lodSelect.test.tsx` and
  `tests/unit/ui/processing/RoofMetricsParams.test.tsx`: the
  `vi.mock(".../toolRegistry", …)` block that forced `implemented: true` is
  deleted, and NOTHING else in either file. Both suites pass unchanged against
  the real registry, which is the evidence the mock was standing in for exactly
  the flag and nothing more.
- `tests/unit/features/processing/eligibility.test.ts`: the "still reads 'Not
  available yet' until Task 13 switches it on" case is deleted, the `enabledRoof`
  local is gone, and the two cases that used it call `toolById("roof-metrics")`
  directly. Note the file's first two cases still pin the M1 ruling that
  `!implemented` outranks every other reason — they now use `measure-solids`,
  which stays unimplemented, so the ruling remains covered for the other five
  tools.
- `tests/unit/features/processing/roofMetricsParams.test.ts` (NOT in the brief's
  list, found by grep): its last case asserted `expect(roof.implemented).toBe(false)`
  under the title "is not switched on yet — Task 13 flips it". It is now "is
  switched on, and asks the form for a LoD" asserting `true`. This was part of
  the RED run.
- `tests/unit/ui/processing/CatalogueView.test.tsx`: only a comment
  ("Every tool but Height from extent is still unimplemented") was stale; it now
  names Roof metrics too. Its disabled-row case already used `join-by-location`,
  so no repoint was needed — the brief's conditional did not fire.

**Deliberately kept** (checked, not changed):

- `tests/unit/ui/processing/useToolForm.test.tsx`'s `measure-solids` registry
  mock. Task 12's comment on it says it stays "until a reader- or
  extension-needing tool ships" — Roof metrics needs neither, so it cannot
  discriminate that suite's `candidates`. Correct as written.
- `tests/unit/features/processing/runQueue.test.ts`'s
  `delete EXECUTORS["roof-metrics"]` in `beforeEach`. Verified that the
  no-executor error is the hardcoded string at `runQueue.ts:603`, independent of
  the `implemented` flag, so the "fails a tool with no executor rather than
  hanging" case is unaffected by the flip and the harness line still does what
  its comment says.
- `tests/unit/ui/processing/extensionChip.test.tsx`'s comment and
  `src/ui/processing/CatalogueView.tsx`'s comment: both are about the SPATIAL
  tools, all still `implemented: false`. Still accurate.
- `src/features/processing/tools/register.ts`'s header: it states the general
  rule ("A tool that is in the catalogue but not here is `implemented: false`"),
  which remains true. No edit.

**New test:** `tests/unit/ui/processing/roofMetricsEnabled.test.tsx`, written from
the brief verbatim. It is the only Roof metrics suite with NO registry mock: the
three `vi.mock` blocks are duckdb, runQueue and useLayerCounts (lodSelect's
`residentModel` mock is not needed — nothing here is streaming). Three cases:
the executor is registered, the catalogue row is enabled with no "Not available
yet", and the form opens with an enabled LoD select, the six ticked measures, the
six-column preview and a Run that submits `toolId: "roof-metrics"`, `lod: "2.2"`
and the normalised params.

**The CSS.** `src/ui/processing/processing.css`: `--processing-caption: 84px` is
declared once on `.processing-panel`, and both `.processing-field` (was 64px) and
`.processing-slider` (was 84px) take their first column from it. See the
alignment decision below.

## Tests and results

| run                                                                  | result                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| RED: `roofMetricsEnabled.test.tsx` + `roofMetricsParams.test.ts`     | 3 failed / 14 passed                                               |
| GREEN: `tests/unit/ui/processing` + `tests/unit/features/processing` | 22 files, 258 tests, all passed                                    |
| Full suite (background, `/tmp/…/scratchpad/full-suite-t13.log`)      | 243 files passed, 2 skipped; 2974 tests passed, 31 skipped, 63.6 s |
| `npx tsc -b --noEmit`                                                | clean, twice (before each commit)                                  |
| `npx vp check`                                                       | 0 errors, 56 warnings (baseline), twice                            |

## TDD evidence

RED, before touching `toolRegistry.ts` (new file + the `roofMetricsParams`
expectation flipped first):

```
× is switched on, and asks the form for a LoD        AssertionError: expected false to be true
× has an enabled catalogue row on a ready city layer roofMetricsEnabled.test.tsx:109 (aria-disabled "true")
× opens a form that can actually be run              getByRole combobox "LoD" — not found
✓ is registered as an executor
Test Files 2 failed (2) | Tests 3 failed | 14 passed (17)
```

Each failure is the intended one: the registry flag, the catalogue row's
`aria-disabled`/"Not available yet", and the LoD select that `ToolView` renders
only when `f.tool.implemented`. `EXECUTORS["roof-metrics"]` passed from the
start, exactly as the brief predicted (Task 9 registered it; `implemented` is a
registry flag, not a registration).

GREEN after the flip and the shim deletions: 258/258 in the two processing
directories, then the whole suite.

The CSS change has no RED test: jsdom computes no layout from a stylesheet, so a
grid column width is not assertable there. Its evidence is the browser
measurement below (before and after `getBoundingClientRect()` on the real page).

## Browser verification

Dev server `npm run dev -- --port 5191 --strictPort` (5173–5176 and 5199 were
taken; never a bare `vite`). Playwright Chromium 151 headless with swiftshader on
CDP 9333, `agent-browser connect 9333`. Screenshots in
`/tmp/claude-1020/-data2-hideba-multiroof-viewer/e57ba222-158b-4909-b356-6b4d18a2a687/scratchpad/smoke-t13/`.
Both the dev server and the Chromium were killed at the end (port 5191 free, no
chrome process left).

Layers were added through the Source URL field (`Detect` then `Add layer`) —
`http://localhost:5191/fixtures/two-buildings.city.json` is same-origin off the
dev server, so no file input or drag-drop was needed. No synthetic canvas clicks
were used; the selection step went through a table row.

| #   | step                        | observation                                                                                                                                                                                                                                                                                                                                                                           | shot                                                           |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | fixture loaded, table ready | "two-buildings.city.json · 2 buildings · LoD 2.2"                                                                                                                                                                                                                                                                                                                                     | `01-layer-loaded.png`, `02-app.png`                            |
| 2   | Tools catalogue             | **Roof metrics to attributes is ENABLED**: `aria-disabled="false"`, row text is name + description only, no "Not available yet". Every other row (Measure solids, Validate solids, Join, Aggregate, Distance) still carries it; Height from extent is enabled as before.                                                                                                              | `03-catalogue.png`                                             |
| 3   | form opens                  | TARGET (Layer, LoD, Scope), PARAMETERS, OUTPUT, Run — all present                                                                                                                                                                                                                                                                                                                     | `04-form.png`                                                  |
| 4   | LoD select                  | one option, **"2.2 (2 buildings with roof surfaces)"**, enabled, defaulted                                                                                                                                                                                                                                                                                                            | `04-form.png`                                                  |
| 5   | six checkboxes              | all six ticked. Hover titles: Flat roof area "Surfaces with a slope under the flat threshold", Flat share "0-1: the flat area over the total roof area", Mean slope "Area-weighted over every roof surface", Dominant azimuth "Of the largest non-flat surface". **Total roof area and Roof surface count carry NO title** — correct: §7.1 gives those two no parenthetical to carry. | `04-form.png`                                                  |
| 6   | threshold slider            | default 5, value "5°" beside it                                                                                                                                                                                                                                                                                                                                                       | `04-form.png`                                                  |
| 7   | alignment                   | see the decision below                                                                                                                                                                                                                                                                                                                                                                | `05-form-aligned.png`                                          |
| 8   | OUTPUT                      | "Write to · This layer (two-buildings.city.json)", Prefix `roof_`, "Columns:" then all six names (the line sits under the sticky run footer until the form is scrolled — pre-existing footer behaviour, not new)                                                                                                                                                                      | `06-columns.png`                                               |
| 9   | Run                         | card: **"✓ 2 buildings measured · 9.4 s / Wrote 6 columns to two-buildings.city.json."** with Open table, Style by result, Undo, Log, Run again                                                                                                                                                                                                                                       | `07-run-done.png`                                              |
| 10  | table                       | the six columns are present and BADGED, each header titled "Roof metrics to attributes · LoD 2.2 · All 2 buildings · 2026-09-12 03:50"                                                                                                                                                                                                                                                | `09-table-expanded.png`, `10-table-columns.png`                |
| 11  | Details / inspector         | feature inspector shows a **COMPUTED** group: roof_area_m2 20, roof_flat_m2 20, roof_flat_share 1, roof_slope_deg 0 …, each with the computed badge                                                                                                                                                                                                                                   | `12-inspector.png`                                             |
| 12  | Style by result             | switches Color by to Rules and opens a rule draft named `roof_area_m2` with the condition **`roof_area_m2 > 20`**                                                                                                                                                                                                                                                                     | `13-style-by-result.png`                                       |
| 13  | Undo                        | the six columns disappear from the table (only the three synthetic ones remain); the card reads "Undone" and loses its Undo button                                                                                                                                                                                                                                                    | `14-after-undo.png`                                            |
| 14  | dark theme                  | Preferences → Dark. Catalogue: the enabled Roof metrics row is bright, the disabled rows and their reasons are muted-but-legible, the 3D/Spatial chips stay readable. Form: captions muted, checkboxes, the slider track/lime thumb and the "5°" all read correctly; the done card keeps its green border.                                                                            | `18-dark-catalogue.png`, `17-dark-form.png`                    |
| 15  | narrow, ~1000px             | the form does NOT break: captions still aligned, the checkbox grid drops to one column, the column list wraps, nothing clips inside the panel. The APP SHELL overflows by 24px at this width (`document.body.scrollWidth` 1024 vs `innerWidth` 1000) — see concerns; it is pre-existing and unrelated.                                                                                | `19-narrow-dark.png`                                           |
| 16  | Delft sample                | `https://storage.googleapis.com/cityjson/delft.city.jsonl`, 1,115 buildings, LoD 2.2. LoD select offers **2.2 / 1.3 / 1.2, each "(1,115 buildings with roof surfaces)"**. Run: **"✓ 1,115 buildings measured · 9.2 s / Wrote 6 columns to delft.city.jsonl."** Real values in the table, e.g. 106.03 m² total, 42.53 flat, 0.40 share, 16.08°, 65.15°, 4 surfaces.                    | `23-delft-tools.png`, `24-delft-run.png`, `25-delft-table.png` |

### Two reading notes on the shots

- The run card grows the sticky footer, so after a run it covers the last
  checkbox and the "Columns:" line until the form is scrolled (`13-style-by-result.png`,
  `17-dark-form.png`). That is `RunFooter`'s existing design, not a regression
  and not touched here.
- The Preferences popover is still open in the top-right of `16-dark-form.png`
  and `17-dark-form.png` (it is how the theme was switched) — not a layout bug.

### The alignment decision (made in this task, one CSS file)

Measured, not eyeballed. BEFORE: every `.processing-field` control (Layer, LoD,
Scope, Write to, Prefix) started at x=1184; the slider's input started at x=1206
— a **22px drift** down one panel, because `.processing-field` was
`64px 1fr` and `.processing-slider` was `84px 1fr 28px`.

Shortening the caption is not free: "Flat threshold" measures **69.7px** at the
form's 12px, so it does not fit a 64px column, and §7.1 names the parameter.
DECISION: **widen the shared column to 84px**, and give both grids ONE source for
it — `--processing-caption: 84px` on `.processing-panel` — so the two cannot
drift apart again. Controls lose 20px of width inside the ~340px panel, which is
comfortable (the Layer select still shows the full file name).

AFTER: all five field controls at x=1204, the slider input at x=1206. The
remaining 2px is the UA's own `margin: 2px` on `input[type="range"]` (thumb
overhang), not app CSS — `flatControls.css` owns range styling for the whole app
and a local override there would put this one slider off the tokens, so it was
left alone. Re-measured identical at 1000px width (788 / 790).

## Files changed

- `src/features/processing/toolRegistry.ts` — `implemented: true`, comment removed
- `src/ui/processing/processing.css` — `--processing-caption` shared by the two grids
- `tests/unit/ui/processing/roofMetricsEnabled.test.tsx` — NEW
- `tests/unit/ui/processing/lodSelect.test.tsx` — registry shim deleted
- `tests/unit/ui/processing/RoofMetricsParams.test.tsx` — registry shim deleted
- `tests/unit/features/processing/eligibility.test.ts` — obsolete case and local removed
- `tests/unit/features/processing/roofMetricsParams.test.ts` — `implemented` expectation flipped
- `tests/unit/ui/processing/CatalogueView.test.tsx` — stale comment only

## Self-review

- Both shim-less suites pass with no other edit, which is the check the brief
  asked for: the flip delivered exactly what the mocks were standing in for.
- The new suite is the only one that sees the real registry, and it imports
  `tools/register` for its side effect so `EXECUTORS` is populated the way a real
  session populates it.
- Every `vi.mock` of `insights/duckdb` in the new file exports the full surface
  the module graph imports (copied from `lodSelect.test.tsx`, which is exercised
  by the same `ToolView` import); tests import from `"vitest"`;
  `noUncheckedIndexedAccess` is satisfied by the brief's `!`s on
  `mock.calls[0]![0]!`.
- The M1 ruling that `!implemented` outranks eligibility reasons is still pinned
  by `eligibility.test.ts`'s `measure-solids` cases and by `lodSelect`'s "does not
  offer a LoD … for an UNIMPLEMENTED tool".
- The brief's `afterEach` calls `useShellStore.getState().requestSection(null)`,
  but the catalogue row click mutates `rightCollapsed`, not the requested section.
  Harmless (the default is not-collapsed and each test renders fresh), so it was
  left as the brief wrote it rather than "fixed".
- The CSS commit is separate from the flip, with the measurement in its message.

## Concerns for the controller

1. **Style by result's median is over ROWS, not features.** On the fixture the
   three table rows hold `roof_area_m2` 20 (parent), 20 (its part) and 180, so the
   draft rule is `roof_area_m2 > 20`; the median over the two FEATURES would be 100. Spec §7.1 just says "rule on `roof_area_m2 >` median". The median query
   evidently has no `id = feature_id` filter, so part rows are counted. Task 10
   owns that code; flagging it because a parts-heavy layer will bias the draft threshold
   towards the small members. Not touched here.
2. **The drawer's synthetic "Roof area" and the computed `roof_area_m2` disagree
   where a feature has both its own roof geometry and a part.** Fixture building
   `NL.IMBAG.Pand.0001`: the inspector Summary says Roof area 112.0 m² / mean
   slope 30.0°, the computed columns say 20 m² / 0°. This is CORRECT per spec
   §7's contributor rule (when parts have geometry, the parts are the contributors
   and the root's own geometry is ignored) and per §7.1's "the drawer's three
   synthetic columns stay as they are" — but a user now sees the two numbers side
   by side in one panel with no explanation. Worth a line in the docs or a
   tooltip, and worth knowing before someone files it as a bug.
3. **The app shell overflows horizontally below ~1024px** (`body.scrollWidth`
   1024 at `innerWidth` 1000), clipping the right edge of the right panel. It
   persists with the right panel collapsed, so it is a shell minimum unrelated to
   the processing form or to this task's CSS. Pre-existing; recorded, not fixed.
4. **Driving note for Task 15's smoke file**: the Add-layer dialog has TWO
   `.fcb-url-btn` buttons (Detect and Add layer), so `querySelector('.fcb-url-btn')`
   silently hits the disabled Detect one. Use `.fcb-url-btn:not([disabled])` or
   match on text. Cost several minutes here.
