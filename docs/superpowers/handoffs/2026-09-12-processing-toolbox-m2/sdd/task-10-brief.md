### Task 10: Style by result gates on a column that has values, and the card names the resident set

**Files:**

- Modify: `src/features/processing/types.ts` (`RunSummary`), `src/features/processing/runQueue.ts` (`summarise` and its one call site), `src/ui/processing/RunFooter.tsx:249-254`
- Test: `tests/unit/features/processing/runQueue.test.ts` (the `summarise` unit tests), `tests/unit/ui/processing/ToolView.test.tsx:575-600`

**Interfaces:**

- Produces:
  - `RunSummary.firstColumnNonNull: number` — how many WRITTEN ROWS have a non-null value in the run's first output column.
  - `summarise(result: ToolResult, elapsedMs: number, options: { readonly streaming: boolean }): RunSummary`.
- Task 12 and Task 15 rely on the gate; nothing else consumes the new field.

**Why `measured === 0` is the wrong gate.** M1 ruled it as the synchronous stand-in for §6.2's "disabled with 'All values are empty' when the chosen column is NULL for every object in the run", and for Height from extent the two coincide: every measured feature gets a height. Roof metrics breaks the equivalence. A run with **only** Dominant azimuth ticked over a layer of perfectly flat roofs measures every building (`measured > 0`) and writes `roof_azimuth_deg = NULL` everywhere — `§7`'s "no remaining contributor for a measure gets NULL for it". Style by result would then open a rule editor on a column with no median, and `readMedian` would toast DuckDB's NULL instead of the sentence the spec names. Same for `roof_slope_deg` and `roof_flat_share` over zero-area surfaces (`computeRoofMetrics` returns all-zeros for a degenerate ring).

The count is computed centrally in `summarise`, from `result.columns[0]` and `result.rows`, so it is right for every tool present and future without asking executors to remember it.

**The resident-set qualifier (§10 scenario 4: "the card says so").** Today the "Runs over the N currently loaded buildings" sentence appears only in the FORM (`ToolView.tsx:174-179`). Scenario 4 asks for it on the result too, and the card is where a run is read afterwards. `summarise` takes `{ streaming }` and puts an extra clause at the head of the DETAIL line. **[adapted copy]**, decided (decision 9): `"Over the resident set: the buildings loaded when the run started."`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/features/processing/runQueue.test.ts`'s `summarise` describe (or add one if there is none):

```ts
describe("summarise", () => {
  const result = (
    rows: Array<[string, Record<string, unknown>]>,
    columns: string[],
  ) => ({
    columns: columns.map((name) => ({ name, type: "DOUBLE" as const })),
    rows: new Map(rows),
    measured: rows.length,
    skipped: [],
  });

  it("counts the rows whose FIRST output column has a value", () => {
    const summary = summarise(
      result(
        [
          ["a", { roof_azimuth_deg: 180 }],
          ["b", { roof_azimuth_deg: null }],
        ],
        ["roof_azimuth_deg"],
      ),
      1000,
      { streaming: false },
    );
    expect(summary.firstColumnNonNull).toBe(1);
  });

  it("is 0 when every object got NULL, even though features were measured", () => {
    // Azimuth-only over perfectly flat roofs: §7 gives NULL for the measure,
    // and §6.2's Style by result must read "All values are empty".
    const summary = summarise(
      result(
        [
          ["a", { roof_azimuth_deg: null }],
          ["b", { roof_azimuth_deg: null }],
        ],
        ["roof_azimuth_deg"],
      ),
      1000,
      { streaming: false },
    );
    expect(summary.measured).toBe(2);
    expect(summary.firstColumnNonNull).toBe(0);
  });

  it("is 0 for a run that wrote no column at all", () => {
    const summary = summarise(result([], []), 1000, { streaming: false });
    expect(summary.firstColumnNonNull).toBe(0);
  });

  it("says the run was over the resident set, for a streaming target", () => {
    const summary = summarise(
      result([["a", { roof_area_m2: 5 }]], ["roof_area_m2"]),
      2400,
      { streaming: true },
    );
    expect(summary.detail).toBe(
      "Over the resident set: the buildings loaded when the run started.",
    );
  });

  it("keeps the skip breakdown beside the resident-set note", () => {
    const summary = summarise(
      {
        ...result([["a", { roof_area_m2: 5 }]], ["roof_area_m2"]),
        skipped: [{ cause: "no roof surfaces at LoD 2", count: 3 }],
      },
      2400,
      { streaming: true },
    );
    expect(summary.detail).toBe(
      "Over the resident set: the buildings loaded when the run started. · " +
        "3 skipped: 3 no roof surfaces at LoD 2",
    );
  });
});
```

And in `tests/unit/ui/processing/ToolView.test.tsx`, use the file's own helpers — `runFixture` (`:140-168`), `doneRun(layerId, patch)` (`:171-182`) and `act(() => useProcessingStore.getState().upsertRun(…))`, which is how every Style-by-result case there already sets a run up. **There is no `renderDoneRun`.**

First, `doneRun`'s own summary is the POSITIVE fixture the rest of the file leans on, so give it a positive count rather than defaulting it to zero (`:174-179`):

```ts
    summary: {
      line: "2 buildings measured · 0.3 s",
      detail: null,
      measured: 2,
      skipped: [],
      // Both buildings got a height: this is the summary of a run that CAN be
      // styled, which is what every case built on `doneRun` assumes.
      firstColumnNonNull: 2,
    },
