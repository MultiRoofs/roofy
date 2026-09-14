### Task 4: Output columns carry their types

**Files:**

- Modify: `src/features/processing/types.ts` (`ToolDefinition.outputColumns`), `src/features/processing/roofMetricsParams.ts` (`roofColumnNames`), `src/features/processing/toolRegistry.ts` (the two entries that have columns), `src/ui/processing/useToolForm.ts`, `src/ui/processing/ToolView.tsx`
- Test: additions to `tests/unit/ui/processing/ToolView.test.tsx` and `tests/unit/ui/processing/useToolForm.test.tsx`; the existing `tests/unit/features/processing/roofMetricsParams.test.ts` is updated in the same commit (its `roofColumnNames` assertions are the ones the signature change moves)

**Interfaces:**

- Produces: `ToolDefinition.outputColumns?: (prefix: string, params: Readonly<Record<string, unknown>>) => ReadonlyArray<OutputColumn>` (was `=> string[]`); `useToolForm`'s `columns` becomes `ReadonlyArray<OutputColumn>`; `ToolView.tsx`'s `columns: f.columns.map((name) => ({ name, type: "DOUBLE" as const }))` becomes `columns: f.columns`. `roofColumnNames` and `height-from-extent`'s inline list return typed columns; the printed list is `f.columns.map((c) => c.name).join(", ")`.

**Behaviour is IDENTICAL today** — every existing column is DOUBLE — so the test is that the frozen request still carries the same names with the same types, and that the form still prints the same comma-separated line. What changes is that there is no longer a place outside the registry where a column's type is decided; Validate solids writes BOOLEAN (Task 10) and Join writes three types by inference (Task 16), and Task 9's `pick` is a rule about column TYPES.

