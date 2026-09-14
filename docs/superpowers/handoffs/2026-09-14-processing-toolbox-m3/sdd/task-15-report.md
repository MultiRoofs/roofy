# Task 15 — The cross-layer form — report

**Status:** DONE. Three commits on `develop`, base `8243f7b`, nothing pushed, no trailers, hooks not bypassed.

- `d196106` `feat: the cross-layer parameters, their columns and their validation`
- `5f07991` `feat: the cross-layer form's SOURCE select and PARAMETERS sections`
- `f256428` `test: a point-layer TARGET is refused with §7.6's own two sentences`

Nothing staged from `.github/hooks/`, `docs/design-history/` or `.superpowers/`; the plan is untouched.

## Implemented

### `src/features/processing/crossLayerParams.ts` (new, pure, engine-free)

`JoinPredicate` / `JoinTie` / `JoinParams` (with `fieldTypes`) / `DistanceParams` / `AggregateOp` /
`AggregateRow` / `AggregateParams`; `joinParams`, `distanceParams`, `aggregateParams`;
`joinColumns(prefix, params)` (TWO arguments), `distanceColumns`, `aggregateColumns`;
`slugifyField`; `SOURCE_NEEDS_AREAS`, `TARGET_NEEDS_AREAS`, `POLYGONAL_KINDS`;
`numericColumnsOf(table)`; `CrossLayerContext`; `resolveCrossLayerParams(toolId, raw, ctx)`;
`crossLayerParamsError(toolId, raw, ctx)`; **`aggregateRowErrors(params)` (added — see
deviations)**. Type-only imports of `ColumnType`/`OutputColumn` (`computedColumns` imports
`duckdb`, so the import is erased) and of `LayerTable`.

### `src/ui/processing/CrossLayerParams.tsx` (new)

`{ toolId, params, onChange, proxies, sourcePropertyKeys, sourcePropertyTypes,
sourceHasFeatureIds, numericColumns }` — no store, no engine. Building-geometry radio group
(disabled options + the muted line), then exactly one tool's section:

- Join: predicate select, field checklist with the type beside each name and a search box past
  12, tie select with `largest overlap` disabled and titled on a centre proxy, match-count
  checkbox disabled under `count only`.
- Distance: `Max search distance (m)` number field, `Also write the nearest feature's id`
  checkbox, and the property select (with `The feature's id`, or `Choose the property to copy`
  when the source has no feature id).
- Aggregate: one row per aggregate (op select, column select except for `count`, remove
  button), `+ Add aggregate`, and **per-row validation** (residual B11).

### Modified

- `toolRegistry.ts`: imports the module **including `type CrossLayerContext`** (residual B4),
  declares `BAG_ONLY`, and gives the three cross-layer entries `outputColumns`,
  `validateParams` and `normaliseParams`. `implemented` stays `false` on all three.
- `runQueue.ts`: the source phase's `tool.id === "join-by-location"` literal becomes
  `SOURCE_NEEDS_AREAS.has(tool.id)`.
- `processingStore.ts`: `ToolDraft` gains `sourceLayerId: string | null`.
- `RecentRuns.tsx`: "Edit & run" carries `run.sourceLayerId`.
- `useToolForm.ts`: two-layer form — `vectorCandidates`, `eligibleVectorTargets`,
  `targetOptions`/`sourceOptions` (`LayerOption` rows with reasons), `sourceLayerId` with the
  B6 disabled fallback, the source's records/types/keys/feature-ids, `cityLayer`/`cityTable`,
  `proxies`, `numericColumns`, the derived source prefix, `params` (resolved),
  `targetName`, `targetReason`, `sourceReason`, the widened `workloadNote`, and a `setDraft`
  that drops the params on a retarget OR a source change.
- `ToolView.tsx`: the TARGET select reads `f.targetOptions` (disabled + title), a `Source`
  select for `tool.sourceKind !== null`, A12's muted line under the scope radios for a vector
  target, the `cross-layer` PARAMETERS branch, `This layer (targetName)`, and `run()` submitting
  `sourceLayerId` plus `normaliseParams(f.params)`.
- `processing.css`: number/search inputs in `.processing-field`, `.processing-check`,
  `.processing-aggregate*`, `.processing-add`.

## Tested + results

