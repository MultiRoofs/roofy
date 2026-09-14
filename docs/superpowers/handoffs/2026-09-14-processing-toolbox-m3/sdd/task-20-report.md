# Task 20 — The OUTPUT destination and the Name rule — report

**Status:** DONE. Two commits on `develop`, base `2218ca3`, nothing pushed, no trailers of any
kind, hooks not bypassed.

- `a55516d` `feat: the OUTPUT section offers a destination and names the new layer`
- `48884b9` `test: a vector target's New-layer name comes from the form's targetName`

Nothing staged from `.github/hooks/`, `docs/design-history/` or `.superpowers/`; the plan is
untouched. No tool gained `"new"`: all seven registry entries ship `destinations: ["layer"]`.

## Implemented

### `src/features/processing/deriveLayer.ts` (new, pure, engine-free)

- `STREAMING_NO_NEW_LAYER` — **[adapted copy A2]**, the ONE home of the sentence (the radio's
  `title`, the note under the radios, the form's `runReason` and the queue head's pre-flight all
  import it; `runQueue.ts` may not import a UI module, so it could not live in `ToolView.tsx`).
- `derivedLayerName(targetName, toolId, sourceName)` — exhaustive `switch` over `ToolId` with no
  `default`, so a new tool without a noun is a compile error. Produces §6's seven prefills and the
  two source-free fallbacks (`Delft`, `Delft · nearest`).
- `nameTaken(name, layers, geoLayers)` — trimmed, case-insensitive, across BOTH stores; an EMPTY
  name is never "taken" (A13 and A14 are two messages for two causes).
- `disambiguate(name, layers, geoLayers) → { name, renamed }` — counts up past a taken `" (2)"`,
  trims before appending, returns a free name untouched. Exported for Task 22's publication
  re-check; nothing in this task calls it yet.

Type-only imports of `Layer`, `GeoLayer` and `ToolId`, so the module pulls nothing in at runtime.

### Modified

- **`types.ts`** — `export type ToolDestination = "layer" | "new"` beside `ToolExtension`;
  `ToolDefinition.destinations: ReadonlyArray<ToolDestination>` (required, above `implemented`).
- **`toolRegistry.ts`** — `destinations: ["layer"]` on all seven entries, under each
  `defaultPrefix`.
- **`processingStore.ts`** — `ToolDraft` gains `destination: ToolDestination` and
  `newLayerName: string | null` (null = "whatever the tool would prefill", so a retarget follows
  the new target's name instead of freezing the old one's).
- **`useToolForm.ts`** — `NAME_EMPTY` / `NAME_TAKEN` (**[adapted copy A13, A14]**), the geo-store
  subscription was already there, the default draft's two new fields, and a name block after
  `paramsError`: `prefilledName`, `newLayerName`, `nameError`, `newLayerBlocked`,
  `destinationReason`, `inherited`. `runReason` gains `destinationReason ?? nameError` between
  `paramsError` and `scopeReason`. The returned object gains the five new entries.
- **`ToolView.tsx`** — two live `Write to` radios (`This layer (<target>)` checked by default,
  `New layer` disabled unless `tool.destinations.includes("new")` and not `newLayerBlocked`), the
  A2 note under the radios, the conditional `Name` field with its `role="alert"` message, the
  replace warning branched by destination, `destination`/`newLayerName` on the request, and
  `footerReason` suppressing the two OUTPUT reasons that are already printed beside their fields.
- **`RecentRuns.tsx`** — "Edit & run" rebuilds a `ToolDraft`, which now needs both fields; it
  restores `destination: "layer", newLayerName: null` (the RECORD carries no destination in this
  task — Task 22 owns that).
- **`runQueue.ts`** — `RunRequest.destination` / `.newLayerName`; two head guards: a `"new"`
  destination the tool does not offer fails `Not available yet` (checked first, it depends on
  nothing but the request), and a `"new"` destination on a streaming CITY target fails with
  `STREAMING_NO_NEW_LAYER` (placed after the `target` resolution, before the source phase).

## Tested + results

New: `tests/unit/features/processing/deriveLayer.test.ts` (8 cases),
`tests/unit/ui/processing/outputDestination.test.tsx` (11 cases),
`tests/unit/features/processing/runQueue.test.ts` (+2 cases → 70).

### TDD evidence

**RED 1 — the name rules**

