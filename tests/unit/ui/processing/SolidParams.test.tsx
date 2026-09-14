/**
 * §7.2's parameters: six measure checkboxes, the mockup's four ticked, and the
 * one validation that blocks Run.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SolidParams } from "../../../../src/ui/processing/SolidParams";

afterEach(cleanup);

describe("SolidParams", () => {
  it("renders the six measures with the mockup's four ticked", () => {
    render(<SolidParams params={{}} onChange={() => {}} />);
    for (const [label, checked] of [
      ["Volume (m³)", true],
      ["Envelope area (m²)", true],
      ["Footprint area (m²)", true],
      ["Height (m)", true],
      ["Ground elevation (m)", false],
      ["Ridge elevation (m)", false],
    ] as const) {
      expect(screen.getByRole("checkbox", { name: label })).toHaveProperty(
        "checked",
        checked,
      );
    }
  });

  it("writes the whole normalised bag back, in §7.2's order", () => {
    // Written back WHOLE, like `RoofMetricsParams`: the draft then holds an
    // explicit list, which is what makes "untick everything" a state the form
    // can reach at all.
    const onChange = vi.fn();
    render(<SolidParams params={{}} onChange={onChange} />);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Ridge elevation (m)" }),
    );
    expect(onChange).toHaveBeenCalledWith({
      measures: ["volume", "envelope", "footprint", "height", "ridge"],
    });
  });

  it("can be emptied, which is the state Run refuses", () => {
    const onChange = vi.fn();
    render(
      <SolidParams params={{ measures: ["volume"] }} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Volume (m³)" }));
    expect(onChange).toHaveBeenCalledWith({ measures: [] });
  });

  it("carries §7.2's explanations as the labels' tooltips", () => {
    // Asserted ON the box each hover belongs to: two `getByTitle`s alone would
    // pass just as well with the two hints swapped.
    render(<SolidParams params={{}} onChange={() => {}} />);
    for (const [label, hint] of [
      ["Volume (m³)", "Only for a closed, valid solid"],
      ["Height (m)", "Ridge minus ground at this LoD"],
    ] as const) {
      const box = screen.getByRole("checkbox", { name: label });
      expect(box.closest("label")).toHaveAttribute("title", hint);
    }
    // And the measures §7.2 explains nothing about carry no tooltip at all.
    expect(
      screen
        .getByRole("checkbox", { name: "Envelope area (m²)" })
        .closest("label"),
    ).not.toHaveAttribute("title");
  });
});