New: `tests/unit/features/processing/crossLayerParams.test.ts` (39 cases),
`tests/unit/ui/processing/CrossLayerParams.test.tsx` (24 cases),
`tests/unit/ui/processing/useToolForm.test.tsx` (+11 cases → 19).

### TDD evidence

**RED 1 — the pure module**

```
$ npx vitest run tests/unit/features/processing/crossLayerParams.test.ts
Failed to resolve import ".../src/features/processing/crossLayerParams" …
 Test Files  1 failed (1) | Tests  no tests
```

**GREEN 1**

```
$ npx vitest run tests/unit/features/processing/crossLayerParams.test.ts
 Test Files  1 passed (1) | Tests  39 passed (39)
```

**RED 2 — the component**

```
$ npx vitest run tests/unit/ui/processing/CrossLayerParams.test.tsx
Failed to resolve import ".../src/ui/processing/CrossLayerParams" …
 Test Files  1 failed (1) | Tests  no tests
```

**GREEN 2** — `Test Files 1 passed (1) | Tests 24 passed (24)` (one intermediate red for a
missing `cleanup()` in `afterEach`: "multiple elements found", fixed in the test).

**The hook suite.** Its eleven cases were appended after the hook was written (the brief's own step
order: hook at step 9, tests at step 11), so they went green on the first run. Rather than claim
a red I did not see, I **falsified each load-bearing behaviour** and watched the tests fail:

```
# removed the B6 disabled fallback and the workloadNote proxy widening
     × warns about a large source only when the PROXY will re-read it
     × keeps a disabled source chosen, so its reason is what Run repeats
     × never exposes Run for Distance with no usable source (§7.7)
      Tests  3 failed | 15 passed (18)

# counts = useLayerCounts(targetLayerId) instead of the city layer
     × counts the SOURCE city layer's buildings for Aggregate (§7.6)
      Tests  1 failed | 17 passed (18)
```

```
# targetReason nulled and the disabled TARGET row forced off
     × refuses a point-layer TARGET for Aggregate with §7.6's own sentences
      Tests  1 failed | 18 passed (19)
```

Every mutation was reverted; the files on disk are the passing ones.

### Gates

```
$ npx tsc -b --noEmit                                → 0
$ npx vp check                                       → Found 0 errors and 56 warnings in 562 files
$ npx vitest run > /tmp/m3-task15-suite.log 2>&1 & wait $!   → suite: 0
  Test Files  261 passed | 4 skipped (265)
  Tests  3368 passed | 78 skipped | 1 todo (3447)
```

### Browser check (CLAUDE.md's UI rule) — done

Dev server via `npm run dev`, headless Chromium on 9333, `agent-browser connect 9333`; stores
seeded by importing the Vite-served modules from the page (`await import('/src/…')`), a city
layer with a ready table (reader + LoD 0 rung + 180 MB source) and a GeoJSON polygon layer with
four properties. Verified against `RoofMetricsParams`' peers in the same panel:

- **Join**: the three proxies with the footprint checked, `Predicate` (intersects / within /
  centre within), the typed field checklist, the tie select, `Also write the match count`,
  `Columns: zones_zone_name, zones_noise, zones_flood, zones_district`, prefix prefilled
  `zones_`. 30 px compact fields, 8 px radii, captions in the same column as Scope.
- **Aggregate**: `Scope applies to the source layer's buildings.` under the radios, the TARGET
  select on Zones and the SOURCE select on Delft, two `sum roof_area_m2` rows and the accent
  sentence `'sum_roof_area_m2' resolves to the same column` rendered **under the second row**.
- **Distance**: `Max search distance (m)` = 500, the checkbox, `The feature's id` select,
  `Columns: zones_distance_m, zones_nearest_id`.
- **No LoD 0**: the footprint radio disabled, the proxy falls back to `Extent centre`, and
  `LoD 0 footprints are not in this layer; the bounding-box centre is used.` renders under the
  group.

(The 3D viewport reports "The 3D engine failed to start" on this headless host — WebGL, not
this task. Nothing under test touches it.)

## Files changed

