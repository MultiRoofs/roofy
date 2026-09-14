# Task 23 — Derived vector layers — report

**Status:** DONE. Four commits on `develop`, base `a16b25d`, nothing pushed, no trailers of any
kind, hooks never bypassed, `core.hooksPath` untouched. Nothing staged from `.github/hooks/`,
`docs/design-history/` or `.superpowers/`; the plan is untouched.

- `f516d01` `feat: a derived vector layer can be prepared from its parent's areas`
- `8e8d0d9` `feat: Aggregate can write its results to a new vector layer`
- `7eb024d` `fix: the run log names the parent a derived vector target was cut from`
- `9ce66fb` `test: a New-layer run's Undo is blocked while a later run is still using the copy`

## Implemented

### `src/features/geoLayers/geoLayerStore.ts`

- `import type { DerivedFrom } from "../layers/layerStore"` — **type-only**, so the two stores
  stay runtime-independent (the file's own header rule).
- `GeoLayerBase.derivedFrom: DerivedFrom | null`, REQUIRED, the same shape a city layer carries.
- `GeoLayerInput`'s `Omit` gains `"derivedFrom"`, plus optional `derivedFrom?: DerivedFrom | null`
  (defaults to `null`, exactly as `visible`/`opacity` do) and `insertAfterId?: string`.
- `addGeoLayer` defaults the field and has ONE splice site: `insertAfterId` absent or naming a row
  that is not in the list still appends, so no existing caller's ordering moved.

### `src/features/geoLayers/geoJsonRecords.ts`

- NEW exported pure `publicGeoDocument(document)` — every feature's properties through
  `publicGeoProperties`, copy-on-write. Not in the brief; see Deviations 1 for why it exists.

### `src/features/processing/deriveLayer.ts`

- `prepareDerivedVectorLayer({runId, parent, name, columns, rows}) → Promise<DerivedPlan>`:
  narrows the parent in-body (throws for a non-GeoJSON one), merges the run's rows into the
  parent's `preparedData` through **Task 18's exported `mergeGeoDocumentProperties`** (no local
  merge), strips the envelopes, and returns a plan whose `publish()` re-checks the name against
  BOTH stores, `addGeoLayer`s a plain GeoJSON layer with `insertAfterId: parent.id`, the parent's
  style and opacity, `derivedFrom` (parent's name read LIVE at publication), copies the parent's
  computed-column provenance across and `activateLayer`s the copy. `discard()` is an async no-op —
  nothing exists outside the closure until `publish()`.

### `src/features/processing/runQueue.ts`

- The `destination === "new"` branch (Task 22's, dispatched before BOTH This-layer publications)
  gains its vector arm and loses the `"Not available yet"` refusal:
  - the parent is re-read and VERIFIED first — `"Layer removed"` / `"Layer changed while running;
run again"`, the same two sentences and the same position as the This-layer vector block
    (Deviations 2);
  - `canonicalise` is branched: a vector copy is spelled by the PARENT DOCUMENT's own property
    keys, not by the source city table's columns (Deviations 3);
  - `prepareDerivedVectorLayer` vs `prepareDerivedCityLayer` on the narrowed `vectorParent`;
  - `summariseCreated(…, vectorParent === null ? scope.count : null, …)`, so §7.6's own head
    segment survives for a vector copy.
- `undoRun`'s `kind: "layer"` branch calls `useGeoLayerStore.getState().removeGeoLayer(...)`
  beside `removeLayer` — one of the two stores holds it and the other's removal is a no-op — still
  OUTSIDE `runOnTableQueue` (design decision (g)).

### `src/features/processing/toolRegistry.ts`

`aggregate-per-area`: `destinations: ["layer", "new"]`. All seven tools now offer both.

### `src/ui/processing/LogView.tsx`

A7's "Derived from <parent>" lookup reads BOTH stores (a derived vector layer's row is in the geo
one). Enabled by this task; see Deviations 7.

## Tested + results

New/extended suites:

- `tests/unit/features/processing/deriveLayer.test.ts` — **+9 cases** in a
  `describe("prepareDerivedVectorLayer")`: every area copied, the parent byte-identical, the
  copy's OWN envelope (mutation-checked), nothing before `publish()` + placement under the parent,
  activation + style/opacity copy, inherited provenance, the " (2)" re-check, `discard()`, and the
  non-GeoJSON parent refusal.
- `tests/unit/features/processing/derivedRun.test.ts` — **+10 cases** through the REAL queue and
  BOTH real stores: the §10.11 success (copy created, original config byte-identical AND the same
  object, no `CREATE TABLE`/`ALTER TABLE`, provenance under the NEW geo id and none on the parent,
  `derivedFrom`), all areas copied, placement + activation, §7.6's line kept whole, the rename +
  A15 note read back from the geo store, cancel-before-publish, engine-death-before-publish, Undo
  removing the copy, and Undo blocked twice — by a later run HELD mid-flight against the copy
  (§6.2's "queued, running or done", asserted while the copy still carries only this run's own
  column) and by the copy growing a column of its own. The two blocks are orthogonal, and that is
  mutation-checked rather than assumed (see TDD evidence).
- `tests/unit/features/geoLayers/geoJsonRecords.test.ts` — **+4 cases** for `publicGeoDocument`
  (the prepare→strip→prepare round trip, a file's own reserved key, identity for an unstamped
  document, a bare `Feature` and a non-document).
- `tests/unit/persistence/geoLayerSnapshot.test.ts` — **+1 case**: `geoLayerSnapshot` neither
  chokes on `derivedFrom` nor writes it (falsification-checked).
- `tests/unit/ui/processing/LogView.test.tsx` — **+1 case**: A7's row for a derived VECTOR target.
- `tests/unit/features/processing/toolDestinations.ts` (new, not a `*.test.ts` so Vitest never
  collects it) — the shared `withDestinations` staging helper; `withNewLayer` is gone.
- Mechanical: `derivedFrom: null` on the 15 hand-built `GeoLayer` fixtures `tsc` named
  (`geoLayerBounds`, `geoLayerStore`, `geoLayerSnapshot`, `GeoRecordsPanel`, `legendCounts`).

### Gates

```
$ npx tsc -b --noEmit                                   → clean
$ npx vp check                → Found 0 errors and 56 warnings in 583 files   (baseline held)
$ npx vitest run > …/m3-task23.log 2>&1 & wait $!; echo "suite: $?"
  suite: 0
  Test Files  276 passed | 4 skipped (280)
  Tests  3641 passed | 96 skipped (3737)      (was 3616 passed at Task 22)
```

Run twice — once before the third commit and once after the fourth (the tightened Undo-block
case), both `suite: 0` at 3641; `tsc` and `vp check` re-run with it.

Focused, while iterating: `npx vitest run tests/unit/features/processing tests/unit/ui/processing`
→ 50 files, 868 passed; `tests/unit/features/geoLayers tests/unit/persistence tests/unit/ui/table
tests/unit/ui/viewport` → 47 files, 476 passed.

## TDD evidence

**RED 1 — `prepareDerivedVectorLayer`, before any production change:**

```
$ npx vitest run tests/unit/features/processing/deriveLayer.test.ts -t "prepareDerivedVectorLayer"
TypeError: prepareDerivedVectorLayer is not a function
 Test Files  1 failed (1)      Tests  9 failed | 23 skipped (32)
```

**GREEN 1** after the store field, `publicGeoDocument` and the preparation: `Tests 32 passed (32)`
(one authoring fix on the way: my style case asserted `style.fillColor`, and the field is `color`).

**MUTATION CHECK on the envelope case** — `publicGeoDocument(merged)` replaced by `merged`:

```
 × gives the copy its OWN stable-id envelope and shows none of it
      Tests  1 failed | 31 passed (32)
```

Exactly one case fails, and it is the one that is about the strip. Reverted immediately.

**RED 2 — `publicGeoDocument` itself, by FALSIFICATION** (the function was written before its
tests, so its body was replaced by `return document`):

```
 × takes a PREPARED document back to the properties the file had
 × gives a file's OWN reserved key back, rather than eating it
 × handles a bare Feature and a document that is neither
      Tests  3 failed | 4 passed (7)
```

**GREEN 2**: `Tests 7 passed (7)`.

**RED 3 — the vector destination branch, before `runQueue.ts` and the registry flip:**

```
$ npx vitest run tests/unit/features/processing/derivedRun.test.ts
 Test Files  1 failed (1)      Tests  10 failed | 19 passed (29)
 AssertionError: expected 'failed' to be 'done'
```

All ten failed at the head's `"Not available yet"` guard — `aggregate-per-area` still shipped
`destinations: ["layer"]`.

**GREEN 3** after the branch + the flip: `Tests 29 passed (29)`, then
`tests/unit/features/processing tests/unit/ui/processing` → `868 passed`. One `tsc` error went
with it and is an authoring fix, not behaviour: `ctx.target.records[0]?.[GEO_RECORD_ID]` types as
a plain `symbol` index when the symbol is reached through `await import`, so the executor uses
`geoRecordId(record)` — the accessor that exists for it.

**RED 4 — A7's row for a vector parent:**

```
$ npx vitest run tests/unit/ui/processing/LogView.test.tsx
 × names the parent of a derived VECTOR target too — [adapted copy A7]
   Unable to find an element with the text: Zones · buildings · Derived from Zones
      Tests  1 failed | 14 passed (15)
```

**GREEN 4** after the both-store lookup: `Tests 15 passed (15)`.

**MUTATION CHECK on the two Undo blocks** — each half of `newLayerUndoBlock` short-circuited in
turn, to prove the two cases are not testing one rule twice:

```
# `if (used) return USED_BY_LATER_RUN;` disabled
 × blocks Undo once a later run has used the derived layer            (the CITY case)
 × blocks Undo while a later run is still RUNNING against the copy    (the VECTOR case)
 × blocks Undo once the copy has computed columns of its OWN          (cascade, see below)

# `return grown ? … : null` disabled
 × blocks Undo once the copy has computed columns of its OWN          (CITY and VECTOR)
      Tests  2 failed | 27 passed (29)
```

The third failure in the first run is a CASCADE, not a second rule: with the `used` scan disabled
the held case's `undoRun` succeeds, removing the copy under a run that is still using it, which
leaves the later run failing and its gate held for the next case. The second run is the clean one
— exactly the two same-named cases (city and vector) fail, and nothing else. Both mutations were
reverted immediately and the file is back at `Tests 29 passed (29)`.

**FALSIFICATION on the snapshot case** (it was GREEN on arrival — the door already ignored the
field, and the case is the pin that it keeps doing so). With `derivedFrom` spread into
`geoLayerSnapshot`'s `base`:

```
 × drops the inline GeoJSON document but keeps every choice around it
 × does not choke on a DERIVED layer, and writes nothing about it
      Tests  2 failed | 15 passed (17)
```

Reverted immediately.

## Files changed

```
src/features/geoLayers/geoJsonRecords.ts
src/features/geoLayers/geoLayerStore.ts
src/features/processing/deriveLayer.ts
src/features/processing/runQueue.ts
src/features/processing/toolRegistry.ts
src/ui/processing/LogView.tsx
tests/unit/features/geoLayers/geoJsonRecords.test.ts
tests/unit/features/geoLayers/geoLayerBounds.test.ts
tests/unit/features/geoLayers/geoLayerStore.test.ts
tests/unit/features/processing/deriveLayer.test.ts
tests/unit/features/processing/derivedRun.test.ts
tests/unit/features/processing/runQueue.test.ts
tests/unit/features/processing/toolDestinations.ts          (new, not a test file)
tests/unit/persistence/geoLayerSnapshot.test.ts
tests/unit/ui/processing/LogView.test.tsx
tests/unit/ui/processing/outputDestination.test.tsx
tests/unit/ui/table/GeoRecordsPanel.test.tsx
tests/unit/ui/viewport/legendCounts.test.ts
```

## How each controller requirement was met

1. **C1's test.** `creates a GeoJSON copy of the target and leaves it untouched (§10.11)` asserts,
   through the real queue: `JSON.stringify(config)` byte-identical before and after, `config` the
   SAME OBJECT (the record was never replaced, so the engine pair is never rebuilt), no
   `bld_buildings_n` key on the parent's first area, `derivedFrom` still null on the parent, no
   provenance under the parent's id, no `CREATE TABLE` and no `ALTER TABLE "layer_1"`, and the
   provenance + `derivedFrom` both under the NEW geo layer id. The unit-level twin
   (`leaves the PARENT's document untouched`) makes the same assertion about the preparation
   alone. `copies EVERY area, whatever the scope selected on the SOURCE (§6)` is §6's copy rule:
   two areas in, two out, the un-evaluated one carrying no key.
2. **The merge is Task 18's.** `deriveLayer.ts` imports `mergeGeoDocumentProperties` and calls it
   once; there is no merge logic in the module. The `?? source` no-op path is commented with why
   sharing is safe — the helper never mutates its input, and every writer of `preparedData`
   REPLACES the object (`setPreparedGeoJson`, `replaceGeoPreparedData`) rather than editing it, so
   the parent cannot change the shared document under the copy. The geometry objects are shared by
   reference for the same reason, which the `publicGeoDocument` doc comment states.
3. **The card.** `summariseCreated` is handed `null` for a vector copy, so the line is §6.2's
   `"Created <name>"` head plus §7.6's own line verbatim — pinned twice: against the literal shape
   (`/^Created Zones · buildings · 1 area aggregated over 1 building · \d+\.\d s$/`) and against
   the SAME tool's This-layer card, seconds dropped from both sides because they are wall clock.
   No "areas" noun was invented. The name on the card is read from BOTH stores (Task 22's
   fallback chain, now exercised: `reads the name publication actually gave the copy` asserts
   `Created Zones (2)`, A15's note and the geo row's name).
4. **Placement, activation, style, persistence.** `insertAfterId: parent.id` splices the copy
   directly under its parent (asserted with a third layer below it, at unit level and through the
   queue); `activateLayer(id)` is the same door the geo selection uses (`useWorkspaceStore`'s
   unified active id — `activateLayer` takes any layer id and rule 1 lives inside
   `setActiveLayerId`), asserted on `activeLayerId`; the parent's style and opacity are copied and
   `addGeoLayer` normalises the style into a record of its own (asserted `not.toBe` the parent's);
   `derivedFrom` is set with the parent's LIVE name. Nothing is persisted: `geoLayerSnapshot` never
   reads the field, pinned by a falsification-checked case that also runs it through `capture`.
5. **Undo.** The `kind: "layer"` branch removes the geo layer OUTSIDE the FIFO (unchanged
   position) and clears its provenance; `Undo removes the derived VECTOR layer` asserts the row is
   gone, the registry entry is gone, `note: "Undone"` and `undoable: false`. Both blocks use the
   SAME sentence as the city case (`USED_BY_LATER_RUN`, asserted verbatim): `blocks Undo once a
later run has used the derived vector layer` (a real second run against the copy) and `blocks
Undo once the copy has computed columns of its OWN`; each also calls `undoRun` and asserts the
   copy survives and the card carries the reason.
6. **Tests, mocks and process.** Every new queue case runs through the real `submitRun` and both
   real stores, with only `duckdb` and `layerTables` mocked (`derivedRun.test.ts`'s existing
   factories — no factory needed a new export, because the modules this task pulled in
   (`geoLayerStore`, `geoJsonRecords`, `geoRecords`, `deriveLayer`) import neither `insights/duckdb`
   nor `insights/layerTables` beyond what `runQueue` already did; the suite proves it).
   Cancel-before-publish and death-before-publish gate the executor's own statement
   (`/* aggregate */`) and then `cancelRun` / `killEngine()` — the vector preparation awaits
   nothing, so the executor is the only place a race can land; both assert one geo layer, a null
   `newLayerId` and (for the cancel) an empty provenance registry. The full suite ran ONCE in the
   background with `& wait $!; echo "suite: $?"`.

## Deviations from the brief (each named; the requirements and the code won)

1. **The copy's `config` is `{ data: <envelope-stripped document> }`, not the brief's
   `{ data, preparedData, preparation }` with the PREPARED document.** `addGeoLayer` re-runs
   `normalizeGeoJsonDocument` over `config.data` whenever data is present (it overwrites any
   `preparedData` the caller passes), and that function tests
   `hasOwnProperty(properties, GEO_STABLE_FEATURE_KEY)` on the incoming bag — so an already-prepared
   document comes back with a SECOND envelope whose `hasOriginal: true` and whose `originalValue`
   is the first envelope. `publicGeoProperties` then hands that back as a visible attribute, and
   the copy's records grid, its Details, its GeoJSON export and its "Color by attribute" list would
   every one of them offer `__roofy_stable_feature_id`. Hence the new pure
   `publicGeoDocument` in `geoJsonRecords.ts` (a file not in the brief's list), called AFTER the
   merge because the merge matches on the very envelope it removes. The stable ids are unchanged
   by the round trip (same feature ids, same order), so the copy's ids are the parent's.
   Mutation-checked, and `publicGeoDocument` has four tests of its own.
2. **The parent is identity-checked before the copy is prepared.** The brief's Step 7 builds the
   copy from the document captured before the compute. The This-layer vector block directly beneath
   refuses a re-link with `"Layer changed while running; run again"`, and a copy of a document the
   user has replaced — keyed by stable ids that no longer exist — is not better for being a copy.
   Same two sentences, same position.
3. **`canonicalise` branches on the target kind.** The brief left `canonicalise(raw, table.columns)`
   for both arms; `table` is the SOURCE CITY layer's table for an Aggregate run, and a
   coincidental name match there would re-spell the vector copy's columns after a layer the copy
   has nothing to do with. The vector arm canonicalises against the parent DOCUMENT's own property
   keys, which is what the This-layer vector publication does.
4. **`derivedFrom.layerName` is read live from the geo store at publication**, matching
   `prepareDerivedCityLayer` exactly (the brief used the captured `parent.name`).
5. **`prepareDerivedVectorLayer` throws for a non-GeoJSON parent** (the task's "narrowed in-body").
   Unreachable from a run — `ToolTarget`'s vector arm is already `GeoJsonLayer` — but the signature
   takes the union, and a raster parent would otherwise publish a layer with no document, which the
   layer list reads as "needs re-link".
6. **`withNewLayer` was not simply deleted — it became a SHARED `withDestinations`** in
   `tests/unit/features/processing/toolDestinations.ts`. The brief says the helper "can be deleted
   along with its uses", and its two uses did become plain; but the flip also removes the SUBJECT
   of three tests of rules that are still in production — the queue head's `"Not available yet"`
   refusal (`runQueue.test.ts` and `derivedRun.test.ts`) and the form's disabled radio
   (`outputDestination.test.tsx`) — because no shipped tool lacks `"new"` any more. Staging a
   definition is the established answer here (`useToolForm.test.tsx`, `lodSelect.test.tsx`), and
   one shared helper beats three copies of a trick whose restore is easy to get wrong. It is
   `async` on purpose: the head guard fires after `submitRun` returns.
7. **`LogView`'s A7 lookup now reads both stores** (its own commit). Not in the brief, but this
   task is what makes a derived VECTOR layer exist, and a run ON one would otherwise lose the
   "Derived from Zones" segment — §6.2's sentence does not distinguish the two kinds, which is the
   same reasoning the brief itself gives for putting `derivedFrom` on `GeoLayerBase`.
8. **Extra tests beyond the brief's two files**, all listed above: cancel/death before publish and
   the two Undo blocks (controller requirement 5 names them and the brief's Step 6 does not write
   them), `publicGeoDocument`'s own cases, the snapshot case, the LogView case.
9. The brief's `columns` parameter is kept on `prepareDerivedVectorLayer`'s input and is
   deliberately unread — documented on the field. §6.2's value rule gives an area the run never
   evaluated no value at all, so there is no column list to pre-declare on a document.

## Self-review

- The city arm of the destination branch is byte-for-byte what it was apart from being indented
  into a ternary; `tsc` plus `derivedRun.test.ts`'s 19 pre-existing cases are the proof.
- `stealUndo` and `installStaleWatcher` needed nothing: both already skip a run with
  `newLayerId !== null`, and a vector New-layer run's `targetLayerId` is the parent it never wrote
  to. `discardUndo` also returns early for `kind: "layer"` — a vector copy has no backup table.
- The Undo's `removeGeoLayer` is called unconditionally beside `removeLayer`; `removeGeoLayer` for
  a city id returns the state object unchanged (`layers.some(...)` is false), so the city Undo is
  not touched — the existing city Undo case still asserts the active layer is handed back.
- `newLayerUndoBlock`'s run-history scan already covers a vector copy (it keys on ids, not stores),
  which is why requirement 5's first block needed no production change — only a test.
- The copy's stable ids are identical to the parent's. That is a property of
  `normalizeGeoJsonDocument` (ids from `feature.id` uniqueness, else the index) and not an accident
  of this code; nothing keys across layers, so it costs nothing and makes the two documents
  comparable by hand.
- `derivedRun.test.ts`'s fake Aggregate executor declares §7.6's real `line`
  (`"1 area aggregated over 1 building"`), so the card assertions are about composition rather
  than about a stand-in sentence.
- No CSS and no new control: this task adds no UI of its own, so no design review applies.

## Concerns (for the commander, not fixed here)

- **A derived VECTOR layer is still saved today, as an empty re-linkable row.** `geoLayerSnapshot`
  drops the inline document and keeps the name/visibility/style, so a workspace saved with a copy
  in it restores a row called "Zones · buildings" that asks to be re-linked. Task 24's snapshot
  filter is what removes it; the pinned case here only proves `derivedFrom` itself never reaches
  the document. Worth checking that Task 24's filter covers the GEO path and the SHARE path (Strand
  C round-2 finding 4 is about the share path for city layers).
- **No "Derived · not saved in workspaces" marker or state line for the vector copy yet** — Task
  24, as the brief's ledger note says.
- **`markEngineStopped` revokes a vector New-layer run's Undo too.** Removing a geo layer needs no
  engine, so the revocation is for nothing. Inherited from Task 18's concern (the flag is
  store-wide and city-shaped); unchanged here.
- **No browser pass.** The host is headless and an Aggregate run needs a real DuckDB boot, a city
  model and a vector layer. Three things to look at when someone can drive `agent-browser`: the
  copy's row appearing directly under Zones in the layer list, `Zoom to layer` actually framing a
  freshly published GeoJSON copy (the engine pair is built by the next `geoLayerSync` pass, and a
  `fitLayer` that races it may no-op — Task 22 deferred the same check), and `Open table` on the
  copy showing the merged column with its badge.
- **`aggregate-per-area`'s `newLayerUndoBlock` inherits Task 22's status-blind scan**: a later run
  that FAILED against the copy still blocks the Undo for ever. Unchanged, still a one-line status
  filter and a spec reading the commander may want to make.
