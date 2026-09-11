# Task 12 — Computed badges in the table and Details, and the COMPUTED groups (spec §8)

Commit: `e3cf64f` — `feat(processing): computed badges and COMPUTED groups in table, Details and rules` (18 files, on `develop`, not pushed).

## What was built

**`src/insights/computedColumns.ts` — `formatProvenance(p)`**
`"<tool> · <summary> · YYYY-MM-DD HH:mm"` from LOCAL clock parts (never `toISOString`: the run happened on the user's clock). Empty parts drop out. When `p.partial` is set it appends `" · 312 of 1,204 buildings in this run; the rest from <previous tool> · 13:40"` — the earlier run's time only when it was the SAME local day, the full stamp otherwise. A partial run whose `previous` is `null` (a layer's first partial run, which is what `runQueue.ts:421` writes) says only `"312 of 1,204 buildings in this run"`: there is no earlier tool to name. Counts use a pinned `en-US` formatter declared locally — `insights` does not import from `ui/table`.

**`ComputedAttributeBadge`** — optional `title`, defaulting to the existing generic sentence (still what the drawer's three synthetic `__roofy_*` columns get, since no run produced them). The CSS hover bubble now renders the SAME string as the native `title`, or a hover showed two different sentences at once; `flatControls.css` lets it wrap inside `max-width: 280px` because a provenance line is far longer than the old sentence.

**`DataGrid` / `ColumnsPanel`** — new optional `layerId`; each subscribes `useComputedColumnStore((s) => s.byLayer[layerId])` (the store's own object — `computedColumnsOf` builds a fresh Set per call and cannot be a selector snapshot). The derived-column branch and the provenance branch are exclusive, so no header or picker row can carry two badges. `TablePanel` passes `layerId` at both call sites.

**Default visibility (the Task 11 finding)** — `defaultColumns(columns, view, computed)` appends the layer's registered computed columns after the file's columns and the derived keys in the buildings view (raw already lists every column). A computed column that collides with one of the six base names is listed once, at the end. `TablePanel` derives the name Set under `useMemo` from the same subscription.

**`LayerAttributesSection`** — partitions the subject's attributes by registry membership (never by the key's shape: a file may carry its own `extent_height_m`). The file's attributes go to `AttributesSection` as before — so reorder and the search box keep operating on the file's keys only — and the computed ones render through a new optional `trailing` slot as `role="group" aria-label="Computed attributes"` with the `Computed` sub-heading and one `AttrRow` per column carrying the badge and the provenance tooltip. `AttrRow` gained an optional `badge` slot rather than a second copy of the `.attr-row` markup. `AttributesSection`'s "No attributes" placeholder is suppressed when the trailing group is non-empty — that sentence is about the FILE's attributes, and a run's results are attributes too.

**`RulesEditor`** — the ordered field list is split into the file's fields and the ones in the registry for this layer; the latter render in an `<optgroup label="Computed">` after the plain options (`RuleForm` gained `computedFields`). The model already carries the values through `mergeAttributes`, so only the grouping is new.

## Tests

`npx vitest run tests/unit/ui/table tests/unit/ui/details tests/unit/ui/layers tests/unit/ui/drawer tests/unit/insights/computedColumns.test.ts tests/unit/ui/processing tests/unit/features/processing` → 50 files, 528 passed. Full suite (background): 230 files, 2765 passed, 20 skipped. `npx tsc -b --noEmit` clean.

New, each written red first:

- `computedColumns.test.ts` — four `formatProvenance` cases (plain, partial with a same-day previous, partial across a day boundary, partial with no previous). Timestamps are built from local parts so the assertions are timezone-stable.
- `DataGrid.test.tsx` — the badge appears in the computed header with `title === formatProvenance(p)`, and a column registered for ANOTHER layer stays unbadged.
- `ColumnsPanel.test.tsx` — the chooser row carries the provenance badge.
- `LayerAttributesSection.test.tsx` (new file) — the computed key sits in the group and `function` does not; no group when nothing is computed; the group survives a subject whose file attributes are empty.
- `columnPolicy.test.ts` — a registered computed column is in the buildings default set, after `id`, and is never listed twice.
- `RulesEditor.test.tsx` — the `Computed` optgroup holds exactly the registered column, the plain options keep the file's fields, and no optgroup exists when nothing was computed.

Every touched test file now clears `useComputedColumnStore` in `afterEach`, so seeded provenance cannot leak into the existing option-order and column assertions.

## Browser check (dev server on 5173, viewport emulated at 1440x900)

Delft sample → Tools → Height from extent → Run ("1,115 buildings measured · 0.4 s · Wrote 3 columns") → Open table:

- Headers: `extent_height_m`, `extent_zmin_m`, `extent_zmax_m` are present WITHOUT touching the column chooser (the default-visibility fix), each badged, each `title` = `"Height from extent · All 1,115 buildings · 2026-09-11 11:38"`. The three synthetic columns keep the generic sentence.
- Columns chooser: the same six rows, synthetic vs computed tooltips as above.
- Details (row click → Details tab): a `Computed` group with the three columns, values, and the provenance tooltip on each badge.
- Style → Color by: Rules → + Add rule: the attribute select has `optgroup label="Computed"` holding exactly the three columns; the 55 plain options are unchanged.

One follow-up came out of the browser check and is in the commit: `workspace.css` neutralises `.details-section-title` inside `.viewer-shell` (sans, sentence case, `margin: 0`), so the spec's "mono sub-heading" is not what this shell renders — the heading matches its peers ("Attributes", "Summary") and reads `Computed`, and the divider's spacing needed a selector specific enough to beat that margin reset.

## Concerns

- **A user-customised column list does not gain later computed columns.** The fix is on the DEFAULT path only: once `query.columns` is set, a new run's columns land in the chooser's "Available" list. Re-appending them there would make the chooser unable to hide them, and there is no "explicitly hidden" list to consult. Worth a hidden-set model if it bites.
- The header's CSS hover bubble is `position: absolute` inside the sticky `<th>`; the native `title` is the reliable carrier of the long provenance line, which is what the tests assert.
- Details shows a computed DOUBLE at full precision (`2.7507561664581317`) because `formatValue` does not round; the table rounds to two places. Pre-existing `formatValue` behaviour for any float attribute, not changed here.
- `export` (spec §8's "Export: computed columns are included") was left alone — out of this task's file list.
- **Streaming layers diverge across the three surfaces.** `runQueue.ts` builds its `mergeAttributes` map from `layer.model.objects`, which is empty for an FCB layer, while the provenance loop still registers the columns. After a run on a streaming layer the table badges the column (DuckDB has it) but Details shows no Computed group and the rule editor no optgroup, because both read the resident model. Filtering the optgroup from the collected fields is deliberate — offering a field `evaluateRule` cannot resolve would be a lie — but the table/Details mismatch is real and belongs to the streaming path, not here (spec §8 already treats a streaming layer's computed columns as disposable).
- **Deliberate deviation from the brief's literal markup:** the sub-heading renders `Computed`, not `COMPUTED`. `workspace.css` sets `text-transform: none` on `.details-section-title` inside `.viewer-shell`, so an uppercase literal would be the only shouting heading in a panel whose peers read "Attributes" and "Summary".

## Fix round 1 (2026-09-11)

Three commits on `develop`, not pushed: `c94022f`, `391119b`, `73eb8d6`.

### 1. A customised column list never gained later computed columns (Important)

`src/ui/drawer/columnPolicy.ts:53` — new `appendColumns(current, names)`: `null`
(the default list) is returned unchanged, the SAME array is returned by
reference when the run added nothing, and a name repeated inside `names` lands
once. The identity return is load-bearing: it is what lets the caller skip a
`setColumns` that would otherwise reset `page` under a user who changed
nothing.

`src/ui/processing/RunFooter.tsx:19-20,121-131` — the result card's **Open
table** now reads `layerQuery(useQueryStore.getState(), run.targetLayerId)
.columns`, appends `run.columns` through the helper and calls `setColumns` only
when the array actually changed. `run.columns` is `ReadonlyArray<string>`
(`src/features/processing/types.ts:100`), so the brief's `.map(c => c.name)`
does not apply. `TablePanel`'s default path is untouched; `orderedColumns`
already drops a name the view does not carry, so an appended name that DuckDB
has not surfaced yet is skipped rather than throwing.

Covering tests — `tests/unit/ui/drawer/columnPolicy.test.ts`: "appends the
names the list does not already carry, in order", "returns the very same list
when every name is already there" (`toBe`, not `toEqual`), "adds a repeated
name once", "leaves the default list alone". `tests/unit/ui/processing/
ToolView.test.tsx`: "appends the run's columns to a customised table list,
once" (clicks Open table twice on a list seeded as `["id"]`) and "leaves a
default table list on the default path".

- RED: `npx vitest run tests/unit/ui/drawer/columnPolicy.test.ts` →
  `TypeError: appendColumns is not a function`, 4 failed | 3 passed.
  `npx vitest run tests/unit/ui/processing/ToolView.test.tsx` →
  `AssertionError: expected [ 'id' ] to deeply equal [ 'id', 'extent_height_m', …(2) ]`,
  1 failed | 18 passed.
- GREEN: both files, 26 passed.

### 2. "Computed" had to read "COMPUTED" (Important)

`src/ui/details/LayerAttributesSection.tsx:66` and `src/ui/layers/
RulesEditor.tsx:730` now carry the spec's literal. `src/app/app.css:6268-6286`
gives `.details-computed-title` the toolbox's own mono label values
(`font: 500 11px/1.4 var(--font-mono); letter-spacing: 0.08em;
text-transform: uppercase; color: var(--fg-muted)`), keeping the existing
spacing/divider; the second selector carries both classes, so at (0,3,0) it
beats `workspace.css:36`'s `.viewer-shell :is(.details-section-title, …)`
(0,2,0), which otherwise forces the UI font, weight 600, `letter-spacing:
normal` and `text-transform: none`. `role="group" aria-label="Computed
attributes"` is unchanged, as ruled.

Covering tests — `LayerAttributesSection.test.tsx`: "lists a computed column
under COMPUTED …" now asserts `getByText("COMPUTED")` and that the heading
carries `details-computed-title`; "shows no COMPUTED heading …" queries the
literal. `RulesEditor.test.tsx`: both computed-attribute tests.

- **jsdom finding worth keeping:** a CSS attribute selector cannot make this
  assertion. `select.querySelector('optgroup[label="COMPUTED"]')` MATCHES a
  `label="Computed"` — nwsapi compares attribute values ASCII
  case-insensitively in an HTML document (verified with a throwaway probe:
  `upper: true, other: false`). The two tests therefore read
  `getAttribute("label")` off the element and compare exactly; the negative
  test asserts no optgroup exists at all.
- RED: `npx vitest run tests/unit/ui/details/LayerAttributesSection.test.tsx
tests/unit/ui/layers/RulesEditor.test.tsx` → `Unable to find an element with
the text: COMPUTED`; then, after the selector was made case-sensitive,
  `AssertionError: expected [ 'Computed' ] to deeply equal [ 'COMPUTED' ]`.
- GREEN: `npx vitest run tests/unit/ui/details tests/unit/ui/layers` → 22
  files, 247 passed.
- The mono/uppercase RENDERING is asserted by class only; jsdom applies no
  stylesheet. The literal text is asserted directly.

### 3. The collision test now runs in buildings mode (Minor)

`tests/unit/ui/drawer/columnPolicy.test.ts` — "lists a computed column that
collides with a base name once, and last": `measuredHeight` registered as
computed, `view === "buildings"`, asserted to appear exactly once and to be the
last column.

- RED was not free (the guard already existed), so it was obtained honestly by
  deleting `&& !computed.has(column.name)` from `defaultColumns`, running, and
  restoring: `AssertionError: expected [ 'measuredHeight', 'measuredHeight' ]
to have a length of 1 but got 2`, 1 failed | 7 passed. The break was never
  staged; `git diff src/ui/drawer/columnPolicy.ts` was empty after the restore.
- GREEN: 8 passed.

### Verification

`npx vitest run tests/unit/ui/table tests/unit/ui/details tests/unit/ui/layers
tests/unit/ui/drawer tests/unit/ui/processing` → **44 files, 472 passed, 0
failed**. `npx tsc -b --noEmit` → clean (exit 0). The pre-commit hook (`vp
staged`) ran on all three commits; no bypass.

### Concerns

- No browser check this round: the changes are a store write, two string
  literals and one CSS rule, all covered by tests. The COMPUTED heading's mono
  rule is unverified visually — worth a glance at the Details panel on the next
  browser pass. Note that `--font-mono` resolves to `var(--font-ui)` in
  `brand.css:54`, so "mono" here means the label TREATMENT (uppercase,
  tracking, muted), not a different family; that is the brand's decision, not
  this fix's.
- The append runs on Open table only. A user who hides one of the run's columns
  and clicks Open table again gets it back — deliberate, per the ruling (no
  continuously enforced visibility set, and no "explicitly hidden" list exists
  to consult).
- Streaming (FCB) layers' Details/rules entries stay as reported: parked by the
  controller, untouched.
- Trailer conflict: the harness reminder asks for a `Claude-Session:` line on
  commits, the task forbids trailers of any kind. The task won; the three
  commits carry no trailers.
