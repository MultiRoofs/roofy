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
 * JOIN'S OWN descriptor is pinned twice: DIRECTLY, over columns this file
 * types itself, and END TO END through the real footer — which is where the
 * `mostFrequent` read and the operator/value FUNCTION forms are exercised. Task
 * 9 had to invent a synthetic tool for that, because no registry entry supplied
 * the function forms yet; Join now does, so the synthetic one is retired and
 * the whole registry here is the real one.
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
const { StyleSection } = await import("../../../../src/ui/layers/StyleSection");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useGeoLayerStore } =
  await import("../../../../src/features/geoLayers/geoLayerStore");
const { useShellStore } = await import("../../../../src/ui/shell/shellStore");
const { CATEGORY_PALETTE_HEX } =
  await import("../../../../src/scene/cityColors");
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
          sourceFeatureIds: null,
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
  useGeoLayerStore.setState({ layers: [] });
  useLayerTableStore.setState({ tables: {} });
  useRuleDraftStore.setState({ drafts: {} });
  useProcessingStore.getState().resetForTest();
  // `requestedSection` is consumed by the layer panel, which no case here
  // renders — so without this a case would read the previous one's request.
  useShellStore.getState().requestSection(null);
});

/**
 * A vector layer carrying a finished Aggregate run's results, as §7.6's
 * publication leaves it: the run's column on every feature's properties.
 */
function addZonesWithResults(): string {
  const id = useGeoLayerStore.getState().addGeoLayer({
    name: "Zones",
    kind: "geojson",
    config: {
      data: {
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: { zone: "A" }, geometry: null },
          { type: "Feature", properties: { zone: "B" }, geometry: null },
          { type: "Feature", properties: { zone: "C" }, geometry: null },
        ],
      },
    },
  });
  useGeoLayerStore.getState().mergeGeoFeatureProperties(
    id,
    new Map([
      ["index:0", { bld_buildings_n: 3, bld_sum_roof_area_m2: 90 }],
      ["index:1", { bld_buildings_n: 7, bld_sum_roof_area_m2: 40 }],
      ["index:2", { bld_buildings_n: 3, bld_sum_roof_area_m2: 12 }],
    ]),
  );
  return id;
}

/** §7.6's own run record: the TARGET is the vector layer. */
function aggregateRun(layerId: string): RunRecord {
  return doneRun({
    targetLayerId: layerId,
    targetName: "Zones",
    toolId: "aggregate-per-area",
    lod: null,
    prefix: "bld_",
    params: {
      proxy: "rectangle",
      predicate: "intersects",
      rows: [
        { op: "count", column: null },
        { op: "sum", column: "roof_area_m2" },
      ],
    },
    columns: ["bld_buildings_n", "bld_sum_roof_area_m2"],
    summary: {
      ...doneRun({}).summary!,
      line: "3 areas aggregated over 12 buildings · 0.4 s",
      nonNullByColumn: { bld_buildings_n: 3, bld_sum_roof_area_m2: 3 },
    },
  });
}

