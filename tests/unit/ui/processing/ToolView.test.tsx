/**
 * Spec §6: the tool form's TARGET / OUTPUT sections, the prefix validation and
 * the footer's four states (idle, running, done, failed). The run queue is
 * mocked: what this pins is the REQUEST the form builds and the copy the card
 * shows, not the execution — `runQueue.test.ts` owns that.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { CityModel } from "../../../../src/domain/citymodel/types";
import type { LayerStoreActions } from "../../../../src/features/layers/layerStore";
import type { RunRecord } from "../../../../src/features/processing/types";
import type { ColumnInfo } from "../../../../src/insights/columnKind";
// A static import beside the other test-local ones: the fixture touches only
// stores, never the engine.
import { addRoofLayer } from "./roofLayerFixture";

vi.mock("../../../../src/insights/duckdb", async () => ({
  // The ONE export taken from the real module: `formatDuckDBError` is pure,
  // and §6.3's notice is DEFINED as the message `runQuery` already built with
  // it. A copy of that formatter in this file would go on passing while the
  // real one changed under it. Everything else stays faked, engine included.
  formatDuckDBError: (
    await vi.importActual<typeof import("../../../../src/insights/duckdb")>(
      "../../../../src/insights/duckdb",
    )
  ).formatDuckDBError,
  subscribeDuckDBStatus: vi.fn(() => () => {}),
  getDuckDBStatusVersion: vi.fn(() => 0),
  getEngineGeneration: vi.fn(() => 1),
  onEngineDeath: vi.fn(() => () => {}),
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
  isExtensionLoaded: vi.fn(() => false),
  ensureExtension: vi.fn(async () => false),
  runQuery: vi.fn(async () => ({ ok: false, message: "no engine" })),
  ddl: vi.fn(async () => ({ ok: false, message: "no engine" })),
  registerBuffer: vi.fn(async () => false),
  dropBuffer: vi.fn(async () => {}),
  readFile: vi.fn(async () => null),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
  initDuckDB: vi.fn(async () => {}),
}));

vi.mock("../../../../src/features/processing/runQueue", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/features/processing/runQueue")
  >("../../../../src/features/processing/runQueue");
  return {
    // §6.2's Undo block is REAL: the footer reads it for every done card, and
    // a stub would let the card claim any reason it liked. It answers null for
    // every This-layer run, which is all this suite has.
    newLayerUndoBlock: actual.newLayerUndoBlock,
    submitRun: vi.fn(() => "run_1"),
    retryRun: vi.fn(() => "run_2"),
    cancelRun: vi.fn(),
    undoRun: vi.fn(async () => {}),
  };
});

const counts = {
  all: 2 as number | null,
  matching: null as number | null,
  selected: 0 as number | null,
  loading: false,
  message: null as string | null,
};
vi.mock("../../../../src/insights/familyViews", () => ({
  ensureFamilyView: vi.fn(async () => ({ ok: true }) as const),
  dropFamilyView: vi.fn(async () => {}),
  dropFamilyViews: vi.fn(async () => {}),
}));
vi.mock("../../../../src/features/cityparquet/familySourceCrs", () => ({
  familySourceCrs: vi.fn(async () => "EPSG:6697"),
}));

vi.mock("../../../../src/ui/table/useLayerCounts", () => ({
  useLayerCounts: () => counts,
}));

const { ToolView } = await import("../../../../src/ui/processing/ToolView");
const { submitRun, retryRun, cancelRun, undoRun } =
  await import("../../../../src/features/processing/runQueue");
const { useProcessingStore } =
  await import("../../../../src/features/processing/processingStore");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useWorkspaceStore } =
  await import("../../../../src/features/workspace/workspaceStore");
const { useGeoLayerStore } =
  await import("../../../../src/features/geoLayers/geoLayerStore");
const { useLayerTableStore } =
  await import("../../../../src/insights/layerTables");
const { useComputedColumnStore } =
  await import("../../../../src/insights/computedColumns");
const { useShellStore } = await import("../../../../src/ui/shell/shellStore");
const { useQueryStore } =
  await import("../../../../src/features/query/queryStore");
const { buildLayerFamilies, resetFamilyStoreForTest, useFamilyStore } =
  await import("../../../../src/features/layers/familyStore");
const { layerTableKey } = await import("../../../../src/insights/layerTables");
const { useRuleDraftStore } =
  await import("../../../../src/features/rules/ruleDraftStore");
const { clearColumnReveals } =
  await import("../../../../src/ui/table/revealColumns");

type LayerInput = Parameters<LayerStoreActions["addLayer"]>[0];

function column(name: string): ColumnInfo {
  return { name, type: "DOUBLE", kind: "scalar" };
}

function addCityLayer(
  columns: ReadonlyArray<ColumnInfo> = [],
  isStreaming = false,
): string {
  const model = {
    sourceEncoding: "cityjson",
    metadata: { referenceSystem: undefined },
    bbox: null,
    objects: {},
    vertexCount: 0,
  } as unknown as CityModel;
  const input: LayerInput = {
    name: "Delft",
    model,
    modelRef: { type: "url", url: "https://x/delft.city.json" },
    visible: true,
    rules: [],
    colorBy: "surface",
    isStreaming,
  };
  const id = useLayerStore.getState().addLayer(input);
  useWorkspaceStore.getState().setActiveLayerId(id);
  useLayerTableStore.setState({
    tables: {
      [id]: {
        state: "ready",
        info: {
          table: "layer_1",
          sourceName: null,
          source: null,
          reader: null,
          columns,
          lods: [],
          extension: null,
          sourceBytes: null,
          sourceFeatureIds: null,
          rowCount: 2,
        },
      },
    },
  });
  return id;
}

/** A polygon vector layer: the TARGET §7.6 needs and the SOURCE §7.5/§7.7 do. */
function addZonesLayer(): string {
  return useGeoLayerStore.getState().addGeoLayer({
    name: "Zones",
    kind: "geojson",
    config: {
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            id: "z1",
            properties: { zone: "A" },
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [4, 52],
                  [5, 52],
                  [5, 53],
                  [4, 52],
                ],
              ],
            },
          },
        ],
      },
    },
  });
}

