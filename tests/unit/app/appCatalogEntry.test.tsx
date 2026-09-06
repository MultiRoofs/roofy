/**
 * The catalog's entry point on the LANDING page (Task 9).
 *
 * A first-time visitor has no file to drop and no URL to paste; "Browse
 * catalog" is what turns an empty viewer into a populated one, so it is one of
 * the landing page's two equal entry paths rather than something behind the
 * sidebar's Add Layer dialog (which does not exist until a layer does).
 *
 * What is pinned here is the WIRING, not the browser: `StacBrowserDialog` is
 * stubbed, because the real one mounts MapLibre and reads a Parquet index
 * through DuckDB-wasm — neither of which jsdom can run, and both of which have
 * suites of their own. The engine is mocked for the same reason as in
 * `appEngineBoot.test.tsx`: `@navaramap/three` crashes at module scope under
 * Node.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddUrlResult } from "../../../src/ui/stac/StacBrowser";
import {
  act,
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
import { useWorkspaceStore } from "../../../src/features/workspace/workspaceStore";

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

vi.mock("../../../src/features/streaming/openStreamingLayer", () => ({
  openStreamingLayer: vi.fn(async () => "stream-1"),
  closeStreamingLayer: vi.fn(),
  closeAllStreamingLayers: vi.fn(),
}));

/** What the real browser needs back from `onAddUrl`: did a layer land? The
 *  stub records every answer so a test can pin the app's side of that
 *  contract without rendering maplibre. */
const addOutcomes: boolean[] = [];
/** The failure sentences the stub saw — the one new seam in App is
 *  `handleAddUrl` reading the loader's message via `lastError(url)`. */
const addMessages: (string | null)[] = [];

/** The dialog stub: a marker (was it mounted?), a close button (does the
 *  landing page own the open state?) and an add button (does its URL reach
 *  the app's ONE loading path, and what does that path report back?). */
