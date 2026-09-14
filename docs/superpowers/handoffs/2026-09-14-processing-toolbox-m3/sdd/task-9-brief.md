### Task 9: ONE Style-by-result seam

**Files:**

- Modify: `src/features/processing/types.ts` (`StyleValueSource`, `StyleByResult` incl. the two function-union fields, `resolveStyleOperator`, `resolveStyleValueSource`, `ToolDefinition.styleByResult`, `RunSummary.nonNullByColumn`), `src/features/processing/toolRegistry.ts` (a descriptor on all seven), `src/features/processing/runQueue.ts` (`summarise` counts every column), `src/ui/processing/RunFooter.tsx`, `src/insights/sql.ts` (`buildMostFrequentSql`, and the CAST inside `buildMedianSql`)
- Test: `tests/unit/ui/processing/styleByResult.test.tsx`, additions to `tests/unit/insights/sqlQuery.test.ts` (where `buildMedianSql`'s cases already are — there is **no** `tests/unit/insights/sql.test.ts`), one case appended to `tests/unit/ui/layers/RulesEditor.test.tsx`, and one appended to `tests/integration/duckdb/computedColumns.test.ts` (which already imports `buildMedianSql` and runs it against a real table, `:577`)

**Interfaces:**

- Produces:

```ts
export type StyleValueSource =
  | { readonly kind: "median" }
  | { readonly kind: "mostFrequent" }
  | { readonly kind: "literal"; readonly value: number | string | boolean };
export interface StyleByResult {
  /** "rule" opens the rule editor on a draft; "attribute" opens a vector
   *  layer's Color by attribute on the picked column (spec §7.6). */
  readonly kind: "rule" | "attribute";
  /**
   * The rule's operator. A FUNCTION of the picked column for §7.5, whose rule
   * is `=` on a copied TEXT field but `>` on `<prefix>matches_n` when no text
   * field was copied — two operators chosen by which column `pick` returned.
   * The five descriptors that need only one operator pass it plainly.
   */
  readonly operator:
    | ConditionOperator
    | ((picked: OutputColumn) => ConditionOperator);
  /** The same union, for the same §7.5 reason: `mostFrequent` on a text field,
   *  a `0` literal on `<prefix>matches_n`. Unused for `kind: "attribute"`. */
  readonly value:
    | StyleValueSource
    | ((picked: OutputColumn) => StyleValueSource);
  /** The column to style by, from the ones the run ACTUALLY wrote, in the
   *  tool's own §7 order. Null when the run wrote nothing styleable. */
  readonly pick: (written: ReadonlyArray<OutputColumn>) => OutputColumn | null;
}

/** The ONE place either field is read, so `RunFooter` has no branch and a
 *  plain (non-function) descriptor is returned as it is. */
export function resolveStyleOperator(
  descriptor: StyleByResult,
  picked: OutputColumn,
): ConditionOperator {
  return typeof descriptor.operator === "function"
    ? descriptor.operator(picked)
    : descriptor.operator;
}

export function resolveStyleValueSource(
  descriptor: StyleByResult,
  picked: OutputColumn,
): StyleValueSource {
  return typeof descriptor.value === "function"
    ? descriptor.value(picked)
    : descriptor.value;
}
// ToolDefinition gains:  styleByResult: StyleByResult | null   (required on all seven)
// RunSummary:            firstColumnNonNull: number  BECOMES
//                        nonNullByColumn: Readonly<Record<string, number>>
// sql.ts gains:          buildMostFrequentSql(table, column): string
// sql.ts changes:        buildMedianSql casts to DOUBLE (the M2 DECIMAL trap)
```

`RunFooter` reads the descriptor; `run.columns[0]` becomes `tool.styleByResult.pick(written)`. No `toolId` may remain in `RunFooter`.

**Where `written: ReadonlyArray<OutputColumn>` comes from, since `RunRecord.columns` is names.** The record's `columns` are the TABLE's spellings of the columns the run actually wrote (`runQueue.ts` patches them after `canonicalise`). Their TYPES are reproducible exactly, because `run.prefix` and `run.params` are FROZEN and `tool.outputColumns` is pure: build a name→type map from `tool.outputColumns(run.prefix, run.params)`, matched case-insensitively (DuckDB identifiers are), and keep the record's spelling with the promise's type. The alternative — widening `RunRecord.columns` to `OutputColumn[]` — touches the queue, the log view, the history and a dozen test fixtures for a fact that is already derivable, so it is not done here. **A consequence Tasks 15-19 inherit, and the commander's ruling (Decisions item 6 (iii)):** every registry `outputColumns(prefix, params)` derives its types from the FROZEN PARAMS alone, and the signature stays TWO-argument. The one tool whose column types come from outside the bag is Join, and Task 15 puts them INSIDE it: `resolveCrossLayerParams` embeds the chosen fields' types as `params.fieldTypes`, so `joinColumns(prefix, params)` needs no third argument and this footer needs no live store read.

**`firstColumnNonNull` becomes `nonNullByColumn`.** `summarise` counts non-NULLs in `columns[0]`; after this task the styled column is `pick(written)`, which for Validate solids is the LAST column. It happens to coincide for M3's tools (they share one parse gate), but the record would be making a claim about a column nobody styles — and §6.2's "disabled with 'All values are empty' when the chosen column is NULL for every object in the run" is a statement about the CHOSEN column. Counting every written column is the same single pass over `result.rows`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/insights/sqlQuery.test.ts` — the suite that already owns `buildMedianSql`'s cases — first REPLACE the two existing `buildMedianSql` expectations with the cast form (the front matter's "`median` must CAST to DOUBLE", never implemented until now):

```ts
describe("buildMedianSql", () => {
  it("casts to DOUBLE, and takes the median over the ROOT rows only", () => {
    // The M2 DECIMAL trap. `median()` over a DECIMAL column answers with a
    // DECIMAL, which arrives in JS as an OBJECT — `typeof value === "number"`
    // in `RunFooter` is then false and §6.2's Style by result reports "All
    // values are empty" over a column full of numbers. Every computed column
    // this app writes is DOUBLE today, but a JOINED column (§7.5) copies the
    // source's own type, so the cast is the difference between a working
    // button and a silent one.
    //
    // Root rows only for the reason it always was: a run copies its value onto
    // the root AND its parts (§7.3), so a median over every row weights each
    // building by how many parts it happens to have modelled.
    expect(buildMedianSql("layer_1", "extent_height_m")).toBe(
      'SELECT median(CAST("extent_height_m" AS DOUBLE)) AS m FROM "layer_1" WHERE "feature_id" IS NULL OR "feature_id" = "id"',
    );
  });

  it("quotes a column whose name would otherwise end the identifier", () => {
    expect(buildMedianSql("layer_1", 'roof"area')).toBe(
      'SELECT median(CAST("roof""area" AS DOUBLE)) AS m FROM "layer_1" WHERE "feature_id" IS NULL OR "feature_id" = "id"',
    );
  });
});
```

and then append:

```ts
describe("buildMostFrequentSql", () => {
  it("is the modal value over the feature ROOTS only", () => {
    // The same restriction as `buildMedianSql`, for the same reason: a run
    // writes its value onto the root AND onto every part, so a mode over every
    // row weights each building by how many parts it happens to have modelled.
    // On 3D BAG, where every Building has exactly one geometry-bearing part,
    // the unrestricted answer is not even a value from the data.
    expect(buildMostFrequentSql("layer_3", "zones_name")).toBe(
      'SELECT mode("zones_name") AS m FROM "layer_3" WHERE ("feature_id" IS NULL OR "feature_id" = "id") AND "zones_name" IS NOT NULL',
    );
  });

  it("quotes an identifier with a quote in it", () => {
    expect(buildMostFrequentSql('a"b', 'c"d')).toContain('FROM "a""b"');
  });
});
```

And append to `tests/integration/duckdb/computedColumns.test.ts`, inside the same `describe` as its existing `buildMedianSql` case (`:543-580`), which already imports the builder and runs it against a real table:

```ts
it("reads a DECIMAL column back as a NUMBER through buildMedianSql", () => {
  // The M2 DECIMAL trap, against the real engine and through the BUILDER —
  // not through a hand-written `median(CAST(...))`, which would pass while the
  // builder went on emitting the uncast form. A joined column (§7.5) carries
  // the source's own type, and DuckDB hands a DECIMAL to JS as an object.
  const TABLE = "layer_cc5";
  db.query(
    `CREATE OR REPLACE TABLE ${quoteIdent(TABLE)} AS
       SELECT "id", "feature_id", CAST("v" AS DECIMAL(18, 3)) AS "zones_rate"
       FROM (VALUES
         ('b1', 'b1', 1.5),
         ('b2', 'b2', 2.5),
         ('b3', 'b3', 9.5)
       ) AS t("id", "feature_id", "v")`,
  );
  const rows = db.query(buildMedianSql(TABLE, "zones_rate"));
  expect(typeof rows[0]?.["m"]).toBe("number");
  expect(Number(rows[0]?.["m"])).toBeCloseTo(2.5, 6);
});
```

Create `tests/unit/ui/processing/styleByResult.test.tsx`:

```tsx
/**
 * §6.2's "Style by result", through ONE descriptor on the tool definition.
 *
 * What is asserted is the DRAFT the button produces — attribute, operator,
 * value — plus the two reasons the button is disabled, the one case where it is
 * absent, and the descriptors themselves.
 *
 * EVERY CASE SEEDS ITS RUN INTO THE PROCESSING STORE. The click handler
 * re-reads the run by id before it writes a draft (§7: a run that went stale or
 * was undone while the read was in flight no longer describes the column the
 * value came from), so a record that exists only as a prop is a run that
 * `runById` cannot find and the draft is never written.
 *
 * THE `mostFrequent` PATH IS NOT EXERCISED THROUGH THE FOOTER HERE. Its only
 * descriptor is Join's, whose `pick` looks for a VARCHAR column, and a column's
 * TYPE is reproduced from `tool.outputColumns` — which Join does not have until
 * Task 15 embeds its `fieldTypes`. So this file pins Join's descriptor
 * DIRECTLY (the `pick` and the resolvers, over columns it types itself) and
 * Task 16, where Join ships, adds the end-to-end footer case.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { RunRecord } from "../../../../src/features/processing/types";

/**
 * Every statement the footer's value read issued, in order. The cases read THIS
 * rather than `runQuery.mock.calls[0]?.[0]`: a zero-parameter `vi.fn` types its
 * call tuple as `[]`, so the indexed read is `undefined` and the assertion
 * cannot compile. Declaring the parameter and using it also keeps
 * `no-unused-vars: error` happy.
 */
const statements: string[] = [];
const MEDIAN_ROWS = () => ({
  ok: true as const,
  columns: ["m"],
  rows: [{ m: 4.2 } as Record<string, unknown>],
});
const runQuery = vi.fn(async (sql: string) => {
  statements.push(sql);
  return MEDIAN_ROWS();
});
vi.mock("../../../../src/insights/duckdb", () => ({
  runQuery,
  ddl: vi.fn(async () => ({ ok: false, message: "no engine" })),
  registerBuffer: vi.fn(async () => false),
  dropBuffer: vi.fn(async () => {}),
  readFile: vi.fn(async () => null),
  getDuckDBStatus: vi.fn(() => ({
    state: "ready",
    extensions: {
      cityjson: { state: "loaded" },
      spatial: { state: "unloaded" },
      three_d: { state: "unloaded" },
    },
    loadedExtensions: [],
    platform: "wasm_eh",
  })),
  getDuckDBStatusVersion: vi.fn(() => 0),
  subscribeDuckDBStatus: vi.fn(() => () => {}),
  getEngineGeneration: vi.fn(() => 1),
  onEngineDeath: vi.fn(() => () => {}),
  isExtensionLoaded: vi.fn(() => true),
  ensureExtension: vi.fn(async () => true),
  formatDuckDBError: (e: unknown) => String(e),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
  initDuckDB: vi.fn(async () => {}),
}));
vi.mock("../../../../src/features/processing/runQueue", () => ({
  submitRun: vi.fn(() => "run_1"),
  retryRun: vi.fn(() => "run_2"),
  cancelRun: vi.fn(),
  undoRun: vi.fn(async () => {}),
}));

const { RunFooter } = await import("../../../../src/ui/processing/RunFooter");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useLayerTableStore } =
  await import("../../../../src/insights/layerTables");
