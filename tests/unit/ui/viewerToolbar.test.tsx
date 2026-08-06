/**
 * Component tests for `ViewerToolbar`'s tool-mode buttons.
 *
 * Task B16 ruling: under `NavaraViewport` the box-select and measure tools
 * have no consumers at all — `acceptsPointer` gates pointer events on
 * `toolMode`, so picking either one only turns selection off. Both buttons
 * are therefore disabled and say so in their tooltip, while the two pick-mode
 * buttons stay live. These tests pin all three halves of that: the dead
 * buttons are inert AND labelled, and the live ones still dispatch.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ViewerToolbar } from "../../../src/ui/toolbar/ViewerToolbar";

afterEach(() => {
  cleanup();
});

const baseProps = {
  fileName: "two-buildings.city.json",
  layerCount: 1,
  pickMode: "object" as const,
  toolMode: "select" as const,
  onSetPickMode: () => undefined,
  onSetToolMode: () => undefined,
  onClose: () => undefined,
  onToggleInspector: () => undefined,
  onToggleLeftSidebar: () => undefined,
  onFitAll: () => undefined,
  theme: "dark" as const,
  onToggleTheme: () => undefined,
};

/** The one button whose `title` starts with `prefix`. */
function buttonByTitlePrefix(prefix: string): HTMLButtonElement {
  const match = screen
    .getAllByRole("button")
    .find((b) => (b.getAttribute("title") ?? "").startsWith(prefix));
  if (!match) throw new Error(`no button titled ${prefix}…`);
  return match as HTMLButtonElement;
}

describe("ViewerToolbar — tools with no Navara implementation", () => {
  for (const [name, prefix] of [
    ["box select", "Box select"],
    ["measure", "Measure distance"],
  ] as const) {
    it(`disables ${name} and says why in the tooltip`, () => {
      render(<ViewerToolbar {...baseProps} />);
      const btn = buttonByTitlePrefix(prefix);
      expect(btn.disabled).toBe(true);
      expect(btn.getAttribute("title")).toContain(
        "temporarily unavailable during the Navara migration",
      );
    });

    it(`never dispatches a tool mode from the ${name} button`, () => {
      const onSetToolMode = vi.fn();
      render(<ViewerToolbar {...baseProps} onSetToolMode={onSetToolMode} />);
      fireEvent.click(buttonByTitlePrefix(prefix));
      expect(onSetToolMode).not.toHaveBeenCalled();
    });
  }

  it("box select stays disabled in surface pick mode too (it is not mode-gated any more)", () => {
    render(<ViewerToolbar {...baseProps} pickMode="surface" />);
    expect(buttonByTitlePrefix("Box select").disabled).toBe(true);
  });

  it("no longer carries the place search, which is a scene overlay now", () => {
    render(<ViewerToolbar {...baseProps} />);
    expect(screen.queryByTitle("Search for a place")).toBeNull();
  });

  it("leaves the object/surface pick buttons live", () => {
    const onSetPickMode = vi.fn();
    const onSetToolMode = vi.fn();
    render(
      <ViewerToolbar
        {...baseProps}
        onSetPickMode={onSetPickMode}
        onSetToolMode={onSetToolMode}
      />,
    );
    const surface = buttonByTitlePrefix("Select surfaces");
    expect(surface.disabled).toBe(false);
    fireEvent.click(surface);
    expect(onSetPickMode).toHaveBeenCalledWith("surface");
    expect(onSetToolMode).toHaveBeenCalledWith("select");
  });
});
