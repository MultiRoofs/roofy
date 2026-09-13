/**
 * Spec §5's history rows: the status dot, the target (and "← source"), the
 * status word, the second line, and which of Log / Undo / Retry / Cancel /
 * Re-run / Edit & run each state offers.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { RunRecord } from "../../../../src/features/processing/types";

vi.mock("../../../../src/features/processing/runQueue", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/features/processing/runQueue")
  >("../../../../src/features/processing/runQueue");
  return {
    // §6.2's block is REAL here, as it is in the card's own suite: the row is
    // asserting the RULE, and a stub would let it claim any reason it liked.
    newLayerUndoBlock: actual.newLayerUndoBlock,
    retryRun: vi.fn(() => "run_2"),
    cancelRun: vi.fn(),
    undoRun: vi.fn(async () => {}),
  };
});

const { RecentRuns } = await import("../../../../src/ui/processing/RecentRuns");
const { retryRun, cancelRun, undoRun } =
  await import("../../../../src/features/processing/runQueue");
const { useProcessingStore } =
  await import("../../../../src/features/processing/processingStore");
const { useShellStore } = await import("../../../../src/ui/shell/shellStore");

function runFixture(patch: Partial<RunRecord>): RunRecord {
  return {
    id: "r1",
    toolId: "height-from-extent",
    targetLayerId: "L1",
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
    status: "done",
    phase: null,
    startedAt: Date.now(),
    elapsedMs: 2400,
    summary: {
      line: "2 buildings measured · 2.4 s",
      detail: null,
      measured: 2,
      skipped: [],
      nonNullByColumn: { extent_height_m: 2 },
    },
    error: null,
    log: [],
    warnings: [],
    undoable: true,
    stale: false,
    destination: "layer",
    newLayerName: null,
    newLayerId: null,
    note: null,
    ...patch,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useProcessingStore.getState().resetForTest();
  useShellStore.getState().setRightCollapsed(false);
});

describe("RecentRuns", () => {
  it("shows the empty line until the first run", () => {
    render(<RecentRuns />);
    expect(screen.getByText("Runs you start appear here")).toBeInTheDocument();
  });

  it("lists a done run with its dot, target, elapsed, status and actions", () => {
    useProcessingStore.getState().upsertRun(runFixture({}));
    const { container } = render(<RecentRuns />);
    expect(
      screen.getByText("Height from extent · Delft · 2.4 s · done"),
    ).toBeInTheDocument();
    expect(container.querySelector(".processing-run-row__dot")).toHaveAttribute(
      "data-status",
      "done",
    );
    expect(
      screen.getByText("2 buildings measured · 2.4 s"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(undoRun).toHaveBeenCalledWith("r1");
    fireEvent.click(screen.getByRole("button", { name: "Log" }));
    expect(useProcessingStore.getState().view).toEqual({
      kind: "log",
      runId: "r1",
      from: { kind: "catalogue" },
    });
  });

  it("refuses a New-layer Undo the queue would refuse, and says why", () => {
    // §5 ties the row's Undo to §6.2's rule, and the QUEUE refuses this one
    // silently (it patches `error`, which a DONE row does not render) — so a
    // row that offered a live button would be a button that does nothing.
    useProcessingStore
      .getState()
      .upsertRun(runFixture({ destination: "new", newLayerId: "NEW" }));
    useProcessingStore.getState().upsertRun(
      runFixture({
        id: "run_later",
        targetLayerId: "NEW",
        status: "queued",
        summary: null,
        undoable: false,
      }),
    );
    render(<RecentRuns />);
    const undo = screen.getAllByRole("button", { name: "Undo" })[0]!;
    expect(undo).toBeDisabled();
    expect(undo.getAttribute("title")).toBe(
      "Used by a later run; remove the layer from the layer list instead",
    );
    fireEvent.click(undo);
    expect(undoRun).not.toHaveBeenCalled();
  });

  it("leaves a New-layer Undo alone while nothing has used the copy", () => {
    useProcessingStore
      .getState()
      .upsertRun(runFixture({ destination: "new", newLayerId: "NEW" }));
    render(<RecentRuns />);
    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo).toBeEnabled();
    fireEvent.click(undo);
    expect(undoRun).toHaveBeenCalledWith("r1");
  });

  it("names the source layer of a cross-layer run", () => {
    useProcessingStore.getState().upsertRun(
      runFixture({
        toolId: "join-by-location",
        sourceLayerId: "G1",
        sourceName: "Zones",
      }),
    );
    render(<RecentRuns />);
    expect(
      screen.getByText(
        "Join attributes by location · Delft ← Zones · 2.4 s · done",
      ),
    ).toBeInTheDocument();
  });

  it("offers Retry on a failed run and repeats its frozen request", () => {
    useProcessingStore.getState().upsertRun(
      runFixture({
        status: "failed",
        error: "Binder Error: x",
        summary: null,
        undoable: false,
      }),
    );
    render(<RecentRuns />);
    expect(screen.getByText("Binder Error: x")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    // The QUEUE holds that request — the scope's frozen ids included — so the
    // row repeats a run by id and never rebuilds one from what it renders
    // (`runQueue.test.ts` owns what the repeat then resolves).
    expect(retryRun).toHaveBeenCalledWith("r1");
  });

  it("offers Cancel while a run is queued or running", () => {
    useProcessingStore
      .getState()
      .upsertRun(runFixture({ status: "running", phase: "compute" }));
    render(<RecentRuns />);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancelRun).toHaveBeenCalledWith("r1");
  });

  it("reads a stale run as reloaded and offers Re-run", () => {
    useProcessingStore
      .getState()
      .upsertRun(runFixture({ stale: true, undoable: false }));
    render(<RecentRuns />);
    expect(screen.getByText("stale: layer reloaded")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Re-run" }));
    expect(retryRun).toHaveBeenCalledWith("r1");
  });

  it("opens the tool view prefilled through Edit & run", () => {
    useProcessingStore.getState().upsertRun(runFixture({}));
    useShellStore.getState().setRightCollapsed(true);
    render(<RecentRuns />);
    fireEvent.click(screen.getByRole("button", { name: "Edit & run" }));
    expect(useProcessingStore.getState().view).toEqual({
      kind: "tool",
      toolId: "height-from-extent",
    });
    expect(useProcessingStore.getState().drafts["height-from-extent"]).toEqual({
      targetLayerId: "L1",
      // §6.3's "the same parameters" includes WHICH layer the run read.
      sourceLayerId: null,
      scope: "all",
      lod: null,
      prefix: "extent_",
      params: {},
      // §6.1 froze the destination and the name onto the record, and §6.3's
      // "the same parameters" includes them.
      destination: "layer",
      newLayerName: null,
    });
    expect(useShellStore.getState().rightCollapsed).toBe(false);
    // §5: it opens the form "so parameters can be changed" — so the run's own
    // result card must not be sitting over it, locked.
    expect(useProcessingStore.getState().dismissedRunIds).toContain("r1");
  });

  it("reopens a New-layer run on New layer, under the name it published", () => {
    // §6.3's "the same parameters": a destination restored as "This layer"
    // would silently retarget the reopened run at the layer the original one
    // deliberately left untouched.
    useProcessingStore.getState().upsertRun(
      runFixture({
        destination: "new",
        newLayerName: "Delft · extent",
        newLayerId: "NEW",
      }),
    );
    render(<RecentRuns />);
    fireEvent.click(screen.getByRole("button", { name: "Edit & run" }));
    expect(
      useProcessingStore.getState().drafts["height-from-extent"],
    ).toMatchObject({
      destination: "new",
      newLayerName: "Delft · extent",
    });
  });

  it("clears the LATEST done card of the pair, not only the row clicked", () => {
    // The tool view watches the latest run of a (tool, target) pair, so
    // dismissing the older row the user clicked would leave the newer card —
    // and its lock — over the form.
    useProcessingStore.getState().upsertRun(runFixture({ id: "older" }));
    useProcessingStore.getState().upsertRun(runFixture({ id: "newer" }));
    render(<RecentRuns />);
    const rows = screen.getAllByRole("button", { name: "Edit & run" });
    fireEvent.click(rows[1]!); // the older row
    expect(useProcessingStore.getState().dismissedRunIds).toEqual(["newer"]);
  });

  it("dismisses nothing when the pair's latest run is still in flight", () => {
    useProcessingStore.getState().upsertRun(runFixture({ id: "done" }));
    useProcessingStore
      .getState()
      .upsertRun(
        runFixture({ id: "live", status: "running", phase: "compute" }),
      );
    render(<RecentRuns />);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit & run" })[1]!);
    // §6.1: the form opens LOCKED under the running run's progress block.
    expect(useProcessingStore.getState().dismissedRunIds).toEqual([]);
  });

  it("clears a FAILED card too, so the form it opens can be submitted", () => {
    // §6.3's card offers Retry and Log; Edit & run promises a form whose
    // parameters can be changed, which means one with a Run button.
    useProcessingStore
      .getState()
      .upsertRun(runFixture({ status: "failed", error: "Binder Error: x" }));
    render(<RecentRuns />);
    fireEvent.click(screen.getByRole("button", { name: "Edit & run" }));
    expect(useProcessingStore.getState().dismissedRunIds).toEqual(["r1"]);
  });

  it("lists the newest run first", () => {
    useProcessingStore.getState().upsertRun(runFixture({ id: "old" }));
    useProcessingStore
      .getState()
      .upsertRun(runFixture({ id: "new", toolId: "measure-solids" }));
    const { container } = render(<RecentRuns />);
    const rows = container.querySelectorAll(".processing-run-row__head");
    expect(rows[0]?.textContent).toContain("Measure solids");
  });

  it("shows 'target \u2190 source' for a cross-layer run", () => {
    useProcessingStore.setState({
      runs: [
        runFixture({
          toolId: "join-by-location",
          targetName: "Delft",
          sourceLayerId: "GEO",
          sourceName: "Zones",
        }),
      ],
    });
    render(<RecentRuns />);
    expect(screen.getByText(/Delft \u2190 Zones/)).toBeInTheDocument();
  });
});
