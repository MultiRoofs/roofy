import { describe, it, expect, beforeEach } from "vitest";
import {
  useShellStore,
  defaultShellState,
  clampDrawerHeight,
  SHELL_LIMITS,
} from "../../../../src/ui/shell/shellStore";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";
import { useSelectionStore } from "../../../../src/features/selection/selectionStore";

describe("defaultShellState (pure)", () => {
  it("uses the wide/tall defaults at a normal viewport", () => {
    expect(defaultShellState(1440, 900)).toEqual({
      leftCollapsed: false,
      leftWidth: 300,
      rightWidth: 340,
      rightCollapsed: false,
      drawerOpen: false,
      drawerHeight: 280,
      drawerExpanded: false,
      openSections: {},
      requestedSection: null,
    });
  });

  it("narrows the side panels below 1360px wide", () => {
    const state = defaultShellState(1200, 900);
    expect(state.leftWidth).toBe(272);
    expect(state.rightWidth).toBe(320);
  });

  it("keeps wide defaults exactly at 1360px", () => {
    const state = defaultShellState(1360, 900);
    expect(state.leftWidth).toBe(300);
    expect(state.rightWidth).toBe(340);
  });

  it("shortens the drawer below 800px tall", () => {
    const state = defaultShellState(1440, 700);
    expect(state.drawerHeight).toBe(220);
  });

  it("keeps the tall default exactly at 800px", () => {
    const state = defaultShellState(1440, 800);
    expect(state.drawerHeight).toBe(280);
  });

  it("applies both breakpoints together", () => {
    const state = defaultShellState(1024, 768);
    expect(state.leftWidth).toBe(272);
    expect(state.rightWidth).toBe(320);
    expect(state.drawerHeight).toBe(220);
  });
});

describe("clampDrawerHeight (pure)", () => {
  it("passes through a value already in range", () => {
    expect(clampDrawerHeight(300, 900)).toBe(300);
  });

  it("clamps to the 160px floor", () => {
    expect(clampDrawerHeight(50, 900)).toBe(160);
  });

  it("clamps to the 800px ceiling when the viewport is tall", () => {
    expect(clampDrawerHeight(2000, 2000)).toBe(800);
  });

  it("clamps to viewport height minus 200 when that is tighter than 800", () => {
    expect(clampDrawerHeight(2000, 900)).toBe(700);
  });
});

describe("SHELL_LIMITS", () => {
  it("matches the documented ranges", () => {
    expect(SHELL_LIMITS).toEqual({
      leftMin: 240,
      leftMax: 420,
      rightMin: 280,
      rightMax: 480,
      drawerMin: 160,
      drawerMax: 800,
    });
  });
});

