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
vi.mock("../../../../src/ui/table/useLayerCounts", () => ({
  useLayerCounts: () => counts,
}));

const { ToolView } = await import("../../../../src/ui/processing/ToolView");
const { RunFooter } = await import("../../../../src/ui/processing/RunFooter");
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
const { useQueryStore, layerQuery } =
  await import("../../../../src/features/query/queryStore");
const { useRuleDraftStore } =
  await import("../../../../src/features/rules/ruleDraftStore");
const { runQuery, formatDuckDBError } =
  await import("../../../../src/insights/duckdb");
const { NEW_RULE_COLOR_HEX } = await import("../../../../src/scene/cityColors");
const { clearColumnReveals, subscribeColumnReveal } =
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

/** The done run the Style-by-result cases all start from. */
function doneRun(layerId: string, patch: Partial<RunRecord> = {}): RunRecord {
  return runFixture({
    status: "done",
    targetLayerId: layerId,
    summary: {
      line: "2 buildings measured · 0.3 s",
      detail: null,
      measured: 2,
      skipped: [],
      // Both buildings got a height: this is the summary of a run that CAN be
      // styled, which is what every case built on `doneRun` assumes.
      nonNullByColumn: { extent_height_m: 2 },
    },
    ...patch,
  });
}

type Outcome = Awaited<ReturnType<typeof runQuery>>;

/** A median read the test resolves BY HAND, so it can act while the query is
 *  still in flight (remove the layer, click again, unmount the card). */
