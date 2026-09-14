### Task 21: Derived city layers

**Files:**

- Modify: **`src/features/processing/deriveLayer.ts`** (Task 20 created it with the name rules), `src/insights/layerTables.ts`, `src/features/processing/scope.ts`, `src/features/processing/runQueue.ts` (one line — the provenance `partial` test), `src/features/layers/layerStore.ts`, `src/features/layers/layerTableLifecycle.ts`, the **6** `vi.mock(".../insights/layerTables")` factories (`tests/unit/app/appCityParquetLayers.test.tsx`, `tests/unit/features/layers/addCityLayer.test.ts`, `tests/unit/features/layers/layerTableLifecycle.test.ts`, `tests/unit/features/layers/useLayerFileLoader.test.ts`, `tests/unit/features/processing/roofMetricsRun.test.ts`, `tests/unit/features/processing/runQueue.test.ts`), and every `tests/` file that builds a `Layer` WITHOUT a cast.
- Test: additions to `tests/unit/features/processing/deriveLayer.test.ts`; additions to `tests/unit/features/processing/scope.test.ts`, `tests/unit/features/layers/layerStore.test.ts`.

**Interfaces:**

- Consumes: `derivedLayerName`, `nameTaken`, `disambiguate` (Task 20, same module); `writeComputedColumns`, `OutputColumn` (`insights/computedColumns.ts`); `raced` (`insights/engineAwait.ts`); `quoteIdent`, `quoteLiteral` (`insights/sql.ts`); `activateLayer` (`features/workspace/layerCoordination.ts`); `useGeoLayerStore` (for `publish()`'s own `disambiguate` call).
- Produces:

  ```ts
  // src/insights/layerTables.ts
  // LayerTable gains:
  //   sourceFeatureIds: ReadonlyArray<string> | null
  //       The FEATURE ROOT ids this table is restricted to — set only on a
  //       DERIVED layer, null on every ordinary one. Whatever reads the
  //       parent's SOURCE on this layer's behalf (readSource's reader FROM,
  //       the CityParquet export's WHERE) must AND this filter in, or a
  //       derived layer silently reads its parent whole.
  export function nextTableName(): string;
  export function adoptLayerTable(layerId: string, info: LayerTable): void;

  // src/features/processing/scope.ts
  // resolveScope's `featureIds` is NO LONGER null for scope "all" when the
  // table carries `sourceFeatureIds`: it returns that table's actual ROW ids,
  // so every executor, `buildProxySql` and `buildSolidMeasureSql` need no
  // change. Signature and return type are unchanged.

  // src/features/layers/layerStore.ts
  // Layer gains:  derivedFrom: { layerId: string; layerName: string; runId: string } | null
  // addLayer's input gains:  insertAfterId?: string   (splice, not append)
  //                          derivedFrom?: DerivedFrom | null   (defaults null)

  // src/features/processing/deriveLayer.ts
  export interface DerivedPlan {
    readonly name: string;
    /** Publishes model + table + layer row as ONE step; returns the new layer id. */
    publish(): string;
    /** Every partial resource, discarded when a cancel or a failure lands first. */
    discard(): Promise<void>;
  }
  export async function prepareDerivedCityLayer(input: {
    readonly runId: string;
    readonly parent: Layer;
    readonly parentTable: LayerTable;
    readonly name: string;
    readonly rowIds: ReadonlyArray<string> | null;
    readonly columns: ReadonlyArray<OutputColumn>;
    readonly rows: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
    readonly signal: AbortSignal;
    /** The run's own `ctx.query` — in the ledger. */
    readonly query: (label: string, sql: string) => Promise<QueryOutcome>;
  }): Promise<DerivedPlan>;
  ```

  **Why `query` is an input** (now in the ledger, so this is a reason and not a deviation): it is the SAME `(label, sql) => Promise<QueryOutcome>` callback `createVectorTable` already takes (Task 13). Without it `deriveLayer.ts` would have to call `runQuery` behind the run's back and the derived layer's `CREATE TABLE` would never appear in the log — which §6.4 asks for ("the SQL statements issued in order"). `ctx.query` is exactly this function, so Task 22 passes it straight through.

- Task 22 is the only caller of `publish()` / `discard()`; Task 23 adds `prepareDerivedVectorLayer` to this module; Task 24 reads `Layer.derivedFrom` and `LayerTable.sourceFeatureIds`.

**Intent:** Design decision (f) in code: the CTAS from the PARENT'S TABLE (not its source), the metadata copy that makes the layer reader-backed, `sourceFeatureIds` as the filter three independent readers must AND in, and a `publish()` that is one synchronous step — `adoptLayerTable`, the provenance copy, `addLayer({ insertAfterId })`, `activateLayer` — with `discard()` undoing every partial resource. `enqueueLayerTable` must not appear anywhere in this file: the run is already on the FIFO. A reviewer rejects it for enqueueing from inside the queue, for a derived layer the lifecycle treats as a streaming rebuild candidate, for publishing anything before `publish()`, or for making `derivedFrom` optional to avoid the test sweep.

**The sweep, sized before the work starts** (`grep -rn "): Layer\b" tests/`, run on `develop` @ `55e4e00`): 32 fixture helpers across 32 files are typed `: Layer`, but **20 of them end in `as Layer` / `as unknown as Layer`** and a cast to a supertype needs no new field. The 12 that build the literal outright, and therefore each need one `derivedFrom: null` line, are:

```
tests/unit/scene/handleSyncAppearance.test.ts
tests/unit/features/processing/runQueue.test.ts
tests/unit/features/processing/roofMetricsRun.test.ts
tests/unit/ui/sidebar/LodSelector.test.tsx
tests/unit/ui/layers/StreamingLodControl.test.tsx
tests/unit/ui/layers/LayerTypeToggles.test.tsx
tests/unit/ui/layers/RulesEditor.test.tsx
tests/unit/ui/viewport/HoverTooltip.test.tsx
tests/unit/ui/viewport/legendCounts.test.ts
tests/unit/ui/viewport/legendModel.test.ts
tests/unit/ui/viewport/LegendOverlay.test.tsx
tests/unit/ui/header/WorkspaceHeader.test.tsx
```

Twelve one-line edits is a `chore:` commit of its own (Step 8), which is what the ledger budgeted rather than making the field optional. **`addLayer`'s callers need nothing**: `derivedFrom` joins `isStreaming` in the input's `Omit` list with an optional field defaulting to `null`.

- [ ] **Step 1: Write the failing test for `nextTableName`, `adoptLayerTable` and `sourceFeatureIds`**

Add to `tests/unit/insights/layerTablesBuild.test.ts` (it already mocks `duckdb` and drives the registry). **Not the stale-watcher case** — that one needs `installStaleWatcher`, which drags `runQueue` and its `tools/register` side effect into this suite; it lives in Task 22's `derivedRun.test.ts` instead.

```ts
describe("a derived layer's table is adopted, never built", () => {
  it("mints a name from the SAME counter an ordinary build uses", () => {
    // A separate counter would eventually collide with `layer_N`, and the
    // collision would be a silent CREATE OR REPLACE over a live table.
    const a = nextTableName();
    const b = nextTableName();
    expect(a).toMatch(/^layer_\d+$/);
    expect(b).not.toBe(a);
  });

  it("seeds a READY entry that nothing will rebuild", () => {
    const info = {
      table: "layer_9",
      sourceName: "layer_1.city.json",
      source: null,
      reader: "read_cityjson" as const,
      extension: "city.json" as const,
      sourceBytes: null,
      sourceFeatureIds: ["a", "b"],
      columns: [{ name: "id", type: "VARCHAR", kind: "scalar" as const }],
      lods: [{ label: "2.2", suffix: "2_2" }],
      rowCount: 3,
    };
    adoptLayerTable("L-derived", info);
    const entry = useLayerTableStore.getState().tables["L-derived"];
    expect(entry?.state).toBe("ready");
    expect(entry?.state === "ready" ? entry.info : null).toEqual(info);
    // And the REGISTRY, not only the store — `getLayerTable` is what a run and
    // an export read, and an entry only the store knew about would give a
    // derived layer a grid and no tools.
    expect(getLayerTable("L-derived")).toEqual(info);
  });
});
```

(`useLayerTableStore` and `getLayerTable` are already imported by that suite; add `nextTableName` and `adoptLayerTable` to its import list.)

- [ ] **Step 2: Run it and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/insights/layerTablesBuild.test.ts
```

Expected: FAIL — `nextTableName is not a function` / `adoptLayerTable is not a function`.

- [ ] **Step 3: Add the field and the two exports to `layerTables.ts`**

1. `LayerTable` gains the field. Find (Task 5 has already added `extension` and `sourceBytes` above it):

```ts
  /** `null` when the COUNT itself failed — the table exists and is browsable,
   *  but its size is UNKNOWN. Not 0: a zero would be shown as "0 rows" over a
   *  grid that then pages real data, which is worse than saying nothing. */
  readonly rowCount: number | null;
}
```

and insert ABOVE `readonly rowCount`:

```ts
  /**
   * The FEATURE ROOT ids this table is restricted to — set only on a DERIVED
   * layer (§6, "What a derived layer is"), null on every ordinary one.
   *
   * Three things read the PARENT's source on this layer's behalf, and every
   * one of them must AND this filter in or the derived layer quietly reads its
   * parent whole: `readSource`'s reader `FROM` (Task 5), `resolveScope`'s
   * "all" (this task) and `buildCityParquetSourceSql`'s `where` (Task 24).
   * That is why it lives on the table and not inside `deriveLayer.ts`.
   */
  readonly sourceFeatureIds: ReadonlyArray<string> | null;
