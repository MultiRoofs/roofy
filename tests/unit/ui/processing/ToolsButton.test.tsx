import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToolsButton } from "../../../../src/ui/processing/ToolsButton";
import { useProcessingStore } from "../../../../src/features/processing/processingStore";
import { useShellStore } from "../../../../src/ui/shell/shellStore";

afterEach(() => {
  cleanup();
  useProcessingStore.getState().resetForTest();
  useShellStore.getState().setRightCollapsed(false);
});

describe("ToolsButton", () => {
  it("opens the toolbox on the Tools tab and reflects it as pressed", () => {
    render(<ToolsButton />);
    const button = screen.getByRole("button", { name: "Tools" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(button);
    expect(useProcessingStore.getState().open).toBe(true);
    expect(useProcessingStore.getState().activeTab).toBe("tools");
    expect(screen.getByRole("button", { name: "Tools" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("closes the toolbox only while Tools is visibly the active tab", () => {
    useProcessingStore.getState().setOpen(true);
    render(<ToolsButton />);
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    expect(useProcessingStore.getState().open).toBe(false);
  });

  it("switches to Tools instead of closing while Details is showing", () => {
    useProcessingStore.getState().setOpen(true);
    useProcessingStore.getState().setTab("details");
    render(<ToolsButton />);
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    expect(useProcessingStore.getState().open).toBe(true);
    expect(useProcessingStore.getState().activeTab).toBe("tools");
  });

  it("expands a collapsed right panel instead of opening behind it", () => {
    useShellStore.getState().setRightCollapsed(true);
    render(<ToolsButton />);
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    expect(useProcessingStore.getState().open).toBe(true);
    expect(useShellStore.getState().rightCollapsed).toBe(false);
  });

  it("reveals an open toolbox hidden behind a collapsed panel rather than closing it", () => {
    useProcessingStore.getState().setOpen(true);
    useProcessingStore.getState().setTab("details");
    useShellStore.getState().setRightCollapsed(true);
    render(<ToolsButton />);
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    expect(useProcessingStore.getState().open).toBe(true);
    expect(useProcessingStore.getState().activeTab).toBe("tools");
    expect(useShellStore.getState().rightCollapsed).toBe(false);
  });

  it("shows a lime dot while a run is queued or running and amber for an unseen failure", () => {
    const { rerender } = render(<ToolsButton />);
    expect(screen.queryByTestId("tools-activity")).toBeNull();
    useProcessingStore.setState({
      runs: [
        {
          id: "r1",
          toolId: "height-from-extent",
          targetLayerId: "L1",
          targetName: "Delft",
          sourceLayerId: null,
          sourceName: null,
          scope: "all",
          scopeCount: 1,
          featureIds: null,
          lod: null,
          params: {},
          prefix: "extent_",
          columns: [],
          status: "running",
          phase: "compute",
          startedAt: 0,
          elapsedMs: 0,
          summary: null,
          error: null,
          log: [],
          warnings: [],
          undoable: false,
          stale: false,
          note: null,
        },
      ],
    });
    rerender(<ToolsButton />);
    expect(screen.getByTestId("tools-activity")).toHaveAttribute(
      "data-tone",
      "running",
    );
    useProcessingStore.setState({ runs: [], unseenFailure: true });
    rerender(<ToolsButton />);
    expect(screen.getByTestId("tools-activity")).toHaveAttribute(
      "data-tone",
      "failed",
    );
  });
});
