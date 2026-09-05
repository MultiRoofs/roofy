import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DataGrid } from "../../../../src/ui/table/DataGrid";
import { formatCell } from "../../../../src/ui/table/tableText";
import type { ColumnInfo } from "../../../../src/analytics/columnKind";

const COLUMNS: ReadonlyArray<ColumnInfo> = [
  { name: "id", type: "VARCHAR", kind: "scalar" },
  { name: "object_type", type: "VARCHAR", kind: "scalar" },
  { name: "b3_h_dak_max", type: "DOUBLE", kind: "scalar" },
];

const ROWS = [
  { id: "B1", object_type: "Building", b3_h_dak_max: 12.3456 },
  { id: "B2", object_type: "BuildingPart", b3_h_dak_max: null },
];

afterEach(cleanup);

describe("formatCell", () => {
  it("renders an em dash for null and undefined", () => {
    expect(formatCell(null)).toBe("—");
    expect(formatCell(undefined)).toBe("—");
  });

  it("rounds a fractional number and leaves an integer alone", () => {
    expect(formatCell(12.3456)).toBe("12.35");
    expect(formatCell(7)).toBe("7");
  });

  it("passes a string through and stringifies anything else", () => {
    expect(formatCell("Building")).toBe("Building");
    expect(formatCell(true)).toBe("true");
    expect(formatCell({ a: 1 })).toBe('{"a":1}');
  });

  it("leaves a NUMERIC STRING alone — HUGEINT and DECIMAL arrive as strings", () => {
    // `toFixed` on a string throws, and rounding a 38-digit DECIMAL to two
    // places would be a lie about the value DuckDB actually holds.
    expect(formatCell("170141183460469231731687303715884105727")).toBe(
      "170141183460469231731687303715884105727",
    );
    expect(formatCell("12.3456")).toBe("12.3456");
  });
});

describe("DataGrid", () => {
  function setup(over: Partial<Parameters<typeof DataGrid>[0]> = {}) {
    const onSort = vi.fn();
    const onRowClick = vi.fn();
    render(
      <DataGrid
        columns={COLUMNS}
        rows={ROWS}
        sort={null}
        selectedIds={new Set()}
        onSort={onSort}
        onRowClick={onRowClick}
        {...over}
      />,
    );
    return { onSort, onRowClick };
  }

  it("renders one header per column and one row per record", () => {
    setup();
    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
    expect(screen.getByText("B1")).toBeTruthy();
    expect(screen.getByText("BuildingPart")).toBeTruthy();
  });

  it("shows an em dash for a null cell", () => {
    setup();
    expect(screen.getAllByText("—")).toHaveLength(1);
  });

  it("rounds the cell TEXT but keeps the raw value on hover", () => {
    setup();
    const cell = screen.getByText("12.35");
    // The tooltip exists to reveal what the rounding hid; repeating the
    // rounded number in it makes the hover pointless.
    expect(cell.getAttribute("title")).toBe("12.3456");
  });

  it("reports a header click as a sort request", () => {
    const { onSort } = setup();
    fireEvent.click(screen.getByText("object_type"));
    expect(onSort).toHaveBeenCalledWith("object_type");
  });

  it("marks the sorted column with aria-sort", () => {
    setup({ sort: { column: "id", dir: "desc" } });
    const header = screen
      .getAllByRole("columnheader")
      .find((h) => h.textContent?.startsWith("id"))!;
    expect(header.getAttribute("aria-sort")).toBe("descending");
  });

  it("does not offer sorting on a nested column", () => {
    const { onSort } = setup({
      columns: [{ name: "parents", type: "VARCHAR[]", kind: "nested" }],
      rows: [{ parents: '["B1"]' }],
    });
    fireEvent.click(screen.getByText("parents"));
    expect(onSort).not.toHaveBeenCalled();
  });

  it("reports a row click with its id and the shift key", () => {
    const { onRowClick } = setup();
    fireEvent.click(screen.getByText("B2"), { shiftKey: true });
    expect(onRowClick).toHaveBeenCalledWith("B2", true);
  });

  it("marks a selected row", () => {
    setup({ selectedIds: new Set(["B1"]) });
    const selected = document.querySelectorAll(".data-row-selected");
    expect(selected).toHaveLength(1);
  });

  it("says so when there are no rows", () => {
    setup({ rows: [] });
    expect(screen.getByText("No rows match this filter.")).toBeTruthy();
  });

  it("uses the caller's empty message when it supplies one", () => {
    setup({ rows: [], emptyMessage: "0 of 2,231 rows match" });
    expect(screen.getByText("0 of 2,231 rows match")).toBeTruthy();
  });
});
