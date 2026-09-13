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
 * JOIN'S OWN descriptor is pinned DIRECTLY, not through the footer. Its `pick`
 * looks for a VARCHAR column, and a written column's TYPE is reproduced from
 * `tool.outputColumns` — which Join does not have until Task 15 embeds its
 * `fieldTypes`. So its `pick` and the resolvers are asserted over columns this
 * file types itself, and Task 16, where Join ships, adds Join's own end-to-end
 * footer case.
 *
 * The `mostFrequent` read and the FUNCTION forms are nonetheless exercised
 * through the real footer, against the synthetic tool declared below — see the
 * comment on that mock for why a tool had to be invented to do it.
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

/**
 * ONE tool definition is replaced, so the footer's FUNCTION-form path has
 * something real to run.
 *
 * `StyleByResult.operator` and `.value` are each `T | ((picked) => T)` because
 * §7.5 needs two answers chosen by the column `pick` returned, and the ONLY
 * supplier of the function forms is Task 16, with the tool that ships them.
 * Until then nothing in the registry exercises those branches through the
 * component, and the resolvers would be proven only against plain values —
 * which is exactly the half that needs no resolver.
 *
 * So `distance-to-nearest` (unimplemented, unused by every other case here) is
 * given a descriptor of the §7.5 SHAPE: `=` and the modal value on a VARCHAR,
 * `<` and the median on a DOUBLE. The registry is otherwise the REAL one — the
 * mock delegates every other id to it, and the footer, the resolvers, the SQL
 * builders and the draft store are all the real ones. What is substituted is
 * the tool's own data, which is the input this seam exists to read.
 */
vi.mock("../../../../src/features/processing/toolRegistry", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/features/processing/toolRegistry")
  >("../../../../src/features/processing/toolRegistry");
  const synthetic: (typeof actual.TOOLS)[number] = {
    ...actual.toolById("distance-to-nearest"),
    outputColumns: (prefix) => [
      { name: `${prefix}name`, type: "VARCHAR" },
      { name: `${prefix}distance_m`, type: "DOUBLE" },
    ],
    styleByResult: {
      kind: "rule",
      operator: (picked) => (picked.type === "VARCHAR" ? "=" : "<"),
      value: (picked) =>
        picked.type === "VARCHAR"
          ? { kind: "mostFrequent" }
          : { kind: "median" },
      pick: (written) => written[0] ?? null,
    },
  };
  return {
    ...actual,
    toolById: (id: Parameters<typeof actual.toolById>[0]) =>
      id === "distance-to-nearest" ? synthetic : actual.toolById(id),
  };
});

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
  it("opens Measure solids' draft on the first WRITTEN column, at the median", async () => {
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
    await waitFor(() => {
      const draft = useRuleDraftStore.getState().drafts[id];
      expect(draft?.form?.conditions).toEqual([
        { field: "solid_volume_m3", operator: ">", value: 4.2 },
      ]);
      expect(draft?.form?.name).toBe("solid_volume_m3");
    });
    // The descriptor's `{ kind: "median" }` reaching the builder, CAST and
    // root-rows-only — the statement is what the user's threshold is computed
    // from, so it is asserted and not merely counted.
    expect(statements).toEqual([
      'SELECT median(CAST("solid_volume_m3" AS DOUBLE)) AS m FROM "layer_1" WHERE "feature_id" IS NULL OR "feature_id" = "id"',
    ]);
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

  it("resolves the FUNCTION forms per picked column, through the footer", async () => {
    // §7.5's shape end to end: the same descriptor answers `=` + the modal
    // value on a TEXT column and `<` + the median on a numeric one, and the
    // footer reads BOTH through the resolvers rather than off `.operator`.
    // The tool is the synthetic one at the top of this file; everything else
    // — footer, resolvers, SQL builders, draft store — is real.
    const descriptor = toolById("distance-to-nearest").styleByResult!;
    const text = { name: "near_name", type: "VARCHAR" as const };
    const number = { name: "near_distance_m", type: "DOUBLE" as const };
    expect(resolveStyleOperator(descriptor, text)).toBe("=");
    expect(resolveStyleValueSource(descriptor, text)).toEqual({
      kind: "mostFrequent",
    });
    expect(resolveStyleOperator(descriptor, number)).toBe("<");
    expect(resolveStyleValueSource(descriptor, number)).toEqual({
      kind: "median",
    });

    const layerId = addLayer();
    const nearest = (columns: ReadonlyArray<string>): RunRecord =>
      doneRun({
        targetLayerId: layerId,
        toolId: "distance-to-nearest",
        prefix: "near_",
        params: {},
        columns,
        summary: {
          ...doneRun({}).summary!,
          nonNullByColumn: { near_name: 2, near_distance_m: 2 },
        },
      });

    // A TEXT column picked: `=` its most frequent value, read with the modal
    // builder — which is not the median builder and not `columns[0] >`.
    runQuery.mockImplementationOnce(async (sql: string) => {
      statements.push(sql);
      return { ok: true as const, columns: ["m"], rows: [{ m: "Centrum" }] };
    });
    const { unmount } = render(
      <RunFooter
        run={seed(nearest(["near_name", "near_distance_m"]))}
        canRun
        reason={null}
        onRunAgain={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Style by result" }));
    await waitFor(() => {
      expect(
        useRuleDraftStore.getState().drafts[layerId]?.form?.conditions,
      ).toEqual([{ field: "near_name", operator: "=", value: "Centrum" }]);
    });
    expect(statements).toEqual([
      'SELECT "v" AS m FROM (SELECT "near_name" AS "v", count(*) AS "n" FROM "layer_1" WHERE ("feature_id" IS NULL OR "feature_id" = "id") AND "near_name" IS NOT NULL GROUP BY "v") ORDER BY "n" DESC, "v" ASC LIMIT 1',
    ]);
    unmount();

    // The SAME descriptor, a numeric column picked because no text one was
    // written: the other operator, the other value source, the other builder.
    statements.length = 0;
    render(
      <RunFooter
        run={seed(nearest(["near_distance_m"]))}
        canRun
        reason={null}
        onRunAgain={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Style by result" }));
    await waitFor(() => {
      expect(
        useRuleDraftStore.getState().drafts[layerId]?.form?.conditions,
      ).toEqual([{ field: "near_distance_m", operator: "<", value: 4.2 }]);
    });
    expect(statements).toEqual([
      'SELECT median(CAST("near_distance_m" AS DOUBLE)) AS m FROM "layer_1" WHERE "feature_id" IS NULL OR "feature_id" = "id"',
    ]);
  });

  it("disables the button with §6.2's reason when the CHOSEN column is empty", () => {
    // NOT `columns[0]`, and the fixture is built so the two answers DISAGREE:
    // Validate solids' descriptor picks `solid_valid`, the FOURTH column it
    // writes, and here that column is empty for every object while the first
    // one written (`solid_closed`) has a value for both. A footer that had
    // kept `columns[0]` would leave this button enabled and then open a rule
    // on a column with nothing in it.
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
              nonNullByColumn: {
                solid_closed: 2,
                solid_manifold: 2,
                solid_oriented: 2,
                solid_valid: 0,
              },
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
