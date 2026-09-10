import { afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
} from "@testing-library/react";
import { FilterValueInput } from "../../../../src/ui/table/FilterValueInput";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it("loads only after focus settles and permits arbitrary typed values", async () => {
  vi.useFakeTimers();
  const load = vi.fn().mockResolvedValue(["Building"]);
  const change = vi.fn();
  const { container } = render(
    <FilterValueInput column="type" load={load} onChange={change} />,
  );
  expect(load).not.toHaveBeenCalled();
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  act(() => vi.advanceTimersByTime(200));
  expect(load).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(50));
  expect(container.querySelector("option")?.value).toBe("Building");
  fireEvent.change(input, { target: { value: "Unlisted" } });
  expect(change).toHaveBeenCalled();
});
it("cancels a brief focus before querying", () => {
  vi.useFakeTimers();
  const load = vi.fn();
  render(<FilterValueInput column="type" load={load} />);
  fireEvent.focus(screen.getByRole("combobox"));
  fireEvent.blur(screen.getByRole("combobox"));
  act(() => vi.advanceTimersByTime(500));
  expect(load).not.toHaveBeenCalled();
});