- `src/features/processing/crossLayerParams.ts` (new, 470 lines)
- `src/ui/processing/CrossLayerParams.tsx` (new, 430 lines)
- `src/features/processing/toolRegistry.ts`, `runQueue.ts`, `processingStore.ts`
- `src/ui/processing/useToolForm.ts`, `ToolView.tsx`, `RecentRuns.tsx`, `processing.css`
- `tests/unit/features/processing/crossLayerParams.test.ts` (new)
- `tests/unit/ui/processing/CrossLayerParams.test.tsx` (new)
- `tests/unit/ui/processing/useToolForm.test.tsx`, `ToolView.test.tsx`, `lodSelect.test.tsx`,
  `RecentRuns.test.tsx`, `tests/unit/features/processing/processingStore.test.ts`
  (the `ToolDraft.sourceLayerId` sweep — 8 hand-built literals plus 2 `submitRun` expectations)

## Deviations from the brief (each named; the controller's requirements won where they clashed)

1. **The brief's step 9 "replace the hook's body from the imports down" was NOT taken
   literally.** Its replacement silently dropped two shipped behaviours: the exported
   `toolWorkloadNote(tool, table)` (which `useToolForm.test.tsx` drives directly, four cases)
   and the `eligibility.ok ? lodAnswer : NO_LOD` gate (§6's "a refused tool states nothing about
   the layer's geometry"). Both are kept; the hook was edited surgically instead.
2. **`workloadNote` keeps its `tool.implemented` guard** and widens only the `needsReader`
   conjunct: `toolWorkloadNote(tool, table, params)` returns null unless
   `tool.implemented && (tool.needsReader || params.proxy === "footprint")`. Requirement 6 names
   only the `needsReader` widening; requirement 8 keeps the three tools `implemented: false`; and
   §6's rule ("a tool whose executor has not shipped claims no fact about the user's data") is
   an existing, tested Task 5 decision. The brief's render test for the note is therefore run
   through a registry mock that flips the three cross-layer tools on (below).
3. **`useToolForm.test.tsx` has no `toolRegistry` mock to extend** — the brief says "its
   `toolRegistry` mock already flips one tool on", but the file's own doc comment records that
   it _used to_ and no longer does. One was added: a partial `vi.mock` with `importActual`, a
   patched `TOOLS` and a re-implemented `toolById` (the real one closes over the module array).
   Without it `toolEligibility` answers "Not available yet" for all three tools, which sits above
   every other reason — Run would never enable, `submitRun` would never be called, and the
   source/proxy/frozen-request cases would assert nothing.
4. **`aggregateRowErrors(params)` is a new export** (residual B11). It is the ONE producer of
   Aggregate's sentences: `crossLayerParamsError` returns the first non-null entry in ROW order,
   so the message Run is blocked with is literally the one rendered beside the offending row.
   Consequence: for `[sum(x), sum(x), sum(null)]` the duplicate on row 2 is reported rather than
   the incomplete row 3 — the brief checked every incomplete row before any duplicate. Every
   case the brief pins is unchanged.
5. **`CrossLayerParams` renders §6's inline validation itself**, and `ToolView`'s cross-layer
   fieldset renders no `paramsError` paragraph. B11 requires the row-shaped sentences to sit
   beside their rows; leaving the section paragraph in place would print the same sentence twice,
   which the codebase already refuses to do (`ToolView`'s `footerReason`). The component builds
   its context with `table: null` — `crossLayerParamsError` never reads `ctx.table`, so its
   answer and the hook's are the same answer by construction.
6. **`types.ts` and `vectorSource.ts` were not touched.** The brief's step 5 adds
   `documentHasFeatureIds`/`documentHasFeatures` (Task 12 already shipped them) and its step 5
   asks `outputColumns` to "gain its optional third argument" while its own prose and
   Decisions 6 (iii) say it stays two-argument. It already is.
7. **Predicate and tie labels use the spec's own lower-case spelling** (`intersects`, `within`,
   `centre within`; `first (by source order)`, `largest overlap`, `count only`) rather than the
   brief's title case, per requirement 7 ("copy verbatim from the spec"). The disabled reason is
   §6's `Largest overlap needs a footprint or rectangle`, unchanged.
8. **The component test harness is stateful.** The brief's Distance case does
   `clear` + `type "250"` on a controlled number input whose `params` prop never moves — React
   would restore `500` after the clear and the typed value would be `500250`. The harness holds
   the bag in `useState` and forwards `onChange`, which is what `ToolView` does through the draft
   store.
9. **Three commits**: the pure module + registry + queue literal, then the form and the hook,
   then a `test:` commit closing the copy table's TARGET-side gap (`The layer has no areas` and a
   disabled `Needs areas (polygons)` TARGET row), which the first two had left untested.
