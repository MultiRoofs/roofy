### Task 27: The M1/M2 leftovers

**Files:**

- Create: `src/ui/table/revealColumns.ts`.
- Modify: `src/insights/computedColumns.ts`, `src/features/processing/runQueue.ts`, **`src/features/processing/deriveLayer.ts`** (the derived write's statements reach the same log), `src/ui/processing/RunFooter.tsx`, `src/ui/table/DataGrid.tsx`, `src/ui/drawer/columnPolicy.ts`, `src/features/layers/layerTableLifecycle.ts`.
- Test: `tests/unit/ui/table/revealColumns.test.tsx`, additions to `tests/unit/insights/computedColumns.test.ts`, `tests/unit/features/processing/derivedRun.test.ts`, `tests/unit/ui/drawer/columnPolicy.test.ts` and `tests/unit/features/layers/layerTableLifecycle.test.ts`.

**Interfaces:** Produces `WriteOutcome`'s `statements: ReadonlyArray<string>` (**[adapted copy A10]** labels), `requestColumnReveal`/`subscribeColumnReveal`/`drainColumnReveals`/`clearColumnReveals`, `prepareDerivedCityLayer`'s optional `recordWrite` input, the synthetic roof column's header explanation (**[adapted copy A8]**), and `layerTableLifecycle`'s `enqueuedVersions` map.

**Intent:** Four independent small fixes, folded together because each is a handful of lines with its own test and none needs a reviewer's separate gate: §6.4's write-step SQL reaching the log so a planner can repeat the UPDATE by hand; §6.2's "scrolled into view" beside the existing column append; §7's contributor rule explained where the two roof-area numbers disagree; and Design decision (j)'s version-aware sweep, so reopening the toolbox stops retiring a finished card as stale. A reviewer rejects it for a sweep that skips a layer whose version DID move, or for a log that prints a value literal.

- [ ] **Step 1: Write the failing test for the write step's statements**

Add to `tests/unit/insights/computedColumns.test.ts`:

```ts
/** One write of two columns, one of which the table already has. Every case
 *  below differs only in what the fake database does to it. */
const oneWrite = () =>
  writeComputedColumns({
    runId: "run_1",
    table: "layer_1",
    columns: [
      { name: "a", type: "DOUBLE" as const },
      { name: "b", type: "BOOLEAN" as const },
    ],
    rows: new Map([["x", { a: 1, b: true }]]),
    existing: new Set(["a"]),
  });

describe("WriteOutcome.statements", () => {
  it("reports every statement the transaction issued, in order", async () => {
    const out = await oneWrite();
    expect(out.ok).toBe(true);
    // §6.4: "the SQL statements issued in order". BEGIN and COMMIT are part of
    // the record — a planner reading the log back has to know the write was one
    // transaction — and the backup CREATE is what makes the Undo legible.
    expect(out.statements).toEqual([
      "BEGIN TRANSACTION",
      expect.stringContaining('CREATE TABLE "__undo_run_1"'),
      expect.stringContaining('ADD COLUMN IF NOT EXISTS "a"'),
      expect.stringContaining('ADD COLUMN IF NOT EXISTS "b"'),
      expect.stringContaining("UPDATE"),
      "COMMIT",
    ]);
  });

  it("never prints a VALUE — the rows go through a registered buffer", async () => {
    // The UPDATE reads `read_json_auto('__vals_run_1.json')`, so the log holds
    // the statement and not a thousand literals. A log that inlined the values
    // would be unusable and would leak the data into a bug report.
    const out = await oneWrite();
    const text = out.statements.join("\n");
    expect(text).toContain("__vals_run_1.json");
    expect(text).not.toContain("VALUES");
    expect(text).not.toContain("true");
  });

  it("reports the statements it got through on a FAILURE too", async () => {
    // §6.3 shows the error; §6.4 still has to say what was attempted. This
    // suite has no fail HELPER — its cases re-implement the two primitives per
    // case (`vi.mocked(duck.runQuery).mockImplementation`, e.g.
    // `computedColumns.test.ts:85-95`), so this one does the same.
    const fail = async (sql: string) =>
      sql.startsWith("UPDATE")
        ? { ok: false as const, message: "boom" }
        : { ok: true as const, columns: [], rows: [] };
    vi.mocked(duck.runQuery).mockImplementation(fail);
    vi.mocked(duck.ddl).mockImplementation(fail);
    const out = await oneWrite();
    expect(out.ok).toBe(false);
    // Everything up to and including the failed UPDATE, then the ROLLBACK that
    // undid it — which is the whole point of recording what was SENT rather
    // than the plan.
    expect(out.statements[0]).toBe("BEGIN TRANSACTION");
    expect(out.statements).toContain("ROLLBACK");
    expect(out.statements).not.toContain("COMMIT");
  });

  it("reports an empty list when the rows never reached the engine", async () => {
    // `registerBuffer` failing is the one exit before any statement is sent
    // (`computedColumns.ts:161-166`).
    vi.mocked(duck.registerBuffer).mockResolvedValueOnce(false);
    const out = await oneWrite();
    expect(out.ok).toBe(false);
    expect(out.statements).toEqual([]);
  });
});
```

(`duck` is the suite's own `await import("../../../src/insights/duckdb")`; `vi.clearAllMocks()` is not in its `afterEach`, so the first case's `mockImplementation` is restored by the next case setting its own — which is the pattern every other case in the file already follows.)

- [ ] **Step 2: Run it and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/insights/computedColumns.test.ts
```

Expected: FAIL — `statements` is not on `WriteOutcome`.

- [ ] **Step 3: Record the statements**

In `src/insights/computedColumns.ts`, `WriteOutcome` gains the field on BOTH branches. Find:

```ts
export type WriteOutcome =
  | { readonly ok: true; readonly backupTable: string | null }
  /** `cancelled` is the user's own Cancel, never an error to report. */
  | {
      readonly ok: false;
      readonly message: string;
      readonly cancelled?: true;
    };
```

and replace with:

```ts
export type WriteOutcome =
  | {
      readonly ok: true;
      readonly backupTable: string | null;
      /**
       * Every statement the transaction issued, in order (spec §6.4: "the SQL
       * statements issued in order"). The run's log prints them so "a planner
       * can read it back and rerun by hand" — which the one `sql: null` entry
       * M1 shipped could not support.
       *
       * They are the statements, never the values: the rows travel through a
       * registered buffer and the UPDATE reads `read_json_auto(…)`, so the log
       * stays a page long whatever the run measured.
       */
      readonly statements: ReadonlyArray<string>;
    }
  /** `cancelled` is the user's own Cancel, never an error to report. */
  | {
      readonly ok: false;
      readonly message: string;
      readonly cancelled?: true;
      /** What it got through before it failed — §6.3 shows the error, §6.4
       *  still has to say what was attempted. */
      readonly statements: ReadonlyArray<string>;
    };
```

In `writeComputedColumns`, collect them. The `statements` array of `[sql, use]` pairs already exists, so the record is what was actually SENT:

```ts
  try {
    for (const [sql, use] of statements) {
      const out = await step(sql, use);
      if (!out.ok) {
        await cleanup("ROLLBACK");
        return { ok: false, message: out.message };
      }
    }
```

becomes

```ts
  // What was actually SENT, in order — not the plan above, which may not have
  // been reached in full.
  const issued: string[] = [];
  try {
    for (const [sql, use] of statements) {
      issued.push(sql);
      const out = await step(sql, use);
      if (!out.ok) {
        await cleanup("ROLLBACK");
        issued.push("ROLLBACK");
        return { ok: false, message: out.message, statements: issued };
      }
    }
```

and the three remaining returns gain `statements: issued` the same way — the cancel branch (`issued.push("ROLLBACK")` first), the failed COMMIT branch, and the success branch (`issued.push("COMMIT")` before it). The early `registerBuffer` failure returns `statements: []`.

- [ ] **Step 4: Put them in the log**

In `src/features/processing/runQueue.ts`, find:

```ts
const written = await raced(writing, null);
log.push({
  label: "Writing results",
  sql: null,
  ms: Math.round(performance.now() - t0),
  rows: result.rows.size,
});
```

and replace with:

```ts
const written = await raced(writing, null);
logWriteStatements(
  log,
  written.statements,
  Math.round(performance.now() - t0),
  result.rows.size,
);
patch(id, { log: [...log] });
```

with the recorder itself beside `execute`, because BOTH destinations write and §6.4 does not have two answers:

```ts
/**
 * §6.4's "the SQL statements issued in order", for a write step.
 *
 * ONE entry per statement, labelled `Writing results (1/6)` …
 * **[adapted copy A10]**, so the log reads as the transaction it was and a
 * planner can repeat the UPDATE by hand. The TIMING is the whole write's and
 * is carried by the LAST entry only: `writeComputedColumns` measures the
 * transaction, not each statement, and repeating one number six times would
 * read as six slow statements.
 *
 * Shared, because a New-layer run writes its columns into the COPY through the
 * same `writeComputedColumns` — from inside `prepareDerivedCityLayer` — and a
 * derived run whose log stopped at `CREATE TABLE` would be the one run §6.4's
 * promise is not true for. Called on FAILURE too: the statements a failed
 * write got through are exactly what a bug report needs.
 */
function logWriteStatements(
  log: LogEntry[],
  statements: ReadonlyArray<string>,
  ms: number,
  rows: number,
): void {
  if (statements.length === 0) {
    log.push({ label: "Writing results", sql: null, ms, rows });
    return;
  }
  statements.forEach((sql, i) => {
    const last = i === statements.length - 1;
    log.push({
      label: `Writing results (${i + 1}/${statements.length})`,
      sql,
      ms: last ? ms : 0,
      rows: last ? rows : null,
    });
  });
}
```

and the New-layer branch handing it to the preparation. In `execute`'s `destination === "new"` block (Task 22), the `prepareDerivedCityLayer({ … })` argument gains one field:

```ts
      // §6.4 again: the copy's ALTER/UPDATE/COMMIT belong in the log beside
      // its CREATE TABLE, and only the preparation knows them — the write
      // happens inside it. Same recorder, so the two destinations cannot
      // drift.
      recordWrite: (statements, ms, rows) => {
        logWriteStatements(log, statements, ms, rows);
        patch(id, { log: [...log] });
      },
```

and in `src/features/processing/deriveLayer.ts`, `prepareDerivedCityLayer`'s input gains the callback and its write reports through it:

```ts
  /**
   * Hand the run's log the statements this preparation's WRITE issued (§6.4).
   *
   * Optional, because the preparation is testable without a log; supplied by
   * `execute`, which is its only production caller. Called on failure as well
   * as on success — the statements a failed write got through are what §6.4's
   * record is for.
   */
  readonly recordWrite?: (
    statements: ReadonlyArray<string>,
    ms: number,
    rows: number,
  ) => void;
```

```ts
    if (input.rows.size > 0) {
      const t0 = performance.now();
      const written = await raced(
        writeComputedColumns({ … }),
        null,
      );
      input.recordWrite?.(
        written.statements,
        Math.round(performance.now() - t0),
        input.rows.size,
      );
      if (!written.ok) throw new Error(written.message);
    }
```

and one case in `tests/unit/features/processing/derivedRun.test.ts`:

```ts
it("logs the COPY's write statement by statement (§6.4)", async () => {
  fakeExecutor();
  const id = submitRun(newLayerRequest());
  await vi.waitFor(() => expect(runById(id)?.status).toBe("done"));
  const labels = (runById(id)?.log ?? []).map((e) => e.label);
  expect(labels.some((l) => l.startsWith("Writing results ("))).toBe(true);
  const statements = (runById(id)?.log ?? [])
    .filter((e) => e.label.startsWith("Writing results ("))
    .map((e) => e.sql);
  expect(statements).toContain("BEGIN TRANSACTION");
  expect(statements).toContain("COMMIT");
});
```

- [ ] **Step 5: Write the failing test for the reveal channel**

Create `tests/unit/ui/table/revealColumns.test.tsx`:

```tsx
/**
 * §6.2: "Open table opens the drawer on the target with the new columns
 * appended after the existing ones **and scrolled into view**." The append is
 * `appendColumns`; the scroll is a one-shot request, because the card and the
 * grid are two components with no prop between them and the grid may not be
 * mounted yet when the card is clicked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearColumnReveals,
  drainColumnReveals,
  requestColumnReveal,
  subscribeColumnReveal,
} from "../../../../src/ui/table/revealColumns";

/** A listener that ACKNOWLEDGES — the grid's answer when it found a header. */
const took = () => vi.fn(() => true);
/** A listener that declines — the grid's answer for another layer, or for a
 *  layer whose headers are not on screen yet. */
const declined = () => vi.fn(() => false);

afterEach(() => {
  // The channel is module state, and an outstanding request is RETAINED — so
  // it would be delivered to the next case's first listener.
  clearColumnReveals();
});

describe("the column-reveal channel", () => {
  it("offers a request to live listeners until one takes it", () => {
    const a = declined();
    const b = took();
    const stopA = subscribeColumnReveal(a);
    const stopB = subscribeColumnReveal(b);
    requestColumnReveal("L1", ["solid_volume_m3", "solid_valid"]);
    expect(a).toHaveBeenCalledWith({
      layerId: "L1",
      columns: ["solid_volume_m3", "solid_valid"],
    });
    expect(b).toHaveBeenCalledTimes(1);
    stopA();
    stopB();
  });

  it("delivers to a listener that subscribes AFTER the request", () => {
    // The grid mounts when the drawer opens, which is AFTER the card's click.
    // A pure event bus would drop the request on the floor.
    requestColumnReveal("L1", ["solid_valid"]);
    const late = took();
    const stop = subscribeColumnReveal(late);
    expect(late).toHaveBeenCalledWith({
      layerId: "L1",
      columns: ["solid_valid"],
    });
    stop();
  });

  it("RETAINS a request no listener acknowledged", () => {
    // The regression this channel was rewritten for. A grid mounted on
    // ANOTHER layer, or on this one before its columns have arrived, cannot
    // scroll to anything — and consuming the request there loses it for good:
    // the drawer opens on the right layer a moment later and never scrolls.
    const other = declined();
    const stopOther = subscribeColumnReveal(other);
    requestColumnReveal("L1", ["solid_valid"]);
    expect(other).toHaveBeenCalledTimes(1);
    stopOther();

    const right = took();
    const stop = subscribeColumnReveal(right);
    expect(right).toHaveBeenCalledWith({
      layerId: "L1",
      columns: ["solid_valid"],
    });
    stop();
  });

  it("re-offers outstanding requests on DRAIN, for columns that arrive late", () => {
    // The grid is mounted on L1 the whole time; its headers appear when the
    // query answers. `drainColumnReveals` is what the grid calls then.
    const grid = vi.fn(() => false);
    const stop = subscribeColumnReveal(grid);
    requestColumnReveal("L1", ["solid_valid"]);
    expect(grid).toHaveBeenCalledTimes(1);

    grid.mockReturnValue(true);
    drainColumnReveals(grid);
    expect(grid).toHaveBeenCalledTimes(2);

    // Taken: a later drain has nothing to re-offer.
    drainColumnReveals(grid);
    expect(grid).toHaveBeenCalledTimes(2);
    stop();
  });

  it("is consumed ONCE, whoever takes it", () => {
    requestColumnReveal("L1", ["solid_valid"]);
    const first = took();
    subscribeColumnReveal(first)();
    expect(first).toHaveBeenCalledTimes(1);
    const second = took();
    const stop = subscribeColumnReveal(second);
    expect(second).not.toHaveBeenCalled();
    stop();
  });

  it("keeps ONE outstanding request per layer, the latest", () => {
    // Two runs on two layers, both waiting for their grid; and a second run on
    // L1 supersedes the first — the user is looking at the newest card.
    requestColumnReveal("L1", ["a"]);
    requestColumnReveal("L2", ["b"]);
    requestColumnReveal("L1", ["c"]);
    const seen: Array<ReadonlyArray<string>> = [];
    const stop = subscribeColumnReveal((reveal) => {
      seen.push(reveal.columns);
      return true;
    });
    expect(seen).toEqual([["c"], ["b"]]);
    stop();
  });

  it("stops delivering to an unsubscribed listener", () => {
    const listener = took();
    subscribeColumnReveal(listener)();
    requestColumnReveal("L1", ["x"]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("ignores an EMPTY column list — there is nothing to scroll to", () => {
    const listener = took();
    const stop = subscribeColumnReveal(listener);
    requestColumnReveal("L1", []);
    expect(listener).not.toHaveBeenCalled();
    stop();
  });
});
```

- [ ] **Step 6: Run it and watch it fail, then write the channel**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/ui/table/revealColumns.test.tsx
```

Expected: FAIL — the module does not exist.

Create `src/ui/table/revealColumns.ts`:

```ts
/**
 * "Scroll these columns into view" — the channel between a run's result card
 * and the grid (spec §6.2).
 *
 * A module channel rather than a store, and rather than a prop: the card is in
 * the RIGHT panel and the grid is in the drawer, with `appendColumns` already
 * crossing the same gap through the query store. What the query store cannot
 * carry is a MOMENT — a column list that is "visible" is state, but "scroll to
 * it now" happens once and must not fire again on the next render.
 *
 * A REQUEST IS RETAINED UNTIL A LISTENER ACKNOWLEDGES IT, which is why the
 * listener returns a boolean. Three things happen between the click and the
 * headers, and each of them delivers a request to something that cannot scroll
 * yet: Open table opens the drawer, so the grid may not be mounted at all; a
 * grid that IS mounted may be showing another layer; and a mounted grid on the
 * right layer renders no `<th>` until its query answers (it returns the empty
 * placeholder while `rows` is empty). Consuming the request at any of those
 * loses it for good, and the scroll the user asked for never happens. So the
 * channel keeps the latest outstanding request PER LAYER and offers it to
 * every new listener and to every {@link drainColumnReveals} — which the grid
 * calls whenever its own headers change.
 */
export interface ColumnReveal {
  readonly layerId: string;
  readonly columns: ReadonlyArray<string>;
}

/** Returns true when the reveal was HONOURED — a matching header was found and
 *  scrolled to. False means "not mine, or not yet", and the request stays. */
type Listener = (reveal: ColumnReveal) => boolean;

const listeners = new Set<Listener>();
/** Outstanding requests, by layer id: the latest per layer, because a second
 *  run on the same layer supersedes the first — the user is looking at the
 *  newest card. Insertion-ordered, so the oldest LAYER is offered first. */
const pending = new Map<string, ReadonlyArray<string>>();

export function requestColumnReveal(
  layerId: string,
  columns: ReadonlyArray<string>,
): void {
  // Nothing to scroll to: an empty list is a no-op by definition, and it
  // clears any outstanding request for that layer rather than leaving a stale
  // one behind.
  if (columns.length === 0) {
    pending.delete(layerId);
    return;
  }
  const reveal: ColumnReveal = { layerId, columns: [...columns] };
  for (const listener of Array.from(listeners)) {
    if (listener(reveal)) return;
  }
  pending.set(layerId, reveal.columns);
}

export function subscribeColumnReveal(listener: Listener): () => void {
  listeners.add(listener);
  drainColumnReveals(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Re-offer every outstanding request to one listener, dropping the ones it
 * takes.
 *
 * The grid calls this when its layer or its rendered headers change: the
 * request may have arrived while it was showing another layer, or before its
 * query answered and it had any `<th>` to scroll to.
 */
export function drainColumnReveals(listener: Listener): void {
  for (const [layerId, columns] of Array.from(pending)) {
    if (listener({ layerId, columns })) pending.delete(layerId);
  }
}

/** Drop every outstanding request. For tests: the channel is module state, and
 *  a retained request would be delivered to the next case's first listener. */
export function clearColumnReveals(): void {
  pending.clear();
}
```

- [ ] **Step 7: Request it from the card and honour it in the grid**

In `src/ui/processing/RunFooter.tsx`'s Open table handler, after the `setColumns` call:

```ts
const next = appendColumns(columns, run.columns);
if (next !== null && next !== columns)
  useQueryStore.getState().setColumns(cardLayerId, next);
```

gains, under it:

```ts
// §6.2: "…and scrolled into view". Requested unconditionally,
// including for the DEFAULT column list (which already shows
// the run's columns without an append) — the scroll is what the
// user came for either way.
requestColumnReveal(cardLayerId, run.columns);
```

In `src/ui/table/DataGrid.tsx`, honour it. Add the refs, ONE handler and TWO effects — the hooks go above the `if (rows.length === 0) return …` early exit (`DataGrid.tsx:95-97`), like every other hook in the component:

```tsx
const headerRefs = useRef(new Map<string, HTMLTableCellElement>());
/**
 * Scroll to the first requested column this grid is SHOWING, and say whether
 * it did.
 *
 * The first and not the last: scrolling to the last would leave the others
 * off-screen to its left. `false` for another layer's request, and for one
 * whose columns this grid has no header for — hidden by the chooser, or not
 * rendered at all because the query has not answered yet (the empty
 * placeholder has no `<th>`). The channel then KEEPS the request.
 */
const reveal = useCallback(
  ({ layerId: id, columns: names }: ColumnReveal): boolean => {
    if (layerId === null || id !== layerId) return false;
    for (const name of names) {
      const cell = headerRefs.current.get(name);
      if (cell === undefined) continue;
      cell.scrollIntoView({ inline: "nearest", block: "nearest" });
      return true;
    }
    return false;
  },
  [layerId],
);
useEffect(() => subscribeColumnReveal(reveal), [reveal]);
// Re-offer whatever is outstanding whenever this grid's HEADERS change: the
// request routinely lands before the columns do, and `rows` is in the deps
// because an empty grid renders no `<th>` at all — the first page arriving is
// exactly when the headers appear.
useEffect(() => {
  drainColumnReveals(reveal);
}, [reveal, columns, rows]);
```

(`useCallback` and `useEffect` join the React import; `ColumnReveal`,
`subscribeColumnReveal` and `drainColumnReveals` come from
`./revealColumns`.) And on the header `<th>` element:

```tsx
                ref={(el) => {
                  if (el === null) headerRefs.current.delete(col.name);
                  else headerRefs.current.set(col.name, el);
                }}
```

- [ ] **Step 8: Explain the synthetic roof columns**

In `src/ui/drawer/columnPolicy.ts`, `derivedColumnTitle` is the header's `title` (`DataGrid.tsx:113`). Find:

```ts
export function derivedColumnTitle(name: string): string {
  const key = DERIVED_COLUMNS.find((column) => name.endsWith(column.key))?.key;
  switch (key) {
    case "__roofy_roof_area":
      return "Roof area (m²)";
```

and replace the roof-area case with **[adapted copy A8]**:

```ts
export function derivedColumnTitle(name: string): string {
  const key = DERIVED_COLUMNS.find((column) => name.endsWith(column.key))?.key;
  switch (key) {
    case "__roofy_roof_area":
      // §7.1 keeps the synthetic column AND ships a computed `roof_area_m2`,
      // and the two disagree on any building that stores roof surfaces on both
      // itself and its parts — so the header says which is which.
      // **[adapted copy A8]**.
      return "Roof area (m²) — Roof area here is the drawer's own per-page figure over every roof surface. The computed roof_area_m2 follows the tool's contributor rule, so a building that stores its roof on both itself and its parts counts it once.";
```

and pin it:

```ts
it("explains how the synthetic roof area differs from the computed one", () => {
  const title = derivedColumnTitle("__roofy_roof_area");
  expect(title.startsWith("Roof area (m²)")).toBe(true);
  expect(title).toContain("the drawer's own per-page figure");
  expect(title).toContain("counts it once");
});

it("leaves the other two synthetic titles alone", () => {
  expect(derivedColumnTitle("__roofy_mean_slope")).toBe("Mean slope (°)");
  expect(derivedColumnTitle("__roofy_parts")).toBe("Parts (count)");
});
```

- [ ] **Step 9: Write the failing test for the version-aware sweep**

Add to `tests/unit/features/layers/layerTableLifecycle.test.ts`:

```ts
it("does not rebuild a streaming layer whose version has not moved", () => {
  // Design decision (j): M2's final wave made the toolbox a table consumer,
  // so opening Tools swept every streaming layer and rebuilt its table —
  // which trips `installStaleWatcher` on the `building → ready` transition
  // and retires a FINISHED card as "stale: layer reloaded" though nothing
  // about the data moved.
  useLayerStore.setState({ layers: [layer({ id: "L1", isStreaming: true })] });
  useStreamStore.setState({ streams: { L1: { version: 3 } as never } });
  vi.advanceTimersByTime(STREAM_REBUILD_DEBOUNCE_MS);
  // The table-panel sweep builds it once at version 3.
  useLayerTableStore.setState({ tablePanelOpen: true });
  const afterFirst = enqueued.length;
  expect(afterFirst).toBeGreaterThan(0);

  // A SECOND consumer opens, with the stream exactly where it was.
  useProcessingStore.getState().setOpen(true);
  expect(enqueued).toHaveLength(afterFirst);
});

it("DOES rebuild when the version moved while nothing was looking", () => {
  useLayerStore.setState({ layers: [layer({ id: "L1", isStreaming: true })] });
  useStreamStore.setState({ streams: { L1: { version: 3 } as never } });
  useLayerTableStore.setState({ tablePanelOpen: true });
  const afterFirst = enqueued.length;
  useLayerTableStore.setState({ tablePanelOpen: false });
  useStreamStore.setState({ streams: { L1: { version: 4 } as never } });
  useProcessingStore.getState().setOpen(true);
  expect(enqueued.length).toBeGreaterThan(afterFirst);
});
```

- [ ] **Step 10: Run it and watch it fail, then make the sweep version-aware**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/layers/layerTableLifecycle.test.ts
```

Expected: FAIL — the first case sees a second enqueue.

In `src/features/layers/layerTableLifecycle.ts`, add the map beside `knownVersions`:

```ts
const knownVersions = new Map<string, number>();
```

becomes

```ts
const knownVersions = new Map<string, number>();
/**
 * The stream version each layer's table was last ENQUEUED at (Design
 * decision (j)).
 *
 * `knownVersions` answers "has a commit arrived since we last looked", which
 * is what the debounced rebuild needs. The consumer SWEEP asks a different
 * question — "is this layer's table behind?" — and answering it with
 * `knownVersions` rebuilds every streaming layer every time a consumer opens,
 * which trips `installStaleWatcher` and retires a finished result card as
 * "stale: layer reloaded" though nothing about the data moved.
 */
const enqueuedVersions = new Map<string, number>();
```

then a helper beside `scheduleRebuild`:

```ts
/** The layer's current stream version, 0 when it has no stream yet. */
const versionOf = (layerId: string): number =>
  useStreamStore.getState().streams[layerId]?.version ?? 0;

/** Enqueue a rebuild and remember the version it was built at. */
const enqueueAt = (layerId: string): void => {
  enqueuedVersions.set(layerId, versionOf(layerId));
  void enqueueLayerTable(layerId, residentTableSource(layerId));
};
```

and every `void enqueueLayerTable(layerId, residentTableSource(layerId));` in this file becomes `enqueueAt(layerId);` — there are three (the new-layer branch, `scheduleRebuild`'s timer body, and `sweepStreamingLayers`). Finally the sweep skips what is current. Find:

```ts
    for (const layer of useLayerStore.getState().layers) {
      if (!layer.isStreaming || layer.derivedFrom !== null) continue;
```

and insert after the `continue`:

```ts
// Design decision (j): the sweep's job is "a consumer opened and this
// layer's table is behind". The VERSION is exactly that question, and
// rebuilding a table that is already current costs a rebuild AND retires
// a finished run's card as stale.
if (enqueuedVersions.get(layer.id) === versionOf(layer.id)) continue;
```

and, in the layer-removal loop, `enqueuedVersions.delete(id);` beside the existing `knownVersions.delete(id);` — a re-added layer under the same id must not inherit the number.

`refreshStreamingTable` (the export's door) deliberately does NOT go through `enqueueAt`: it is an explicit "rebuild now whatever the version", and recording its version would let the next sweep skip a rebuild the export's own table change needs. Add that as a comment there.

- [ ] **Step 11: Run everything and commit**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/insights tests/unit/features/layers tests/unit/features/processing tests/unit/ui/table tests/unit/ui/drawer tests/unit/ui/processing
npx tsc -b --noEmit
npx vp check
npx vitest run > /tmp/m3-task27.log 2>&1 &
wait $!; echo "suite: $?"
```

Expected: PASS throughout; `suite: 0`.

```bash
git add src/insights/computedColumns.ts src/features/processing/runQueue.ts \
  src/features/processing/deriveLayer.ts \
  src/ui/processing/RunFooter.tsx src/ui/table/revealColumns.ts \
  src/ui/table/DataGrid.tsx src/ui/drawer/columnPolicy.ts \
  src/features/layers/layerTableLifecycle.ts tests/
git commit -m "fix: the write step's SQL, scroll-into-view, the roof-area explanation and a version-aware sweep"
```
