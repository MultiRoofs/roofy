/**
 * §6.2's done card for a New-layer run: the "Created …" line, the five actions
 * pointing at the COPY rather than at the untouched target, and Zoom to layer.
 *
 * The footer is rendered on its own, not through `ToolView`: what is under
 * test is the card, and a form around it would make every case depend on the
 * eligibility of a tool it is not about.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { RunRecord } from "../../../../src/features/processing/types";

vi.mock("../../../../src/insights/duckdb", () => ({
  formatDuckDBError: (e: unknown) => String(e),
  subscribeDuckDBStatus: vi.fn(() => () => {}),
  getDuckDBStatusVersion: vi.fn(() => 0),
  getEngineGeneration: vi.fn(() => 1),
  onEngineDeath: vi.fn(() => () => {}),
  getDuckDBStatus: vi.fn(() => ({
    state: "ready",
    extensions: {},
    loadedExtensions: [],
    platform: "wasm_eh",
  })),
  isExtensionLoaded: vi.fn(() => true),
  ensureExtension: vi.fn(async () => true),
  runQuery: vi.fn(async () => ({ ok: true, columns: ["m"], rows: [{ m: 7 }] })),
  ddl: vi.fn(async () => ({ ok: true, columns: [], rows: [] })),
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
    // The BLOCK is real: what the card is asserting is §6.2's rule, and a
    // stubbed predicate would let the card claim any reason it liked.
    newLayerUndoBlock: actual.newLayerUndoBlock,
    submitRun: vi.fn(() => "run_1"),
    retryRun: vi.fn(() => "run_2"),
    cancelRun: vi.fn(),
    undoRun: vi.fn(async () => {}),
  };
});

const { RunFooter } = await import("../../../../src/ui/processing/RunFooter");
const { useShellStore } = await import("../../../../src/ui/shell/shellStore");
const { clearColumnReveals } =
  await import("../../../../src/ui/table/revealColumns");
const { useQueryStore } =
  await import("../../../../src/features/query/queryStore");
const { useProcessingStore } =
  await import("../../../../src/features/processing/processingStore");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useWorkspaceStore } =
  await import("../../../../src/features/workspace/workspaceStore");
const { useLayerTableStore } =
  await import("../../../../src/insights/layerTables");
const { undoRun } =
  await import("../../../../src/features/processing/runQueue");
const { useRuleDraftStore } =
  await import("../../../../src/features/rules/ruleDraftStore");

/** A done New-layer run whose copy is the layer "NEW". */
function createdRun(patch: Partial<RunRecord> = {}): RunRecord {
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
    columns: ["extent_height_m"],
    destination: "new",
    newLayerName: "Delft · extent",
    newLayerId: "NEW",
    status: "done",
    phase: null,
    startedAt: Date.now(),
    elapsedMs: 300,
    summary: {
      line: "Created Delft · extent · 2 buildings · 0.3 s",
      detail: null,
      measured: 2,
      skipped: [],
      // Style by result reads the per-column map to decide whether the chosen
      // column is all-NULL.
      nonNullByColumn: { extent_height_m: 2 },
    },
    error: null,
    log: [],
    warnings: [],
    undoable: false,
    stale: false,
    note: null,
    ...patch,
  };
}

/** Both layers in the store, and a ready table for the copy, so Open table
 *  has somewhere to go. Only the two ids matter to the card. */