const { useRuleDraftStore } =
  await import("../../../../src/features/rules/ruleDraftStore");
const { useProcessingStore } =
  await import("../../../../src/features/processing/processingStore");
const { toolById } =
  await import("../../../../src/features/processing/toolRegistry");
const { resolveStyleOperator, resolveStyleValueSource } =
  await import("../../../../src/features/processing/types");

function addLayer(): string {
  const id = useLayerStore.getState().addLayer({
    name: "Delft",
    model: {
      sourceEncoding: "cityjson",
      metadata: {},
      bbox: null,
      vertexCount: 0,
      objects: {},
    } as never,
    modelRef: { type: "url", url: "https://x/d.city.json" },
    visible: true,
    rules: [],
    colorBy: "surface",
    isStreaming: false,
  });
  useLayerTableStore.setState((s) => ({
    tables: {
      ...s.tables,
      [id]: {
        state: "ready",
        info: {
          table: "layer_1",
          sourceName: null,
          source: null,
          reader: null,
          extension: null,
          sourceBytes: null,
          columns: [],
          lods: [],
          rowCount: 2,
        },
      },
    },
  }));
  return id;
}

function doneRun(over: Partial<RunRecord>): RunRecord {
  return {
    id: "run_1",
    toolId: "measure-solids",
    targetLayerId: "?",
    targetName: "Delft",
    sourceLayerId: null,
    sourceName: null,
    scope: "all",
    scopeCount: 2,
    featureIds: null,
    lod: "2.2",
    params: { measures: ["volume", "envelope", "footprint", "height"] },
    prefix: "solid_",
    columns: [
      "solid_volume_m3",
      "solid_envelope_m2",
      "solid_footprint_m2",
      "solid_height_m",
      "solid_valid",
    ],
    status: "done",
    phase: null,
    startedAt: 0,
    elapsedMs: 2400,
    summary: {
      line: "2 buildings measured · 2.4 s",
      detail: null,
      measured: 2,
      skipped: [],
      nonNullByColumn: {
        solid_volume_m3: 2,
        solid_envelope_m2: 2,
        solid_footprint_m2: 2,
        solid_height_m: 2,
        solid_valid: 2,
      },
    },
    error: null,
    log: [],
    warnings: [],
    undoable: true,
    stale: false,
    note: null,
    ...over,
  } as RunRecord;
}

