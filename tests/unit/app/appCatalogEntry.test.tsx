/**
 * The catalog's entry point on the LANDING page (Task 9).
 *
 * A first-time visitor has no file to drop and no URL to paste; "Browse
 * catalog" is what turns an empty viewer into a populated one, so it sits
 * beside "Load Delft sample" rather than behind the sidebar's Add Layer
 * dialog (which does not exist until a layer does).
 *
 * What is pinned here is the WIRING, not the browser: `StacBrowserDialog` is
 * stubbed, because the real one mounts MapLibre and reads a Parquet index
 * through DuckDB-wasm — neither of which jsdom can run, and both of which have
 * suites of their own. The engine is mocked for the same reason as in
 * `appEngineBoot.test.tsx`: `@navaramap/three` crashes at module scope under
 * Node.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import type { CitySceneHandle } from "../../../src/scene/NavaraViewport";
import type {
  ProjectStateStore,
  SnapshotSummary,
} from "../../../src/persistence/types";

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

const CATALOG_URL = "https://catalog.test/tile.city.json";

vi.mock("../../../src/scene/NavaraViewport", () => ({
  NavaraViewport: forwardRef<CitySceneHandle, Record<string, unknown>>(
    function MockNavaraViewport(_props, ref) {
      useImperativeHandle(ref, () => null as unknown as CitySceneHandle, []);
      return <div data-testid="navara-viewport" />;
    },
  ),
}));

// DuckDB-wasm is irrelevant here and expensive to even import. Every export
// the app reaches for must be present — a partial factory turns an unrelated
// import into a runtime TypeError.
vi.mock("../../../src/analytics/duckdb", () => ({
  initDuckDB: vi.fn(async () => {}),
  getDuckDBStatus: vi.fn(() => ({ state: "uninitialized" })),
  loadModelIntoDuckDB: vi.fn(async () => false),
  loadCityModelFromMemory: vi.fn(async () => false),
  loadResidentObjectsIntoDuckDB: vi.fn(async () => false),
  shouldUseSourceUrlPath: vi.fn(() => false),
  queryParquetBuffer: vi.fn(),
}));

vi.mock("../../../src/features/streaming/openStreamingLayer", () => ({
  openStreamingLayer: vi.fn(async () => "stream-1"),
  closeStreamingLayer: vi.fn(),
  closeAllStreamingLayers: vi.fn(),
}));

/** The dialog stub: a marker (was it mounted?), a close button (does the
 *  landing page own the open state?) and an add button (does its URL reach
 *  the app's ONE loading path?). */
vi.mock("../../../src/ui/stac/StacBrowserDialog", () => ({
  StacBrowserDialog: (props: {
    onClose: () => void;
    onAddUrl: (url: string) => void;
  }) => (
    <div data-testid="stac-dialog-stub">
      <button type="button" onClick={() => props.onAddUrl(CATALOG_URL)}>
        stub catalog add
      </button>
      <button type="button" onClick={props.onClose}>
        stub catalog close
      </button>
    </div>
  ),
}));

const loadFromUrl = vi.fn();
vi.mock(
  "../../../src/domain/citymodel/loadCityModel",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../src/domain/citymodel/loadCityModel")
      >();
    return { ...actual, loadFromUrl: (url: string) => loadFromUrl(url) };
  },
);

const { App } = await import("../../../src/app/App");
const { useLayerStore } =
  await import("../../../src/features/layers/layerStore");

const emptyStore: ProjectStateStore = {
  list: async (): Promise<SnapshotSummary[]> => [],
  load: async () => null,
  save: async () => "snapshot-1",
  remove: async () => {},
};

describe("App landing page — catalog entry point", () => {
  beforeEach(() => {
    loadFromUrl.mockReset();
    // Never resolves: the landing page has to stay mounted for the assertion
    // that follows the add, and a resolved model would swap in the shell.
    loadFromUrl.mockReturnValue(new Promise(() => {}));
    useLayerStore.setState({ layers: [], activeLayerId: null });
  });

  afterEach(cleanup);

  it("offers 'Browse catalog' beside the sample-data button", () => {
    render(<App persistenceStore={emptyStore} />);

    expect(
      screen.getByRole("button", { name: "Load Delft sample" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Browse catalog" }),
    ).toBeInTheDocument();
    // Closed until asked for.
    expect(screen.queryByTestId("stac-dialog-stub")).toBeNull();
  });

  it("mounts the catalog dialog on click and closes it again", () => {
    render(<App persistenceStore={emptyStore} />);

    fireEvent.click(screen.getByRole("button", { name: "Browse catalog" }));
    expect(screen.getByTestId("stac-dialog-stub")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "stub catalog close" }));
    expect(screen.queryByTestId("stac-dialog-stub")).toBeNull();
  });

  it("routes an added catalog URL through the app's one loading path", async () => {
    render(<App persistenceStore={emptyStore} />);

    fireEvent.click(screen.getByRole("button", { name: "Browse catalog" }));
    fireEvent.click(screen.getByRole("button", { name: "stub catalog add" }));

    await waitFor(() => expect(loadFromUrl).toHaveBeenCalledWith(CATALOG_URL));
    // Adding does not dismiss the catalog: picking several tiles out of one
    // collection is the normal case. (The landing branch — dialog included —
    // unmounts on its own once the first layer lands.)
    expect(screen.getByTestId("stac-dialog-stub")).toBeInTheDocument();
  });
});
