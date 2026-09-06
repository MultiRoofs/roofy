/**
 * The workspace header: the WORKSPACE's home.
 *
 * Three things are pinned here.
 *
 * 1. The workspace is a subject with a name and a menu — rename it, start a
 *    new one, open a saved one, save this one — rather than a row of anonymous
 *    icons for "save" and "close file".
 * 2. The panel-collapse buttons sit at the header's inner edges and SAY which
 *    way they go ("Collapse layers panel" / "Expand layers panel"), and the
 *    details one is unavailable when there is no selection to show.
 * 3. The toolbar's old sin is not re-committed: the header carries CONTROLS
 *    ONLY. That block is inherited from `viewerToolbar.test.tsx`, which this
 *    file replaces — it renders with a fully populated layer store precisely
 *    so a re-added pill would show something and fail, rather than passing
 *    vacuously against an empty store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { WorkspaceHeader } from "../../../../src/ui/header/WorkspaceHeader";
import { SceneControlsTemp } from "../../../../src/ui/header/SceneControlsTemp";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import type { Layer } from "../../../../src/features/layers/layerStore";
import {
  useWorkspaceStore,
  DEFAULT_WORKSPACE_NAME,
} from "../../../../src/features/workspace/workspaceStore";
import { useShellStore } from "../../../../src/ui/shell/shellStore";
import { useSelectionStore } from "../../../../src/features/selection/selectionStore";
import type { SnapshotSummary } from "../../../../src/persistence/types";

// jsdom ships no `matchMedia`, which the Preferences popover's theme store
// reads when a preference is applied.
window.matchMedia ??= ((query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList) as typeof window.matchMedia;

const SNAPSHOTS: ReadonlyArray<SnapshotSummary> = [
  { id: "s1", label: "Delft rooftop study", savedAt: "2026-08-01T10:00:00Z" },
  { id: "s2", label: "Rotterdam pilot", savedAt: "2026-08-03T10:00:00Z" },
];

const baseProps = {
  onSave: async () => true,
  onShare: () => undefined,
  canShare: true,
  onNewWorkspace: () => undefined,
  onOpenWorkspace: () => undefined,
  snapshots: SNAPSHOTS,
  sceneControls: null,
};

beforeEach(() => {
  useWorkspaceStore.setState({ name: DEFAULT_WORKSPACE_NAME });
  useShellStore.setState({ leftCollapsed: false, rightCollapsed: false });
  useSelectionStore.setState({ selections: [], geoSelection: null });
});

afterEach(() => {
  cleanup();
  useLayerStore.setState({ layers: [] });
  useWorkspaceStore.setState({ activeLayerId: null });
});

function openWorkspaceMenu(): void {
  fireEvent.click(screen.getByRole("button", { name: DEFAULT_WORKSPACE_NAME }));
}

describe("WorkspaceHeader — the workspace's own controls", () => {
  it("names the workspace and offers Save, Share and Preferences", () => {
    render(<WorkspaceHeader {...baseProps} />);

    expect(
      screen.getByRole("button", { name: DEFAULT_WORKSPACE_NAME }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save workspace" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Share this view" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Preferences" }),
    ).toBeInTheDocument();
  });

  it("shows the current workspace name once it has been renamed", () => {
    useWorkspaceStore.setState({ name: "Delft rooftop study" });
    render(<WorkspaceHeader {...baseProps} />);
    expect(
      screen.getByRole("button", { name: "Delft rooftop study" }),
    ).toBeInTheDocument();
  });

  it("makes Share unavailable when there is nothing shareable to link to", () => {
    render(<WorkspaceHeader {...baseProps} canShare={false} />);
    expect(
      (
        screen.getByRole("button", {
          name: "Share this view",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("dispatches Share", () => {
    const onShare = vi.fn();
    render(<WorkspaceHeader {...baseProps} onShare={onShare} />);
    fireEvent.click(screen.getByRole("button", { name: "Share this view" }));
    expect(onShare).toHaveBeenCalledTimes(1);
  });
});

describe("WorkspaceHeader — the Saved note", () => {
  afterEach(() => vi.useRealTimers());

  it("confirms a save that worked, and takes the note back down again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<WorkspaceHeader {...baseProps} />);

    fireEvent.click(screen.getByRole("button", { name: "Save workspace" }));

    await waitFor(() =>
      expect(screen.getByText("Saved · just now")).toBeInTheDocument(),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(screen.queryByText("Saved · just now")).toBeNull();
  });

  it("stays silent when the save did not happen", async () => {
    const onSave = vi.fn(async () => false);
    render(<WorkspaceHeader {...baseProps} onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: "Save workspace" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    // The camera was not readable, or the store refused: a green tick over a
    // save that never landed is worse than no tick at all.
    expect(screen.queryByText("Saved · just now")).toBeNull();
  });
});

describe("WorkspaceHeader — the panel collapse buttons", () => {
  it("says which way the layers button goes, and writes the shell store", () => {
    render(<WorkspaceHeader {...baseProps} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse layers panel" }),
    );

    expect(useShellStore.getState().leftCollapsed).toBe(true);
    expect(
      screen.getByRole("button", { name: "Expand layers panel" }),
    ).toBeInTheDocument();
  });

  it("disables the details button while nothing is selected", () => {
    render(<WorkspaceHeader {...baseProps} />);
    expect(
      (
        screen.getByRole("button", {
          name: "Collapse details panel",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("collapses and expands the details panel once there is a selection", () => {
    useSelectionStore.setState({
      selections: [{ kind: "object", layerId: "L", objectId: "b1" }],
    });
    render(<WorkspaceHeader {...baseProps} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse details panel" }),
    );
    expect(useShellStore.getState().rightCollapsed).toBe(true);

    fireEvent.click(
      screen.getByRole("button", { name: "Expand details panel" }),
    );
    expect(useShellStore.getState().rightCollapsed).toBe(false);
  });
});

describe("WorkspaceMenu", () => {
  it("renames the workspace inline", () => {
    render(<WorkspaceHeader {...baseProps} />);
    openWorkspaceMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const field = screen.getByLabelText("Workspace name");
    fireEvent.change(field, { target: { value: "Delft rooftop study" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(useWorkspaceStore.getState().name).toBe("Delft rooftop study");
  });

  it("keeps a rename that ended by reaching for another item, and lets that item act", async () => {
    const onSave = vi.fn(async () => true);
    render(<WorkspaceHeader {...baseProps} onSave={onSave} />);
    openWorkspaceMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const field = screen.getByLabelText("Workspace name");
    fireEvent.change(field, { target: { value: "Delft rooftop study" } });
    // The mousedown on "Save" blurs the field on its way. If blur closed the
    // menu, the item would unmount before its click landed and Save would
    // silently do nothing.
    fireEvent.blur(field);
    fireEvent.click(screen.getByRole("menuitem", { name: "Save" }));

    expect(useWorkspaceStore.getState().name).toBe("Delft rooftop study");
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it("abandons a rename on Escape without touching the name", () => {
    render(<WorkspaceHeader {...baseProps} />);
    openWorkspaceMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    const field = screen.getByLabelText("Workspace name");
    fireEvent.change(field, { target: { value: "nope" } });
    fireEvent.keyDown(field, { key: "Escape" });

    expect(useWorkspaceStore.getState().name).toBe(DEFAULT_WORKSPACE_NAME);
  });

  it("starts a new workspace", () => {
    const onNewWorkspace = vi.fn();
    render(<WorkspaceHeader {...baseProps} onNewWorkspace={onNewWorkspace} />);
    openWorkspaceMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "New workspace" }));

    expect(onNewWorkspace).toHaveBeenCalledTimes(1);
    // The menu is done with: acting on an item closes it.
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("lists the saved workspaces with their date, and opens one", () => {
    const onOpenWorkspace = vi.fn();
    render(
      <WorkspaceHeader {...baseProps} onOpenWorkspace={onOpenWorkspace} />,
    );
    openWorkspaceMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /^Open/ }));

    const entry = screen.getByRole("menuitem", { name: /Delft rooftop study/ });
    expect(entry.textContent).toMatch(/2026/);
    fireEvent.click(entry);

    expect(onOpenWorkspace).toHaveBeenCalledWith("s1");
  });

  it("says so when there is nothing saved yet", () => {
    render(<WorkspaceHeader {...baseProps} snapshots={[]} />);
    openWorkspaceMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: /^Open/ }));

    expect(screen.getByText("No saved workspaces yet")).toBeInTheDocument();
  });

  it("saves from the menu as well as from the header button", async () => {
    const onSave = vi.fn(async () => true);
    render(<WorkspaceHeader {...baseProps} onSave={onSave} />);
    openWorkspaceMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it("closes on Escape and hands the focus back to the name button", () => {
    render(<WorkspaceHeader {...baseProps} />);
    openWorkspaceMenu();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: DEFAULT_WORKSPACE_NAME }),
    );
  });
});

/** A layer with everything the deleted pills used to read: a CRS, a LoD, an
 *  enabled rule and a name. */
