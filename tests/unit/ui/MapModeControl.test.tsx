import { afterEach, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SelectModeControl } from "../../../src/ui/viewport/SelectModeControl";
afterEach(cleanup);
it("groups pick targets under Pick and only enables Draw for a draw layer", () => {
  render(
    <SelectModeControl
      mode="object"
      toolMode="select"
      cityActive={true}
      onSetMode={vi.fn()}
      onSetToolMode={vi.fn()}
      canDraw={false}
      drawActive={false}
      onDraw={vi.fn()}
      onPick={vi.fn()}
    />,
  );
  expect(screen.getByRole("combobox", { name: "Mode" })).toHaveValue("object");
  expect(screen.getByRole("option", { name: "Draw model" })).toBeDisabled();
});
it("leaves Draw before selecting a pick target", () => {
  const pick = vi.fn(),
    mode = vi.fn();
  render(
    <SelectModeControl
      mode="object"
      toolMode="select"
      cityActive={true}
      onSetMode={mode}
      onSetToolMode={vi.fn()}
      canDraw={true}
      drawActive={true}
      onDraw={vi.fn()}
      onPick={pick}
    />,
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Mode" }), {
    target: { value: "surface" },
  });
  expect(pick).toHaveBeenCalledOnce();
  expect(mode).toHaveBeenCalledWith("surface");
});
