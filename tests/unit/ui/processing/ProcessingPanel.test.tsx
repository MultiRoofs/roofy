/**
 * Spec §4.2: the right panel's tab strip. The Details tab exists only with a
 * selection, a pick never switches the tab (it only emphasises Details), and
 * the × closes the toolbox so the panel goes back to following the selection.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

vi.mock("../../../../src/insights/duckdb", () => ({
  subscribeDuckDBStatus: vi.fn(() => () => {}),
  getDuckDBStatusVersion: vi.fn(() => 0),
  getEngineGeneration: vi.fn(() => 1),
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

const { ProcessingPanel } =
  await import("../../../../src/ui/processing/ProcessingPanel");
const { useProcessingStore } =
  await import("../../../../src/features/processing/processingStore");

afterEach(() => {
  cleanup();
  useProcessingStore.getState().resetForTest();
});

describe("ProcessingPanel", () => {
  it("shows the Details tab only with a selection and never switches to it by itself", () => {
    const { rerender } = render(
      <ProcessingPanel details={null} detailsTitle="Selection" />,
    );
    expect(screen.queryByRole("tab", { name: /Details/ })).toBeNull();
    rerender(
      <ProcessingPanel
        details={<div>details body</div>}
        detailsTitle="Building …12869"
      />,
    );
    const details = screen.getByRole("tab", {
      name: /Details · Building …12869/,
    });
    expect(details).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByText("details body")).toBeNull();
    fireEvent.click(details);
    expect(screen.getByText("details body")).toBeInTheDocument();
  });

  it("emphasises the Details tab until it is looked at", () => {
    const { rerender, container } = render(
      <ProcessingPanel details={null} detailsTitle="Selection" />,
    );
    rerender(
      <ProcessingPanel details={<div>a</div>} detailsTitle="Building A" />,
    );
    expect(container.querySelector(".processing-tab__emphasis")).not.toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /Details · Building A/ }));
    expect(container.querySelector(".processing-tab__emphasis")).toBeNull();
  });

  it("returns to Tools when the selection is cleared", () => {
    const { rerender } = render(
      <ProcessingPanel details={<div>a</div>} detailsTitle="Building A" />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /Details · Building A/ }));
    expect(screen.getByText("a")).toBeInTheDocument();
    rerender(<ProcessingPanel details={null} detailsTitle="Selection" />);
    expect(screen.getByRole("tab", { name: "Tools" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("renders the view the store names", () => {
    render(<ProcessingPanel details={null} detailsTitle="Selection" />);
    expect(screen.getByRole("searchbox", { name: "Search tools" }));
    act(() => useProcessingStore.getState().openTool("height-from-extent"));
    expect(screen.getByText("Height from extent")).toBeInTheDocument();
    expect(
      screen.queryByRole("searchbox", { name: "Search tools" }),
    ).toBeNull();
  });

  it("follows the tab the store names, so the Tools button can switch it", () => {
    render(
      <ProcessingPanel details={<div>details body</div>} detailsTitle="B" />,
    );
    act(() => useProcessingStore.getState().setTab("details"));
    expect(screen.getByText("details body")).toBeInTheDocument();
    act(() => useProcessingStore.getState().setTab("tools"));
    expect(screen.queryByText("details body")).toBeNull();
  });

  it("brings the Tools tab up when a view opens behind the Details tab", () => {
    render(
      <ProcessingPanel details={<div>details body</div>} detailsTitle="B" />,
    );
    act(() => useProcessingStore.getState().setTab("details"));
    act(() => useProcessingStore.getState().openTool("height-from-extent"));
    expect(screen.queryByText("details body")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Height from extent" }),
    ).toBeInTheDocument();
  });

  it("closes through the × and returns the panel to the selection", () => {
    useProcessingStore.getState().setOpen(true);
    render(<ProcessingPanel details={null} detailsTitle="Selection" />);
    fireEvent.click(screen.getByRole("button", { name: "Close tools" }));
    expect(useProcessingStore.getState().open).toBe(false);
  });
});