function loadedLayer(): Layer {
  return {
    id: "L",
    name: "two-buildings.city.json",
    model: {
      sourceEncoding: "cityjson",
      metadata: {
        referenceSystem: "https://www.opengis.net/def/crs/EPSG/0/7415",
      },
      bbox: null,
      objects: {
        b1: {
          id: "b1",
          objectType: "Building",
          attributes: {},
          surfaces: [],
          bbox: null,
          children: [],
          parents: [],
          lod: "2.2",
        },
      },
      vertexCount: 0,
    },
    modelRef: { type: "url", url: "https://x/a.city.json" },
    visible: true,
    rules: [
      {
        id: "r1",
        name: "tall",
        color: "#4ec84e",
        conditions: [],
        logic: "AND",
        enabled: true,
      },
    ],
    rulesEnabled: true,
    selectedLod: "2.2",
    availableLods: ["2.2"],
    lodMode: "manual",
    cameraSync: true,
    hiddenTypes: [],
    visibleObjectIds: null,
    availableObjectTypes: ["Building"],
    appearanceThemes: [],
    selectedAppearance: null,
    isStreaming: false,
  };
}

const sceneProps = {
  pickMode: "object" as const,
  toolMode: "select" as const,
  onSetPickMode: () => undefined,
  onSetToolMode: () => undefined,
  onFitAll: () => undefined,
};

