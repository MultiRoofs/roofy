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

vi.mock("../../../../src/insights/duckdb", () => ({
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
  formatDuckDBError: (e: unknown) => String(e),
  runQuery: vi.fn(async () => ({ ok: false, message: "no engine" })),
  ddl: vi.fn(async () => ({ ok: false, message: "no engine" })),
  registerBuffer: vi.fn(async () => false),
  dropBuffer: vi.fn(async () => {}),
  readFile: vi.fn(async () => null),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
  initDuckDB: vi.fn(async () => {}),
}));

vi.mock("../../../../src/features/processing/runQueue", () => ({
  submitRun: vi.fn(() => "run_1"),
  cancelRun: vi.fn(),
  undoRun: vi.fn(async () => {}),
}));

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
const { submitRun, cancelRun, undoRun } =
  await import("../../../../src/features/processing/runQueue");
const { useProcessingStore } =
  await import("../../../../src/features/processing/processingStore");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useWorkspaceStore } =
  await import("../../../../src/features/workspace/workspaceStore");
const { useLayerTableStore } =
  await import("../../../../src/insights/layerTables");
const { useComputedColumnStore } =
  await import("../../../../src/insights/computedColumns");
const { useShellStore } = await import("../../../../src/ui/shell/shellStore");
const { useQueryStore, layerQuery } =
  await import("../../../../src/features/query/queryStore");

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
          rowCount: 2,
        },
      },
    },
  });
  return id;
}

function runFixture(patch: Partial<RunRecord>): RunRecord {
  return {
    id: "r1",
    toolId: "height-from-extent",
    targetLayerId: "L",
    targetName: "Delft",
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
  useWorkspaceStore.getState().setActiveLayerId(null);
  useLayerTableStore.setState({ tables: {} });
  useComputedColumnStore.setState({ byLayer: {} });
  useQueryStore.setState({ queries: {} });
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
        scope: "selected",
        lod: null,
        prefix: "extent_",
        params: {},
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
    expect(
      screen.getByRole("button", { name: "Cancel run" }),
    ).toBeInTheDocument();
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
    // §6.3 leaves the form editable after a failure, so the draft can drift —
    // and drift into a state that would refuse a fresh Run.
    fireEvent.change(screen.getByRole("textbox", { name: "Prefix" }), {
      target: { value: "1 bad" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(submitRun).toHaveBeenCalledWith(
      expect.objectContaining({
        toolId: "height-from-extent",
        targetLayerId: layerId,
        prefix: "extent_",
        columns: [
          { name: "extent_height_m", type: "DOUBLE" },
          { name: "extent_zmin_m", type: "DOUBLE" },
          { name: "extent_zmax_m", type: "DOUBLE" },
        ],
      }),
    );
  });

  it("opens the drawer and the STYLE section from the result card", () => {
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
          },
        }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open table" }));
    expect(useShellStore.getState().drawerOpen).toBe(true);
    expect(useWorkspaceStore.getState().activeLayerId).toBe(layerId);
    fireEvent.click(screen.getByRole("button", { name: "Style by result" }));
    expect(useShellStore.getState().requestedSection).toEqual({
      layerId,
      section: "style",
    });
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
        scope: "selected",
        lod: null,
        prefix: "extent_",
        params: {},
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
        scope: "selected",
        lod: null,
        prefix: "extent_",
        params: {},
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
    ).toBeInTheDocument();
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