function addLayers(): void {
  useLayerStore.setState({
    layers: [
      { id: "L", name: "Delft" } as never,
      { id: "NEW", name: "Delft · extent" } as never,
    ],
  });
  useLayerTableStore.setState({
    tables: {
      NEW: {
        state: "ready",
        info: {
          table: "layer_2",
          sourceName: null,
          source: null,
          reader: null,
          extension: null,
          sourceBytes: null,
          sourceFeatureIds: null,
          columns: [],
          lods: [],
          rowCount: 2,
        },
      },
    },
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useProcessingStore.getState().resetForTest();
  useLayerStore.setState({ layers: [] });
  useLayerTableStore.setState({ tables: {} });
  useWorkspaceStore.getState().setActiveLayerId(null);
  useQueryStore.setState({ queries: {} });
  useRuleDraftStore.setState({ drafts: {} });
  useShellStore.getState().requestZoom(null);
  useShellStore.getState().closeDrawer();
  // Open table RETAINS its scroll request until a grid acknowledges it, and no
  // case here renders one.
  clearColumnReveals();
});

describe("the New-layer result card", () => {
  it("groups Undo, Log, and Run again outside the result card with icons", () => {
    const onRunAgain = vi.fn();
    render(
      <RunFooter
        run={createdRun({ undoable: true })}
        canRun
        reason={null}
        onRunAgain={onRunAgain}
      />,
    );
    expect(screen.queryByRole("button", { name: "Open table" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Style by result" }),
    ).toBeNull();
    const undo = screen.getByRole("button", { name: "Undo" });
    const log = screen.getByRole("button", { name: "Log" });
    const again = screen.getByRole("button", { name: "Run again" });
    expect(undo.parentElement).toBe(again.parentElement);
    expect(log.parentElement).toBe(again.parentElement);
    for (const button of [undo, log, again]) {
      expect(button.closest(".processing-card")).toBeNull();
      expect(button.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    }
    fireEvent.click(again);
    expect(onRunAgain).toHaveBeenCalledOnce();
  });

  it("shows the Created line and the remaining actions", () => {
    render(
      <RunFooter
        run={createdRun({ undoable: true })}
        canRun
        reason={null}
        onRunAgain={() => {}}
      />,
    );
    expect(
      screen.getByText("Created Delft · extent · 2 buildings · 0.3 s"),
    ).toBeTruthy();
    // Derived results retain their zoom shortcut.
    for (const name of ["Zoom to layer", "Undo", "Log"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("asks the shell to zoom to the COPY", () => {
    addLayers();
    render(
      <RunFooter
        run={createdRun()}
        canRun
        reason={null}
        onRunAgain={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Zoom to layer" }));
    expect(useShellStore.getState().requestedZoom).toBe("NEW");
  });

  it("does NOT say 'Wrote N columns to Delft' — nothing was written there", () => {
    render(
      <RunFooter
        run={createdRun()}
        canRun
        reason={null}
        onRunAgain={() => {}}
      />,
    );
    expect(screen.queryByText(/Wrote 1 column to Delft/)).toBeNull();
  });

  it("still names what a THIS-LAYER run wrote and where", () => {
    // The other half of the branch: the sentence is dropped for the copy, not
    // deleted from the card.
    render(
      <RunFooter
        run={createdRun({
          destination: "layer",
          newLayerName: null,
          newLayerId: null,
          summary: null,
        })}
        canRun
        reason={null}
        onRunAgain={() => {}}
      />,
    );
    expect(screen.getByText(/Wrote 1 column to Delft\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Zoom to layer" })).toBeNull();
  });

  it("does nothing once Undo has REMOVED the copy the actions point at", () => {
    // The card outlives its layer: §6.2's Undo removes the copy and leaves the
    // card reading "Undone", with `newLayerId` still on the record. Activating
    // an id that is gone leaves the workspace with a dangling active layer and
    // an empty left panel — nothing corrects it, because the correction
    // watches the LAYER stores and this write is to the workspace one.
    addLayers();
    useLayerStore.setState((state) => ({
      layers: state.layers.filter((l) => l.id !== "NEW"),
    }));
    render(
      <RunFooter
        run={createdRun({ note: "Undone" })}
        canRun
        reason={null}
        onRunAgain={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Zoom to layer" }));
    expect(useWorkspaceStore.getState().activeLayerId).toBeNull();
    expect(useShellStore.getState().requestedZoom).toBeNull();
    expect(useWorkspaceStore.getState().activeLayerId).toBeNull();
    expect(useShellStore.getState().drawerOpen).toBe(false);
  });

  it("shows A15's rename note when publication renamed the layer", () => {
    render(
      <RunFooter
        run={createdRun({
          note: 'Renamed to "Delft · extent (2)": a layer already had that name',
        })}
        canRun
        reason={null}
        onRunAgain={() => {}}
      />,
    );
    expect(
      screen.getByText(
        'Renamed to "Delft · extent (2)": a layer already had that name',
      ),
    ).toBeTruthy();
  });

  it("disables Undo with §6.2's reason once a later run used the copy", () => {
    useProcessingStore
      .getState()
      .upsertRun(
        createdRun({ id: "run_later", targetLayerId: "NEW", newLayerId: null }),
      );
    const run = createdRun({ undoable: true });
    render(<RunFooter run={run} canRun reason={null} onRunAgain={() => {}} />);
    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo).toBeDisabled();
    expect(undo.getAttribute("title")).toBe(
      "Used by a later run; remove the layer from the layer list instead",
    );
    fireEvent.click(undo);
    expect(vi.mocked(undoRun)).not.toHaveBeenCalled();
  });

  it("leaves a THIS-LAYER run's Undo alone — the block is not its rule", () => {
    const run = createdRun({
      destination: "layer",
      newLayerName: null,
      newLayerId: null,
      undoable: true,
    });
    render(<RunFooter run={run} canRun reason={null} onRunAgain={() => {}} />);
    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo).toBeEnabled();
    fireEvent.click(undo);
    expect(vi.mocked(undoRun)).toHaveBeenCalledWith("r1");
  });
});