```
$ npx vitest run tests/unit/features/processing/deriveLayer.test.ts
Failed to resolve import ".../src/features/processing/deriveLayer" from
  "tests/unit/features/processing/deriveLayer.test.ts". Does the file exist?
 Test Files  1 failed (1) | Tests  no tests
```

**GREEN 1** — `Test Files 1 passed (1) | Tests 8 passed (8)`
(the brief predicted "9 cases"; the file has 8 `it`s, all of the brief's assertions.)

**RED 2 — the OUTPUT destination**

```
$ npx vitest run tests/unit/ui/processing/outputDestination.test.tsx
 × offers BOTH of §6's radios, with This layer checked
 × disables New layer for a tool whose destinations do not include it
 × shows the Name field prefilled once New layer is chosen
 × flags an EMPTY name inline at Run and refuses to run
 × flags a name an existing layer already has, GEO layers included
 × scopes the replace warning to the COPY when writing to a new layer
 × freezes the destination and the name into the request
 × sends destination 'layer' and a null name by default
 × refuses New layer on a STREAMING target, with A2's reason
 × REFUSES RUN when a chosen New layer is retargeted to a streaming layer
TestingLibraryElementError: Unable to find an accessible element with the role
  "radio" and name "New layer"        (× 9; the tenth failed in `withNewLayer`)
 Test Files  1 failed (1) | Tests  10 failed (10)
```

**GREEN 2** — `Test Files 1 passed (1) | Tests 10 passed (10)`

**RED 3 — the head's two destination guards**

```
$ npx vitest run tests/unit/features/processing/runQueue.test.ts -t "New-layer request"
 × refuses a New-layer request for a tool that does not offer it
   AssertionError: expected 'done' to be 'failed'
 × refuses a New-layer request on a STREAMING target, with A2's reason
   AssertionError: expected 'Not available yet' to be 'New layer is not available for a stre…'
 Tests  2 failed | 68 skipped (70)
```

(The second failure is the interesting one: without the guard the run fell through to the
"no executor" refusal, which is a different sentence about a different fact.)

**GREEN 3** — `Test Files 1 passed (1) | Tests 70 passed (70)`

**Residual C2, proved by falsification.** The ten cases above all run `height-from-extent`, where
`target` and `targetName` agree — the one tool where the brief's prefill and mine give the same
answer. An eleventh case was added for §7.6's REVERSED direction (a `Zones` polygon layer as the
TARGET, `Delft` as the city SOURCE, `withNewLayer("aggregate-per-area", …)`), asserting the Name
field reads `Zones · buildings`. It went green on the first run (the code was already written), so
the prefill was reverted to the brief's city-only form and the case watched to fail:

```
# prefilledName = target === null ? "" : derivedLayerName(target.name, toolId, sourceName)
 × prefills a VECTOR target's own name, which `target` does not carry
   AssertionError: expected '' to be 'Zones · buildings'
 Tests  1 failed | 10 passed (11)

# restored
 Tests  11 passed (11)
```

The mutation was reverted; the file on disk is the passing one (`git diff` clean against
`a55516d`).

Two pre-existing assertions were OBSOLETE, not weakened:

- `ToolView.test.tsx` "opens OUTPUT with Write to, on the target, with no other destination"
  asserted the single radio was `disabled` and that `New layer` was absent. Rewritten as "opens
  OUTPUT with Write to on the target, New layer offered but staged off": `This layer` checked and
  now ENABLED, `New layer` present, unchecked and disabled.
- `RecentRuns.test.tsx`'s `toEqual` on the restored draft gained the two new required fields.

### Gates

```
$ npx tsc -b --noEmit                                         → 0
$ npx vp check                    → Found 0 errors and 56 warnings in 579 files   (baseline held)
$ npx vitest run > /tmp/m3-task20-suite.log 2>&1 & wait $!    → suite: 0
  Test Files  273 passed | 4 skipped (277)
  Tests  3554 passed | 96 skipped (3650)
```

(Run once after each commit; the numbers above are the final one.)

## Files changed

- `src/features/processing/deriveLayer.ts` (new, 122 lines)
- `src/features/processing/types.ts`, `toolRegistry.ts`, `processingStore.ts`, `runQueue.ts`
- `src/ui/processing/useToolForm.ts`, `ToolView.tsx`, `RecentRuns.tsx`
- `tests/unit/features/processing/deriveLayer.test.ts` (new)
- `tests/unit/ui/processing/outputDestination.test.tsx` (new)
- `tests/unit/features/processing/runQueue.test.ts` (+2 cases, `TOOLS` import, `withNewLayer`,
  `request()` fixture)
