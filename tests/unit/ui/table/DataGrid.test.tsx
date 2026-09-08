import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DataGrid } from "../../../../src/ui/table/DataGrid";
import { formatCell } from "../../../../src/ui/table/tableText";
import type { ColumnInfo } from "../../../../src/insights/columnKind";

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

  it("uses readable unit titles only for generated derived columns", () => {
    setup({
      columns: [
        { name: "__roofy_roof_area", type: "DERIVED", kind: "nested" },
        { name: "source_area", type: "DOUBLE", kind: "scalar" },
      ],
      derivedColumnNames: new Set(["__roofy_roof_area"]),
    });
    const headers = screen.getAllByRole("columnheader");
    expect(headers[0]?.getAttribute("title")).toBe("Roof area (m²)");
    expect(headers[1]?.getAttribute("title")).toBe("source_area (DOUBLE)");
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

  it("can change from empty to rows without changing hook order", () => {
    const { rerender } = render(
      <DataGrid
        columns={COLUMNS}
        rows={[]}
        sort={null}
        selectedIds={new Set()}
        onSort={vi.fn()}
        onRowClick={vi.fn()}
      />,
    );

    rerender(
      <DataGrid
        columns={COLUMNS}
        rows={[ROWS[0]!]}
        sort={null}
        selectedIds={new Set()}
        onSort={vi.fn()}
        onRowClick={vi.fn()}
      />,
    );

    expect(screen.getByText("B1")).toBeTruthy();
  });
});

describe("DataGrid parts", () => {
  it("expands actual child ids, selects the child, and collapses", () => {
    const onRowClick = vi.fn();
    render(
      <DataGrid
        columns={COLUMNS}
        rows={[ROWS[0]!]}
        sort={null}
        selectedIds={new Set()}
        onSort={vi.fn()}
        onRowClick={onRowClick}
        partsById={{ B1: ["B1-part-1"] }}
      />,
    );
    const toggle = screen.getByLabelText("Toggle parts for B1");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(onRowClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("↳ B1-part-1"));
    expect(onRowClick).toHaveBeenCalledWith("B1-part-1", false);
    fireEvent.click(toggle);
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("B1-part-1")).toBeNull();
  });
});

describe("DataGrid actual child rows", () => {
  it("renders supplied child attributes and selects the exact child id", () => {
    const onRowClick = vi.fn();
    render(
      <DataGrid
        columns={[
          { name: "id", type: "VARCHAR", kind: "scalar" },
          { name: "height", type: "DOUBLE", kind: "scalar" },
        ]}
        rows={[{ id: "root", height: 10 }]}
        sort={null}
        selectedIds={new Set()}
        onSort={() => {}}
        onRowClick={onRowClick}
        partsById={{ root: ["child"] }}
        partRows={{ child: { id: "child", height: 22 } }}
      />,
    );
    fireEvent.click(screen.getByLabelText("Toggle parts for root"));
    expect(screen.getByText("22")).toBeTruthy();
    fireEvent.click(screen.getByText("↳ child"));
    expect(onRowClick).toHaveBeenCalledWith("child", false);
  });
});
