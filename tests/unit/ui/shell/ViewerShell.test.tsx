/**
 * The shell GRID: which region lands in which area, and the real sizes the
 * grid is given. The sizes are inline custom properties on the shell element
 * — jsdom has no layout, so the property values ARE the contract.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { ViewerShell } from "../../../../src/ui/shell/ViewerShell";
import {
  defaultShellState,
  SHELL_LIMITS,
  useShellStore,
} from "../../../../src/ui/shell/shellStore";
import { useProcessingStore } from "../../../../src/features/processing/processingStore";
import type { RunRecord } from "../../../../src/features/processing/types";

function runRecord(status: RunRecord["status"]): RunRecord {
  return {
    id: "r1",
    toolId: "height-from-extent",
    targetLayerId: "L1",
    targetName: "Delft",
    targetDerivedFrom: null,
    sourceLayerId: null,
    sourceName: null,
    scope: "all",
    scopeCount: 1,
    featureIds: null,
    lod: null,
    params: {},
    prefix: "extent_",
    columns: [],
    status,
    phase: null,
    startedAt: 0,
    elapsedMs: 0,
    summary: null,
    error: null,
    log: [],
    warnings: [],
    undoable: false,
    stale: false,
    destination: "layer",
    newLayerName: null,
    newLayerId: null,
    note: null,
  };
}

/** jsdom is 1024×768, which is below both of `defaultShellState`'s
 *  breakpoints — every test here reads the wide/tall numbers instead. */