- The required-field sweep (mechanical, two lines each): `aggregatePerAreaRun`, `crossLayerRun`,
  `distanceToNearestRun`, `joinByLocationRun`, `measureSolidsRun`, `roofMetricsRun`,
  `validateSolidsRun`, `vectorTableLifecycle`, `processingStore` under
  `tests/unit/features/processing/`; `ToolView.test.tsx`, `lodSelect.test.tsx`,
  `useToolForm.test.tsx`, `RecentRuns.test.tsx` under `tests/unit/ui/processing/`.

## How each controller requirement was met

1. **Residual C2 — Task 15's two-layer contract.** The prefill reads `targetName`, never
   `target.name`: Task 15 makes `target === null` for a vector target, so Aggregate would have
   prefilled `""`. `prefilledName = targetName === null ? "" : derivedLayerName(targetName,
toolId, sourceName)`, pinned by the Aggregate case above (falsified), and `sourceName` is the
   hook's EXISTING source-row lookup (line ~413,
   `sourceOptions.find(o => o.id === sourceLayerId)?.name`), which resolves out of whichever store
   holds the source — so Aggregate gets `Zones · buildings` and Join/Distance get their source
   segment. I did NOT paste the brief's second `sourceName` lookup (it would have shadowed).
   `runReason` KEEPS `targetReason` and `sourceReason`; the two new reasons were inserted after
   `paramsError`, so the full chain is eligibility → LoD → target → source → prefix → params →
   destination → name → scope. **Deviation from requirement 1's literal ordering:** it lists
   "eligibility → target/source → LoD → params"; the SHIPPED chain puts `lods.emptyReason` before
   `targetReason`/`sourceReason` and Task 15's tests pin that, so the existing relative order is
   untouched and only the new reasons were placed (after params, before scope), which is the
   binding half of the requirement.
2. **Streaming retarget (round-1 C4).** Three statements from one constant. `newLayerBlocked =
tool.destinations.includes("new") && target?.isStreaming === true` disables the radio and
   prints the note; `destinationReason` (non-null only when the DRAFT still says `"new"`) enters
   `runReason`, which is what actually refuses Run; and the head's second guard refuses a `"new"`
   destination on a streaming city target with the same sentence. `footerReason` suppresses
   `f.destinationReason` (and `f.nameError`), so A2 appears exactly ONCE — which is what the
   retarget test's `getByText` proves: a second copy would fail it with "multiple elements found".
   The retarget case drives a real target change (two layers in the store) and asserts Run goes
   enabled → disabled.
3. **Name validation at Run and at the head.** Empty (after trim) → `Name the new layer`;
   duplicate (trimmed, case-insensitive, city AND geo) → `A layer is already called that`; both
   only under `destination === "new"`, so an invalid name never blocks a This-layer run.
   `disambiguate` is exported and unused here; Task 22 calls it at publication and both sides
   share `nameTaken`, so Run and publication cannot disagree about what is unique.
4. **The replace warning.** `inherited = existing.filter(c => computedLower.has(
c.name.toLowerCase()))` — INHERITED computed columns only (the brief's `c.toLowerCase()` does
   not compile: `existing` is `OutputColumn[]`). Rendered as `plural(n, "inherited computed
column", "inherited computed columns") + " will be replaced in the new layer"` for `"new"`,
   and as the M1 sentence otherwise. Both branches keep the `prefixError === null` gate, so a
   prefix colliding with a source attribute is still the prefix error and not a warning.
5. **Nothing persisted** (`grep -rn "drafts\|ToolDraft" src/persistence/` → nothing); no tool
   gained `"new"`; the two new suites' `vi.mock(".../insights/duckdb")` factory is
   `ToolView.test.tsx`'s verbatim (with the real `formatDuckDBError` via `importActual`), which
   the passing suite proves covers what the tree imports; the radios reuse the Scope radios'
   markup (`.processing-radios` inside `.processing-field`) and the Name field is the Prefix
   field's exact shape, so no new CSS and no new tokens.

## Deviations from the brief (each named)