`types.ts` gains a TYPE-ONLY import of `OutputColumn` from `src/insights/computedColumns.ts`. That is erased at compile time, so the module stays engine-free at runtime — which its header promises and which the pure eligibility tests depend on.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/ui/processing/useToolForm.test.tsx` a new top-level `describe` (the suite has no `renderHook`; every case there drives the hook through `<ToolView>`, and `readyTable(true)`/`addCityLayer` are its own helpers). These two are the derived lists that now read `.name` instead of the string itself — the replace warning and the source-collision error:

```ts
describe("the OUTPUT column list, typed (spec §7)", () => {
  it("still counts the columns that exist, over typed columns", () => {
    // `existing` is `columns.filter(c => onTable.has(c.name.toLowerCase()))`
    // after this task. A filter left on the OBJECT would match nothing and the
    // replace warning would silently stop appearing.
    const id = addCityLayer("Delft", true);
    useWorkspaceStore.getState().setActiveLayerId(id);
    useLayerTableStore.setState({
      tables: {
        ...useLayerTableStore.getState().tables,
        [id]: {
          state: "ready",
          info: {
            ...readyTableInfo(true),
            columns: [{ name: "roof_area_m2", type: "DOUBLE", kind: "scalar" }],
          },
        },
      },
    });
    useComputedColumnStore
      .getState()
      .setProvenance(id, "roof_area_m2", PROVENANCE);
    render(<ToolView toolId="roof-metrics" />);
    expect(
      screen.getByText("1 of these columns exist; they will be replaced."),
    ).toBeInTheDocument();
  });

  it("names the TABLE's spelling when a typed column collides with the file", () => {
    // §6, verbatim: "'height' belongs to the source data; choose another
    // prefix" — and the spelling in the message is the table's, which is now
    // reached through `onTable.get(c.name.toLowerCase())`.
    const id = addCityLayer("Delft", true);
    useWorkspaceStore.getState().setActiveLayerId(id);
    useLayerTableStore.setState({
      tables: {
        ...useLayerTableStore.getState().tables,
        [id]: {
          state: "ready",
          info: {
            ...readyTableInfo(true),
            columns: [{ name: "EXTENT_height_m", type: "DOUBLE", kind: "scalar" }],
          },
        },
      },
    });
    render(<ToolView toolId="height-from-extent" />);
    expect(
      screen.getByText(
        "'EXTENT_height_m' belongs to the source data; choose another prefix",
      ),
    ).toBeInTheDocument();
  });
});
```

Two small supports this needs in the same file, both additive: split `readyTable` into `readyTableInfo(withReader): LayerTable` plus the one-line `readyTable` that wraps it (so a case can override `columns`), and add

```ts
const PROVENANCE = {
  runId: "run_0",
  toolName: "Roof metrics to attributes",
  summary: "All 2 buildings",
  at: 0,
  partial: null,
  previous: null,
};
```

beside the other fixtures, importing `useComputedColumnStore` from `src/insights/computedColumns`.

Append to `tests/unit/ui/processing/ToolView.test.tsx`, inside the same describe as "renders TARGET, scope counts, OUTPUT columns and runs with the draft". **It uses `addRoofLayer`, not this file's `addCityLayer`**: `addCityLayer`'s model is `objects: {}`, so Roof metrics has no qualifying LoD, the select is empty, Run is disabled with "No roof surfaces in this layer" and the click would assert nothing. `roofLayerFixture.tsx` is the shared roof-bearing layer three suites already run against, so add

```ts
import { addRoofLayer } from "./roofLayerFixture";
```

to the file's imports (a static import beside the other test-local ones — the fixture touches only stores, not the engine), and make sure the suite's `afterEach` clears `useLayerStore`/`useLayerTableStore` as it already does for `addCityLayer`.

```ts
it("prints the column NAMES and freezes the typed columns", () => {
  // The two halves of the same list: the mono line is names (§6's "column
  // list in mono"), and what `submitRun` freezes is the typed columns the
  // write path needs (`buildAddColumnSql` interpolates `col.type`).
  //
  // The ROOF layer, because Roof metrics needs a qualifying LoD before Run is
  // enabled at all — `addCityLayer`'s model has no surfaces.
  addRoofLayer();
  render(<ToolView toolId="roof-metrics" />);
  expect(
    screen.getByText(
      "roof_area_m2, roof_flat_m2, roof_flat_share, roof_slope_deg, roof_azimuth_deg, roof_surfaces_n",
    ),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  expect(submitRun).toHaveBeenCalledWith(
    expect.objectContaining({
      columns: [
        { name: "roof_area_m2", type: "DOUBLE" },
        { name: "roof_flat_m2", type: "DOUBLE" },
        { name: "roof_flat_share", type: "DOUBLE" },
        { name: "roof_slope_deg", type: "DOUBLE" },
        { name: "roof_azimuth_deg", type: "DOUBLE" },
        { name: "roof_surfaces_n", type: "DOUBLE" },
      ],
    }),
  );
});
```

And update the two `roofColumnNames` cases in `tests/unit/features/processing/roofMetricsParams.test.ts` to the typed shape:

```ts
describe("roofColumnNames", () => {
  it("is spec §7.1's list, in spec §7.1's order, every column DOUBLE", () => {
    expect(roofColumnNames("roof_", DEFAULT_ROOF_PARAMS)).toEqual([
      { name: "roof_area_m2", type: "DOUBLE" },
      { name: "roof_flat_m2", type: "DOUBLE" },
      { name: "roof_flat_share", type: "DOUBLE" },
      { name: "roof_slope_deg", type: "DOUBLE" },
      { name: "roof_azimuth_deg", type: "DOUBLE" },
      { name: "roof_surfaces_n", type: "DOUBLE" },
    ]);
  });

  it("prints only the ticked measures, still in the spec's order", () => {
    expect(
      roofColumnNames("roof_", {
        measures: ["surfaces", "area"],
        flatThresholdDeg: 5,
      }),
    ).toEqual([
      { name: "roof_area_m2", type: "DOUBLE" },
      { name: "roof_surfaces_n", type: "DOUBLE" },
    ]);
  });

  it("honours a different prefix", () => {
    expect(
      roofColumnNames("dak_", { measures: ["area"], flatThresholdDeg: 5 }),
    ).toEqual([{ name: "dak_area_m2", type: "DOUBLE" }]);
  });
```

(The fourth case, "has one spec entry per measure, and no duplicate suffix or label", is untouched.)

- [ ] **Step 2: Run and watch them fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing/roofMetricsParams.test.ts \
  tests/unit/ui/processing/useToolForm.test.tsx tests/unit/ui/processing/ToolView.test.tsx
```

Expected: FAIL — `roofColumnNames` returns `["roof_area_m2", …]`, `useToolForm`'s `columns` is a string array, and the new ToolView case fails on the same.

- [ ] **Step 3: Widen `ToolDefinition.outputColumns`**

In `src/features/processing/types.ts`, add at the top of the file:

```ts
import type { OutputColumn } from "../../insights/computedColumns";
```

(A TYPE-ONLY import, so it is erased and this module stays engine-free at runtime.)

Then replace the `outputColumns` declaration. Find:

```ts
  readonly outputColumns?: (
    prefix: string,
    params: Readonly<Record<string, unknown>>,
  ) => string[];
```

and replace with:

```ts
  readonly outputColumns?: (
    prefix: string,
    params: Readonly<Record<string, unknown>>,
  ) => ReadonlyArray<OutputColumn>;
```

and extend the doc comment above it with:

```
   * The TYPE travels with the name because it is decided here and nowhere
   * else: `buildAddColumnSql` interpolates `col.type` into the `ALTER TABLE`,
   * Validate solids writes BOOLEAN and Join copies VARCHAR/BOOLEAN/DOUBLE by
   * inference. The UI used to hard-code DOUBLE for every column; there is now
   * exactly one place a column's type is stated.
```

- [ ] **Step 4: Make the two column builders typed**

In `src/features/processing/roofMetricsParams.ts`, add the type import:

```ts
import type { OutputColumn } from "../../insights/computedColumns";
```

and replace `roofColumnNames`:

```ts
/**
 * The columns this run will write, prefix applied, in the spec's order.
 *
 * Every roof measure is a number, so every column is DOUBLE — but the type is
 * stated here rather than assumed downstream, because the registry is the one
 * place a tool declares what it writes (§7: "Output columns are DOUBLE,
 * BOOLEAN or VARCHAR").
 */
export function roofColumnNames(
  prefix: string,
  params: RoofMetricsParams,
): ReadonlyArray<OutputColumn> {
  const ticked = new Set(params.measures);
  return ROOF_MEASURES.filter((m) => ticked.has(m.key)).map((m) => ({
    name: `${prefix}${m.suffix}`,
    type: "DOUBLE" as const,
  }));
}
```

In `src/features/processing/toolRegistry.ts`, replace the `height-from-extent` entry's inline list. Find:

```ts
    outputColumns: (p) => [`${p}height_m`, `${p}zmin_m`, `${p}zmax_m`],
```

and replace with:

```ts
    outputColumns: (p) => [
      { name: `${p}height_m`, type: "DOUBLE" },
      { name: `${p}zmin_m`, type: "DOUBLE" },
      { name: `${p}zmax_m`, type: "DOUBLE" },
    ],
```

- [ ] **Step 5: Stop the UI from inventing a type**

In `src/ui/processing/useToolForm.ts`, the `columns` line and the two derived lists. Find:

```ts
const columns = tool.outputColumns?.(draft.prefix, draft.params) ?? [];
```

and leave it as it is — its TYPE changes on its own. Then find:

```ts
const existing = columns.filter((c) => onTable.has(c.toLowerCase()));
const sourceCollisions = existing
  .filter((c) => !computedLower.has(c.toLowerCase()))
  .map((c) => onTable.get(c.toLowerCase()) ?? c);
```

and replace with:

```ts
const existing = columns.filter((c) => onTable.has(c.name.toLowerCase()));
const sourceCollisions = existing
  .filter((c) => !computedLower.has(c.name.toLowerCase()))
  .map((c) => onTable.get(c.name.toLowerCase()) ?? c.name);
```

In `src/ui/processing/ToolView.tsx`, find:

```ts
      columns: f.columns.map((name) => ({ name, type: "DOUBLE" as const })),
```

and replace with:

```ts
      // The registry's own answer, types and all — §7 puts a column's type
      // beside its name, and the write path reads `col.type` straight out of
      // this list. There is no second place that decides a type.
      columns: f.columns,
```

and find:

```tsx
<p className="processing-columns">{f.columns.join(", ")}</p>
```

and replace with:

```tsx
<p className="processing-columns">{f.columns.map((c) => c.name).join(", ")}</p>
```

- [ ] **Step 6: Run to pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing tests/unit/ui/processing
npx tsc -b --noEmit
```

Expected: PASS. `tsc` names every remaining place that treats an output column as a string — there must be none left; if one appears, it is the second type-deciding site this task exists to remove.

- [ ] **Step 7: Commit**

```bash
git add src/features/processing/types.ts src/features/processing/roofMetricsParams.ts \
  src/features/processing/toolRegistry.ts src/ui/processing/useToolForm.ts \
  src/ui/processing/ToolView.tsx \
  tests/unit/features/processing/roofMetricsParams.test.ts \
  tests/unit/ui/processing/useToolForm.test.tsx tests/unit/ui/processing/ToolView.test.tsx
git commit -m "refactor: a tool's output columns carry their SQL types"
```

---