beforeEach(() => {
  useShellStore.setState(defaultShellState(1440, 900));
  useProcessingStore.getState().resetForTest();
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
    expect(widthOf(el, "--drawer-h")).toBe("0px");
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

describe("ViewerShell collapsed pills with the toolbox open", () => {
  it("offers Tools alone when nothing is selected", () => {
    useShellStore.setState({ rightCollapsed: true });
    shell({ right: <div data-testid="the-right" />, rightMode: "tools" });

    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    expect(useShellStore.getState().rightCollapsed).toBe(false);
    expect(screen.queryByRole("button", { name: /Details ·/ })).toBeNull();
  });

  it("names a run on the Tools pill", () => {
    useShellStore.setState({ rightCollapsed: true });
    useProcessingStore.setState({ runs: [runRecord("running")] });
    shell({ right: <div data-testid="the-right" />, rightMode: "tools" });
    expect(screen.getByRole("button", { name: "Tools · running" }));
  });

  it("stacks the Details pill beside it while a selection exists", () => {
    useShellStore.setState({ rightCollapsed: true });
    shell({
      right: <div data-testid="the-right" />,
      rightMode: "tools",
      hasSelection: true,
    });
    expect(screen.getByRole("button", { name: "Tools" }));
    fireEvent.click(
      screen.getByRole("button", { name: /Details · Building 1/ }),
    );
    expect(useShellStore.getState().rightCollapsed).toBe(false);
  });

  it("each pill expands the panel on the tab it names", () => {
    // §4.2: two pills, two tabs. A pill that only un-collapses the panel
    // shows whichever tab happened to be up — clicking Details could reveal
    // Tools, and the other way round.
    useShellStore.setState({ rightCollapsed: true });
    useProcessingStore.getState().setTab("tools");
    shell({
      right: <div data-testid="the-right" />,
      rightMode: "tools",
      hasSelection: true,
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Details · Building 1/ }),
    );
    expect(useProcessingStore.getState().activeTab).toBe("details");
    expect(useShellStore.getState().rightCollapsed).toBe(false);

    act(() => useShellStore.getState().setRightCollapsed(true));
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    expect(useProcessingStore.getState().activeTab).toBe("tools");
    expect(useShellStore.getState().rightCollapsed).toBe(false);
  });
});

describe("ViewerShell right-panel resize", () => {
  function grabHandle(): HTMLElement {
    shell({ right: <div data-testid="the-right" /> });
    return screen.getByRole("separator", { name: "Resize details panel" });
  }

  function move(clientX: number): void {
    window.dispatchEvent(
      new PointerEvent("pointermove", { clientX, pointerId: 1 }),
    );
  }

  it("widens the panel when its left-edge handle is dragged left", () => {
    const handle = grabHandle();

    fireEvent.pointerDown(handle, { clientX: 900, pointerId: 1 });
    move(880);
    expect(useShellStore.getState().rightWidth).toBe(360);
    move(870);
    expect(useShellStore.getState().rightWidth).toBe(370);

    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
    move(700);
    expect(useShellStore.getState().rightWidth).toBe(370);
  });

  it("measures from where the drag STARTED, so an over-drag does not drift", () => {
    // Past `SHELL_LIMITS.rightMax` (480) and back to 40px out. Deltas
    // relative to the previous move instead of the pointerdown would clamp at
    // 480 and then subtract the whole way back — landing at 320, a panel that
    // ignores the pointer until the drag has repaid its own overshoot.
    const handle = grabHandle();

    fireEvent.pointerDown(handle, { clientX: 900, pointerId: 1 });
    move(600);
    expect(useShellStore.getState().rightWidth).toBe(SHELL_LIMITS.rightMax);
    move(860);
    expect(useShellStore.getState().rightWidth).toBe(380);
  });

  it("maps physical keys and bounds to the details panel", () => {
    const handle = grabHandle();
    handle.focus();
    expect(handle).toHaveAttribute("aria-valuenow", "340");

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(useShellStore.getState().rightWidth).toBe(324);
    fireEvent.keyDown(handle, { key: "PageUp" });
    expect(useShellStore.getState().rightWidth).toBe(388);
    fireEvent.keyDown(handle, { key: "Home" });
    expect(useShellStore.getState().rightWidth).toBe(SHELL_LIMITS.rightMin);
    fireEvent.keyDown(handle, { key: "End" });
    expect(useShellStore.getState().rightWidth).toBe(SHELL_LIMITS.rightMax);
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

  it("never hides the map for an expanded flag with NO drawer", () => {
    useShellStore.setState({ drawerExpanded: true });
    const el = shell();
    expect(el.classList.contains("drawer-expanded")).toBe(false);
  });
});

describe("ViewerShell map identity", () => {
  /** The map slot survives every layout change. At most ONE Navara viewport
   *  may exist per page, and a remounted `.map-area` would tear the engine
   *  down and build a second one — see the hard rule in CLAUDE.md. */
  it("keeps the same map node across drawer and right-column changes", () => {
    function Harness() {
      const drawerOpen = useShellStore((s) => s.drawerOpen);
      return (
        <ViewerShell
          header={<div />}
          left={<div />}
          map={<div data-testid="the-map" />}
          drawer={drawerOpen ? <div data-testid="the-drawer" /> : null}
          right={<div data-testid="the-right" />}
          rightTitle="Building 1"
          status={<div />}
          attributionLines={["Drawer terrain credit"]}
        />
      );
    }
    const { container } = render(<Harness />);
    const mapArea = container.querySelector(".map-area");
    const mapNode = screen.getByTestId("the-map");

    act(() => useShellStore.getState().openDrawer());
    act(() => useShellStore.getState().setDrawerExpanded(true));
    const credit = screen.getByText("Drawer terrain credit");
    const drawer = screen.getByTestId("the-drawer");
    expect(credit).toBeInTheDocument();
    // The map toggle lives in TablePanel's header. The shell owns only the
    // in-flow licence footer, after the drawer content, so credits cannot
    // cover pagination and this component never duplicates the toggle.
    expect(credit.parentElement?.previousElementSibling).toBe(drawer);
    expect(screen.queryByRole("button", { name: "Show map" })).toBeNull();
    act(() => useShellStore.getState().setDrawerExpanded(false));
    act(() => useShellStore.getState().closeDrawer());
    act(() => useShellStore.getState().setRightCollapsed(true));
    act(() => useShellStore.getState().setRightCollapsed(false));

    expect(container.querySelector(".map-area")).toBe(mapArea);
    expect(screen.getByTestId("the-map")).toBe(mapNode);
  });
});

it("keeps a table opener when closed and lets the grip open by keyboard resizing", () => {
  shell({ canOpenTable: true });
  fireEvent.click(screen.getByRole("button", { name: "Open table" }));
  expect(useShellStore.getState().drawerOpen).toBe(true);
  useShellStore.getState().closeDrawer();
  fireEvent.keyDown(
    screen.getByRole("separator", { name: "Open or resize table" }),
    { key: "ArrowUp" },
  );
  expect(useShellStore.getState().drawerOpen).toBe(true);
  expect(useShellStore.getState().drawerHeight).toBe(SHELL_LIMITS.drawerMin);
});
it("drag-resizing a closed expanded table returns to a map/table split", () => {
  useShellStore.setState({ drawerExpanded: true });
  shell({ canOpenTable: true });
  fireEvent.keyDown(
    screen.getByRole("separator", { name: "Open or resize table" }),
    { key: "ArrowUp" },
  );
  expect(useShellStore.getState().drawerExpanded).toBe(false);
});
it("places the toolbar before the map as a separate row", () => {
  const el = shell({ toolbar: <div data-testid="map-toolbar" /> });
  const toolbar = screen.getByTestId("map-toolbar");
  expect(toolbar.parentElement).toBe(el.querySelector(".map-column"));
  expect(toolbar.nextElementSibling).toBe(el.querySelector(".map-area"));
});
