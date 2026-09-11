/**
 * Spec §6.1 after the engine dies: the tools go dark with the reason the
 * catalogue already has, and no card offers an Undo it cannot perform.
 *
 * The queue is mocked — `runQueue.test.ts` owns what a dying engine does to a
 * RUN — so what this file pins is the copy and the disabled state the two
 * places an Undo is offered show once the store's flag is set.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { CityModel } from "../../../../src/domain/citymodel/types";
import type { LayerStoreActions } from "../../../../src/features/layers/layerStore";
import type { RunRecord } from "../../../../src/features/processing/types";

/** The published status, as a test sets it before rendering. */
const READY = {
  state: "ready",
  extensions: {
    cityjson: { state: "loaded" },
    spatial: { state: "unloaded" },
    three_d: { state: "unloaded" },
  },
  loadedExtensions: [],
  platform: "wasm_eh",
};
let engineStatus: unknown = READY;

vi.mock("../../../../src/insights/duckdb", () => ({
  subscribeDuckDBStatus: vi.fn(() => () => {}),
  getDuckDBStatusVersion: vi.fn(() => 0),
  getDuckDBStatus: vi.fn(() => engineStatus),
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
  retryRun: vi.fn(() => "run_2"),
  cancelRun: vi.fn(),
  undoRun: vi.fn(async () => {}),
}));

const { CatalogueView } =
  await import("../../../../src/ui/processing/CatalogueView");
const { ToolView } = await import("../../../../src/ui/processing/ToolView");
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

type LayerInput = Parameters<LayerStoreActions["addLayer"]>[0];

/** A ready city layer, so ONLY the engine can disable the row. */
function addCityLayer(): string {
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
          columns: [],
          lods: [],
          rowCount: 2,
        },
      },
    },
  });
  return id;
}

/** A finished, undoable run of the one implemented M1 tool. */
function doneRun(layerId: string, patch: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "r1",
    toolId: "height-from-extent",
    targetLayerId: layerId,
    targetName: "Delft",
    sourceLayerId: null,
    sourceName: null,
    scope: "all",
    scopeCount: 2,
    featureIds: null,
    lod: null,
    params: {},
    prefix: "extent_",
    columns: ["extent_height_m"],
    status: "done",
    phase: null,
    startedAt: Date.now(),
    elapsedMs: 300,
    summary: {
      line: "2 buildings measured · 0.3 s",
      detail: null,
      measured: 2,
      skipped: [],
    },
    error: null,
    log: [],
    warnings: [],
    undoable: true,
    stale: false,
    note: null,
    ...patch,
  };
}

afterEach(() => {
  cleanup();
  engineStatus = READY;
  useProcessingStore.getState().resetForTest();
  useLayerStore.getState().removeAllLayers();
  useWorkspaceStore.getState().setActiveLayerId(null);
  useLayerTableStore.setState({ tables: {} });
  useComputedColumnStore.setState({ byLayer: {} });
  useShellStore.getState().setRightCollapsed(false);
});

describe("after the analytics engine stops", () => {
  it("disables every tool row with the existing reason", () => {
    // `eligibility.ts` already answers this for `engineState: "failed"`; what
    // this pins is that the reason is REACHABLE once the status says so.
    engineStatus = { state: "failed", error: "worker gone" };
    addCityLayer();
    render(<CatalogueView />);
    const row = screen.getByText("Height from extent").closest("button")!;
    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(row.textContent).toContain(
      "Not available while DuckDB is unavailable",
    );
  });

  it("disables the result card's Undo and says why", () => {
    const layerId = addCityLayer();
    useProcessingStore.getState().markEngineStopped();
    render(<ToolView toolId="height-from-extent" />);
    act(() => useProcessingStore.getState().upsertRun(doneRun(layerId)));
    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo).toBeDisabled();
    expect(undo).toHaveAttribute(
      "title",
      "Unavailable: the analytics engine stopped",
    );
  });

  it("disables Recent runs' Undo for the same reason", () => {
    const layerId = addCityLayer();
    useProcessingStore.getState().markEngineStopped();
    act(() => useProcessingStore.getState().upsertRun(doneRun(layerId)));
    render(<CatalogueView />);
    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo).toBeDisabled();
    expect(undo).toHaveAttribute(
      "title",
      "Unavailable: the analytics engine stopped",
    );
  });

  it("leaves Undo alone while the engine is alive", () => {
    const layerId = addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    act(() => useProcessingStore.getState().upsertRun(doneRun(layerId)));
    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo).toBeEnabled();
    expect(undo).not.toHaveAttribute("title");
  });
});
