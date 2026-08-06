/**
 * The 2D / 2.5D / 3D segmented control.
 *
 * Three buttons over a store — so what is worth pinning is the accessibility
 * contract (exactly one segment pressed at a time) and that the labels say what
 * the mode does, since "2.5D" means nothing on its own.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  DEFAULT_VIEW_MODE,
  useViewModeStore,
} from "../../../../src/features/viewMode/viewModeStore";
import { ViewModeToggle } from "../../../../src/ui/toolbar/ViewModeToggle";

beforeEach(() => {
  useViewModeStore.setState({ mode: DEFAULT_VIEW_MODE });
});

afterEach(() => {
  cleanup();
  useViewModeStore.setState({ mode: DEFAULT_VIEW_MODE });
});

describe("ViewModeToggle", () => {
  it("offers the three modes, with the active one pressed", () => {
    render(<ViewModeToggle />);
    expect(screen.getByRole("button", { name: /^2D$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^2\.5D$/ })).toBeTruthy();
    const three = screen.getByRole("button", { name: /^3D$/ });
    expect(three.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen.getByRole("button", { name: /^2D$/ }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("switches the store, and only one segment is ever pressed", () => {
    render(<ViewModeToggle />);
    fireEvent.click(screen.getByRole("button", { name: /^2D$/ }));
    expect(useViewModeStore.getState().mode).toBe("2d");
    const pressed = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed.map((b) => b.textContent)).toEqual(["2D"]);
  });

  it("follows the store when the mode is changed elsewhere (a restore)", () => {
    render(<ViewModeToggle />);
    act(() => useViewModeStore.getState().setViewMode("2.5d"));
    expect(
      screen
        .getByRole("button", { name: /^2\.5D$/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("explains each mode in its tooltip", () => {
    render(<ViewModeToggle />);
    expect(screen.getByRole("button", { name: /^2D$/ }).title).toMatch(
      /plan|top/i,
    );
    expect(screen.getByRole("button", { name: /^2\.5D$/ }).title).toMatch(
      /tilt|60/i,
    );
    expect(screen.getByRole("button", { name: /^3D$/ }).title).toMatch(/free/i);
  });

  it("is a labelled group, so the three buttons read as one control", () => {
    render(<ViewModeToggle />);
    expect(screen.getByRole("group", { name: /view mode/i })).toBeTruthy();
  });
});