describe("useShellStore", () => {
  beforeEach(() => {
    useShellStore.setState(defaultShellState(1440, 900));
    useWorkspaceStore.setState({ activeLayerId: null });
    useSelectionStore.setState({
      selections: [],
      hovered: null,
      geoSelection: null,
      mode: "object",
    });
    Object.defineProperty(window, "innerHeight", {
      value: 900,
      configurable: true,
      writable: true,
    });
  });

  it("starts with the given defaults", () => {
    const state = useShellStore.getState();
    expect(state.leftCollapsed).toBe(false);
    expect(state.leftWidth).toBe(300);
    expect(state.rightWidth).toBe(340);
    expect(state.rightCollapsed).toBe(false);
    expect(state.drawerOpen).toBe(false);
    expect(state.drawerHeight).toBe(280);
    expect(state.drawerExpanded).toBe(false);
    expect(state.openSections).toEqual({});
    expect(state.requestedSection).toBeNull();
  });

  it("sets and toggles leftCollapsed", () => {
    useShellStore.getState().setLeftCollapsed(true);
    expect(useShellStore.getState().leftCollapsed).toBe(true);
    useShellStore.getState().toggleLeftCollapsed();
    expect(useShellStore.getState().leftCollapsed).toBe(false);
    useShellStore.getState().toggleLeftCollapsed();
    expect(useShellStore.getState().leftCollapsed).toBe(true);
  });

  it("sets and toggles rightCollapsed without touching the selection", () => {
    useSelectionStore
      .getState()
      .select({ kind: "object", layerId: "a", objectId: "o1" });
    useShellStore.getState().setRightCollapsed(true);
    expect(useShellStore.getState().rightCollapsed).toBe(true);
    expect(useSelectionStore.getState().selections).toHaveLength(1);
    useShellStore.getState().toggleRightCollapsed();
    expect(useShellStore.getState().rightCollapsed).toBe(false);
  });

  it("clamps leftWidth to 240..420", () => {
    useShellStore.getState().setLeftWidth(100);
    expect(useShellStore.getState().leftWidth).toBe(240);
    useShellStore.getState().setLeftWidth(1000);
    expect(useShellStore.getState().leftWidth).toBe(420);
    useShellStore.getState().setLeftWidth(310);
    expect(useShellStore.getState().leftWidth).toBe(310);
  });

  it("clamps rightWidth to 280..480", () => {
    useShellStore.getState().setRightWidth(100);
    expect(useShellStore.getState().rightWidth).toBe(280);
    useShellStore.getState().setRightWidth(1000);
    expect(useShellStore.getState().rightWidth).toBe(480);
    useShellStore.getState().setRightWidth(400);
    expect(useShellStore.getState().rightWidth).toBe(400);
  });

  it("opens, closes and toggles the drawer", () => {
    useShellStore.getState().openDrawer();
    expect(useShellStore.getState().drawerOpen).toBe(true);
    useShellStore.getState().closeDrawer();
    expect(useShellStore.getState().drawerOpen).toBe(false);
    useShellStore.getState().toggleDrawer();
    expect(useShellStore.getState().drawerOpen).toBe(true);
  });

  it("sets drawerExpanded", () => {
    useShellStore.getState().setDrawerExpanded(true);
    expect(useShellStore.getState().drawerExpanded).toBe(true);
  });

  it("clamps setDrawerHeight against the current window.innerHeight", () => {
    // innerHeight is 900 in this test -> ceiling is min(800, 700) = 700
    useShellStore.getState().setDrawerHeight(2000);
    expect(useShellStore.getState().drawerHeight).toBe(700);
    useShellStore.getState().setDrawerHeight(10);
    expect(useShellStore.getState().drawerHeight).toBe(160);
    useShellStore.getState().setDrawerHeight(300);
    expect(useShellStore.getState().drawerHeight).toBe(300);
  });

  describe("toggleSection", () => {
    it('defaults an unknown layer to ["style"] and adds a section', () => {
      useShellStore.getState().toggleSection("layer-a", "filter");
      expect(useShellStore.getState().openSections["layer-a"]).toEqual([
        "style",
        "filter",
      ]);
    });

    it("removes a section that is already open", () => {
      useShellStore.getState().toggleSection("layer-a", "style");
      expect(useShellStore.getState().openSections["layer-a"]).toEqual([]);
    });

    it("keeps sections for other layers independent", () => {
      useShellStore.getState().toggleSection("layer-a", "filter");
      useShellStore.getState().toggleSection("layer-b", "details");
      expect(useShellStore.getState().openSections["layer-a"]).toEqual([
        "style",
        "filter",
      ]);
      expect(useShellStore.getState().openSections["layer-b"]).toEqual([
        "style",
        "details",
      ]);
    });
  });

  describe("requestSection", () => {
    it("activates the layer, opens the left panel, opens the section and stores the request", () => {
      useShellStore.getState().setLeftCollapsed(true);
      useShellStore.getState().requestSection("layer-a", "details");

      expect(useWorkspaceStore.getState().activeLayerId).toBe("layer-a");
      expect(useShellStore.getState().leftCollapsed).toBe(false);
      expect(useShellStore.getState().openSections["layer-a"]).toEqual([
        "style",
        "details",
      ]);
      expect(useShellStore.getState().requestedSection).toEqual({
        layerId: "layer-a",
        section: "details",
      });
    });

    it("does not duplicate a section that is already open", () => {
      useShellStore.getState().requestSection("layer-a", "style");
      expect(useShellStore.getState().openSections["layer-a"]).toEqual([
        "style",
      ]);
    });

    it("clears the request with requestSection(null)", () => {
      useShellStore.getState().requestSection("layer-a", "details");
      useShellStore.getState().requestSection(null);
      expect(useShellStore.getState().requestedSection).toBeNull();
      // clearing the request does not undo the earlier activation or the
      // open section
      expect(useWorkspaceStore.getState().activeLayerId).toBe("layer-a");
      expect(useShellStore.getState().openSections["layer-a"]).toEqual([
        "style",
        "details",
      ]);
    });
  });
});