function runFixture(patch: Partial<RunRecord>): RunRecord {
  return {
    id: "r1",
    toolId: "height-from-extent",
    targetLayerId: "L",
    targetName: "Delft",
    targetDerivedFrom: null,
    sourceLayerId: null,
    sourceName: null,
    scope: "all",
    scopeCount: 2,
    featureIds: null,
    lod: null,
    params: {},
    prefix: "extent_",
    columns: ["extent_height_m", "extent_zmin_m", "extent_zmax_m"],
    status: "queued",
    phase: null,
    startedAt: Date.now(),
    elapsedMs: 0,
    summary: null,
    error: null,
    log: [],
    warnings: [],
    undoable: false,
    stale: false,
    destination: "layer",
    newLayerName: null,
    newLayerId: null,
    note: null,
    ...patch,
  };
}

beforeEach(() => {
  counts.all = 2;
  counts.matching = null;
  counts.selected = 0;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useProcessingStore.getState().resetForTest();
  useLayerStore.getState().removeAllLayers();
  useGeoLayerStore.setState({ layers: [] });
  useWorkspaceStore.getState().setActiveLayerId(null);
  useLayerTableStore.setState({ tables: {} });
  useComputedColumnStore.setState({ byLayer: {} });
  useQueryStore.setState({ queries: {} });
  resetFamilyStoreForTest();
  useRuleDraftStore.setState({ drafts: {} });
  // Open table RETAINS its scroll request until a grid acknowledges it, and no
  // case here renders one — so without this the next case's first listener
  // would be handed the previous case's request.
  clearColumnReveals();
  // `requestedSection` is consumed by the layer panel, which no test here
  // renders — so without this a case that asserts "nothing was requested"
  // would read the PREVIOUS case's request.
  useShellStore.getState().requestSection(null);
});