```

2. Every construction site of a `LayerTable` gets `sourceFeatureIds: null`: `buildFromReader`'s return, `buildFromRows`' return, and the flat-fallback path. `tsc` names them all.

3. The two exports, beside `runOnTableQueue` (which is the other door into this module's internals from the run queue). Find:

```ts
/** Public door onto the ONE queue for work that must not interleave with a
 *  table build: a processing run's ALTER/UPDATE on a layer table. */
export function runOnTableQueue<T>(task: () => Promise<T>): Promise<T> {
  return enqueue(task);
}
```

and add under it:

```ts
/**
 * The next table name, from the SAME counter the builds use.
 *
 * A derived layer's table is created by the RUN, inside the run's own FIFO
 * slot — `enqueueLayerTable` goes through `enqueue` (see {@link dropLayerTable}
 * for the same reason), and enqueueing from inside the queue is a deadlock.
 * The name still has to come from here: a second counter would eventually mint
 * a `layer_N` an ordinary build is about to use, and the collision would be a
 * silent `CREATE OR REPLACE` over a live table.
 *
 * Call it from INSIDE a queued task only, like {@link adoptLayerTable}.
 */
export function nextTableName(): string {
  return `layer_${++counter}`;
}

/**
 * Adopt a table that was built OUTSIDE this module's build path.
 *
 * The derived layer's one door (Design decision (f)). It seeds the registry
 * and the store as `ready`, so nothing rebuilds it, nothing retries it, and
 * `getLayerTable` answers for it exactly as for a built table.
 *
 * Note what it does NOT do: no `enqueue`, no DESCRIBE, no source parking. The
 * caller has just created the table and knows its shape; a round trip here
 * would have to be awaited, and the publication is one SYNCHRONOUS step.
 */
export function adoptLayerTable(layerId: string, info: LayerTable): void {
  registry.set(layerId, info);
  setState(layerId, { state: "ready", info });
}
```

- [ ] **Step 4: Run it and watch it pass, then sweep the SEVEN `layerTables` mock factories**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/insights/layerTablesBuild.test.ts
```

Expected: PASS. Then add both names to each `vi.mock(".../insights/layerTables", …)` factory — the module under test imports them once `deriveLayer.ts` does (and `runQueue.ts` imports `deriveLayer.ts`), and a factory without them throws `No "nextTableName" export is defined on the mock`.

