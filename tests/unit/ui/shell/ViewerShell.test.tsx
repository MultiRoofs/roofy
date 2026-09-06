/**
 * The shell GRID: which region lands in which area, and the real sizes the
 * grid is given. The sizes are inline custom properties on the shell element
 * — jsdom has no layout, so the property values ARE the contract.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ViewerShell } from "../../../../src/ui/shell/ViewerShell";
import {
  defaultShellState,
  useShellStore,
} from "../../../../src/ui/shell/shellStore";

/** jsdom is 1024×768, which is below both of `defaultShellState`'s
 *  breakpoints — every test here reads the wide/tall numbers instead. */
beforeEach(() => {
  useShellStore.setState(defaultShellState(1440, 900));
});

afterEach(cleanup);

function shell(over: Partial<Parameters<typeof ViewerShell>[0]> = {}) {
  const { container } = render(
    <ViewerShell
      header={<div data-testid="the-header" />}
      left={<div data-testid="the-left" />}
      map={<div data-testid="the-map" />}
      drawer={null}
      right={null}
      rightTitle="Building 1"
      status={<div data-testid="the-status" />}
      {...over}
    />,
  );
  return container.querySelector(".viewer-shell") as HTMLElement;
}

function widthOf(el: HTMLElement, prop: string): string {
  return el.style.getPropertyValue(prop);
}

describe("ViewerShell regions", () => {
  it("puts each region in its own area", () => {
    const el = shell({
      drawer: <div data-testid="the-drawer" />,
      right: <div data-testid="the-right" />,
    });

    expect(
      el
        .querySelector(".shell-header")
        ?.contains(screen.getByTestId("the-header")),
    ).toBe(true);
    expect(
      el.querySelector(".shell-left")?.contains(screen.getByTestId("the-left")),
    ).toBe(true);
    expect(
      el
        .querySelector(".map-column > .map-area")
        ?.contains(screen.getByTestId("the-map")),
    ).toBe(true);
    expect(
      el
        .querySelector(".map-column > .drawer-area")
        ?.contains(screen.getByTestId("the-drawer")),
    ).toBe(true);
    expect(
      el
        .querySelector(".shell-right")
        ?.contains(screen.getByTestId("the-right")),
    ).toBe(true);
    expect(
      el
        .querySelector(".shell-status")
        ?.contains(screen.getByTestId("the-status")),
    ).toBe(true);
  });

  it("gives the drawer no row and no area when it is closed", () => {
    const el = shell();
    expect(el.querySelector(".drawer-area")).toBeNull();
    expect(widthOf(el, "--drawer-h")).toBe("0");
  });

  it("sizes an open drawer from the store", () => {
    const el = shell({ drawer: <div data-testid="the-drawer" /> });
    expect(widthOf(el, "--drawer-h")).toBe("280px");
  });
});

describe("ViewerShell columns", () => {
  it("sizes the left column from the store", () => {
    expect(widthOf(shell(), "--left-w")).toBe("300px");
  });

  it("collapses the left column to the 40px rail", () => {
    useShellStore.setState({ leftCollapsed: true });
    const el = shell();
    expect(widthOf(el, "--left-w")).toBe("40px");
    expect(el.classList.contains("left-collapsed")).toBe(true);
  });

  it("sizes the right column from the store when there is a selection", () => {
    const el = shell({ right: <div data-testid="the-right" /> });
    expect(widthOf(el, "--right-w")).toBe("340px");
  });

  it("gives the right column zero width when there is no selection", () => {
    const el = shell();
    expect(widthOf(el, "--right-w")).toBe("0");
    expect(el.querySelector(".shell-right")).toBeNull();
  });

  it("gives the right column zero width when it is collapsed", () => {
    useShellStore.setState({ rightCollapsed: true });
    const el = shell({ right: <div data-testid="the-right" /> });
    expect(widthOf(el, "--right-w")).toBe("0");
    expect(el.querySelector(".shell-right")).toBeNull();
  });
});

describe("ViewerShell collapsed-details pill", () => {
  it("offers the selection back on the map's right edge", () => {
    useShellStore.setState({ rightCollapsed: true });
    shell({ right: <div data-testid="the-right" /> });

    const pill = screen.getByRole("button", { name: /Details · Building 1/ });
    fireEvent.click(pill);
    expect(useShellStore.getState().rightCollapsed).toBe(false);
  });

  it("shows no pill while the panel is open", () => {
    shell({ right: <div data-testid="the-right" /> });
    expect(screen.queryByRole("button", { name: /Details ·/ })).toBeNull();
  });

  it("shows no pill when there is nothing to show", () => {
    useShellStore.setState({ rightCollapsed: true });
    shell();
    expect(screen.queryByRole("button", { name: /Details ·/ })).toBeNull();
  });
});

describe("ViewerShell right-panel resize", () => {
  it("widens the panel when its left-edge handle is dragged left", () => {
    shell({ right: <div data-testid="the-right" /> });

    const handle = screen.getByRole("separator", {
      name: "Resize details panel",
    });
    fireEvent.pointerDown(handle, { clientX: 900, pointerId: 1 });
    window.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 880, pointerId: 1 }),
    );
    expect(useShellStore.getState().rightWidth).toBe(360);

    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
    window.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 700, pointerId: 1 }),
    );
    expect(useShellStore.getState().rightWidth).toBe(360);
  });
});

describe("ViewerShell expanded drawer", () => {
  it("hands the whole map column to the drawer", () => {
    useShellStore.setState({ drawerExpanded: true });
    const el = shell({ drawer: <div data-testid="the-drawer" /> });
    expect(el.classList.contains("drawer-expanded")).toBe(true);
  });

  it("keeps the map when the drawer is not expanded", () => {
    const el = shell({ drawer: <div data-testid="the-drawer" /> });
    expect(el.classList.contains("drawer-expanded")).toBe(false);
  });
});
