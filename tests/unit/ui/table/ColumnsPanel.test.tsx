import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ColumnsPanel } from "../../../../src/ui/table/ColumnsPanel";
import {
  formatProvenance,
  useComputedColumnStore,
  type Provenance,
} from "../../../../src/insights/computedColumns";
afterEach(() => {
  cleanup();
  useComputedColumnStore.setState({ byLayer: {} });
});
it("separates shown and available columns and searches both", () => {
  const columns = ["id", "height", "status"].map((name) => ({
    name,
    type: "VARCHAR",
    kind: "scalar" as const,
  }));
  const onChange = vi.fn();
  render(
    <ColumnsPanel
      columns={columns}
      visible={[columns[1]!, columns[0]!]}
      label={(name) => name}
      onChange={onChange}
      onMove={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  expect(screen.getByText("Shown · 2")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Move status up" })).toBeNull();
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "status" },
  });
  expect(screen.queryByRole("checkbox", { name: "height" })).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "status" }));
  expect(onChange).toHaveBeenCalledWith(["height", "id", "status"]);
  fireEvent.click(screen.getByRole("button", { name: "Reset columns" }));
  expect(onChange).toHaveBeenCalledWith(null);
});
it("reorders shown columns by dragging a grip onto another row", () => {
  const columns = ["id", "height"].map((name) => ({
    name,
    type: "VARCHAR",
    kind: "scalar" as const,
  }));
  const onMove = vi.fn();
  render(
    <ColumnsPanel
      columns={columns}
      visible={columns}
      label={(n) => n}
      onChange={vi.fn()}
      onMove={onMove}
      onClose={vi.fn()}
    />,
  );
  const grip = screen.getByRole("button", { name: "Drag id to reorder" });
  fireEvent.dragStart(grip, {
    dataTransfer: { setData: vi.fn(), effectAllowed: "" },
  });
  const target = screen
    .getByRole("checkbox", { name: "height" })
    .closest(".column-picker-row")!;
  fireEvent.dragOver(target);
  fireEvent.drop(target);
  expect(onMove).toHaveBeenCalledWith("id", "height");
});

it("badges a tool-computed column in the chooser with its provenance", () => {
  const provenance: Provenance = {
    runId: "r1",
    toolName: "Height from extent",
    summary: "All · 2 buildings",
    at: new Date(2026, 8, 10, 14, 2).getTime(),
    partial: null,
    previous: null,
  };
  useComputedColumnStore
    .getState()
    .setProvenance("L1", "extent_height_m", provenance);
  const columns = [
    { name: "id", type: "VARCHAR", kind: "scalar" as const },
    { name: "extent_height_m", type: "DOUBLE", kind: "scalar" as const },
  ];
  render(
    <ColumnsPanel
      layerId="L1"
      columns={columns}
      visible={[columns[0]!]}
      label={(name) => name}
      onChange={vi.fn()}
      onMove={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  const badge = screen.getByRole("img", { name: "Computed by Roofy" });
  expect(badge.getAttribute("title")).toBe(formatProvenance(provenance));
});