/** The real Style section over the real geo layer record. */
function GeoStyle({ id }: { readonly id: string }) {
  const layer = useGeoLayerStore((s) => s.layers.find((l) => l.id === id));
  return layer ? <StyleSection item={{ kind: "geo", layer }} /> : null;
}

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
    // §7.5's other half: "if no text field was copied, on
    // `<prefix>matches_n > 0`". The SAME descriptor, a different column —
    // which is what the operator/value FUNCTION unions exist for.
    expect(descriptor.pick([count])).toEqual(count);
    expect(resolveStyleOperator(descriptor, count)).toBe(">");
    expect(resolveStyleValueSource(descriptor, count)).toEqual({
      kind: "literal",
      value: 0,
    });
  });

  it("resolves a PLAIN descriptor's operator and value as they are", () => {
    // The five tools that need one answer pass it plainly, and the resolvers
    // must hand those straight back — `RunFooter` has no branch of its own.
    const solids = toolById("measure-solids").styleByResult!;
    const column = { name: "solid_volume_m3", type: "DOUBLE" as const };
    expect(resolveStyleOperator(solids, column)).toBe(">");
    expect(resolveStyleValueSource(solids, column)).toEqual({ kind: "median" });
  });

  it("styles a Join by the copied TEXT field's most frequent value (§7.5)", async () => {
    // The footer's own path, end to end: `outputColumns(prefix, params)` types
    // the written columns from the FROZEN `fieldTypes`, `pick` finds the
    // VARCHAR, the operator FUNCTION answers `=` for it, and the value is read
    // with the modal builder over ROOT rows — never a median, and never a
    // string handed to `>`.
    const id = addLayer();
    runQuery.mockImplementationOnce(async (sql: string) => {
      statements.push(sql);
      return {
        ok: true as const,
        columns: ["m"],
        rows: [{ m: "Centrum" } as Record<string, unknown>],
      };
    });
    render(
      <RunFooter
        run={seed(
          doneRun({
            targetLayerId: id,
            toolId: "join-by-location",
            lod: null,
            prefix: "zones_",
            params: {
              proxy: "rectangle",
              predicate: "intersects",
              fields: ["name"],
              tie: "first",
              writeMatchCount: false,
              fieldTypes: { name: "VARCHAR" },
            },
            columns: ["zones_name"],
            summary: {
              ...doneRun({}).summary!,
              nonNullByColumn: { zones_name: 2 },
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
        [{ field: "zones_name", operator: "=", value: "Centrum" }],
      );
    });
    expect(statements).toEqual([
      'SELECT "v" AS m FROM (SELECT "zones_name" AS "v", count(*) AS "n" FROM "layer_1" WHERE ("feature_id" IS NULL OR "feature_id" = "id") AND "zones_name" IS NOT NULL GROUP BY "v") ORDER BY "n" DESC, "v" ASC LIMIT 1',
    ]);
  });

  it("styles a Distance run on `<prefix>distance_m <` the median (§7.7)", async () => {
    // §7.7's own descriptor through the real footer, now that the tool ships:
    // `pick` finds the distance column BESIDE the nearest id (a VARCHAR the
    // default `columns[0]` rule would have been happy with in another order),
    // the operator is `<` — the NEARER half, which is the opposite direction
    // from every other median rule — and the threshold is the same CAST median
    // over root rows.
    const id = addLayer();
    render(
      <RunFooter
        run={seed(
          doneRun({
            targetLayerId: id,
            toolId: "distance-to-nearest",
            lod: null,
            prefix: "roads_",
            params: {
              proxy: "rectangle",
              maxDistanceM: 500,
              writeNearestId: true,
              nearestIdProperty: null,
            },
            columns: ["roads_distance_m", "roads_nearest_id"],
            summary: {
              ...doneRun({}).summary!,
              nonNullByColumn: { roads_distance_m: 2, roads_nearest_id: 2 },
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
        [{ field: "roads_distance_m", operator: "<", value: 4.2 }],
      );
    });
    expect(statements).toEqual([
      'SELECT median(CAST("roads_distance_m" AS DOUBLE)) AS m FROM "layer_1" WHERE "feature_id" IS NULL OR "feature_id" = "id"',
    ]);
  });

  it("styles a count-only Join on `<prefix>matches_n > 0`, reading nothing", async () => {
    // §7.5's OTHER half, through the same descriptor and the same footer: no
    // text field was copied, so `pick` falls to the match count and the
    // operator and value FUNCTIONS answer `>` and a literal 0 — which needs no
    // round trip to the engine at all.
    const id = addLayer();
    render(
      <RunFooter
        run={seed(
          doneRun({
            targetLayerId: id,
            toolId: "join-by-location",
            lod: null,
            prefix: "zones_",
            params: {
              proxy: "rectangle",
              predicate: "intersects",
              fields: ["name"],
              tie: "countOnly",
              writeMatchCount: true,
              fieldTypes: { name: "VARCHAR" },
            },
            columns: ["zones_matches_n"],
            summary: {
              ...doneRun({}).summary!,
              nonNullByColumn: { zones_matches_n: 2 },
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
        [{ field: "zones_matches_n", operator: ">", value: 0 }],
      );
    });
    expect(runQuery).not.toHaveBeenCalled();
    expect(statements).toEqual([]);
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

  it("opens §7.6's STYLE section on the FIRST output column, categories filled", async () => {
    // §7.6: "Style by result opens the vector layer's STYLE section with Color
    // by attribute set to the first output column (categories prefilled from
    // its values)". The descriptor's `kind: "attribute"` branch, which Task 9
    // left for the one tool that has it — through the real footer and the real
    // style section.
    const id = addZonesWithResults();
    render(
      <RunFooter
        run={seed(aggregateRun(id))}
        canRun
        reason={null}
        onRunAgain={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Style by result" }));

    await waitFor(() => {
      expect(useShellStore.getState().requestedSection).toEqual({
        layerId: id,
        section: "style",
      });
    });
    // The FIRST output column, with the categories read off the document the
    // run published into — never an empty list under a named attribute.
    expect(
      useGeoLayerStore.getState().layers.find((l) => l.id === id)?.style
        .colorByAttribute,
    ).toEqual({
      attribute: "bld_buildings_n",
      categories: [
        { value: "3", color: CATEGORY_PALETTE_HEX[0] },
        { value: "7", color: CATEGORY_PALETTE_HEX[1] },
      ],
    });
    // No rule draft and no round trip: a vector layer is coloured by attribute,
    // and §7.6's descriptor reads nothing from the engine.
    expect(useRuleDraftStore.getState().drafts[id]).toBeUndefined();
    expect(runQuery).not.toHaveBeenCalled();

    // And the REAL style section shows it: the select on the run's column, one
    // swatch per category.
    render(<GeoStyle id={id} />);
    expect(
      (
        screen.getByRole("combobox", {
          name: "Color by attribute",
        }) as HTMLSelectElement
      ).value,
    ).toBe("bld_buildings_n");
    expect(screen.getByLabelText('Colour for "3"')).toBeInTheDocument();
    expect(screen.getByLabelText('Colour for "7"')).toBeInTheDocument();
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