**There are SEVEN, not the six the Global Constraints counted on `develop`**: Task 11 authored an eighth-of-its-own — `tests/unit/features/processing/crossLayerRun.test.ts` — which mocks this module for the queue's own suite, and Task 22 wires the New-layer branch into the same `execute` that suite drives. `grep -rln 'vi.mock(.*insights/layerTables' tests/` before starting is the check; the number the Global Constraints quote is the `develop` baseline and this milestone moved it by one.

```ts
    nextTableName: vi.fn(() => `layer_${++mockTableCounter}`),
    adoptLayerTable: vi.fn((layerId: string, info: unknown) => {
      adopted.set(layerId, info);
    }),
```

In `runQueue.test.ts` and `roofMetricsRun.test.ts` back them with two module-level test fixtures so a case can assert on them:

```ts
/** Tables `adoptLayerTable` was handed, by layer id. */
const adopted = new Map<string, unknown>();
let mockTableCounter = 100;
```

and reset both in `beforeEach`. The remaining five (`crossLayerRun.test.ts` included) may use the same two lines with a throwaway map.

Also add `sourceFeatureIds: null` (and, from Task 5, `extension: null` / `sourceBytes: null`) to every `LayerTable` literal in `tests/` — `tsc` names them; the list is `runQueue.test.ts`, `roofMetricsRun.test.ts`, `scope.test.ts`, `mapFilterSync.test.ts`, `layerTablesBuild.test.ts`, `StatsTabDuckdb.test.tsx`, `CatalogueView.test.tsx`, `engineStopped.test.tsx`, `extensionChip.test.tsx`, `roofLayerFixture.tsx`, `ToolView.test.tsx`, `useToolForm.test.tsx`, `styleByResult.test.tsx` (Task 9's `addLayer` helper builds one), `ExportDialog.test.tsx`, `TablePanel.test.tsx`, `useLayerCounts.test.tsx`, `useLayerQuery.test.tsx`.

- [ ] **Step 5: Write the failing test for `Layer.derivedFrom` and `insertAfterId`**

Add to `tests/unit/features/layers/layerStore.test.ts`, with one helper beside its existing `makeModel` / `modelWithTypes`:

```ts
/** `addLayer`'s minimum input, named — every case below differs only in name. */
function input(name: string) {
  return {
    name,
    model: makeModel(),
    modelRef: { type: "file" as const, fileName: "a.city.json" },
    visible: true,
    rules: [],
  };
}

describe("a derived layer's row", () => {
  it("records its parent, and every other layer records none", () => {
    const parent = useLayerStore.getState().addLayer(input("Delft"));
    const child = useLayerStore.getState().addLayer({
      ...input("Delft · extent"),
      derivedFrom: { layerId: parent, layerName: "Delft", runId: "run_3" },
    });
    const layers = useLayerStore.getState().layers;
    expect(layers.find((l) => l.id === parent)?.derivedFrom).toBeNull();
    expect(layers.find((l) => l.id === child)?.derivedFrom).toEqual({
      layerId: parent,
      layerName: "Delft",
      runId: "run_3",
    });
  });

  it("is INSERTED directly under its target, not appended (§6.2)", () => {
    const a = useLayerStore.getState().addLayer(input("A"));
    const b = useLayerStore.getState().addLayer(input("B"));
    const derived = useLayerStore
      .getState()
      .addLayer({ ...input("A · extent"), insertAfterId: a });
    expect(useLayerStore.getState().layers.map((l) => l.id)).toEqual([
      a,
      derived,
      b,
    ]);
  });

  it("appends when `insertAfterId` names a layer that is not there", () => {
    // The target was removed between Run and publication. Appending is the
    // honest fallback: the layer still exists and is still findable.
    const a = useLayerStore.getState().addLayer(input("A"));
    const derived = useLayerStore
      .getState()
      .addLayer({ ...input("A · extent"), insertAfterId: "gone" });
    expect(useLayerStore.getState().layers.map((l) => l.id)).toEqual([
      a,
      derived,
    ]);
  });

  it("does not leak `insertAfterId` onto the record", () => {
    // It is an instruction to the store, not a field of a layer — and the row
    // is spread from the input, so it would otherwise ride along into the
    // snapshot's field list and into every `Layer` comparison.
    const a = useLayerStore.getState().addLayer(input("A"));
    useLayerStore.getState().addLayer({ ...input("B"), insertAfterId: a });
    expect(Object.keys(useLayerStore.getState().layers[1]!)).not.toContain(
      "insertAfterId",
    );
  });
});
```

The file's `beforeEach` already resets `layers`; these cases need nothing else.

- [ ] **Step 6: Run it and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/layers/layerStore.test.ts
```

Expected: FAIL — `expected undefined to be null` on the first case, and the order assertion fails with `[a, b, derived]`.

- [ ] **Step 7: Add `derivedFrom` and `insertAfterId` to the store**

In `src/features/layers/layerStore.ts`:

1. The shape, above `export interface Layer`:

```ts
/**
 * Where a DERIVED layer came from (spec §6, "What a derived layer is").
 *
 * `layerName` is a COPY of the parent's name at publication, not a live read:
 * §6.2's state line says "Derived from Delft" and the parent may be renamed or
 * removed afterwards — "a derived layer is independent of its parent from
 * publication on". `runId` is what the layer row's "Show run log" opens, and
 * what §6.2's Undo block scans the history for.
 */
export interface DerivedFrom {
  readonly layerId: string;
  readonly layerName: string;
  readonly runId: string;
}
```

2. The field on `Layer`, after `selectedAppearance`:

```ts
  readonly selectedAppearance: AppearanceTheme | null;
}
```

becomes

```ts
  readonly selectedAppearance: AppearanceTheme | null;
  /**
   * Null for every ordinary layer. REQUIRED rather than optional, so the
   * snapshot filter, the state line and the layer-list marker are all reading
   * a field the compiler made every fixture answer for. NOT added to
   * `App.tsx`'s explicit serialisation list — a derived layer is omitted from
   * the snapshot entirely (§8), so this field is not persisted by
   * construction.
   */
  readonly derivedFrom: DerivedFrom | null;
}
```

3. `addLayer`'s input: add `"derivedFrom"` to the `Omit` union (beside `"isStreaming"`) and the two optional fields to the intersection. Find:

```ts
      /** Defaults to false. Set true for a layer opened via viewport
       *  streaming (Task 17's `openStreamingLayer`) — its `model` is a stub
       *  (bbox only, empty objects) rather than a fully-parsed model. */
      readonly isStreaming?: boolean;
```

and insert under it:

```ts
      /** Defaults to null. Supplied only by a New-layer run's publication
       *  (Tasks 21 and 23). */
      readonly derivedFrom?: DerivedFrom | null;
      /**
       * Insert directly AFTER this layer instead of appending (spec §6.2: the
       * derived layer is "inserted directly under its target in the layer
       * list"). An id that is not in the list appends, which is what a target
       * removed between Run and publication leaves behind.
       */
      readonly insertAfterId?: string;