10. **The footprint muted line renders under the radio group, not inside `.processing-field`.**
    The grid is two columns (caption | control); a third child would land in the caption column.
    Verified in the browser.
11. `RecentRuns.test.tsx`'s `toEqual` on the restored draft gained `sourceLayerId: null` — a
    required field on `ToolDraft` now.

## How each controller requirement was met

1. **B4.** `toolRegistry.ts` imports `type CrossLayerContext` (tsc clean proves it); the
   `joinParams` equality case asserts `fieldTypes: {}`; the hook narrows before reading
   `preparedData` — `vectorTarget`/`sourceGeo` are `GeoJsonLayer | null` locals and every
   `config.preparedData` read goes through one of them (or through a captured
   `targetDocument`/`sourceDocument`), never through a re-indexed `layers[0]`.
2. **B6.** `sourceLayerId = storedValid ?? firstEnabled ?? sourceOptions[0]?.id ?? null`, so an
   all-disabled list keeps a chosen row and `sourceReason` renders; `canRun` adds
   `tool.sourceKind === null || sourceLayerId !== null`. Two tests: Join shows
   `The source layer has no features` with Run disabled (not a parameter error), and Distance —
   whose parameters are valid on their own — never exposes Run. Falsified by removing the
   fallback.
3. **B11.** `aggregateRowErrors` drives both the blocking error and the row-anchored rendering;
   each offending row's `<p className="processing-error" role="alert">` carries an `id` and both
   of that row's selects carry `aria-describedby`. Tests assert the ASSOCIATION (`describedBy`
   helper), not the presence of the text — the placeholder option carries the same A17 sentence,
   so a `getByText` would have passed over a sentence attached to nothing. A duplicate is flagged
   on the SECOND row with §6's `resolves to the same column`; an incomplete row blocks Run with
   A17 and its select's placeholder is that same sentence.