```

Then rewrite the existing "All values are empty" case (`:560-589`) so the run MEASURED things and still wrote nothing, and add its sibling:

```tsx
it("disables Style by result when the first column is NULL everywhere", () => {
  const layerId = addCityLayer();
  render(<ToolView toolId="height-from-extent" />);
  act(() =>
    useProcessingStore.getState().upsertRun(
      doneRun(layerId, {
        summary: {
          line: "2 buildings measured · 0.1 s",
          detail: null,
          // MEASURED, and still nothing to style: §6.2's condition is about
          // the COLUMN, not the count. A Roof metrics run with only Dominant
          // azimuth ticked over flat roofs lands exactly here.
          measured: 2,
          skipped: [],
          firstColumnNonNull: 0,
        },
      }),
    ),
  );
  const button = screen.getByRole("button", { name: "Style by result" });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("title", "All values are empty");
  // The reason has to be READABLE, not only a tooltip on a disabled control
  // (which no keyboard or screen-reader user ever reaches) — the same muted
  // note the Run button's reason gets.
  expect(
    screen.getByText("All values are empty", { selector: "p" }),
  ).toBeInTheDocument();
});

it("keeps Style by result enabled when only SOME values are null", () => {
  const layerId = addCityLayer();
  render(<ToolView toolId="height-from-extent" />);
  act(() =>
    useProcessingStore.getState().upsertRun(
      doneRun(layerId, {
        summary: {
          line: "2 buildings measured · 0.1 s",
          detail: null,
          measured: 2,
          skipped: [],
          firstColumnNonNull: 1,
        },
      }),
    ),
  );
  expect(screen.getByRole("button", { name: "Style by result" })).toBeEnabled();
});
```

`tsc` will then name every other `RunSummary` literal in the suite that lacks the field — the `runFixture({ summary: … })` calls around `:387`, `:437`, `:462`, `:483`, `:522` and `:568`. Give each the count its case implies: a card showing a done run with values gets a positive number, and only a genuinely empty one gets `0`. Do not default them all to zero — several of those cases assert an ENABLED Style by result.

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run tests/unit/features/processing/runQueue.test.ts -t summarise
npx vitest run tests/unit/ui/processing/ToolView.test.tsx -t "values are empty"
```

Expected: FAIL — `firstColumnNonNull` is not a property of `RunSummary`, and `summarise` takes two arguments.

- [ ] **Step 3: Carry the count on the summary**

