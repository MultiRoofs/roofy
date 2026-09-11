/**
 * Spec §6.2: "The footer becomes a result card, and a toast repeats its first
 * line." The run queue pushes that line into `useProcessingStore` as a notice;
 * `App` is the one subscriber, because `App` owns the toast.
 *
 * The engine is never imported: `NavaraViewport` is mocked (jsdom has no
 * WebGL, and `@navaramap/three` crashes at module scope under Node).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import type { CitySceneHandle } from "../../../src/scene/NavaraViewport";
import type {
  ProjectStateStore,
  SnapshotSummary,
} from "../../../src/persistence/types";
import type { CityObject } from "../../../src/domain/citymodel/types";

// jsdom ships no `matchMedia`, which `useTheme` reads on its first render.
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

vi.mock("../../../src/scene/NavaraViewport", () => ({
  NavaraViewport: forwardRef<CitySceneHandle, Record<string, unknown>>(
    function MockNavaraViewport(_props, ref) {
      useImperativeHandle(ref, () => null as unknown as CitySceneHandle, []);
      return <div data-testid="navara-viewport" />;
    },
  ),
}));

vi.mock("../../../src/insights/duckdb", () => ({
  initDuckDB: vi.fn(async () => {}),
  getDuckDBStatus: vi.fn(() => ({ state: "uninitialized" })),
  isExtensionLoaded: vi.fn(() => false),
  ensureExtension: vi.fn(async () => false),
  formatDuckDBError: (e: unknown) =>
    e instanceof Error ? e.message : String(e),
  runQuery: vi.fn(async () => ({ ok: false, message: "no engine" })),
  ddl: vi.fn(async () => ({ ok: false, message: "no engine" })),
  registerBuffer: vi.fn(async () => false),
  dropBuffer: vi.fn(async () => {}),
  readFile: vi.fn(async () => null),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
}));

const { App } = await import("../../../src/app/App");
const { useLayerStore } =
  await import("../../../src/features/layers/layerStore");
const { useSelectionStore } =
  await import("../../../src/features/selection/selectionStore");
const { useGeoLayerStore } =
  await import("../../../src/features/geoLayers/geoLayerStore");
const { useWorkspaceStore } =
  await import("../../../src/features/workspace/workspaceStore");
const { useShellStore, defaultShellState } =
  await import("../../../src/ui/shell/shellStore");
const { useSceneSheetStore } =
  await import("../../../src/features/sceneSheet/sceneSheetStore");
const { useProcessingStore } =
  await import("../../../src/features/processing/processingStore");

const emptyStore: ProjectStateStore = {
  list: async (): Promise<SnapshotSummary[]> => [],
  load: async () => null,
  save: async () => "snapshot-1",
  remove: async () => {},
};

const building: CityObject = {
  id: "NL.IMBAG.Pand.0503100000025028",
  objectType: "Building",
  attributes: { measuredHeight: 12 },
  surfaces: [],
  bbox: [0, 0, 0, 10, 5, 3],
  children: [],
  parents: [],
  lod: "2.2",
};

const model = {
  sourceEncoding: "cityjson" as const,
  metadata: { referenceSystem: "EPSG:7415" },
  bbox: null,
  objects: { [building.id]: building },
  vertexCount: 0,
};

function renderViewer(): void {
  useLayerStore.getState().addLayer({
    id: "city-1",
    name: "delft.city.json",
    model,
    modelRef: { type: "url", url: "https://example.test/delft.city.json" },
    visible: true,
    rules: [],
    isStreaming: false,
  });
  render(<App persistenceStore={emptyStore} />);
}

beforeEach(() => {
  useLayerStore.setState({ layers: [] });
  useWorkspaceStore.setState({ activeLayerId: null });
  useSelectionStore.setState({ selections: [], geoSelection: null });
  useGeoLayerStore.setState({ layers: [] });
  useSceneSheetStore.setState({ sheet: null });
  // jsdom is 1024×768, below both of `defaultShellState`'s breakpoints.
  useShellStore.setState(defaultShellState(1440, 900));
});

afterEach(() => {
  cleanup();
  useProcessingStore.getState().resetForTest();
});

describe("App processing toast", () => {
  it("repeats a finished run's first line as a toast", () => {
    renderViewer();
    act(() =>
      useProcessingStore.getState().pushNotice("2 buildings measured · 0.3 s"),
    );
    expect(
      screen.getByText("2 buildings measured · 0.3 s"),
    ).toBeInTheDocument();
  });

  it("raises the SAME line again when a second run finishes", () => {
    // `notice` alone would not change, so the subscription keys off
    // `noticeSeq`: two identical runs both get their toast.
    renderViewer();
    act(() => useProcessingStore.getState().pushNotice("Done · 0.1 s"));
    act(() => useProcessingStore.getState().pushNotice("Done · 0.1 s"));
    expect(screen.getByText("Done · 0.1 s")).toBeInTheDocument();
    expect(useProcessingStore.getState().noticeSeq).toBe(2);
  });
});