function deferredQuery(): {
  readonly promise: Promise<Outcome>;
  readonly resolve: (outcome: Outcome) => void;
} {
  let resolve!: (outcome: Outcome) => void;
  const promise = new Promise<Outcome>((r) => {
    resolve = r;
  });
  vi.mocked(runQuery).mockReturnValueOnce(promise);
  return { promise, resolve };
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

  it("opens the drawer and the STYLE section from the result card", async () => {
    const layerId = addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    act(() =>
      useProcessingStore.getState().upsertRun(
        runFixture({
          status: "done",
          targetLayerId: layerId,
          summary: {
            line: "2 buildings measured · 0.3 s",
            detail: null,
            measured: 2,
            skipped: [],
            nonNullByColumn: { extent_height_m: 2 },
          },
        }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open table" }));
    expect(useShellStore.getState().drawerOpen).toBe(true);
    expect(useWorkspaceStore.getState().activeLayerId).toBe(layerId);
    // The median is read before the navigation, so the click is async now.
    vi.mocked(runQuery).mockResolvedValueOnce({
      ok: true,
      columns: ["m"],
      rows: [{ m: 4.2 }],
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Style by result" }));
    });
    expect(useShellStore.getState().requestedSection).toEqual({
      layerId,
      section: "style",
    });
  });

  it("opens STYLE on a rule DRAFT over the run's first column", async () => {
    // §6.2/§7.4: Color by = Rules, the editor open on a DRAFT whose attribute
    // is the first column the run wrote, operator ">", value the median. The
    // map does not change until the user saves the rule, so nothing here
    // writes a rule — only the draft.
    const layerId = addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    act(() =>
      useProcessingStore.getState().upsertRun(
        runFixture({
          status: "done",
          targetLayerId: layerId,
          summary: {
            line: "2 buildings measured · 0.3 s",
            detail: null,
            measured: 2,
            skipped: [],
            nonNullByColumn: { extent_height_m: 2 },
          },
        }),
      ),
    );
    vi.mocked(runQuery).mockResolvedValueOnce({
      ok: true,
      columns: ["m"],
      rows: [{ m: 4.2 }],
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Style by result" }));
    });
    // ROOT ROWS ONLY: the run copied its value onto the root and its parts, so
    // a median over every row would weight each building by its part count
    // (`buildMedianSql`). CAST to DOUBLE for the M2 DECIMAL trap: a DECIMAL
    // median reaches JS as an object and `typeof value === "number"` below
    // would then report "All values are empty" over a column full of numbers.
    expect(runQuery).toHaveBeenCalledWith(
      'SELECT median(CAST("extent_height_m" AS DOUBLE)) AS m FROM "layer_1" WHERE "feature_id" IS NULL OR "feature_id" = "id"',
    );
    // The MODE is untouched: §6.2's "the map does NOT change until the user
    // presses Save in the editor" holds for the layer's colouring too, and the
    // draft carries the flag that tells the editor's Save to switch it then
    // (M3 ruling C6).
    expect(
      useLayerStore.getState().layers.find((l) => l.id === layerId)?.colorBy,
    ).toBe("surface");
    expect(useRuleDraftStore.getState().drafts[layerId]).toEqual({
      editingId: null,
      open: true,
      origin: "style-by-result",
      form: {
        // The editor refuses to save an unnamed rule, so the draft arrives
        // named after the column it is about; the user renames it if they
        // want to.
        name: "extent_height_m",
        color: NEW_RULE_COLOR_HEX,
        logic: "AND",
        conditions: [{ field: "extent_height_m", operator: ">", value: 4.2 }],
      },
    });
  });

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
            nonNullByColumn: { extent_height_m: 0 },
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
            nonNullByColumn: { extent_height_m: 1 },
          },
        }),
      ),
    );
    expect(
      screen.getByRole("button", { name: "Style by result" }),
    ).toBeEnabled();
  });

  it("says why when the median query fails, and opens no draft", async () => {
    const layerId = addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    act(() => useProcessingStore.getState().upsertRun(doneRun(layerId)));
    // `runQuery` has ALREADY run the raw DuckDB error through
    // `formatDuckDBError` (duckdb.ts:396), and that IS §6.3's "first error
    // line, as the export dialog shows DuckDB errors": the `LINE n:` echo of
    // our own SQL and its caret are dropped, everything DuckDB actually said
    // — candidate bindings included — is kept, joined into one line. So the
    // outcome is built here the way `runQuery` builds it, and the notice must
    // be that message VERBATIM; a second split here would eat the bindings.
    const message = formatDuckDBError(
      [
        'Binder Error: Referenced column "zone_id" not found in FROM clause',
        'Candidate bindings: "zone_code"',
        'LINE 1: SELECT median("zone_id") AS m FROM "layer_1"',
        "                      ^",
      ].join("\n"),
    );
    vi.mocked(runQuery).mockResolvedValueOnce({ ok: false, message });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Style by result" }));
    });
    // The engine already told us what went wrong; discarding that for a
    // plausible-looking "> 0" rule is the bug this pins.
    const notice = useProcessingStore.getState().notice;
    expect(notice).toBe(message);
    expect(notice).toContain(
      'Binder Error: Referenced column "zone_id" not found in FROM clause',
    );
    expect(notice).toContain('Candidate bindings: "zone_code"');
    expect(notice).not.toContain("LINE 1:");
    expect(notice).not.toContain("^");
    expect(useRuleDraftStore.getState().drafts[layerId]).toBeUndefined();
    expect(useShellStore.getState().requestedSection).toBeNull();
  });

  it("keeps the stale reason on a run that is BOTH stale and empty", async () => {
    // A rebuilt table is why a median cannot be trusted at all; "All values
    // are empty" would be a claim about data this run no longer describes.
    const layerId = addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    act(() =>
      useProcessingStore.getState().upsertRun(
        doneRun(layerId, {
          stale: true,
          summary: {
            line: "0 buildings measured · 0.1 s",
            detail: null,
            measured: 0,
            skipped: [],
            nonNullByColumn: { extent_height_m: 0 },
          },
        }),
      ),
    );
    const button = screen.getByRole("button", { name: "Style by result" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "stale: layer reloaded");
    expect(
      screen.getByText("stale: layer reloaded", { selector: "p" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("All values are empty")).toBeNull();
  });

  it("says All values are empty when the median is NULL, and opens no draft", async () => {
    const layerId = addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    act(() => useProcessingStore.getState().upsertRun(doneRun(layerId)));
    vi.mocked(runQuery).mockResolvedValueOnce({
      ok: true,
      columns: ["m"],
      rows: [{ m: null }],
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Style by result" }));
    });
    expect(useProcessingStore.getState().notice).toBe("All values are empty");
    expect(useRuleDraftStore.getState().drafts[layerId]).toBeUndefined();
    expect(useShellStore.getState().requestedSection).toBeNull();
  });

  it("abandons silently when the target layer goes while the median is in flight", async () => {
    const layerId = addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    act(() => useProcessingStore.getState().upsertRun(doneRun(layerId)));
    const pending = deferredQuery();
    fireEvent.click(screen.getByRole("button", { name: "Style by result" }));
    act(() => useLayerStore.getState().removeLayer(layerId));
    await act(async () => {
      pending.resolve({ ok: true, columns: ["m"], rows: [{ m: 4.2 }] });
      await pending.promise;
    });
    // `requestSection` activates whatever id it is handed (shellStore.ts:173),
    // so writing here would resurrect a layer the user has removed.
    expect(useRuleDraftStore.getState().drafts[layerId]).toBeUndefined();
    expect(useShellStore.getState().requestedSection).toBeNull();
    expect(useProcessingStore.getState().notice).toBeNull();
  });

  it("takes one click at a time", async () => {
    const layerId = addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    act(() => useProcessingStore.getState().upsertRun(doneRun(layerId)));
    const pending = deferredQuery();
    fireEvent.click(screen.getByRole("button", { name: "Style by result" }));
    // Disabled while its query runs: two overlapping reads would each replace
    // the WHOLE draft on arrival, in whatever order they landed.
    expect(
      screen.getByRole("button", { name: "Style by result" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Style by result" }));
    expect(runQuery).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve({ ok: true, columns: ["m"], rows: [{ m: 4.2 }] });
      await pending.promise;
    });
  });

  it("drops a median that lands after Run again", async () => {
    // Run again DISMISSES the run (ToolView.tsx:209-215), which takes the card
    // away WITHOUT unmounting the footer — so an unmount-only invalidation
    // misses it, and the read lands on a card the user has already left.
    const layerId = addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    act(() => useProcessingStore.getState().upsertRun(doneRun(layerId)));
    const pending = deferredQuery();
    fireEvent.click(screen.getByRole("button", { name: "Style by result" }));
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Run again" }));
    });
    expect(screen.getByRole("button", { name: "Run" })).toBeInTheDocument();
    await act(async () => {
      pending.resolve({ ok: true, columns: ["m"], rows: [{ m: 4.2 }] });
      await pending.promise;
    });
    expect(useRuleDraftStore.getState().drafts[layerId]).toBeUndefined();
    expect(useShellStore.getState().requestedSection).toBeNull();
    expect(useProcessingStore.getState().notice).toBeNull();
    // And the replacement context starts clean: the next run's button is not
    // still disabled by the abandoned read's `pending`.
    act(() =>
      useProcessingStore
        .getState()
        .upsertRun(doneRun(layerId, { id: "r2", elapsedMs: 400 })),
    );
    expect(
      screen.getByRole("button", { name: "Style by result" }),
    ).not.toBeDisabled();
  });

  it("disables Style by result on a stale run, with the spec's reason", async () => {
    // §7: a layer whose table was rebuilt after the run. The median would be
    // read from a table the run no longer describes.
    const layerId = addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    act(() =>
      useProcessingStore
        .getState()
        .upsertRun(doneRun(layerId, { stale: true })),
    );
    const button = screen.getByRole("button", { name: "Style by result" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "stale: layer reloaded");
    expect(
      screen.getByText("stale: layer reloaded", { selector: "p" }),
    ).toBeInTheDocument();
  });

  it("abandons silently when the target has no table to read", async () => {
    // Impossible for a non-stale done run — the run itself wrote to that
    // table — so there is nothing to tell the user, and no failure message to
    // invent. The card is rendered DIRECTLY here because `ToolView` cannot
    // reach this state: a layer without a ready table leaves the tool's target
    // list entirely (`useToolForm.ts:83`), taking the card with it.
    const layerId = addCityLayer();
    act(() => useLayerTableStore.setState({ tables: {} }));
    render(
      <RunFooter
        run={doneRun(layerId)}
        canRun={true}
        reason={null}
        onRunAgain={() => {}}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Style by result" }));
    });
    expect(runQuery).not.toHaveBeenCalled();
    expect(useProcessingStore.getState().notice).toBeNull();
    expect(useRuleDraftStore.getState().drafts[layerId]).toBeUndefined();
    expect(useShellStore.getState().requestedSection).toBeNull();
  });

  it("re-enables Style by result once its query has landed", async () => {
    const layerId = addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    act(() => useProcessingStore.getState().upsertRun(doneRun(layerId)));
    const pending = deferredQuery();
    fireEvent.click(screen.getByRole("button", { name: "Style by result" }));
    await act(async () => {
      pending.resolve({ ok: true, columns: ["m"], rows: [{ m: 4.2 }] });
      await pending.promise;
    });
    expect(
      screen.getByRole("button", { name: "Style by result" }),
    ).not.toBeDisabled();
    expect(
      useRuleDraftStore.getState().drafts[layerId]?.form.conditions[0],
    ).toEqual({ field: "extent_height_m", operator: ">", value: 4.2 });
  });

  it("appends the run's columns to a customised table list, once", () => {
    // §6.2: Open table "opens the drawer on the target with the new columns
    // appended after the existing ones". Once the user has customised the
    // list, the default path (which appends the registry's columns) is no
    // longer consulted, so the card has to do the appending itself.
    const layerId = addCityLayer();
    act(() => useQueryStore.getState().setColumns(layerId, ["id"]));
    render(<ToolView toolId="height-from-extent" />);
    act(() =>
      useProcessingStore
        .getState()
        .upsertRun(runFixture({ status: "done", targetLayerId: layerId })),
    );
    const openTable = screen.getByRole("button", { name: "Open table" });
    fireEvent.click(openTable);
    expect(layerQuery(useQueryStore.getState(), layerId).columns).toEqual([
      "id",
      "extent_height_m",
      "extent_zmin_m",
      "extent_zmax_m",
    ]);
    fireEvent.click(openTable);
    expect(layerQuery(useQueryStore.getState(), layerId).columns).toEqual([
      "id",
      "extent_height_m",
      "extent_zmin_m",
      "extent_zmax_m",
    ]);
  });

  it("leaves a default table list on the default path", () => {
    const layerId = addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    act(() =>
      useProcessingStore
        .getState()
        .upsertRun(runFixture({ status: "done", targetLayerId: layerId })),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open table" }));
    expect(layerQuery(useQueryStore.getState(), layerId).columns).toBeNull();
  });

  it("asks the grid to scroll the run's columns into view (§6.2)", () => {
    // §6.2: "…appended after the existing ones AND SCROLLED INTO VIEW". On the
    // DEFAULT list too, where the append is a no-op — the scroll is what the
    // user pressed Open table for either way.
    const layerId = addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    act(() =>
      useProcessingStore
        .getState()
        .upsertRun(runFixture({ status: "done", targetLayerId: layerId })),
    );
    const seen: Array<{ layerId: string; columns: ReadonlyArray<string> }> = [];
    const stop = subscribeColumnReveal((reveal) => {
      seen.push({ layerId: reveal.layerId, columns: reveal.columns });
      return true;
    });
    fireEvent.click(screen.getByRole("button", { name: "Open table" }));
    expect(seen).toEqual([
      {
        layerId,
        columns: ["extent_height_m", "extent_zmin_m", "extent_zmax_m"],
      },
    ]);
    stop();
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
});
