/**
 * Spec §6.4: the run header a planner can read back, the statements with their
 * timings, the warnings, the error, and Copy.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { RunRecord } from "../../../../src/features/processing/types";

const { LogView } = await import("../../../../src/ui/processing/LogView");
const { formatRunLog, clockTime } =
  await import("../../../../src/ui/processing/runFormat");
const { useProcessingStore } =
  await import("../../../../src/features/processing/processingStore");

const startedAt = new Date(2026, 8, 10, 14, 2, 11).getTime();

function runFixture(patch: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "r1",
    toolId: "height-from-extent",
    targetLayerId: "L1",
    targetName: "Delft",
    sourceLayerId: null,
    sourceName: null,
    scope: "all",
    scopeCount: 1115,
    featureIds: null,
    lod: null,
    params: {},
    prefix: "extent_",
    columns: ["extent_height_m", "extent_zmin_m", "extent_zmax_m"],
    status: "done",
    phase: null,
    startedAt,
    elapsedMs: 412,
    summary: {
      line: "1,115 buildings measured · 0.4 s",
      detail: null,
      measured: 1115,
      skipped: [],
    },
    error: null,
    log: [
      {
        label: "Compute extents",
        sql: 'SELECT "id" FROM layer_1',
        ms: 412,
        rows: 1116,
      },
    ],
    warnings: ["ST_3DVolume skipped 37 invalid solids"],
    undoable: true,
    stale: false,
    note: null,
    ...patch,
  };
}

afterEach(() => {
  cleanup();
  useProcessingStore.getState().resetForTest();
});

describe("LogView", () => {
  it("lists a warning the run raised twice, without colliding keys", () => {
    const twice = "ST_3DVolume skipped 37 invalid solids";
    useProcessingStore
      .getState()
      .upsertRun(runFixture({ warnings: [twice, twice] }));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<LogView runId="r1" />);
    expect(screen.getAllByText(twice)).toHaveLength(2);
    expect(errors.mock.calls.map((c) => String(c[0])).join("\n")).not.toMatch(
      /same key/,
    );
    errors.mockRestore();
  });

  it("renders the header, the statement and the warning", () => {
    useProcessingStore.getState().upsertRun(runFixture());
    render(<LogView runId="r1" />);
    expect(screen.getByText("Height from extent")).toBeInTheDocument();
    expect(screen.getByText("Delft")).toBeInTheDocument();
    expect(
      screen.getByText("All · 1,115 buildings (frozen at 14:02:11)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("extent_height_m, extent_zmin_m, extent_zmax_m"),
    ).toBeInTheDocument();
    expect(screen.getByText("Compute extents")).toBeInTheDocument();
    expect(screen.getByText('SELECT "id" FROM layer_1')).toBeInTheDocument();
    expect(screen.getByText("0.4 s · 1,116 rows")).toBeInTheDocument();
    expect(
      screen.getByText("ST_3DVolume skipped 37 invalid solids"),
    ).toBeInTheDocument();
  });

  it("copies the whole log as text", async () => {
    useProcessingStore.getState().upsertRun(runFixture());
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<LogView runId="r1" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(formatRunLog(runFixture()));
  });

  it("goes back to the view that opened it", () => {
    useProcessingStore.getState().upsertRun(runFixture());
    useProcessingStore.getState().openTool("height-from-extent");
    useProcessingStore.getState().openLog("r1");
    render(<LogView runId="r1" />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(useProcessingStore.getState().view).toEqual({
      kind: "tool",
      toolId: "height-from-extent",
    });
  });

  it("says so when the run is gone", () => {
    render(<LogView runId="missing" />);
    expect(
      screen.getByText("This run is no longer in the history"),
    ).toBeInTheDocument();
  });
});

describe("formatRunLog", () => {
  it("is the header, the statements and the warnings as plain text", () => {
    const text = formatRunLog(runFixture());
    expect(text).toContain("Target layer: Delft");
    expect(text).toContain("Source layer: —");
    expect(text).toContain(
      `Scope: All · 1,115 buildings (frozen at ${clockTime(startedAt)})`,
    );
    expect(text).toContain(
      "Output columns: extent_height_m, extent_zmin_m, extent_zmax_m",
    );
    expect(text).toContain("Status: done");
    expect(text).toContain('SELECT "id" FROM layer_1');
    expect(text).toContain("0.4 s · 1,116 rows");
    expect(text).toContain("Warning: ST_3DVolume skipped 37 invalid solids");
  });

  it("names the error of a failed run", () => {
    expect(
      formatRunLog(runFixture({ status: "failed", error: "Binder Error: x" })),
    ).toContain("Error: Binder Error: x");
  });
});