In `src/features/processing/types.ts`, inside `RunSummary` (`:75-82`):

```ts
  /**
   * How many written rows have a value in the run's FIRST output column.
   *
   * Spec §6.2 disables Style by result "when the chosen column is NULL for
   * every object in the run", and the chosen column is `columns[0]`. It is not
   * the same as `measured === 0`: a run with only Dominant azimuth ticked over
   * flat roofs measures every building and writes NULL to all of them (§7,
   * "a feature with no remaining contributor for a measure gets NULL for it").
   */
  readonly firstColumnNonNull: number;
```

- [ ] **Step 4: Compute it, and the streaming clause, in `summarise`**

In `src/features/processing/runQueue.ts`, replace `summarise` (`:150-169`):

```ts
/** Spec §10 scenario 4: a streaming run's card says what it ran over. */
const RESIDENT_SET_NOTE =
  "Over the resident set: the buildings loaded when the run started.";

export function summarise(
  result: ToolResult,
  elapsedMs: number,
  options: { readonly streaming: boolean },
): RunSummary {
  const skippedTotal = result.skipped.reduce((a, s) => a + s.count, 0);
  const parts = [
    plural(result.measured, "building measured", "buildings measured"),
  ];
  if (skippedTotal > 0) parts.push(`${fmt(skippedTotal)} skipped`);
  parts.push(`${(elapsedMs / 1000).toFixed(1)} s`);

  const detailParts: string[] = [];
  if (options.streaming) detailParts.push(RESIDENT_SET_NOTE);
  if (skippedTotal > 0) {
    detailParts.push(
      `${fmt(skippedTotal)} skipped: ${result.skipped
        .map((s) => `${fmt(s.count)} ${s.cause}`)
        .join(" · ")}`,
    );
  }

  // The FIRST written column is the one §6.2's Style by result offers; a run
  // that wrote none has nothing to style either way.
  const first = result.columns[0]?.name ?? null;
  let firstColumnNonNull = 0;
  if (first !== null) {
    for (const values of result.rows.values()) {
      const value = values[first];
      if (value !== null && value !== undefined) firstColumnNonNull += 1;
    }
  }

  return {
    line: parts.join(" · "),
    detail: detailParts.length > 0 ? detailParts.join(" · ") : null,
    measured: result.measured,
    skipped: result.skipped,
    firstColumnNonNull,
  };
}
```

Update the two call sites in `execute` (the zero-rows branch at `runQueue.ts:517-540` and the publication branch) to pass `{ streaming: layer.isStreaming }`.

- [ ] **Step 5: Move the gate in the footer**

In `src/ui/processing/RunFooter.tsx`, replace the `styleReason` ternary (`:249-254`):

```tsx
// §6.2: "disabled with 'All values are empty' when the chosen column is
// NULL for every object in the run". The RUN knows that — `summarise`
// counted it — and `measured === 0` does not: a run with only Dominant
// azimuth ticked over flat roofs measures every building and writes NULL
// to all of them. A STALE run is disabled too, and OUTRANKS empty: its
// table was rebuilt under it, so no median can be trusted at all.
const styleReason = run.stale
  ? STALE_LAYER_RELOADED
  : run.summary === null || run.summary.firstColumnNonNull === 0
    ? ALL_VALUES_EMPTY
    : null;
```

- [ ] **Step 6: Run the tests**

```bash
npx vitest run tests/unit/features/processing tests/unit/ui/processing
npx tsc -b --noEmit
```

Expected: PASS. `tsc` names every `RunSummary` literal in the tests that still lacks `firstColumnNonNull` — add `firstColumnNonNull: 0` (or a value the assertion wants) to each.

- [ ] **Step 7: Commit**

```bash
git add src/features/processing/types.ts src/features/processing/runQueue.ts \
  src/ui/processing/RunFooter.tsx tests/unit/features/processing/runQueue.test.ts \
  tests/unit/ui/processing/ToolView.test.tsx
git commit -m "fix(processing): Style by result needs a column with values, not a measured count"
```

---