describe("WorkspaceHeader — controls only, no scene information", () => {
  for (const [what, text] of [
    ["the object count", "Objects"],
    ["the layer count", "Layers"],
    ["the LoD", "LoD"],
    ["the rule count", "Rules"],
  ] as const) {
    it(`does not restate ${what}, which another surface already shows`, () => {
      useLayerStore.setState({ layers: [loadedLayer()] });
      useWorkspaceStore.setState({ activeLayerId: "L" });
      render(
        <WorkspaceHeader
          {...baseProps}
          sceneControls={<SceneControlsTemp {...sceneProps} />}
        />,
      );
      expect(screen.queryByText(text)).toBeNull();
    });
  }

  it("does not carry the file name, the CRS or a separate sun pill", () => {
    useLayerStore.setState({ layers: [loadedLayer()] });
    useWorkspaceStore.setState({ activeLayerId: "L" });
    const { container } = render(
      <WorkspaceHeader
        {...baseProps}
        sceneControls={<SceneControlsTemp {...sceneProps} />}
      />,
    );
    expect(container.querySelector(".toolbar-file")).toBeNull();
    expect(container.querySelector(".meta-pills")).toBeNull();
    expect(container.querySelector(".sun-pill")).toBeNull();
    // The CRS is not deleted, it MOVED — see StatusBar.test.tsx.
    expect(screen.queryByText("EPSG:7415")).toBeNull();
  });
});

describe("SceneControlsTemp", () => {
  it("keeps the pick-mode pair live", () => {
    const onSetPickMode = vi.fn();
    const onSetToolMode = vi.fn();
    render(
      <SceneControlsTemp
        {...sceneProps}
        onSetPickMode={onSetPickMode}
        onSetToolMode={onSetToolMode}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Select surfaces (S)" }),
    );

    expect(onSetPickMode).toHaveBeenCalledWith("surface");
    expect(onSetToolMode).toHaveBeenCalledWith("select");
  });

  it("keeps Zoom to fit", () => {
    const onFitAll = vi.fn();
    render(<SceneControlsTemp {...sceneProps} onFitAll={onFitAll} />);
    fireEvent.click(screen.getByRole("button", { name: "Zoom to fit (F)" }));
    expect(onFitAll).toHaveBeenCalledTimes(1);
  });

  for (const dead of ["Box select", "Measure"]) {
    it(`no longer renders ${dead}, which had no implementation to reach`, () => {
      render(<SceneControlsTemp {...sceneProps} />);
      const found = screen
        .getAllByRole("button")
        .find((b) => (b.getAttribute("aria-label") ?? "").startsWith(dead));
      // A disabled button is still a promise; removing it is the honest form.
      expect(found).toBeUndefined();
    });
  }

  it("hosts the basemap and Google 3D controls behind one Scene popover", () => {
    render(<SceneControlsTemp {...sceneProps} />);
    expect(screen.queryByLabelText("Basemap")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Scene" }));

    expect(screen.getByLabelText("Basemap")).toBeInTheDocument();
    expect(screen.getByText("Background")).toBeInTheDocument();
  });

  it("marks itself as furniture that 12.5 removes", () => {
    const { container } = render(<SceneControlsTemp {...sceneProps} />);
    expect(
      container.querySelector('[data-temporary="12.5"]'),
    ).toBeInTheDocument();
  });

  it("opens the rendering settings", () => {
    const onToggleAdvancedSettings = vi.fn();
    render(
      <SceneControlsTemp
        {...sceneProps}
        advancedSettingsOpen={false}
        onToggleAdvancedSettings={onToggleAdvancedSettings}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Rendering settings" }));
    expect(onToggleAdvancedSettings).toHaveBeenCalledTimes(1);
  });
});