/**
 * Every cross-layer tool now ships, against the REAL registry: the form
 * promises its columns and prints its geometry verdict.
 *
 * This block used to assert the GLOBAL CONSTRAINT's other half — a tool whose
 * executor has not shipped claims nothing about the user's data — on
 * `aggregate-per-area`, the last entry that was `implemented: false`. Task 19
 * ships it, so the registry has no unimplemented subject left; the guard itself
 * is still pinned, on a PATCHED definition, in `useToolForm.test.tsx` ("says
 * nothing about the columns of an unimplemented tool") and `lodSelect.test.tsx`.
 *
 * Aggregate's TARGET is the vector layer and its compute table is the CITY
 * layer's, so both are added: without the vector layer the form would print
 * nothing for want of a target and the case would pass for the wrong reason.
 */
describe("a shipped cross-layer tool promises its columns", () => {
  it("prints Aggregate's column list and its geometry verdict", () => {
    addCityLayer();
    addZonesLayer();
    render(<ToolView toolId="aggregate-per-area" />);
    // The table has no LoD 0 rung and no reader, so the proxy radio says so —
    // §7.5's muted line, on the option it explains.
    expect(
      screen.getByText(/LoD 0 footprints are not in this layer/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radiogroup", { name: "Building geometry" }),
    ).toBeInTheDocument();
    // §7.6's default row is a count, so the promised column is the count one.
    expect(document.querySelector(".processing-columns")).toHaveTextContent(
      "bld_buildings_n",
    );
  });

  it("prints both for the cross-layer tool whose target is the city layer", () => {
    addCityLayer();
    addZonesLayer();
    render(<ToolView toolId="distance-to-nearest" />);
    expect(
      screen.getByRole("radiogroup", { name: "Building geometry" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/LoD 0 footprints are not in this layer/),
    ).toBeInTheDocument();
  });
});

describe("ToolView", () => {
  it("renders TARGET, scope counts, OUTPUT columns and runs with the draft", () => {
    const layerId = addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    expect(
      screen.getByRole("heading", { name: "Height from extent" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Layer" })).toHaveValue(
      layerId,
    );
    expect(
      screen.getByRole("radio", { name: "All 2 buildings" }),
    ).toBeChecked();
    expect(screen.getByRole("radio", { name: /Matching/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Selected/ })).toBeDisabled();
    expect(
      screen.getByText("extent_height_m, extent_zmin_m, extent_zmax_m"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(submitRun).toHaveBeenCalledWith(
      expect.objectContaining({
        toolId: "height-from-extent",
        targetLayerId: layerId,
        sourceLayerId: null,
        scope: "all",
        prefix: "extent_",
        columns: [
          { name: "extent_height_m", type: "DOUBLE" },
          { name: "extent_zmin_m", type: "DOUBLE" },
          { name: "extent_zmax_m", type: "DOUBLE" },
        ],
      }),
    );
  });

  it("prints the column NAMES and SUBMITS the typed columns", () => {
    // The two halves of the same list: the mono line is names (§6's "column
    // list in mono"), and what the form hands the QUEUE is the typed columns
    // the write path needs (`buildAddColumnSql` interpolates `col.type`).
    // What `submitRun` then freezes is `runQueue`'s own test.
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

  it("opens OUTPUT with Write to on the target, New layer offered beside it", () => {
    // §6: OUTPUT "starts with the destination, Write to". BOTH radios are
    // drawn and both are live for a city tool; which tools offer `New layer`
    // at all, and when it is disabled, is `outputDestination.test.tsx`'s gate.
    addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    const writeTo = screen.getByRole("radio", {
      name: "This layer (Delft)",
    });
    expect(writeTo).toBeChecked();
    expect(writeTo).toBeEnabled();
    const newLayer = screen.getByRole("radio", { name: "New layer" });
    expect(newLayer).not.toBeChecked();
    expect(newLayer).toBeEnabled();
  });

  it("reads a count that has not arrived as pending, not as zero", () => {
    counts.all = null;
    addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    expect(
      screen.getByRole("radio", { name: "All … buildings" }),
    ).toBeChecked();
  });

  it("sees a FAMILY's filter — the scope radio and the run agree with the table", () => {
    // R-C′: a CityParquet layer's filter lives under `${layerId}::${family}`.
    // Reading the bare key here made the form say "No filter applied" while the
    // counts beside it showed a matching number and `submitRun` would have
    // frozen that very filter.
    counts.matching = 312;
    const layerId = addCityLayer([], true);
    act(() => {
      useFamilyStore.getState().setFamilies(
        layerId,
        buildLayerFamilies([
          {
            key: "building",
            href: "building.parquet",
            size: null,
            source: { url: "https://x/building.parquet" },
          },
        ]),
      );
      // The family's own table, which is the only one a reader of this layer
      // resolves to (ruling S3).
      const key = layerTableKey(layerId, "building");
      useLayerTableStore.setState((state) => ({
        tables: { ...state.tables, [key]: state.tables[layerId]! },
      }));
      useQueryStore.getState().setFilter(key, {
        logic: "AND",
        conditions: [{ id: "c1", column: "status", op: "=", value: "ok" }],
      });
      useQueryStore.getState().applyFilter(key);
    });
    render(<ToolView toolId="roof-metrics" />);
    expect(
      screen.getByRole("radio", { name: "Matching 312" }),
    ).not.toBeDisabled();
  });

  it("offers Matching with its count once a filter is applied, and runs on it", () => {
    counts.matching = 312;
    const layerId = addCityLayer();
    act(() => {
      useQueryStore.getState().setFilter(layerId, {
        logic: "AND",
        conditions: [{ id: "c1", column: "status", op: "=", value: "ok" }],
      });
      useQueryStore.getState().applyFilter(layerId);
    });
    render(<ToolView toolId="height-from-extent" />);
    const matching = screen.getByRole("radio", { name: "Matching 312" });
    expect(matching).not.toBeDisabled();
    fireEvent.click(matching);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(submitRun).toHaveBeenCalledWith(
      expect.objectContaining({
        toolId: "height-from-extent",
        targetLayerId: layerId,
        sourceLayerId: null,
        scope: "matching",
      }),
    );
  });

  it("names the reason Run is blocked under the button", () => {
    addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    fireEvent.click(screen.getByRole("radio", { name: /Selected/ }));
    // Disabled radios cannot be picked, so the draft is set directly.
    act(() =>
      useProcessingStore.getState().setDraft("height-from-extent", {
        targetLayerId: useLayerStore.getState().layers[0]!.id,
        sourceLayerId: null,
        scope: "selected",
        lod: null,
        prefix: "extent_",
        params: {},
        destination: "layer",
        newLayerName: null,
      }),
    );
    expect(
      screen.getByText("Nothing selected on this layer"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });

  it("rejects a prefix that collides with a source attribute", () => {
    addCityLayer([column("height_m")]);
    render(<ToolView toolId="height-from-extent" />);
    fireEvent.change(screen.getByRole("textbox", { name: "Prefix" }), {
      target: { value: "" },
    });
    expect(
      screen.getByText(
        "'height_m' belongs to the source data; choose another prefix",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });

  it("rejects a prefix that collides in DuckDB's eyes, whatever its case", () => {
    // DuckDB identifiers are case-insensitive: writing "EXTENT_height_m" over
    // a source "extent_height_m" overwrites the file's own column.
    addCityLayer([column("extent_height_m")]);
    render(<ToolView toolId="height-from-extent" />);
    fireEvent.change(screen.getByRole("textbox", { name: "Prefix" }), {
      target: { value: "EXTENT_" },
    });
    expect(
      screen.getByText(
        // The TABLE's spelling: that is the column that belongs to the data.
        "'extent_height_m' belongs to the source data; choose another prefix",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });

  it("rejects a prefix that is not a name", () => {
    addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    fireEvent.change(screen.getByRole("textbox", { name: "Prefix" }), {
      target: { value: "1 bad" },
    });
    expect(
      screen.getByText(
        "Use letters, digits and underscores, starting with a letter",
      ),
    ).toBeInTheDocument();
  });

  it("shows the replace warning for computed columns and the running / done / failed footers", () => {
    const layerId = addCityLayer([column("extent_height_m")]);
    useComputedColumnStore
      .getState()
      .setProvenance(layerId, "extent_height_m", {
        runId: "r0",
        toolName: "Height from extent",
        summary: "All 2 buildings",
        at: Date.now(),
        partial: null,
        previous: null,
      });
    render(<ToolView toolId="height-from-extent" />);
    expect(
      screen.getByText("1 of these columns exist; they will be replaced."),
    ).toBeInTheDocument();

    act(() =>
      useProcessingStore.getState().upsertRun(
        runFixture({
          status: "running",
          phase: "compute",
          targetLayerId: layerId,
        }),
      ),
    );
    expect(screen.getByText(/Computing/)).toBeInTheDocument();
    expect(screen.getByText(/Loading extension ✓/)).toBeInTheDocument();
    // §6.1's button reads "Cancel"; the label only tells a screen reader
    // which Cancel this is (the idle footer's returns to the catalogue).
    expect(
      screen.getByRole("button", { name: "Cancel run" }),
    ).toHaveTextContent(/^Cancel$/);
    fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));
    expect(cancelRun).toHaveBeenCalledWith("r1");

    act(() =>
      useProcessingStore.getState().patchRun("r1", {
        status: "done",
        summary: {
          line: "2 buildings measured · 0.3 s",
          detail: null,
          measured: 2,
          skipped: [],
          nonNullByColumn: { extent_height_m: 2 },
        },
        undoable: true,
      }),
    );
    expect(
      screen.getByText("2 buildings measured · 0.3 s"),
    ).toBeInTheDocument();
    expect(screen.getByText("Wrote 3 columns to Delft.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(undoRun).toHaveBeenCalledWith("r1");

    act(() =>
      useProcessingStore
        .getState()
        .patchRun("r1", { status: "failed", error: "Binder Error: x" }),
    );
    expect(screen.getByText("Binder Error: x")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("announces the running phase in a polite live region", () => {
    const layerId = addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    act(() =>
      useProcessingStore.getState().upsertRun(
        runFixture({
          status: "running",
          phase: "compute",
          targetLayerId: layerId,
        }),
      ),
    );
    expect(screen.getByText(/Computing/)).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  it("retries a failed run with its FROZEN parameters, not the draft", () => {
    const layerId = addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    // §6.3 leaves the form editable after a failure, so the draft can drift —
    // and drift into a state that would refuse a fresh Run. Seeded BEFORE the
    // card arrives: an edit made UNDER a failed card dismisses it, which is
    // how the Run button comes back.
    fireEvent.change(screen.getByRole("textbox", { name: "Prefix" }), {
      target: { value: "1 bad" },
    });
    act(() =>
      useProcessingStore.getState().upsertRun(
        runFixture({
          status: "failed",
          targetLayerId: layerId,
          error: "Binder Error: x",
          elapsedMs: 1200,
        }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    // The frozen request lives in the QUEUE (its scope's resolved ids with
    // it), so Retry repeats the run by id and never rebuilds a request from
    // the card — the draft beside it cannot leak in.
    expect(retryRun).toHaveBeenCalledWith("r1");
    expect(submitRun).not.toHaveBeenCalled();
  });

  it("says nothing about a queue before anything is queued", () => {
    const layerId = addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    act(() =>
      useProcessingStore.getState().upsertRun(
        runFixture({
          id: "other",
          toolId: "measure-solids",
          status: "running",
          phase: "compute",
          targetLayerId: layerId,
        }),
      ),
    );
    // §6.1 only promises the note for the run that WAS queued; until the user
    // presses Run, this form has queued nothing.
    expect(screen.queryByText(/Queued behind/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).not.toBeDisabled();
  });

  it("lets a queued run's note win over the reason Run was blocked", () => {
    const layerId = addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    act(() => {
      useProcessingStore.getState().setDraft("height-from-extent", {
        targetLayerId: layerId,
        sourceLayerId: null,
        scope: "selected",
        lod: null,
        prefix: "extent_",
        params: {},
        destination: "layer",
        newLayerName: null,
      });
      useProcessingStore.getState().upsertRun(
        runFixture({
          id: "other",
          toolId: "measure-solids",
          status: "running",
          phase: "compute",
          targetLayerId: layerId,
        }),
      );
      useProcessingStore
        .getState()
        .upsertRun(runFixture({ status: "queued", targetLayerId: layerId }));
    });
    expect(
      screen.getByText("Queued behind Measure solids"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Nothing selected on this layer"),
    ).not.toBeInTheDocument();
  });

  it("keeps a stale reason out of the queued footer even before anything runs", () => {
    const layerId = addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    act(() => {
      useProcessingStore.getState().setDraft("height-from-extent", {
        targetLayerId: layerId,
        sourceLayerId: null,
        scope: "selected",
        lod: null,
        prefix: "extent_",
        params: {},
        destination: "layer",
        newLayerName: null,
      });
      // Queued with nothing running yet: the hand-off window between one run's
      // done patch and the next run's running patch.
      useProcessingStore
        .getState()
        .upsertRun(runFixture({ status: "queued", targetLayerId: layerId }));
    });
    expect(screen.getByText("Queued")).toBeInTheDocument();
    expect(
      screen.queryByText("Nothing selected on this layer"),
    ).not.toBeInTheDocument();
  });

  it("names the running tool a queued run waits behind", () => {
    const layerId = addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    act(() => {
      useProcessingStore.getState().upsertRun(
        runFixture({
          id: "other",
          toolId: "measure-solids",
          status: "running",
          phase: "compute",
          targetLayerId: layerId,
        }),
      );
      useProcessingStore
        .getState()
        .upsertRun(runFixture({ status: "queued", targetLayerId: layerId }));
    });
    expect(
      screen.getByText("Queued behind Measure solids"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cancel run" }),
    ).toHaveTextContent(/^Cancel$/);
  });

  it("locks the form while the run is in flight and while its card shows, and Run again only unlocks it", () => {
    const layerId = addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    act(() =>
      useProcessingStore.getState().upsertRun(
        runFixture({
          status: "running",
          phase: "write",
          targetLayerId: layerId,
        }),
      ),
    );
    expect(screen.getByRole("textbox", { name: "Prefix" })).toBeDisabled();

    // §6.2: the card stands in for the form until the user asks for it back.
    act(() =>
      useProcessingStore.getState().patchRun("r1", {
        status: "done",
        summary: {
          line: "2 buildings measured · 0.3 s",
          detail: null,
          measured: 2,
          skipped: [],
          nonNullByColumn: { extent_height_m: 2 },
        },
      }),
    );
    expect(screen.getByRole("textbox", { name: "Prefix" })).toBeDisabled();

    // "Run again unlocks the form with the same values" — it does NOT run.
    fireEvent.click(screen.getByRole("button", { name: "Run again" }));
    expect(submitRun).not.toHaveBeenCalled();
    // The dismissal lives in the store, so it survives leaving the view and
    // Recent runs' "Edit & run" can reach it.
    expect(useProcessingStore.getState().dismissedRunIds).toContain("r1");
    expect(screen.getByRole("textbox", { name: "Prefix" })).not.toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Prefix" })).toHaveValue(
      "extent_",
    );
    expect(screen.getByRole("button", { name: "Run" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Run again" }),
    ).not.toBeInTheDocument();

    // And the unlocked Run is the ordinary one.
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(submitRun).toHaveBeenCalledTimes(1);
  });

  it("never lets a dismissal suppress a run that is still in flight", () => {
    const layerId = addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    act(() => {
      useProcessingStore.getState().upsertRun(
        runFixture({
          status: "running",
          phase: "compute",
          targetLayerId: layerId,
        }),
      );
      // A dismissal left over from the run's own done card, or written by
      // "Edit & run": it must not unlock a form whose run is still going.
      useProcessingStore.getState().dismissRun("r1");
    });
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cancel run" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Prefix" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Run" })).toBeNull();

    // The dismissal WAITS for the run: once it is done, the card it would have
    // shown is the one the dismissal suppresses, and the form comes back.
    act(() =>
      useProcessingStore.getState().patchRun("r1", {
        status: "done",
        summary: {
          line: "2 buildings measured · 0.3 s",
          detail: null,
          measured: 2,
          skipped: [],
          nonNullByColumn: { extent_height_m: 2 },
        },
      }),
    );
    expect(screen.queryByRole("button", { name: "Run again" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Prefix" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Run" })).toBeInTheDocument();
  });

  it("leaves the form editable under a FAILED card (§6.3 offers Retry and Log only)", () => {
    const layerId = addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    act(() =>
      useProcessingStore.getState().upsertRun(
        runFixture({
          status: "failed",
          targetLayerId: layerId,
          error: "Binder Error: x",
        }),
      ),
    );
    expect(screen.getByRole("textbox", { name: "Prefix" })).not.toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Layer" })).not.toBeDisabled();
  });

  it("hands Run back on the first edit under a FAILED card", () => {
    // §6.3's footer offers Retry and Log only, and Retry repeats the FROZEN
    // request — so while the card stands, an edited request has no way out of
    // the form at all.
    const layerId = addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    act(() =>
      useProcessingStore.getState().upsertRun(
        runFixture({
          status: "failed",
          targetLayerId: layerId,
          error: "Binder Error: x",
        }),
      ),
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Prefix" }), {
      target: { value: "h_" },
    });
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(submitRun).toHaveBeenCalledWith(
      expect.objectContaining({ prefix: "h_" }),
    );
  });

  it("shows the idle footer for a failed run Edit & run dismissed", () => {
    const layerId = addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    act(() => {
      useProcessingStore.getState().upsertRun(
        runFixture({
          status: "failed",
          targetLayerId: layerId,
          error: "Binder Error: x",
        }),
      );
      useProcessingStore
        .getState()
        .dismissFinishedRun("height-from-extent", layerId);
    });
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByRole("button", { name: "Run" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Prefix" })).not.toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Layer" })).not.toBeDisabled();
  });

  it("warns about a large source only for a tool that re-reads it", () => {
    // §6, verbatim, with the REAL number: "Re-reads a 180 MB source; this can
    // take a minute and needs memory".
    const id = addCityLayer();
    useLayerTableStore.setState((s) => {
      const entry = s.tables[id];
      if (entry?.state !== "ready") return s;
      return {
        tables: {
          ...s.tables,
          [id]: {
            ...entry,
            info: { ...entry.info, sourceBytes: 180_000_000 },
          },
        },
      };
    });
    render(<ToolView toolId="height-from-extent" />);
    // `needsReader: false` — no read, no note.
    expect(screen.queryByText(/Re-reads a/)).toBeNull();
  });

  it("says a streaming target only covers the loaded buildings", () => {
    addCityLayer([], true);
    render(<ToolView toolId="height-from-extent" />);
    expect(
      screen.getByText(
        "Runs over the 2 currently loaded buildings, not the whole dataset.",
      ),
    ).toBeInTheDocument();
  });

  it("does NOT say that of a family's table, which is the whole family", () => {
    // `counts.all` is the family view's own count (R-B′), so the sentence would
    // contradict the number it quotes.
    const layerId = addCityLayer([], true);
    act(() => {
      useFamilyStore.getState().setFamilies(
        layerId,
        buildLayerFamilies([
          {
            key: "building",
            href: "building.parquet",
            size: null,
            source: { url: "https://x/building.parquet" },
          },
        ]),
      );
      useLayerTableStore.setState((state) => ({
        tables: {
          ...state.tables,
          [layerTableKey(layerId, "building")]: state.tables[layerId]!,
        },
      }));
    });
    render(<ToolView toolId="height-from-extent" />);
    expect(screen.queryByText(/currently loaded/)).toBeNull();
  });
});