/**
 * The record, IN THE STORE and handed back for the prop.
 *
 * The click handler re-reads the run by id before it writes a draft (§7: a
 * stale or undone run no longer describes the column the value came from), so a
 * record that lives only as a prop is one `runById` cannot find — and every
 * case below would silently assert an empty draft store.
 */
function seed(run: RunRecord): RunRecord {
  useProcessingStore.setState({ runs: [run] });
  return run;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  statements.length = 0;
  runQuery.mockImplementation(async (sql: string) => {
    statements.push(sql);
    return MEDIAN_ROWS();
  });
  useLayerStore.getState().removeAllLayers();
  useLayerTableStore.setState({ tables: {} });
  useRuleDraftStore.setState({ drafts: {} });
  useProcessingStore.getState().resetForTest();
});

describe("Style by result, from the descriptor", () => {
  it("opens Measure solids' draft on the first WRITTEN column, at the median", () => {
    const id = addLayer();
    render(
      <RunFooter
        run={seed(doneRun({ targetLayerId: id }))}
        canRun
        reason={null}
        onRunAgain={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Style by result" }));
    return waitFor(() => {
      const draft = useRuleDraftStore.getState().drafts[id];
      expect(draft?.form?.conditions).toEqual([
        { field: "solid_volume_m3", operator: ">", value: 4.2 },
      ]);
      expect(draft?.form?.name).toBe("solid_volume_m3");
    });
  });

  it("picks the next written column when the first measure was unticked", () => {
    // §6.2: "the first column the run ACTUALLY wrote, in the order §7 lists for
    // that tool (an unticked measure is never chosen)".
    const id = addLayer();
    render(
      <RunFooter
        run={seed(
          doneRun({
            targetLayerId: id,
            params: { measures: ["footprint"] },
            columns: ["solid_footprint_m2", "solid_valid"],
            summary: {
              ...doneRun({}).summary!,
              nonNullByColumn: { solid_footprint_m2: 2, solid_valid: 2 },
            },
          }),
        )}
        canRun
        reason={null}
        onRunAgain={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Style by result" }));
    return waitFor(() => {
      expect(
        useRuleDraftStore.getState().drafts[id]?.form?.conditions?.[0]?.field,
      ).toBe("solid_footprint_m2");
    });
  });

  it("needs no query for a LITERAL value, and writes a BOOLEAN condition", async () => {
    // §7.3's descriptor: `solid_valid = false`. The value is not read from the
    // data, so no round trip happens at all, and the condition carries the
    // BOOLEAN `false` — not the string "false", which `evaluateCondition`'s
    // strict `===` would never match. The editor's own Save path for this
    // draft is pinned in `RulesEditor.test.tsx` (Step 1b), where the editor
    // already has a harness.
    const id = addLayer();
    render(
      <RunFooter
        run={seed(
          doneRun({
            targetLayerId: id,
            toolId: "validate-solids",
            params: {},
            columns: [
              "solid_closed",
              "solid_manifold",
              "solid_oriented",
              "solid_valid",
              "solid_open_edges_n",
              "solid_nonmanifold_edges_n",
              "solid_degenerate_faces_n",
            ],
            summary: {
              ...doneRun({}).summary!,
              nonNullByColumn: { solid_valid: 2 },
            },
          }),
        )}
        canRun
        reason={null}
        onRunAgain={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Style by result" }));
    await waitFor(() => {
      expect(useRuleDraftStore.getState().drafts[id]?.form?.conditions).toEqual(
        [{ field: "solid_valid", operator: "=", value: false }],
      );
    });
    expect(runQuery).not.toHaveBeenCalled();
    expect(
      typeof useRuleDraftStore.getState().drafts[id]?.form?.conditions?.[0]
        ?.value,
    ).toBe("boolean");
  });

  it("reads §7.5's descriptor DIRECTLY: the first copied TEXT field, most frequent", () => {
    // Join's descriptor, without the footer. Its `pick` looks for a VARCHAR,
    // and a written column's TYPE is reproduced from `tool.outputColumns` —
    // which Join does not have until Task 15 embeds its `fieldTypes`. So the
    // columns are typed HERE, and Task 16, where Join ships, adds the footer
    // case that presses the button and reads `mode(` off the statement.
    const descriptor = toolById("join-by-location").styleByResult!;
    const text = { name: "zones_name", type: "VARCHAR" as const };
    const count = { name: "zones_matches_n", type: "DOUBLE" as const };

    expect(descriptor.pick([text, count])).toEqual(text);
    expect(resolveStyleOperator(descriptor, text)).toBe("=");
    expect(resolveStyleValueSource(descriptor, text)).toEqual({
      kind: "mostFrequent",
    });
    // No text field copied: nothing to style by YET. §7.5's other half
    // (`<prefix>matches_n > 0`, which is what the operator/value FUNCTION
    // unions exist for) is Task 16's, with the tool that ships it.
    expect(descriptor.pick([count])).toBeNull();
  });

  it("resolves a PLAIN descriptor's operator and value as they are", () => {
    // The five tools that need one answer pass it plainly, and the resolvers
    // must hand those straight back — `RunFooter` has no branch of its own.
    const solids = toolById("measure-solids").styleByResult!;
    const column = { name: "solid_volume_m3", type: "DOUBLE" as const };
    expect(resolveStyleOperator(solids, column)).toBe(">");
    expect(resolveStyleValueSource(solids, column)).toEqual({ kind: "median" });
  });

  it("disables the button with §6.2's reason when the CHOSEN column is empty", () => {
    // Not `columns[0]`: the chosen column is the descriptor's, which for
    // Validate solids is the fourth one written.
    const id = addLayer();
    render(
      <RunFooter
        run={seed(
          doneRun({
            targetLayerId: id,
            summary: {
              ...doneRun({}).summary!,
              nonNullByColumn: { solid_volume_m3: 0, solid_envelope_m2: 2 },
            },
          }),
        )}
        canRun
        reason={null}
        onRunAgain={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Style by result" }),
    ).toBeDisabled();
    expect(screen.getByText("All values are empty")).toBeInTheDocument();
  });

  it("is ABSENT when the descriptor picks nothing", () => {
    // §6.2: "absent when the run wrote no styleable column".
    const id = addLayer();
    render(
      <RunFooter
        run={seed(
          doneRun({
            targetLayerId: id,
            toolId: "join-by-location",
            prefix: "zones_",
            params: {
              fields: [],
              tie: "countOnly",
              writeMatchCount: true,
              proxy: "centre",
              predicate: "intersects",
            },
            columns: [],
            summary: { ...doneRun({}).summary!, nonNullByColumn: {} },
          }),
        )}
        canRun
        reason={null}
        onRunAgain={() => {}}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Style by result" }),
    ).toBeNull();
  });
});
```

- [ ] **Step 1b: Pin the editor's BOOLEAN Save path where the editor has a harness**

§7.3's draft is the first BOOLEAN `=` rule anything in this app has produced, and the front matter's design decision (e) says Task 9 pins that rather than assuming it. The assertion belongs in `tests/unit/ui/layers/RulesEditor.test.tsx`, which already stands the editor up (`render(<RulesEditor model={emptyModel()} layerId="A" />)`, layers "A" and "B" in its `beforeEach`, the draft store cleared in its `afterEach`, and Save spelled **"Add"** for a new rule). Append to its draft `describe`:

```tsx
it("saves a BOOLEAN condition from a draft as a boolean, and it evaluates", () => {
  // The draft §6.2's Style by result writes for Validate solids
  // (`solid_valid = false`). The value must survive Save as a BOOLEAN:
  // `evaluateCondition` compares `=` with a strict `===`, so the string
  // "false" would match nothing and the map would simply not change.
  //
  // The layer is set up the way a RUN leaves it, not the way the shortest
  // test would: `runQueue` merges the values onto the objects (so
  // `collectAttributeFields` finds the column) and registers the provenance
  // (so it renders in the editor's COMPUTED optgroup). The condition's field
  // is then an option the select actually offers, which is the path
  // production takes — a controlled select whose value is in none of its
  // options renders with nothing chosen.
  useLayerStore.setState({
    layers: [
      baseLayer({
        id: "A",
        name: "Delft",
        model: {
          ...emptyModel(),
          objects: {
            b1: {
              id: "b1",
              objectType: "Building",
              attributes: { solid_valid: false },
              surfaces: [],
              bbox: null,
              children: [],
              parents: [],
              lod: null,
            },
          },
        } as unknown as CityModel,
      }),
      baseLayer({ id: "B", name: "Rotterdam" }),
    ],
  });
  useComputedColumnStore.getState().setProvenance("A", "solid_valid", {
    runId: "run_1",
    toolName: "Validate solids",
    summary: "1 valid",
    at: 0,
    partial: null,
    previous: null,
  });
  useRuleDraftStore.getState().setDraft("A", {
    editingId: null,
    open: true,
    form: {
      name: "solid_valid",
      color: NEW_RULE_COLOR_HEX,
      logic: "AND",
      conditions: [{ field: "solid_valid", operator: "=", value: false }],
    },
  });
  const model = useLayerStore
    .getState()
    .layers.find((l) => l.id === "A")!.model;
  render(<RulesEditor model={model} layerId="A" />);
  // The select offers the column, in its own COMPUTED group (spec §8).
  expect(screen.getByRole("combobox", { name: "Attribute" })).toHaveValue(
    "solid_valid",
  );
  fireEvent.click(screen.getByText("Add"));

  const rule = useLayerStore.getState().layers.find((l) => l.id === "A")!
    .rules[0]!;
  expect(rule.conditions).toEqual([
    { field: "solid_valid", operator: "=", value: false },
  ]);
  // `evaluateRule(attributes, metrics, rule)` — attributes FIRST.
  const metrics = {
    areaSqM: 0,
    inclinationDeg: 0,
    azimuthDeg: 0,
    elevationM: 0,
  };
  expect(evaluateRule({ solid_valid: false }, metrics, rule)).toBe(true);
  expect(evaluateRule({ solid_valid: true }, metrics, rule)).toBe(false);
});
```

with `import { evaluateRule } from "@cityjson/navara-core";` added to that file's imports (`NEW_RULE_COLOR_HEX`, `useRuleDraftStore`, `useLayerStore`, `useComputedColumnStore`, `CityModel`, `baseLayer` and `emptyModel` are all already there, and its `afterEach` already clears both stores).

- [ ] **Step 2: Run and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/insights/sqlQuery.test.ts \
  tests/unit/ui/processing/styleByResult.test.tsx \
  tests/unit/ui/layers/RulesEditor.test.tsx
```

Expected: FAIL — `buildMostFrequentSql` and `ToolDefinition.styleByResult` do not exist, `buildMedianSql` emits the uncast form, and `RunSummary` has `firstColumnNonNull`.

- [ ] **Step 3: Declare the descriptor**

In `src/features/processing/types.ts`, add to the imports:

```ts
import type { ConditionOperator } from "../rules/types";
```

and, above `interface ToolDefinition`:

```ts
/**
 * Where §6.2's prefilled rule value comes from: "median for a numeric column,
 * the most frequent value for a text column, `false` for a validity flag".
 */
export type StyleValueSource =
  | { readonly kind: "median" }
  | { readonly kind: "mostFrequent" }
  | { readonly kind: "literal"; readonly value: number | string | boolean };

/**
 * §6.2's "Style by result", as data on the tool rather than as a branch in the
 * footer.
 *
 * Seven tools want seven combinations of (which column, which operator, which
 * value, rule or Color-by-attribute). A `switch (toolId)` in `RunFooter` would
 * put that knowledge in the component furthest from the tool that owns it, and
 * the footer would grow a case per tool for ever.
 */
export interface StyleByResult {
  /** "rule" opens the rule editor on a draft; "attribute" opens a vector
   *  layer's Color by attribute on the picked column (spec §7.6). */
  readonly kind: "rule" | "attribute";
  /**
   * The rule's operator. A FUNCTION of the picked column for §7.5, whose rule
   * is `=` on a copied TEXT field but `>` on `<prefix>matches_n` when no text
   * field was copied — two operators chosen by which column `pick` returned.
   * The five descriptors that need only one operator pass it plainly.
   */
  readonly operator:
    | ConditionOperator
    | ((picked: OutputColumn) => ConditionOperator);
  /** The same union, for the same §7.5 reason: `mostFrequent` on a text field,
   *  a `0` literal on `<prefix>matches_n`. Unused for `kind: "attribute"`. */
  readonly value:
    | StyleValueSource
    | ((picked: OutputColumn) => StyleValueSource);
  /**
   * The column to style by, from the ones the run ACTUALLY wrote, in the
   * tool's own §7 order. Null when the run wrote nothing styleable.
   *
   * It takes the WRITTEN columns, not the prefix, because §6.2's rule is "the
   * first column the run actually wrote … (an unticked measure is never
   * chosen)" — a rule about what happened, not about what was offered. It takes
   * them TYPED because §7.5's own answer is "the first copied TEXT field".
   */
  readonly pick: (written: ReadonlyArray<OutputColumn>) => OutputColumn | null;
}

/** The ONE place either field is read, so `RunFooter` has no branch and a
 *  plain (non-function) descriptor is returned as it is. */
export function resolveStyleOperator(
  descriptor: StyleByResult,
  picked: OutputColumn,
): ConditionOperator {
  return typeof descriptor.operator === "function"
    ? descriptor.operator(picked)
    : descriptor.operator;
}

export function resolveStyleValueSource(
  descriptor: StyleByResult,
  picked: OutputColumn,
): StyleValueSource {
  return typeof descriptor.value === "function"
    ? descriptor.value(picked)
    : descriptor.value;
}
```

**Why `operator` and `value` are each a union with a function.** §7.5's Style by result is "a rule on the first copied TEXT field `=` its most frequent value; if no text field was copied, on `<prefix>matches_n > 0`" — two different operators AND two different value sources, chosen by the column `pick` returned. One plain `operator` and one plain `value` cannot express it, and the alternative (a second descriptor, or a `toolId` branch in `RunFooter`) is exactly the seam this task exists to remove. The five descriptors that need one answer pass it plainly; Task 16 is the only supplier that passes functions, and it supplies nothing but the descriptor.

Inside `ToolDefinition`, after `normaliseParams`:

```ts
  /**
   * §6.2's Style by result for this tool, or null when it has none.
   *
   * REQUIRED on every entry, so a new tool cannot ship with the footer quietly
   * guessing `columns[0] >` median on its behalf.
   */
  readonly styleByResult: StyleByResult | null;
```

And replace `RunSummary.firstColumnNonNull`. Find:

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

and replace with:

```ts
  /**
   * How many written rows have a value, per output column.
   *
   * Spec §6.2 disables Style by result "when the chosen column is NULL for
   * every object in the run", and the CHOSEN column is the one the tool's
   * `styleByResult.pick` returns — for Validate solids that is the fourth
   * column written, not the first. It is not the same as `measured === 0`: a
   * run with only Dominant azimuth ticked over flat roofs measures every
   * building and writes NULL to all of them (§7, "a feature with no remaining
   * contributor for a measure gets NULL for it").
   */
  readonly nonNullByColumn: Readonly<Record<string, number>>;
```

- [ ] **Step 4: Count every column in `summarise`**

In `src/features/processing/runQueue.ts`, find:

```ts
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
```

and replace with:

```ts
// Every written column, in ONE pass: §6.2's "All values are empty" is about
// the column the tool's `styleByResult` CHOOSES, which is not always the
// first one written (Validate solids styles `<prefix>valid`, its fourth).
const nonNullByColumn: Record<string, number> = {};
for (const col of result.columns) nonNullByColumn[col.name] = 0;
for (const values of result.rows.values()) {
  for (const col of result.columns) {
    const value = values[col.name];
    if (value !== null && value !== undefined) {
      nonNullByColumn[col.name] = (nonNullByColumn[col.name] ?? 0) + 1;
    }
  }
}
```

and in the returned object replace `firstColumnNonNull,` with `nonNullByColumn,`. Then sweep the readers:

```bash
grep -rn "firstColumnNonNull" src/ tests/
```

Every remaining hit is a test fixture's summary literal; replace `firstColumnNonNull: N` with `nonNullByColumn: { <the column>: N }`.

- [ ] **Step 5: Cast the median, and add the modal-value builder**

In `src/insights/sql.ts`, replace `buildMedianSql`'s body (`:438-439`) — its doc comment's root-row paragraph stays exactly as it is:

```ts
export function buildMedianSql(table: string, column: string): string {
  // CAST to DOUBLE, always. `median()` over a DECIMAL column answers with a
  // DECIMAL, which reaches JS as an OBJECT — `typeof value === "number"` in
  // `RunFooter` is then false, and §6.2's Style by result reports "All values
  // are empty" over a column full of numbers. Every column the tools write
  // today is DOUBLE, but §7.5's Join copies the SOURCE's own type, so this is
  // the difference between a working button and a silently dead one.
  return `SELECT median(CAST(${quoteIdent(column)} AS DOUBLE)) AS m FROM ${quoteIdent(table)} WHERE "feature_id" IS NULL OR "feature_id" = "id"`;
}
```

and immediately after it:

```ts
/**
 * The most frequent value of one COMPUTED COLUMN, over the feature ROOTS only
 * — §6.2's prefilled value for a TEXT column.
 *
 * Root-only for exactly `buildMedianSql`'s reason: a run writes its value onto
 * the root row AND onto each part (§7, "then copied to root and parts alike"),
 * so a mode over every row weights each building by how many parts it happens
 * to have modelled. A building with six parts must not outvote one with none.
 *
 * NULLs are excluded explicitly rather than left to `mode()`'s own handling, so
 * the answer is a value the user can see in the data — a NULL prefilled into a
 * rule is a condition that matches nothing.
 */
export function buildMostFrequentSql(table: string, column: string): string {
  const col = quoteIdent(column);
  return `SELECT mode(${col}) AS m FROM ${quoteIdent(table)} WHERE ("feature_id" IS NULL OR "feature_id" = "id") AND ${col} IS NOT NULL`;
}
```

- [ ] **Step 6: Give all seven tools a descriptor**

In `src/features/processing/toolRegistry.ts`, add `styleByResult` to every entry. The four numeric-first tools and the two that follow §7.5/§7.7 take the same shape; only Validate solids and Aggregate differ.

```ts
/**
 * §6.2's default: the first column the run actually wrote. Correct for every
 * tool whose §7 order puts its primary measure first — Roof metrics
 * (`roof_area_m2 >` median), Measure solids (`solid_volume_m3 >` median) and
 * Height from extent (`extent_height_m >` median).
 */
const firstWritten = (
  written: ReadonlyArray<OutputColumn>,
): OutputColumn | null => written[0] ?? null;
```

Then, per entry:

- `roof-metrics`, `measure-solids`, `height-from-extent`:

```ts
    styleByResult: {
      kind: "rule",
      operator: ">",
      value: { kind: "median" },
      pick: firstWritten,
    },
```

- `validate-solids` (§7.3: "a rule on `solid_valid = false`"). Task 10 flips this tool on; the descriptor is correct from here:

```ts
    styleByResult: {
      kind: "rule",
      operator: "=",
      value: { kind: "literal", value: false },
      // The validity flag by NAME, not by position: §7.3 writes seven columns
      // and this is the fourth. `endsWith` rather than an interpolated prefix,
      // because the run's prefix is the user's and the table's spelling wins.
      pick: (written) =>
        written.find((c) => c.name.toLowerCase().endsWith("valid")) ?? null,
    },
```

- `join-by-location` (§7.5: "rule on the first copied text field `=` its most frequent value"):

```ts
    styleByResult: {
      kind: "rule",
      operator: "=",
      value: { kind: "mostFrequent" },
      pick: (written) => written.find((c) => c.type === "VARCHAR") ?? null,
    },
```

- `distance-to-nearest` (§7.7: "rule on `<prefix>distance_m <` median"):

```ts
    styleByResult: {
      kind: "rule",
      operator: "<",
      value: { kind: "median" },
      pick: (written) =>
        written.find((c) => c.name.toLowerCase().endsWith("distance_m")) ?? null,
    },
```

- `aggregate-per-area` (§7.6: "Color by attribute set to the first output column"):

```ts
    styleByResult: {
      kind: "attribute",
      // Unused for "attribute"; stated rather than left to a cast, because the
      // field is required and a lie would be worse than a redundancy.
      operator: "=",
      value: { kind: "literal", value: true },
      pick: firstWritten,
    },
```

Add `import type { OutputColumn } from "../../insights/computedColumns";` at the top of the registry.

- [ ] **Step 7: Make `RunFooter` read the descriptor**

In `src/ui/processing/RunFooter.tsx`, add the imports:

```ts
import { toolById } from "../../features/processing/toolRegistry";
import {
  resolveStyleOperator,
  resolveStyleValueSource,
  type StyleByResult,
  type StyleValueSource,
} from "../../features/processing/types";
import { runById } from "../../features/processing/processingStore";
import type { OutputColumn } from "../../insights/computedColumns";
import { buildMedianSql, buildMostFrequentSql } from "../../insights/sql";
```

(replacing the existing single-name `buildMedianSql` import; `useProcessingStore` is already imported from `processingStore`, so `runById` joins that line rather than adding a second one. The two resolvers are VALUES, not types — they are called below.) Then replace `readMedian` with:

```ts
/**
 * The columns the run WROTE, with their types.
 *
 * `RunRecord.columns` are the TABLE's spellings of what the run actually wrote;
 * the types are reproducible exactly, because `run.prefix` and `run.params` are
 * FROZEN (§6.1) and `outputColumns` is pure. Matched without regard to case,
 * like every other comparison between column names — DuckDB's identifiers are
 * case-insensitive and the table's spelling is the one that wins.
 */
function writtenColumns(run: RunRecord): ReadonlyArray<OutputColumn> {
  const promised = new Map(
    (toolById(run.toolId).outputColumns?.(run.prefix, run.params) ?? []).map(
      (c) => [c.name.toLowerCase(), c.type],
    ),
  );
  return run.columns.map((name) => ({
    name,
    // DOUBLE is the fallback for a tool that promises no columns at all; every
    // tool in the registry does, so it is unreachable rather than a guess.
    type: promised.get(name.toLowerCase()) ?? "DOUBLE",
  }));
}

/**
 * §6.2's prefilled value, or `null` when it could not be read.
 *
 * `null` is not a failure to report when the TABLE is gone: the button is only
 * offered on a DONE run whose own writes went into that table, and a table that
 * has since gone takes the layer out of the tool's target list altogether. A
 * literal needs no engine at all.
 */
async function readStyleValue(
  layerId: string,
  column: string,
  // The RESOLVED source, never `StyleByResult["value"]` — that union includes
  // a FUNCTION of the picked column (§7.5 needs two answers), and `.kind` does
  // not exist on it. The caller resolves it with `resolveStyleValueSource`,
  // which is the one place either function-union field is read.
  source: StyleValueSource,
): Promise<
  QueryOutcome | null | { readonly literal: number | string | boolean }
> {
  if (source.kind === "literal") return { literal: source.value };
  const entry = useLayerTableStore.getState().tables[layerId];
  if (entry?.state !== "ready") return null;
  return await runQuery(
    source.kind === "median"
      ? buildMedianSql(entry.info.table, column)
      : buildMostFrequentSql(entry.info.table, column),
  );
}
```

In `useStyleByResult`, change `start`'s signature to `(run: RunRecord, column: OutputColumn, descriptor: StyleByResult) => void` and its body's middle. Replace:

```ts
const outcome = await readMedian(layerId, column);
if (tokenRef.current !== token) return;
if (outcome === null) return;
```

with:

```ts
const outcome = await readStyleValue(
  layerId,
  column.name,
  resolveStyleValueSource(descriptor, column),
);
if (tokenRef.current !== token) return;
if (outcome === null) return;
```

and replace the value extraction and the draft. Find the block from `if (!outcome.ok) {` through `useShellStore.getState().requestSection(layerId, "style");` and replace with:

```ts
// §7: a run that went stale or was undone while the read was in flight
// no longer describes the column this value came from.
const current = runById(run.id);
if (current === null || current.stale || current.status !== "done") return;

let value: number | string | boolean;
if ("literal" in outcome) {
  value = outcome.literal;
} else {
  if (!outcome.ok) {
    // Verbatim: `runQuery` has already put the error through
    // `formatDuckDBError`, which IS §6.3's "first error line".
    useProcessingStore.getState().pushNotice(outcome.message);
    return;
  }
  const read = outcome.rows[0]?.["m"];
  const usable =
    (typeof read === "number" && Number.isFinite(read)) ||
    typeof read === "string" ||
    typeof read === "boolean";
  if (!usable) {
    useProcessingStore.getState().pushNotice(ALL_VALUES_EMPTY);
    return;
  }
  value = read;
}

if (descriptor.kind === "attribute") {
  // §7.6: "Style by result opens the vector layer's STYLE section with
  // Color by attribute set to the first output column". The section is
  // opened here; the attribute prefill needs the vector layer's
  // category computation and lands with Aggregate buildings per area,
  // the only tool with this descriptor — which is `implemented: false`
  // until then, so this branch is unreachable in the meantime.
  useShellStore.getState().requestSection(layerId, "style");
  return;
}

useRuleDraftStore.getState().setDraft(layerId, {
  editingId: null,
  open: true,
  form: {
    // Named after the column, not left empty as "+ Add rule" starts:
    // the editor will not save an unnamed rule, and a user who came
    // here by pressing one button should not have to invent a name
    // before they can see the result on the map.
    name: column.name,
    color: NEW_RULE_COLOR_HEX,
    logic: "AND",
    conditions: [
      {
        field: column.name,
        operator: resolveStyleOperator(descriptor, column),
        value,
      },
    ],
  },
});
useLayerStore.getState().updateLayer(layerId, { colorBy: "rules" });
// Last, so the panel opens on a draft that is already written.
useShellStore.getState().requestSection(layerId, "style");
```

(The eager `colorBy: "rules"` stays exactly where it is — moving it to the editor's Save is Task 26's change, and doing both at once would make one commit two bugs' worth of behaviour.)

In the `status === "done"` branch, replace:

```ts
const styleColumn = run.columns[0];
```

with:

```ts
// §6.2/§7 through ONE descriptor: the tool says which column, which
// operator and where the value comes from. No `toolId` appears in this
// component.
const descriptor = toolById(run.toolId).styleByResult;
const written = writtenColumns(run);
const styleColumn = descriptor?.pick(written) ?? null;
```

and the disabled reason:

```ts
const styleReason = run.stale
  ? STALE_LAYER_RELOADED
  : styleColumn === null ||
      run.summary === null ||
      (run.summary.nonNullByColumn[styleColumn.name] ?? 0) === 0
    ? ALL_VALUES_EMPTY
    : null;
```

and the two `styleColumn !== undefined` guards become `styleColumn !== null`, with the click handler `onClick={() => style.start(run, styleColumn, descriptor!)}` — or, avoiding the assertion, wrap the button in `{descriptor !== null && styleColumn !== null && (…)}`.

- [ ] **Step 8: Run to pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/insights tests/unit/ui/processing \
  tests/unit/features/processing tests/unit/ui/layers/RulesEditor.test.tsx
npx tsc -b --noEmit
grep -rn "toolId ===" src/ui/processing/RunFooter.tsx
DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/computedColumns.test.ts
```

Expected: PASS, and the grep prints nothing — `RunFooter` no longer knows a tool by name.

- [ ] **Step 9: Commit**

```bash
git add src/features/processing/types.ts src/features/processing/toolRegistry.ts \
  src/features/processing/runQueue.ts src/ui/processing/RunFooter.tsx \
  src/insights/sql.ts tests/unit/insights/sqlQuery.test.ts \
  tests/unit/ui/processing/styleByResult.test.tsx \
  tests/unit/ui/layers/RulesEditor.test.tsx \
  tests/integration/duckdb/computedColumns.test.ts
# plus the `firstColumnNonNull` → `nonNullByColumn` fixtures from Step 4:
git add $(git diff --name-only -- tests/)
git commit -m "refactor: Style by result reads one descriptor, not a branch per tool"
```

---
