/**
 * The view-align cluster's view-mode awareness.
 *
 * In 2D a front/left/bottom alignment would fly straight out of the mode the
 * user just chose, so those buttons go dark and say why — a button whose only
 * effect is to break the mode is worse than one that is visibly unavailable
 * (the same rule the dead measure/box-select tools follow).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  DEFAULT_VIEW_MODE,
  useViewModeStore,
} from "../../../src/features/viewMode/viewModeStore";
import { ViewAlignButtons } from "../../../src/scene/ViewAlignButtons";

beforeEach(() => {
  useViewModeStore.setState({ mode: DEFAULT_VIEW_MODE });
});

afterEach(() => {
  cleanup();
  useViewModeStore.setState({ mode: DEFAULT_VIEW_MODE });
});

describe("ViewAlignButtons", () => {
  it("offers every alignment in 3D", () => {
    const onAlign = vi.fn();
    render(<ViewAlignButtons onAlign={onAlign} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(6);
    expect(buttons.every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.click(screen.getByText("F"));
    expect(onAlign).toHaveBeenCalledWith("front");
  });

  it("keeps only Top alive in 2D, and explains the rest", () => {
    useViewModeStore.setState({ mode: "2d" });
    const onAlign = vi.fn();
    render(<ViewAlignButtons onAlign={onAlign} />);
    const top = screen.getByText("T") as HTMLButtonElement;
    const front = screen.getByText("F") as HTMLButtonElement;
    expect(top.disabled).toBe(false);
    expect(front.disabled).toBe(true);
    expect(front.title).toMatch(/2D/);
    fireEvent.click(front);
    expect(onAlign).not.toHaveBeenCalled();
    fireEvent.click(top);
    expect(onAlign).toHaveBeenCalledWith("top");
  });

  it("leaves 2.5D alone — an oblique mode can still be aligned", () => {
    useViewModeStore.setState({ mode: "2.5d" });
    render(<ViewAlignButtons onAlign={vi.fn()} />);
    expect(
      screen
        .getAllByRole("button")
        .every((b) => !(b as HTMLButtonElement).disabled),
    ).toBe(true);
  });
});
