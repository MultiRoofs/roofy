/**
 * Spec §5's history rows: the status dot, the target (and "← source"), the
 * status word, the second line, and which of Log / Undo / Retry / Cancel /
 * Re-run / Edit & run each state offers.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { RunRecord } from "../../../../src/features/processing/types";

vi.mock("../../../../src/features/processing/runQueue", () => ({
  submitRun: vi.fn(() => "run_2"),
  cancelRun: vi.fn(),
  undoRun: vi.fn(async () => {}),
}));

const { RecentRuns } = await import("../../../../src/ui/processing/RecentRuns");
const { submitRun, cancelRun, undoRun } =
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
    expect(submitRun).toHaveBeenCalledWith({
      toolId: "height-from-extent",
      targetLayerId: "L1",
      scope: "all",
      lod: null,
      params: {},
      prefix: "extent_",
      columns: [
        { name: "extent_height_m", type: "DOUBLE" },
        { name: "extent_zmin_m", type: "DOUBLE" },
        { name: "extent_zmax_m", type: "DOUBLE" },
      ],
    });
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
    expect(submitRun).toHaveBeenCalledTimes(1);
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
      scope: "all",
      lod: null,
      prefix: "extent_",
      params: {},
    });
    expect(useShellStore.getState().rightCollapsed).toBe(false);
    // §5: it opens the form "so parameters can be changed" — so the run's own
    // result card must not be sitting over it, locked.
    expect(useProcessingStore.getState().dismissedRunIds).toContain("r1");
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
});