4. **Decision 6 (iii).** `outputColumns` is two-argument everywhere;
   `resolveCrossLayerParams` embeds only the chosen fields' types as `fieldTypes` (bag entry wins
   when the context has none); the three `BAG_ONLY` regression cases pass, plus the
   plain idempotence case and the browser-verified `params: { proxy: "footprint",
fields: ["zone"], fieldTypes: { zone: "VARCHAR" } }` on the frozen request.
5. **Readiness order.** `vectorSourceReason` asks preparation (A4's two sentences) → emptiness
   (`The source layer has no features`) → geometry kind (`Needs areas (polygons)`), and is the
   only producer of each; `runReason` repeats the chosen row's reason. Aggregate's TARGET is the
   vector layer with `The layer has no areas`, its scope radios stay under TARGET with A12, and
   `resolveCrossLayerParams` keeps an explicitly chosen proxy when `ctx.table` is null (round-1
   B1, pinned).
6. **`workloadNote`.** `tool.needsReader || params.proxy === "footprint"` (plus the kept
   `implemented` guard — deviation 2); `footprintAvailable(table)` decides the offer through
   `proxyOptions`/`defaultProxy` (Task 14's own predicate, untouched), and the muted line is
   Task 14's `ProxyOption.note`.
7. **Copy.** `Footprint (LoD 0)` / `Extent rectangle` / `Extent centre` and the muted line come
   from Task 14's `proxyOptions`, not from a second literal here. In this task's own files:
   `Largest overlap needs a footprint or rectangle`, `Also write the match count`,
   `Max search distance (m)`, `Also write the nearest feature's id`,
   `Choose the property to copy`, `+ Add aggregate`, `Pick at least one measure` (Join's
   nothing-to-copy AND Aggregate's empty list), `'<name>' resolves to the same column`,
   `A distance limit must be a positive number` (A11), `Choose a column to summarise` (A17),
   `Scope applies to the source layer's buildings.` (A12), `Needs areas (polygons)`,
   `The source layer has no features`, `The layer has no areas`,
   `This vector layer is still loading` / `could not be loaded` (A4). The predicates and ties are
   the spec's own words (deviation 7). One affordance label is not in the spec: the nearest-id
   select's `The feature's id` option, which §7.7 describes ("defaults to the GeoJSON feature
   `id`") without wording; the brief proposed it and it is kept.
8. **Tools stay `implemented: false`** (registry unchanged on that field; only the test mock
   flips them). Each section renders only under its own `toolId`, asserted. No
   `vi.mock(".../insights/duckdb")` factory needed a new export — this task adds none;
   `CrossLayerParams` reaches no engine module at runtime and needs no duckdb mock, and
   `useToolForm.test.tsx`'s existing factory already covers the hook's new imports (`geoRecords`,
   `vectorSource`, `crossLayerParams`, `buildingProxy` are all engine-free). Tokens come from
   `flatControls.css` via the existing `.processing-*` classes.

## Self-review / concerns

- **The `implemented` guard on the workload note is the one place I chose the shipped rule over
  the brief's literal code.** If the intent really was to show the note before the executor
  ships, the fix is one clause in `toolWorkloadNote` plus deleting an existing test; flagging it
  rather than deciding silently.
- **The registry mock in `useToolForm.test.tsx` is scoped to this file** and patches only the
  three cross-layer ids, so the four pure `toolWorkloadNote` cases (measure-solids,
  height-from-extent) still run against the real definitions.
- **`existingNames` for a vector target is `Object.keys` of every `geoRecord`.** That is the
  public property set the spec's "belongs to the source data" rule is about, and it is memoised
  on the document identity — but it is O(features) per document change. For a large GeoJSON it
  is one pass on a prepared document that already lives in memory; Task 18/20 should watch it if
  the vector path grows.
- **Aggregate's row list has no caption**, so it starts at the panel's left edge rather than in
  the control column. That matches `RoofMetricsParams`' uncaptioned `processing-checks` grid, and
  inventing a caption string ("Aggregates") is exactly what requirement 7 forbids — but a
  reviewer may prefer the alignment. One `<span>` if so.
- **`sectionError` is decided structurally** (`aggregate-per-area` with at least one row keeps
  the sentence beside the row) rather than by matching the sentence text, so the component does
  not depend on a string it does not own.
- **`crossLayerParamsError` is called twice per render** for a cross-layer tool (once in the hook
  for Run, once in the component for the inline sentence). It is pure and cheap; the alternative
  is passing the hook's answer down, which would let the component render a sentence about a
  context it does not have.
- **Aggregate's `useLayerCounts` is asserted by spy**, because the mocked hook returns the same
  counts for every layer — the assertion is on which layer id the form asked about.
- Tasks 16/17/19 flip `implemented` and will want the registry mock in `useToolForm.test.tsx`
  narrowed or removed as each ships.

---

## Fix round 1

Rebased onto `develop` HEAD `b208f1b` (Task 16 landed after Task 15, flipped `join-by-location`
to `implemented: true` and narrowed my registry mock to the two tools that are still
unimplemented). Five commits, no trailers, hooks not bypassed, nothing pushed:

- `ad90ad8` `fix: only a cross-layer retarget drops the tool's parameters`
- `bbacc80` `fix: an unimplemented cross-layer tool promises no columns and no geometry verdict`
- `496bf6c` `fix: Aggregate opens on a vector layer that has areas`
- `278b343` `fix: 'centre within' forces the centre proxy in the form and the frozen bag`
- `98f1388` `fix: a copied-field collision is flagged on the second field it belongs to`

### 1. Important — a retarget erased single-layer parameters

`setDraft`'s `params: {}` reset is now `crossLayer && (retarget || resource)`. A one-layer tool's
parameters name neither layer — Roof metrics' measures and threshold and Measure solids' measures
are a statement about what the user wants WRITTEN — so they survive a layer change exactly as they
did before Task 15. The LoD is still dropped, which was the pre-Task-15 behaviour.

Three cases in `useToolForm.test.tsx` (`what a retarget keeps`): Roof metrics keeps
`{ measures: ["roofArea"], flatThresholdDeg: 12 }` and loses its LoD; Measure solids keeps
`{ measures: ["volume"] }`; and a Join bag is still emptied, because it names the source's own
fields. RED first (`× keeps Roof metrics' measures…`, `× keeps Measure solids' measures…`).

### 2. Important — "centre within" now forces the centre proxy everywhere

`resolveCrossLayerParams` computes the offered proxy as before and then overrides it with
`"centre"` when the predicate is `centreWithin` (Join and Aggregate; Distance has no predicate).
The bag's own `proxy` is left untouched, so switching the predicate back restores the footprint
the user picked — a case of its own.

Consequences, all now true of the DISPLAYED and the FROZEN bag:

- the radio shows `Extent centre` checked and disables the other two, titled with §7.5's own
  parenthetical `Forces the centre proxy` (one literal, `CENTRE_FORCED`, shared with the
  predicate option's tooltip);
- `largest overlap` is disabled with `Largest overlap needs a footprint or rectangle` — the tie
  select reads the EFFECTIVE proxy, passed in from the parent;
- `crossLayerParamsError` REFUSES `largestOverlap` when the proxy is centre **or** the predicate
  is `centreWithin`, so a raw bag that still carries the earlier footprint is blocked too;
- §6's footprint workload note disappears, because `params.proxy` is no longer `"footprint"`.

Coverage: two pure cases (the force for both tools, idempotent through `BAG_ONLY`; and the
restore when the predicate stops forcing), one pure validation case, three component cases (Join,
Aggregate, and Distance which must NOT be forced), and two hook cases that drive the predicate
through the form and assert the request the mocked `submitRun` received
(`params: { predicate: "centreWithin", proxy: "centre" }`) plus the note going away. RED first;
re-falsified after the fix by removing the override (3 failures).

### 3. Important — an unimplemented tool promises nothing

Two guards, for the two halves the review names:

- `useToolForm` returns `columns: []` unless `tool.implemented`. The guard lives in the hook, not
  on the definition, precisely because Task 15 gave the three cross-layer entries their column
  builders so Tasks 16/17/19 would have nothing to wire.
- `ToolView`'s cross-layer PARAMETERS branch carries `&& f.tool.implemented`, the same guard the
  LoD select already had and for the same reason: the proxy radio is a VERDICT on the target's
  geometry (`LoD 0 footprints are not in this layer…`).

Covered in `ToolView.test.tsx`, which mocks no registry: `distance-to-nearest` (still
unimplemented) shows no radio group, no LoD-0 line and an empty column list, while
`join-by-location` (shipped in Task 16) shows both — so the test discriminates on `implemented`
rather than on the group. RED first.

### 4. Important — Aggregate's default target now respects `hasAreas`

`preferred` tries four pools in order for a vector target: eligible-and-area,
eligible, candidate-and-area, candidate. The first non-empty one wins, so a workspace of nothing
but point layers still opens on one rather than on a blank select, and the point rows stay in the
select (disabled, titled `Needs areas (polygons)`) for the explanation §5 requires. Test: a point
layer added FIRST and a polygon second, no stored draft, no active target — the select opens on
the polygon and `The layer has no areas` is NOT under Run. RED first.

### Minor — Join's collision is flagged on the second field

New export `joinFieldErrors(params): ReadonlyMap<string, string>` — keyed by the RAW property
name, empty under `count only` (which copies no field), flagging the SECOND field of a colliding
pair with §6's `'<slug>' resolves to the same column`. `crossLayerParamsError` reads it first and
falls through to the column-level sweep, which still catches the one collision no field can own
(a field slugging to `matches_n`).

The checklist renders that sentence beside the offending checkbox, `aria-describedby`-associated,
as a SIBLING of the `<label>` rather than a child — inside, it would become part of the
checkbox's accessible name. The section-level paragraph is suppressed by a membership test over
the sentences actually rendered inline (`new Set([...rowErrors, ...fieldErrors.values()])`), which
also replaces the earlier structural `rowLevel` flag: a sentence that belongs to no control — the
`largest overlap` pair, or an empty aggregate list — still prints under the section, and that case
has a test of its own.

### Gates (fix round)

```
$ npx tsc -b --noEmit    → 0
$ npx vp check           → Found 0 errors and 56 warnings in 565 files   (baseline held)
$ npx vitest run > /tmp/m3-task15-fix1-final.log 2>&1 & wait $!   → suite: 0
  Test Files  263 passed | 4 skipped (267)
  Tests  3424 passed | 84 skipped | 1 todo (3509)
```

Task 16's own suites (`joinByLocation`, `joinByLocationRun`, `styleByResult`, `extensionChip`,
`CatalogueView`, the Join integration file) are green throughout; `crossLayerParamsError`'s new
`centreWithin` refusal is stricter than its executor, which the review explicitly asks for.

### Notes on this round

- The five commits were rebuilt from a verified working tree so each one is a single finding:
  the tree was reset to `b208f1b`, each fix re-applied and committed with its own tests, and the
  final files were byte-compared against the set the full suite had already passed on.
- `aggregateRowErrors` and `joinFieldErrors` are now both computed in the parent component and
  passed down, so the section-level suppression can see what was rendered. `AggregateFields` no
  longer owns its `useId`.
- Not changed: the field checklist still renders all source keys, so a collision sentence appears
  only when BOTH colliding fields are ticked — which is when the collision exists.

---

## Fix round 2

On `develop` HEAD `5028433` (Task 16's own fix round had landed). Two commits, no trailers, hooks
not bypassed, nothing pushed:

- `e8ab696` `fix: the draft keeps the proxy the user picked when a predicate forces the centre`
- `60920dc` `fix: a field search cannot hide the collision sentence that blocks Run`

### Regression 1 — predicate switching lost the chosen proxy

Round 1 forced `proxy: "centre"` into the RESOLVED bag, and the section renders that bag and
writes it back whole — so a change to anything else carried the forced centre into the DRAFT.
Footprint → `centre within` → `within` ended up stored as `proxy: "centre"`, and every later run
used a proxy nobody chose.

The separation the round-1 comment promised is now real: **the draft keeps the user's own proxy;
only the resolved bag (display + frozen request) carries the forced one.** `setDraft` restores the
draft's `proxy` whenever a `params` patch did not change the proxy itself — which is exactly "the
user changed something else". A radio click DOES change it, so an explicit choice still lands in
the draft; a retarget or a source change still empties the bag before any of this applies.

Tests in `useToolForm.test.tsx`, driving the real transition through the form:

- three changes (default footprint → `centre within` shows centre → `within` shows **footprint**
  again), then Run asserts the submitted bag is `{ predicate: "within", proxy: "footprint" }`;
- a radio click to `Extent rectangle` followed by a predicate change keeps `rectangle`, so the
  restoration cannot swallow a real choice.

RED first (`× gives the footprint back when the predicate stops forcing the centre`), and
re-falsified after the fix by disabling the restore.

### Regression 2 — a search could hide the sentence that blocks Run

Past twelve fields the search filtered the checklist by name only, so ticking `Zone Name` and
`zone_name` and searching for `Zone Name` hid the second field — while the section paragraph was
suppressed (the sentence was "beside the field") and `ToolView`'s footer echo was suppressed too.
Run was disabled with no visible reason anywhere.

Taken the reviewer's second option, which keeps the sentence attached to its control: **a field
the search would hide stays when it carries a sentence** (`|| fieldErrors.has(k)`). The parent's
suppression is now also literally "only what is rendered" — it counts a field error only when the
field is still one the SOURCE offers, so a sentence with no checkbox to live on falls back to the
section paragraph.

Test: thirteen fields, both colliding ones ticked, `Search fields` typed with `Zone Name` — a
non-matching ordinary field (`p0`) is gone, the colliding `zone_name` checkbox is still there and
still `aria-describedby`-associated with `'zone_name' resolves to the same column`. RED first
(`Unable to find an accessible element with the role "checkbox" and name /^zone_name/`), and
re-falsified after the fix.

### Gates (fix round 2)

```
$ npx tsc -b --noEmit    → 0
$ npx vp check           → Found 0 errors and 56 warnings in 565 files   (baseline held)
$ npx vitest run > /tmp/m3-task15-fix2-suite.log 2>&1 & wait $!   → suite: 0
  Test Files  263 passed | 4 skipped (267)
  Tests  3428 passed | 88 skipped | 1 todo (3517)
```

Join's suites (`joinByLocation`, `joinByLocationRun`, the integration file) stayed green; nothing
under `tools/` was touched.

### Concerns from this round

- The proxy restoration is a rule about a WRITE-BACK, not about a key: "a params patch that left
  the effective proxy alone keeps the draft's own". It is right for every control the section has
  today (the only writer of `proxy` is the radio, and the radio is disabled while the predicate
  forces the centre). A future control that writes `proxy` as a side effect of something else
  would need to say so.
- On the very first predicate change from an untouched draft there is no stored preference yet, so
  the resolved default lands in the draft — which is the same value the form was showing. The
  round trip is only observable from the second change onward, and the test drives all three.
