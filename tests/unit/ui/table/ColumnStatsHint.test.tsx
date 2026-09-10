import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { ColumnStatsHint } from "../../../../src/ui/table/ColumnStatsHint";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it("waits one second, cancels brief hovers, and displays the summary", async () => {
  vi.useFakeTimers();
  const load = vi.fn().mockResolvedValue({
    count: 3,
    missing: 1,
    distinct: 2,
    min: "2",
    max: "10",
  });
  render(<ColumnStatsHint name="height" load={load} />);
  const button = screen.getByRole("button");
  fireEvent.mouseEnter(button);
  act(() => vi.advanceTimersByTime(900));
  expect(load).not.toHaveBeenCalled();
  fireEvent.mouseLeave(button);
  act(() => vi.advanceTimersByTime(1100));
  expect(load).not.toHaveBeenCalled();
  fireEvent.focus(button);
  await act(async () => vi.advanceTimersByTime(1000));
  expect(load).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("tooltip").textContent).toContain("Cardinality");
  fireEvent.keyDown(button, { key: "Escape" });
  expect(screen.queryByRole("tooltip")).toBeNull();
});
it("discards a result when the filter loader changes", async () => {
  let resolve!: (value: unknown) => void;
  const oldLoad = vi.fn().mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const { rerender } = render(<ColumnStatsHint name="id" load={oldLoad} />);
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByRole("status")).toBeTruthy();
  rerender(<ColumnStatsHint name="id" load={vi.fn()} />);
  await act(async () =>
    resolve({ count: 1, missing: 0, distinct: 1, min: "old", max: "old" }),
  );
  expect(screen.queryByRole("tooltip")).toBeNull();
});
