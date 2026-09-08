import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Pagination } from "../../../../src/ui/table/Pagination";
import { rangeLabel } from "../../../../src/ui/table/tableText";

afterEach(cleanup);

function setup(over: Partial<Parameters<typeof Pagination>[0]> = {}) {
  const onPage = vi.fn();
  const onPageSize = vi.fn();
  render(
    <Pagination
      page={0}
      pageSize={100}
      totalRows={2231}
      unfilteredRows={2231}
      filtered={false}
      onPage={onPage}
      onPageSize={onPageSize}
      {...over}
    />,
  );
  return { onPage, onPageSize };
}

describe("rangeLabel", () => {
  it("counts from one and stops at the total", () => {
    expect(rangeLabel(0, 100, 2231)).toBe("1–100 of 2,231");
    expect(rangeLabel(22, 100, 2231)).toBe("2,201–2,231 of 2,231");
  });

  it("says so for an empty result", () => {
    expect(rangeLabel(0, 100, 0)).toBe("0 rows");
  });

  it("keeps the range and drops only the total when the count is unknown", () => {
    // A null total is not zero: the page query is separate, so there ARE rows
    // on screen, and "0 rows" over a full grid contradicts what is visible.
    expect(rangeLabel(0, 100, null)).toBe("1–100 of ?");
    expect(rangeLabel(2, 100, null)).toBe("201–300 of ?");
  });
});

describe("Pagination", () => {
  it("shows the range", () => {
    setup();
    expect(screen.getByText("1–100 of 2,231")).toBeTruthy();
  });

  it("names the unfiltered total when a filter is applied", () => {
    setup({ totalRows: 12, filtered: true, unfilteredRows: 2231 });
    expect(screen.getByText("filtered from 2,231")).toBeTruthy();
  });

  it("omits the 'filtered from' line when the unfiltered total is unknown", () => {
    setup({ totalRows: 12, filtered: true, unfilteredRows: null });
    expect(screen.queryByText(/filtered from/)).toBeNull();
  });

  it("keeps Next live when the total is unknown", () => {
    setup({ totalRows: null, unfilteredRows: null });
    expect(
      (screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("disables Previous on the first page and Next on the last", () => {
    setup();
    expect(
      (
        screen.getByRole("button", {
          name: "Previous page",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    cleanup();
    setup({ page: 22 });
    expect(
      (screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("steps a page", () => {
    const { onPage } = setup({ page: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(onPage).toHaveBeenNthCalledWith(1, 4);
    expect(onPage).toHaveBeenNthCalledWith(2, 2);
  });

  it("offers 20 / 50 / 100 and reports the choice as a number", () => {
    const { onPageSize } = setup();
    const select = screen.getByLabelText("Rows per page") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual([
      "20",
      "50",
      "100",
    ]);
    fireEvent.change(select, { target: { value: "50" } });
    expect(onPageSize).toHaveBeenCalledWith(50);
  });
});