```

4. The push becomes a splice, and the record gains the field. Two edits to the one `set` call.

First, `insertAfterId` must not ride into the row: the record is built by spreading `input`, so it would otherwise become a `Layer` field. Above the `set`, beside the existing `const colorBy = normalizeColorBy(input);`, add:

```ts
// An INSTRUCTION to the store, not a field of a layer — pulled out of the
// input so the spread below cannot carry it into the record (and thence
// into every `Layer` comparison and the snapshot's field list).
const { insertAfterId, ...rest } = input;
```

Then find:

```ts
    set((state) => ({
      layers: [
        ...state.layers,
        {
          ...input,
          id,
```

and rewrite the `set` so the literal is a NAMED, fully typed record and the array is spliced. The literal itself keeps every line it has today (with `...rest` in place of `...input`), plus one:

```ts
set((state) => {
  // Typed `: Layer`, not `as Layer`: this is the one construction site of
  // the record, and the annotation is what makes a new REQUIRED field
  // (`derivedFrom`) a compile error here rather than an undefined at
  // runtime.
  const record: Layer = {
    ...rest,
    id,
    selectedLod,
    availableLods,
    lodMode: "auto",
    cameraSync: true,
    isStreaming: input.isStreaming ?? false,
    derivedFrom: input.derivedFrom ?? null,
    hiddenTypes: input.hiddenTypes ?? [],
    attributeOrders: normalizeAttributeOrders(input.attributeOrders),
    visibleObjectIds: null,
    availableObjectTypes: input.isStreaming
      ? []
      : computeAvailableObjectTypes(input.model),
    appearanceThemes,
    selectedAppearance,
    ...colorBy,
  };
  // §6.2: a derived layer is "inserted directly under its target in the
  // layer list". `insertAfterId` is the ONLY way this is not an append, so
  // every existing caller keeps append semantics and there is exactly one
  // splice site. An id that is not in the list appends — which is what a
  // target removed between Run and publication leaves behind.
  const at =
    insertAfterId === undefined
      ? -1
      : state.layers.findIndex((l) => l.id === insertAfterId);
  if (at < 0) return { layers: [...state.layers, record] };
  const next = [...state.layers];
  next.splice(at + 1, 0, record);
  return { layers: next };
});
```

(The comments the existing literal carries on `cameraSync`, `visibleObjectIds` and `availableObjectTypes` are kept verbatim; they are elided above only to keep the diff readable.)

- [ ] **Step 8: Run, sweep the 12 `Layer` fixtures, commit the field**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/layers/layerStore.test.ts
npx tsc -b --noEmit
```

`tsc` names each of the 12 files listed above; add `derivedFrom: null` to each fixture. Then:

```bash
# The full suite in the BACKGROUND with its output to a file, per the M2
# process rule — and WAITED on, because the commit below must not be made on
# an unknown result.
npx vitest run > /tmp/m3-task21-sweep.log 2>&1 &
wait $!; echo "suite: $?"
git add src/features/layers/layerStore.ts tests/
git commit -m "chore: every layer records whether it was derived"
```

Expected: `suite: 0`. A non-zero status is a failing sweep, not a flake: `tsc` named every fixture and one of them was missed.

This is the sweep the plan's Design decision (g) budgets as its own commit, so the feature commit below is reviewable without 12 one-line fixture edits in it.

- [ ] **Step 9: Write the failing test for scope "all" on a derived table**

Add to `tests/unit/features/processing/scope.test.ts`, using that file's own helpers — the module-level `table` CONST, `countOnce(n)` (which queues the FEATURE count as the next `runQuery` answer) and `nothingSelected`:

```ts
describe("scope 'all' on a DERIVED table", () => {
  it("resolves to the table's OWN row ids, not to null", async () => {
    // `featureIds: null` reaches `readSource` as "no filter", and the reader
    // would then re-read the parent WHOLE. A table that knows which features
    // it was cut from answers with its own rows — roots AND parts, because
    // that is what the write touches.
    countOnce(2);
    vi.mocked(duck.runQuery).mockResolvedValueOnce({
      ok: true,
      columns: ["id"],
      rows: [{ id: "a" }, { id: "a-1" }, { id: "b" }],
    });
    const out = await resolveScope({
      table: { ...table, sourceFeatureIds: ["a", "b"] },
      scope: "all",
      snapshot: nothingSelected,
    });
    expect(out).toEqual({
      ok: true,
      featureIds: ["a", "a-1", "b"],
      count: 2,
      total: 2,
    });
    // ROWS, not roots: `SELECT "id"`, with no `AS f` and no WHERE.
    expect(vi.mocked(duck.runQuery).mock.calls[1]?.[0]).toBe(
      'SELECT "id" FROM "layer_1"',
    );
  });

  it("still answers null for an ORDINARY table", async () => {
    countOnce(2);
    const out = await resolveScope({
      table: { ...table, sourceFeatureIds: null },
      scope: "all",
      snapshot: nothingSelected,
    });
    expect(out).toEqual({ ok: true, featureIds: null, count: 2, total: 2 });
  });

  it("refuses an EMPTY derived table rather than sending `IN ()`", async () => {
    countOnce(0);
    vi.mocked(duck.runQuery).mockResolvedValueOnce({
      ok: true,
      columns: ["id"],
      rows: [],
    });
    const out = await resolveScope({
      table: { ...table, sourceFeatureIds: ["a"] },
      scope: "all",
      snapshot: nothingSelected,
    });
    expect(out).toEqual({
      ok: false,
      message: "Nothing to run on (0 buildings)",
    });
  });
});
```

The module-level `table` const gains `extension: null`, `sourceBytes: null` (Task 5) and `sourceFeatureIds: null` in the same edit — `tsc` asks for them.

- [ ] **Step 10: Run it and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing/scope.test.ts
```

Expected: FAIL — the first case gets `featureIds: null`.

- [ ] **Step 11: Teach `resolveScope` about `sourceFeatureIds`**

In `src/features/processing/scope.ts`, find:

```ts
const total = await countFeatures(input.table.table);
if (!total.ok) return { ok: false, message: total.message };
if (where === null) {
  return {
    ok: true,
    featureIds: null,
    count: total.count,
    total: total.count,
  };
}
```

and replace with:

```ts
const total = await countFeatures(input.table.table);
if (!total.ok) return { ok: false, message: total.message };
if (where === null) {
  // A DERIVED layer's table holds a SUBSET of its parent's source, and
  // "every row" is a different question there: `featureIds: null` travels to
  // `readSource` and the CityParquet export as "no filter", and the reader
  // would re-read the PARENT whole. A table that knows the features it was
  // cut from therefore answers with its own ROW ids — roots AND parts,
  // because that is what a write touches — and every executor,
  // `buildProxySql` and `buildSolidMeasureSql` need no change at all.
  const cut = input.table.sourceFeatureIds;
  if (cut !== null) {
    const rows = await runQuery(
      `SELECT "id" FROM ${quoteIdent(input.table.table)}`,
    );
    if (!rows.ok) return { ok: false, message: rows.message };
    const featureIds = rows.rows.map((r) => String(r.id));
    if (featureIds.length === 0)
      return { ok: false, message: "Nothing to run on (0 buildings)" };
    return {
      ok: true,
      featureIds,
      count: total.count,
      // The list the table was CUT with, which is the honest denominator for
      // "312 of 1,115" — the parent's count would describe another layer.
      total: cut.length,
    };
  }
  return {
    ok: true,
    featureIds: null,
    count: total.count,
    total: total.count,
  };
}
```

and, in `src/features/processing/runQueue.ts`, one line so the provenance tooltip does not start reading "312 of 312 buildings in this run" on every derived layer. After Task 18 this `partial` lives inside the shared `publishProvenance` helper rather than inline in `execute` — same expression, one indent level out, with `scope` its parameter. Find:

```ts
        partial:
          scope.featureIds === null
            ? null
            : { count: scope.count, total: scope.total },
```

and replace with:

```ts
        // A derived layer's scope "all" now resolves to ITS OWN row ids rather
        // than null (`resolveScope`, Task 21), so "kept no id list" is no
        // longer the same question as "covered the whole layer". Compared on
        // the COUNTS, which is what the tooltip is about.
        partial:
          scope.featureIds === null || scope.count >= scope.total
            ? null
            : { count: scope.count, total: scope.total },
```

- [ ] **Step 12: Run it and watch it pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing/scope.test.ts tests/unit/features/processing/runQueue.test.ts
```

Expected: PASS.

- [ ] **Step 13: Write the failing test for `prepareDerivedCityLayer`**

`tests/unit/features/processing/deriveLayer.test.ts` gains mocks and a second `describe`. Its Task-20 imports become `await import(…)` so the factories hoist above them, and the file gains at the top:

```ts
/** Every statement the preparation sent, in order. */
const sql: string[] = [];
/** Tables `adoptLayerTable` was handed, by layer id. */
const adopted = new Map<string, unknown>();

vi.mock("../../../../src/insights/duckdb", () => {
  const run = async (statement: string) => {
    sql.push(statement);
    if (statement.includes('COALESCE("feature_id", "id") AS f')) {
      return { ok: true as const, columns: ["f"], rows: [{ f: "a" }] };
    }
    return { ok: true as const, columns: [], rows: [] };
  };
  return {
    runQuery: vi.fn(run),
    ddl: vi.fn(run),
    registerBuffer: vi.fn(async () => true),
    dropBuffer: vi.fn(async () => {}),
    subscribeDuckDBStatus: vi.fn(() => () => {}),
    onEngineDeath: vi.fn(() => () => {}),
    getDuckDBStatusVersion: vi.fn(() => 0),
    getEngineGeneration: vi.fn(() => 1),
    getDuckDBStatus: vi.fn(() => ({
      state: "ready",
      extensions: {},
      loadedExtensions: [],
      platform: null,
    })),
    isExtensionLoaded: vi.fn(() => true),
    ensureExtension: vi.fn(async () => true),
    formatDuckDBError: (e: unknown) => String(e),
    readFile: vi.fn(async () => null),
    queryDuckDB: vi.fn(async () => null),
    queryParquetBuffer: vi.fn(async () => null),
    initDuckDB: vi.fn(async () => {}),
  };
});

vi.mock("../../../../src/insights/layerTables", async () => {
  const { create } = await import("zustand");
  const store = create<{ tables: Record<string, unknown> }>(() => ({
    tables: {},
  }));
  let n = 100;
  // ONE chain, exactly like the real queue — that is what makes the "takes no
  // slot of its own" case below a real regression: a nested enqueue would wait
  // for a slot the preparation is holding, and the case would time out.
  let chain: Promise<unknown> = Promise.resolve();
  return {
    useLayerTableStore: store,
    getLayerTable: vi.fn(() => null),
    runOnTableQueue: vi.fn(<T>(task: () => Promise<T>): Promise<T> => {
      const next = chain.then(task, task);
      chain = next.then(
        () => {},
        () => {},
      );
      return next;
    }),
    // Present so the case below can assert it was never called; the real one
    // would deadlock here.
    enqueueLayerTable: vi.fn(async () => {}),
    refreshLayerTableColumns: vi.fn(async () => {}),
    nextTableName: vi.fn(() => `layer_${++n}`),
    adoptLayerTable: vi.fn((layerId: string, info: unknown) => {
      adopted.set(layerId, info);
    }),
  };
});
```

then the cases:

```ts
const { prepareDerivedCityLayer } =
  await import("../../../../src/features/processing/deriveLayer");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useWorkspaceStore } =
  await import("../../../../src/features/workspace/workspaceStore");
const { useComputedColumnStore } =
  await import("../../../../src/insights/computedColumns");
const { runQuery } = await import("../../../../src/insights/duckdb");

function parentLayer(): Layer {
  return useLayerStore.getState().layers[0]!;
}

function seedParent(): string {
  // The bboxes are REAL and SEPARATED: `b` sits 100 m away from `a`, so a copy
  // that kept the parent's envelope is visibly different from one that
  // computed its own (the "Zoom to layer" case below).
  return useLayerStore.getState().addLayer({
    name: "Delft",
    model: {
      sourceEncoding: "cityjson",
      metadata: {},
      bbox: [0, 0, 0, 110, 110, 9],
      objects: {
        a: {
          id: "a",
          objectType: "Building",
          attributes: { height: 9 },
          surfaces: [],
          bbox: [0, 0, 0, 10, 10, 9],
          children: ["a-1"],
          parents: [],
          lod: null,
        },
        "a-1": {
          id: "a-1",
          objectType: "BuildingPart",
          attributes: {},
          surfaces: [],
          bbox: [0, 0, 0, 10, 10, 9],
          children: [],
          parents: ["a"],
          lod: null,
        },
        b: {
          id: "b",
          objectType: "Building",
          attributes: {},
          surfaces: [],
          bbox: [100, 100, 0, 110, 110, 6],
          children: [],
          parents: [],
          lod: null,
        },
      },
      vertexCount: 0,
    } as unknown as CityModel,
    modelRef: { type: "url", url: "https://x/delft.city.json" },
    visible: true,
    rules: [],
  });
}

const parentTable = () => ({
  table: "layer_1",
  sourceName: "layer_1.city.json",
  source: async () => new Uint8Array(),
  reader: "read_cityjson" as const,
  extension: "city.json" as const,
  sourceBytes: 1234,
  sourceFeatureIds: null,
  columns: [
    { name: "id", type: "VARCHAR", kind: "scalar" as const },
    { name: "feature_id", type: "VARCHAR", kind: "scalar" as const },
  ],
  lods: [{ label: "2.2", suffix: "2_2" }],
  rowCount: 3,
});

async function prepare(rowIds: ReadonlyArray<string> | null) {
  return await prepareDerivedCityLayer({
    runId: "run_7",
    parent: parentLayer(),
    parentTable: parentTable(),
    name: "Delft · extent",
    rowIds,
    columns: [{ name: "extent_height_m", type: "DOUBLE" as const }],
    rows: new Map([["a", { extent_height_m: 9 }]]),
    signal: new AbortController().signal,
    // Straight at the mocked primitive, so the roots query gets the fake's
    // `AS f` answer and the CTAS is built from real ids. A fake that returned
    // `rows: []` for everything would make the CTAS `IN ()` and the assertion
    // below pass for the wrong reason.
    query: async (_label, statement) => await runQuery(statement),
  });
}

beforeEach(() => {
  sql.length = 0;
  adopted.clear();
  useLayerStore.setState({ layers: [] });
  useWorkspaceStore.setState({ activeLayerId: null });
  useComputedColumnStore.setState({ byLayer: {} });
  seedParent();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("prepareDerivedCityLayer", () => {
  it("cuts the copy from the PARENT'S TABLE, by feature ROOT", async () => {
    await prepare(["a", "a-1"]);
    // Not `"id" IN (…)`: §6's copy holds the scoped FEATURES, and a feature is
    // its root plus its parts (Design decision (f)).
    expect(
      sql.some((s) =>
        /^CREATE TABLE "layer_\d+" AS SELECT \* FROM "layer_1" WHERE COALESCE\("feature_id", "id"\) IN \('a'\)$/.test(
          s,
        ),
      ),
    ).toBe(true);
    // NOT through the reader: re-reading a 300 MB CityJSON for rows the engine
    // already holds is a minute of parsing for nothing, and a CityGML parent
    // has no reader at all.
    expect(sql.some((s) => s.includes("read_cityjson("))).toBe(false);
  });

  it("publishes NOTHING before publish()", async () => {
    await prepare(["a", "a-1"]);
    expect(useLayerStore.getState().layers).toHaveLength(1);
    expect(adopted.size).toBe(0);
  });

  it("publishes the table, the row and the activation in ONE step", async () => {
    const parentId = parentLayer().id;
    const plan = await prepare(["a", "a-1"]);
    const id = plan.publish();
    const layers = useLayerStore.getState().layers;
    expect(layers.map((l) => l.name)).toEqual(["Delft", "Delft · extent"]);
    expect(layers[1]?.derivedFrom).toEqual({
      layerId: parentId,
      layerName: "Delft",
      runId: "run_7",
    });
    expect(adopted.has(id)).toBe(true);
    expect(useWorkspaceStore.getState().activeLayerId).toBe(id);
  });

  it("makes the copy reader-backed, filtered to the roots it was cut with", async () => {
    const plan = await prepare(["a", "a-1"]);
    const id = plan.publish();
    expect(adopted.get(id)).toMatchObject({
      reader: "read_cityjson",
      extension: "city.json",
      lods: [{ label: "2.2", suffix: "2_2" }],
      sourceFeatureIds: ["a"],
    });
  });

  it("describes the copy's table WITH the columns just written into it", async () => {
    // The `ALTER`s have already changed the table's shape; an adopted `info`
    // carrying only the parent's list would hide the new columns from the
    // grid and let the NEXT run's Undo drop them as if it had created them.
    const plan = await prepare(["a", "a-1"]);
    const id = plan.publish();
    const columns = (adopted.get(id) as { columns: Array<{ name: string }> })
      .columns;
    expect(columns.map((c) => c.name)).toEqual([
      "id",
      "feature_id",
      "extent_height_m",
    ]);
  });

  it("copies only the SCOPED objects into the model, with the new values", async () => {
    const plan = await prepare(["a", "a-1"]);
    plan.publish();
    const model = useLayerStore.getState().layers[1]!.model;
    expect(Object.keys(model.objects).sort()).toEqual(["a", "a-1"]);
    expect(model.objects.a?.attributes).toMatchObject({
      height: 9,
      extent_height_m: 9,
    });
    // The PARENT is untouched: §6, "the run leaves the target untouched".
    expect(
      useLayerStore.getState().layers[0]!.model.objects.a?.attributes,
    ).toEqual({ height: 9 });
  });

  it("carries the parent's provenance across for inherited columns", async () => {
    const parentId = parentLayer().id;
    useComputedColumnStore.getState().setProvenance(parentId, "roof_area_m2", {
      runId: "run_1",
      toolName: "Roof metrics to attributes",
      summary: "All 2 buildings",
      at: 1,
      partial: null,
      previous: null,
    });
    const plan = await prepare(["a", "a-1"]);
    const id = plan.publish();
    // §6: "inherited computed columns keep their provenance".
    expect(
      useComputedColumnStore.getState().byLayer[id]?.["roof_area_m2"]?.toolName,
    ).toBe("Roof metrics to attributes");
  });

  it("re-checks the name AT publication and appends ' (2)' (§10.12)", async () => {
    const plan = await prepare(["a", "a-1"]);
    // The rename lands while the run is queued — after `prepare`, before
    // `publish`. This is the whole reason the check is inside `publish()`.
    useLayerStore
      .getState()
      .updateLayer(parentLayer().id, { name: "Delft · extent" });
    const id = plan.publish();
    expect(useLayerStore.getState().layers.find((l) => l.id === id)?.name).toBe(
      "Delft · extent (2)",
    );
    // `plan.name` still says what was ASKED for, so the caller can tell the
    // two apart and put §10.12's sentence on the card.
    expect(plan.name).toBe("Delft · extent");
  });

  it("drops the half-built table on discard, and publishes nothing", async () => {
    const plan = await prepare(["a", "a-1"]);
    await plan.discard();
    expect(sql.some((s) => /^DROP TABLE IF EXISTS "layer_\d+"$/.test(s))).toBe(
      true,
    );
    expect(useLayerStore.getState().layers).toHaveLength(1);
    expect(adopted.size).toBe(0);
  });

  it("copies the WHOLE parent table and keeps no filter for scope 'all'", async () => {
    await prepare(null);
    expect(
      sql.some((s) =>
        /^CREATE TABLE "layer_\d+" AS SELECT \* FROM "layer_1"$/.test(s),
      ),
    ).toBe(true);
  });

  it("gives the copy its OWN envelope, not the parent's", async () => {
    // `CityModelMesh.getBoundsGeodetic()` reads `model.bbox`
    // (`cityModelMesh.ts:675-687`), and that is what `fitLayer` — §6.2's "Zoom
    // to layer" — frames. A copy that kept `{ ...parent.model }`'s bbox would
    // fly the camera to the PARENT's extent: for a subset of one building in a
    // city, a view of the whole city with the layer somewhere in it.
    const plan = await prepare(["a", "a-1"]);
    plan.publish();
    expect(useLayerStore.getState().layers[1]!.model.bbox).toEqual([
      0, 0, 0, 10, 10, 9,
    ]);
    // Scope "all" copies every object, so the parent's own envelope IS the
    // copy's and no walk is needed.
    const whole = await prepare(null);
    whole.publish();
    expect(useLayerStore.getState().layers[2]!.model.bbox).toEqual([
      0, 0, 0, 110, 110, 9,
    ]);
  });

  it("copies a MANUAL LoD choice, mode included (§6.2)", async () => {
    // `addLayer` derives `selectedLod` from the model and hard-codes
    // `lodMode: "auto"`, and `setLayerLod` does not touch the mode
    // (`layerStore.ts:432-437`) — so a copy that set only the LoD would sit in
    // auto mode and re-derive it on the next model change. §6.2 asks for "an
    // independent COPY of the target's LoD choice".
    const parentId = parentLayer().id;
    useLayerStore.getState().setLayerLod(parentId, "1.2");
    useLayerStore.getState().setLodMode(parentId, "manual");
    const plan = await prepare(["a", "a-1"]);
    const id = plan.publish();
    const copy = useLayerStore.getState().layers.find((l) => l.id === id);
    expect(copy?.selectedLod).toBe("1.2");
    expect(copy?.lodMode).toBe("manual");
  });

  it("takes no table-queue slot of its own — the run already holds one", async () => {
    // The deadlock Design decision (f) calls a hard fact: `enqueueLayerTable`
    // goes through the same `enqueue` the run is already inside, so a build
    // started here would wait for a slot this run is holding and the page
    // would freeze with no other symptom. Asserted BEHAVIOURALLY — the
    // preparation is run INSIDE a slot of the mocked queue (one chain, like
    // the real one) and must ask for neither a build nor a second slot. A
    // source-text assertion cannot be used: the module's own doc comment
    // contains the word `enqueueLayerTable`, which is where the rule is
    // written down.
    const tables = await import("../../../../src/insights/layerTables");
    const plan = await tables.runOnTableQueue(() => prepare(["a", "a-1"]));
    expect(tables.enqueueLayerTable).not.toHaveBeenCalled();
    expect(vi.mocked(tables.runOnTableQueue)).toHaveBeenCalledTimes(1);
    // And the publication takes none either: it is one synchronous step.
    plan.publish();
    expect(tables.enqueueLayerTable).not.toHaveBeenCalled();
    expect(vi.mocked(tables.runOnTableQueue)).toHaveBeenCalledTimes(1);
    // The slot really was given back — a second one is reachable.
    await tables.runOnTableQueue(async () => undefined);
  });
});
```

(No `node:fs` import: the file reads no source text. `vi.clearAllMocks()` in
the suite's `afterEach` resets the two call counts the last case asserts on.)

- [ ] **Step 14: Run it and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing/deriveLayer.test.ts
```

Expected: FAIL — `prepareDerivedCityLayer is not a function`.

- [ ] **Step 15: Add `DerivedPlan` and `prepareDerivedCityLayer` to `deriveLayer.ts`**

Append to `src/features/processing/deriveLayer.ts` (the name rules from Task 20 stay exactly as they are), with the imports it needs added at the top:

```ts
import { runQuery, type QueryOutcome } from "../../insights/duckdb";
import { raced } from "../../insights/engineAwait";
import {
  useComputedColumnStore,
  writeComputedColumns,
  type OutputColumn,
} from "../../insights/computedColumns";
import {
  adoptLayerTable,
  nextTableName,
  type LayerTable,
} from "../../insights/layerTables";
import { quoteIdent, quoteLiteral } from "../../insights/sql";
import { activateLayer } from "../workspace/layerCoordination";
import { selectedObjectBounds } from "../../scene/selectedObjectBounds";
import type { CityModel, CityObject } from "../../domain/citymodel/types";
```

(`selectedObjectBounds` is pure and engine-free — one type import from
`@cityjson/navara-core` — and `features/` already imports from `scene/`
(`geoLayers/categorize.ts:26-29`). It is the app's one "envelope of these
objects and their parts" walk, and a second copy here would be the second
answer to the question `fitLayer` asks.)

and Task 20's two type-only imports become value imports of the same modules — ONE import line each, or `vp check`'s no-duplicate-imports rule fails:

```ts
import { useGeoLayerStore, type GeoLayer } from "../geoLayers/geoLayerStore";
import { useLayerStore, type Layer } from "../layers/layerStore";
```

```ts
/**
 * A derived layer that EXISTS but is not yet visible (spec §6.1).
 *
 * "For New layer, the results, the model copy, its table and the layer row are
 * all prepared first and published together as the last step. A cancel (or a
 * failure) that lands BEFORE publication discards every partial resource … and
 * the run reads cancelled with nothing changed."
 *
 * So the preparation returns a plan rather than a layer id: everything costly
 * has happened, nothing anyone can see has.
 */
export interface DerivedPlan {
  readonly name: string;
  /** Publishes model + table + layer row as ONE step; returns the new layer id. */
  publish(): string;
  /** Every partial resource, discarded when a cancel or a failure lands first. */
  discard(): Promise<void>;
}

/**
 * Build a derived CITY layer's table, model copy and row — without publishing
 * any of them (Design decision (f)).
 *
 * THE COPY IS CUT FROM THE PARENT'S TABLE, NOT FROM ITS SOURCE. Re-reading a
 * 300 MB CityJSON to produce rows the engine already holds is a minute of
 * parsing for nothing, and it would need a reader — which a CityGML or
 * CityParquet parent does not have, forcing a second code path for them. One
 * `CREATE TABLE … AS SELECT * FROM <parent> WHERE …` works for every parent
 * kind, brings the parent's own computed columns across WITH their values, and
 * needs no geometry-column filtering because the browsing table never had
 * geometry columns (`isDroppedColumn`).
 *
 * READER-BACKEDNESS IS THEN METADATA PLUS A FILTER: the new `LayerTable` copies
 * the parent's `source`, `reader`, `extension` and `lods` verbatim and sets
 * `sourceFeatureIds` to the root ids it was cut with.
 *
 * CALLED FROM INSIDE THE RUN'S OWN FIFO SLOT. `enqueueLayerTable` must not
 * appear in this module: it goes through the same queue, and enqueueing from
 * inside the queue is a deadlock.
 */
export async function prepareDerivedCityLayer(input: {
  readonly runId: string;
  readonly parent: Layer;
  readonly parentTable: LayerTable;
  readonly name: string;
  readonly rowIds: ReadonlyArray<string> | null;
  readonly columns: ReadonlyArray<OutputColumn>;
  readonly rows: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  readonly signal: AbortSignal;
  readonly query: (label: string, sql: string) => Promise<QueryOutcome>;
}): Promise<DerivedPlan> {
  const parentTableName = input.parentTable.table;
  const table = nextTableName();

  // THE FILTER IS OVER FEATURE ROOTS, NOT ROWS. §6's copy holds "the SCOPED
  // features … with their geometry at every LoD", and a feature is its root
  // plus its parts. The same list becomes `sourceFeatureIds`, which is what
  // makes the reader re-read the parent filtered to exactly these.
  let roots: ReadonlyArray<string> | null = null;
  if (input.rowIds !== null) {
    const out = await input.query(
      "Selecting the copy's features",
      `SELECT DISTINCT COALESCE("feature_id", "id") AS f FROM ${quoteIdent(
        parentTableName,
      )} WHERE "id" IN (${input.rowIds.map((id) => quoteLiteral(id)).join(", ")})`,
    );
    if (!out.ok) throw new Error(out.message);
    roots = out.rows.map((r) => String(r.f));
    // `IN ()` is a SYNTAX error in DuckDB, not an empty result. The scope
    // resolution already refuses an empty scope ("Nothing to run on"), so
    // reaching here means the parent's rows moved under the run.
    if (roots.length === 0) {
      throw new Error("Layer changed while running; run again");
    }
  }

  const where =
    roots === null
      ? null
      : `COALESCE("feature_id", "id") IN (${roots
          .map((id) => quoteLiteral(id))
          .join(", ")})`;
  const create = `CREATE TABLE ${quoteIdent(table)} AS SELECT * FROM ${quoteIdent(
    parentTableName,
  )}${where === null ? "" : ` WHERE ${where}`}`;

  /** Everything this function made, for {@link DerivedPlan.discard}. */
  const drop = async (): Promise<void> => {
    // RACED, and swallowed: the DROP is housekeeping inside a FIFO slot, and a
    // statement caught by the engine's death never answers — an unraced one
    // would hold the shared queue for the life of the page.
    await raced(
      runQuery(`DROP TABLE IF EXISTS ${quoteIdent(table)}`),
      null,
    ).catch(() => undefined);
  };

  try {
    const created = await input.query("Creating the new layer's table", create);
    if (!created.ok) throw new Error(created.message);

    // The run's own columns, written into the COPY. `existing` is empty, so
    // `writeComputedColumns` makes no backup table — Undo of a New-layer run
    // removes the layer (§6.2), it does not restore values.
    //
    // RACED against the engine's death for the reason `execute`'s own write is
    // (`runQueue.ts`'s `raced(writing, null)`): a transaction caught by the
    // death never answers, and this await is inside the shared FIFO slot.
    if (input.rows.size > 0) {
      const written = await raced(
        writeComputedColumns({
          runId: input.runId,
          table,
          columns: input.columns,
          rows: input.rows,
          existing: new Set<string>(),
          signal: input.signal,
        }),
        null,
      );
      if (!written.ok) throw new Error(written.message);
    }
  } catch (error) {
    await drop();
    throw error;
  }

  // The MODEL copy. `rowIds` is already the row set the new table holds
  // (`resolveScope` expanded the scope to whole features), so the objects to
  // keep need no graph walk — and the run's values are merged in here, which
  // is what makes §6.1's "computed columns live in the model too" true on a
  // derived layer as on an ordinary one.
  const keep =
    input.rowIds === null
      ? Object.keys(input.parent.model.objects)
      : input.rowIds;
  const objects: Record<string, CityObject> = {};
  for (const id of keep) {
    const object = input.parent.model.objects[id];
    if (object === undefined) continue;
    const values = input.rows.get(id);
    objects[id] =
      values === undefined
        ? object
        : { ...object, attributes: { ...object.attributes, ...values } };
  }
  const model: CityModel = {
    ...input.parent.model,
    objects,
    // THE COPY'S OWN ENVELOPE. `CityModelMesh.getBoundsGeodetic()` reads
    // `model.bbox` (`cityModelMesh.ts:675-687`) and that is what `fitLayer` —
    // §6.2's "Zoom to layer" — frames, so a copy that inherited the parent's
    // bbox would fly the camera to the PARENT's extent: for 312 buildings cut
    // out of 1,115, a view of the whole city with the layer somewhere inside
    // it. `selectedObjectBounds` walks the kept objects and their parts, which
    // is exactly the set the copy holds.
    //
    // Scope "all" keeps every object, so the parent's own envelope IS the
    // copy's and the walk is skipped; a subset whose objects carry no bbox at
    // all (nothing to union) falls back to the parent's rather than to the
    // null island `[0,0,0,0,0,0]` the mesh would otherwise frame.
    bbox:
      input.rowIds === null
        ? input.parent.model.bbox
        : (selectedObjectBounds({ objects }, Object.keys(objects)) ??
          input.parent.model.bbox),
  };

  // Minted HERE, not by `addLayer`, so the table can be adopted BEFORE the row
  // exists: a layer row that is visible for even one render without its table
  // is a layer the catalogue would offer tools against and the grid would find
  // nothing for.
  const layerId = crypto.randomUUID();
  const parent = input.parent;
  const info: LayerTable = {
    table,
    // Verbatim from the parent: this is what makes §6's promise true — "the
    // reader re-reads the parent source filtered to those ids", so every tool,
    // proxy and export format the parent supports works on the copy. A CityGML
    // or CityParquet parent carries nulls here and the copy inherits its
    // limitations, which is exactly what §6 asks for.
    sourceName: input.parentTable.sourceName,
    source: input.parentTable.source,
    reader: input.parentTable.reader,
    extension: input.parentTable.extension,
    sourceBytes: input.parentTable.sourceBytes,
    lods: input.parentTable.lods,
    // The parent's columns PLUS the ones just written into the copy. Copying
    // the parent's list alone would leave the adopted table describing a
    // shape the `ALTER`s above have already changed: the grid would not show
    // the new columns, and the NEXT run's "did this column already exist?"
    // check (`onTable` in `execute`) would classify them as new and let its
    // Undo drop them. Built here rather than DESCRIBEd, because `publish()`
    // is synchronous and the shape is known exactly.
    columns: [
      ...input.parentTable.columns.filter(
        (c) =>
          !input.columns.some(
            (out) => out.name.toLowerCase() === c.name.toLowerCase(),
          ),
      ),
      ...input.columns.map((c) => ({
        name: c.name,
        type: c.type,
        kind: "scalar" as const,
      })),
    ],
    rowCount:
      input.rowIds === null ? input.parentTable.rowCount : input.rowIds.length,
    sourceFeatureIds: roots,
  };

  return {
    name: input.name,
    publish(): string {
      adoptLayerTable(layerId, info);
      // §6: "inherited computed columns keep their provenance". The values came
      // across with the `SELECT *`; the registry entries have to be copied,
      // because it is keyed by layer id.
      const registry = useComputedColumnStore.getState();
      for (const [column, provenance] of Object.entries(
        registry.byLayer[parent.id] ?? {},
      )) {
        registry.setProvenance(layerId, column, provenance);
      }
      // The run's OWN columns get their provenance from `execute` (Task 22),
      // which is the only caller of `publish()` and the only place that knows
      // `tool.name` and the scope sentence. Nothing is written for them here.
      const store = useLayerStore.getState();
      // §6: "The name is re-checked at publication (a queued run or a rename in
      // between can take it): a conflict then gets ' (2)' appended". HERE and
      // nowhere else, because `publish()` is SYNCHRONOUS and inside the run's
      // own FIFO slot — nothing can take the name between this check and the
      // `addLayer` below. The caller reads the published name back off the
      // store to find out whether it was renamed (§10 scenario 12's card).
      const final = disambiguate(
        input.name,
        store.layers,
        useGeoLayerStore.getState().layers,
      );
      store.addLayer({
        id: layerId,
        name: final.name,
        model,
        modelRef: parent.modelRef,
        visible: true,
        // §6.2: "an independent COPY of the target's LoD choice, colour mode,
        // rules and palette (later edits on either side do not affect the
        // other)". Arrays are copied, never shared.
        rules: [...parent.rules],
        colorBy: parent.colorBy,
        singleColor: parent.singleColor,
        unmatchedColor: parent.unmatchedColor,
        selectedAppearance: parent.selectedAppearance,
        insertAfterId: parent.id,
        derivedFrom: {
          layerId: parent.id,
          layerName: parent.name,
          runId: input.runId,
        },
      });
      // `addLayer` derives `selectedLod` from the model and hard-codes
      // `lodMode: "auto"`; §6.2 wants "an independent COPY of the target's LoD
      // choice", and a choice is the LoD AND the mode. `setLayerLod` does not
      // touch the mode (`layerStore.ts:432-437`), so both setters are needed
      // or a manually chosen LoD comes back as an auto-derived one.
      if (parent.selectedLod !== null) {
        store.setLayerLod(layerId, parent.selectedLod);
      }
      if (parent.lodMode !== "auto") {
        store.setLodMode(layerId, parent.lodMode);
      }
      // §6.2: "it becomes the active layer through the ordinary activate rule
      // (which clears a selection belonging to another layer)".
      activateLayer(layerId);
      return layerId;
    },
    discard: drop,
  };
}
```

**`publish()` copies the INHERITED provenance and writes none of its own, deliberately.** `toolName` and `summary` are the RUN's, and only `execute` knows them — so Task 22 publishes them from there, through the same `publishProvenance` helper both This-layer paths use (Task 18), rather than a second copy of the rule inside this module. Until Task 22 lands, a derived layer's new columns carry no badge; that is visible only to this task's own tests, because nothing reachable creates a derived layer until Task 22 turns the destination on. Guessing the tool name here would be the worse intermediate state: a badge whose text no test pins.

- [ ] **Step 16: Run it and watch it pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing/deriveLayer.test.ts
```

Expected: PASS, all of Task 20's name cases plus the nine preparation cases.

- [ ] **Step 17: Keep the lifecycle away from a derived layer**

In `src/features/layers/layerTableLifecycle.ts`, find:

```ts
for (const layer of state.layers) {
  // A STATIC layer's table was enqueued by `addCityLayer`, which is the
  // only place that has its bytes. A STREAMING layer has none to give, so
  // it is enqueued here — empty at first, then rebuilt as cells land.
  if (!knownLayerIds.has(layer.id) && layer.isStreaming) {
    void enqueueLayerTable(layer.id, residentTableSource(layer.id));
  }
}
```

and replace with:

```ts
for (const layer of state.layers) {
  // A STATIC layer's table was enqueued by `addCityLayer`, which is the
  // only place that has its bytes. A STREAMING layer has none to give, so
  // it is enqueued here — empty at first, then rebuilt as cells land.
  //
  // A DERIVED layer is neither: its table was CREATED by the run that
  // published it and adopted straight into the registry
  // (`adoptLayerTable`), and rebuilding it from a resident set would
  // replace a cut of the parent with the parent's own rows. Excluded here
  // and in `sweepStreamingLayers` below by the same test.
  if (
    !knownLayerIds.has(layer.id) &&
    layer.isStreaming &&
    layer.derivedFrom === null
  ) {
    void enqueueLayerTable(layer.id, residentTableSource(layer.id));
  }
}
```

and, in `sweepStreamingLayers`, find:

```ts
    for (const layer of useLayerStore.getState().layers) {
      if (!layer.isStreaming) continue;
```

and replace with:

```ts
    for (const layer of useLayerStore.getState().layers) {
      if (!layer.isStreaming || layer.derivedFrom !== null) continue;
```

Add the regression to `tests/unit/features/layers/layerTableLifecycle.test.ts`:

```ts
it("never rebuilds a DERIVED layer's table from a resident set", () => {
  // `enqueued` is this file's own record of the mocked `enqueueLayerTable`,
  // and `layer(over)` its `Layer` fixture; the lifecycle is already
  // installed by the suite's `beforeEach`.
  useLayerStore.setState({
    layers: [
      layer({ id: "L1", isStreaming: true }),
      layer({
        id: "L2",
        isStreaming: true,
        derivedFrom: { layerId: "L1", layerName: "Delft", runId: "run_1" },
      }),
    ],
  });
  expect(enqueued).toContain("L1");
  expect(enqueued).not.toContain("L2");
  // And the consumer sweep leaves it alone too.
  enqueued.length = 0;
  useProcessingStore.getState().setOpen(true);
  expect(enqueued).not.toContain("L2");
});
```

- [ ] **Step 18: Run everything this task touched**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing tests/unit/features/layers tests/unit/insights
npx tsc -b --noEmit
npx vp check
```

Expected: PASS; `tsc` clean; `vp check` at 0 errors / 56 warnings. Then the whole suite, in the background to a file as the Global Constraints require — and waited on, so the commit is made on a known result:

```bash
npx vitest run > /tmp/m3-task21.log 2>&1 &
wait $!; echo "suite: $?"
```

Expected: `suite: 0`.

- [ ] **Step 19: Commit**

```bash
git add src/insights/layerTables.ts \
  src/features/processing/deriveLayer.ts \
  src/features/processing/scope.ts \
  src/features/processing/runQueue.ts \
  src/features/layers/layerTableLifecycle.ts \
  tests/
git commit -m "feat: prepare a derived city layer's model, table and row as one publication"
```