vi.mock("../../../src/ui/stac/StacBrowserDialog", () => ({
  StacBrowserDialog: (props: {
    onClose: () => void;
    onAddUrl: (url: string) => Promise<AddUrlResult>;
  }) => (
    <div data-testid="stac-dialog-stub">
      <button
        type="button"
        onClick={() => {
          void props.onAddUrl(CATALOG_URL).then((result) => {
            addOutcomes.push(result.ok);
            addMessages.push(result.ok ? null : result.message);
          });
        }}
      >
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

/** The parsed model a successful `loadFromUrl` resolves — enough shape for
 *  `addLayer` and the viewer shell, nothing more. */
const model = {
  sourceEncoding: "cityjson" as const,
  metadata: { referenceSystem: "EPSG:7415" },
  bbox: null,
  objects: {},
  vertexCount: 0,
};

/** What `loadFromUrl` resolves since Task 15: the model PLUS the decoded
 *  source bytes and the encoding, for the layer's DuckDB table. */
const loaded = {
  model,
  bytes: new TextEncoder().encode("{}"),
  encoding: "cityjson" as const,
};

describe("App landing page — catalog entry point", () => {
  beforeEach(() => {
    addOutcomes.length = 0;
    addMessages.length = 0;
    loadFromUrl.mockReset();
    // Never resolves: the landing page has to stay mounted for the assertion
    // that follows the add, and a resolved model would swap in the shell.
    loadFromUrl.mockReturnValue(new Promise(() => {}));
    useLayerStore.setState({ layers: [] });
    useWorkspaceStore.setState({ activeLayerId: null });
  });

  afterEach(cleanup);

  it("offers the catalog as one of the landing page's two entry paths", () => {
    render(<App persistenceStore={emptyStore} />);

    // Two peers, one heading each; the sample is a footnote link below them.
    expect(
      screen.getByRole("heading", { name: "Open your data" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Browse the catalog" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Browse catalog" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "try the Delft sample" }),
    ).toBeInTheDocument();
    // Closed until asked for.
    expect(screen.queryByTestId("stac-dialog-stub")).toBeNull();
  });

  it("offers appearance through Preferences alone — no theme toggle in the corner", () => {
    render(<App persistenceStore={emptyStore} />);

    expect(
      screen.getByRole("button", { name: "Preferences" }),
    ).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("button")
        .filter((b) =>
          /toggle theme|switch to (dark|light)/i.test(
            b.getAttribute("aria-label") ?? b.textContent ?? "",
          ),
        ),
    ).toEqual([]);
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

  it("tells the catalog an add FAILED, so it can roll its mark back", async () => {
    // `addLayerFromUrl` reports a failure by resolving null, never by
    // throwing — the boolean the browser waits on has to survive that.
    loadFromUrl.mockRejectedValue(new Error("404 Not Found"));
    render(<App persistenceStore={emptyStore} />);

    fireEvent.click(screen.getByRole("button", { name: "Browse catalog" }));
    fireEvent.click(screen.getByRole("button", { name: "stub catalog add" }));

    await waitFor(() => expect(addOutcomes).toEqual([false]));
    // The loader's sentence made it through `handleAddUrl` — not a canned
    // fallback: the catalog renders exactly this next to the item.
    expect(addMessages).toEqual(["404 Not Found"]);
    // Still open, still on the landing page: nothing landed.
    expect(screen.getByTestId("stac-dialog-stub")).toBeInTheDocument();
  });

  it("resolves TRUE once the layer has actually landed", async () => {
    loadFromUrl.mockResolvedValue(loaded);
    render(<App persistenceStore={emptyStore} />);

    fireEvent.click(screen.getByRole("button", { name: "Browse catalog" }));
    fireEvent.click(screen.getByRole("button", { name: "stub catalog add" }));

    await waitFor(() => expect(addOutcomes).toEqual([true]));
    expect(useLayerStore.getState().layers).toHaveLength(1);
  });

  it("does not re-open the catalog when the LAST layer is removed from the panel", async () => {
    // The other way back to the landing page, and the one a close-time reset
    // missed entirely: the layer row's own remove calls `removeLayer`
    // directly, so `hasLayers` flips false without `handleClose` ever running.
    // Driven through the REAL row menu, not the store.
    loadFromUrl.mockResolvedValue(loaded);
    render(<App persistenceStore={emptyStore} />);

    fireEvent.click(screen.getByRole("button", { name: "Browse catalog" }));
    fireEvent.click(screen.getByRole("button", { name: "stub catalog add" }));

    await waitFor(() =>
      expect(screen.getByTestId("navara-viewport")).toBeInTheDocument(),
    );

    fireEvent.click(
      screen.getByRole("button", { name: /^Layer actions for / }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    });

    expect(
      screen.getByRole("button", { name: "Browse catalog" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("stac-dialog-stub")).toBeNull();
  });

  it("does not re-open the catalog over the landing page after a workspace close", async () => {
    // The regression: `App` is NOT remounted when `hasLayers` flips, so
    // `catalogOpen` survives the round trip to the viewer and back. A user who
    // browsed, added a tile, then hit Close would find the modal open over the
    // landing page — scroll locked, hero hidden — having asked for nothing.
    loadFromUrl.mockResolvedValue(loaded);
    render(<App persistenceStore={emptyStore} />);

    fireEvent.click(screen.getByRole("button", { name: "Browse catalog" }));
    fireEvent.click(screen.getByRole("button", { name: "stub catalog add" }));

    // The layer lands, the viewer shell replaces the landing branch, and the
    // dialog goes with it (accepted behaviour — the branch owns it).
    await waitFor(() =>
      expect(screen.getByTestId("navara-viewport")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("stac-dialog-stub")).toBeNull();

    // "New workspace" in the header's workspace menu — what "Close file" in
    // the toolbar was: the seam that hands the user back to the landing page.
    fireEvent.click(screen.getByRole("button", { name: "Untitled workspace" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New workspace" }));
    });

    expect(
      screen.getByRole("button", { name: "Browse catalog" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("stac-dialog-stub")).toBeNull();
  });
});