1. **`prefilledName` reads `targetName`, not `target.name`** — requirement 1 / residual C2. The
   brief's `target === null ? "" : derivedLayerName(target.name, …)` is the obsolete city-only
   contract.
2. **The hook's EXISTING `sourceName` is reused** rather than the brief's second lookup over
   `layers`/`geoLayers`. Same answer, one producer.
3. **`inherited` filters on `c.name.toLowerCase()`** — the brief's `c.toLowerCase()` is a type
   error.
4. **`runReason` ordering** — see requirement 1 above; the shipped LoD/target/source order is
   preserved.
5. **`RecentRuns.tsx` and four more test files were edited** beyond the brief's file list: both
   new fields are REQUIRED, so `tsc` names every hand-built `ToolDraft` and `RunRequest` literal.
   All of those edits are two lines of `destination: "layer", newLayerName: null`.
6. **`ToolView.test.tsx`'s OUTPUT case was rewritten, not deleted** — the old assertion described
   the single disabled radio this task replaces.
7. **`addCityLayer` in the new suite carries `extension: null, sourceBytes: null`** on the table
   info; the brief's fixture omits them and `LayerTable` requires them.
8. **The brief's step 11 JSX is malformed** (stray `;` and statement-level `{ … }` wrappers); it
   was written as real JSX inside the OUTPUT fieldset.

## Self-review / concerns

- **The `New layer` radio is unreachable in the shipped app.** Every registry entry is
  `["layer"]`, so the only user-visible change is that `This layer` became a live (checked,
  enabled) radio and a second, disabled `New layer` radio sits beside it. Both tests that click
  the radio go through `withNewLayer`, which mutates the registry object for one case and puts it
  back — the staging pattern M2 used for `implemented`.
- **A draft can hold `destination: "new"` for a tool whose `destinations` lose `"new"`.** The
  form would then leave Run enabled and the head would refuse with `Not available yet`. It cannot
  happen today (`destinations` is static per entry and drafts are per tool), which is why no form
  reason was added for it; if Task 22/23 ever make the field conditional, the form needs a third
  clause. Flagging rather than pre-building it.
- **`RecentRuns`' "Edit & run" always reopens as `This layer`.** `RunRecord` has no `destination`
  in this task (Task 22 adds the record side), so a future New-layer run reopened from the history
  will offer the destination every M3-so-far run used. Named here so Task 22 does not miss it.
- **The head's first guard reports `Not available yet`,** the same sentence an unimplemented tool
  gets. That is the brief's wording and the fact is the same one ("this has not shipped"), but it
  does read oddly for a tool that IS implemented; Task 22 deletes that case with the last
  `["layer"]` on a city tool.
- **`disambiguate` has no caller yet.** It is exported, tested and unused until Task 22 — the
  brief asks for exactly that, and the alternative (shipping it with Task 22) would put the
  publication's comparison rule in a different module from Run's.
- **The `"new"` branch of the replace warning is only reachable through `withNewLayer` today**, so
  its rendering is proved by the unit test rather than in the browser (below).
- **For Join with no vector layer, A14 and the eligibility reason can both be true at once.**
  `derivedLayerName(target, "join-by-location", null)` is the TARGET's own name, and `nameTaken`
  counts the target — so a Join draft on `destination: "new"` with zero vector layers would show
  `A layer is already called that` under Name while eligibility already says `Add a vector layer
to join with`. Two true sentences about two different problems, and only reachable once Task 22
  flips Join's `destinations`. Noted for Task 22 rather than changed here: suppressing the name
  check behind eligibility would also suppress it for the legitimate duplicate.

## Browser check

Not performed as a live click-through: the New-layer radio and the Name field cannot be reached
in the running app in this task (no tool declares `"new"`), so there is nothing new to click. The
two controls are byte-for-byte the shape of their peers in the same panel — the radio is the Scope
radios' markup inside the same `.processing-radios` / `.processing-field` pair, and the Name field
is the Prefix field with a different label — and no CSS was added or changed, so the 8 px radii,
30 px compact field height and control spacing come from `flatControls.css` through the existing
`.processing-*` classes exactly as they do for the peers. The one thing a user sees change,
`This layer` going from a `readOnly disabled` radio to a live one beside a disabled `New layer`,
is asserted in `ToolView.test.tsx`. Task 22 should do the real browser pass with the radio live.
