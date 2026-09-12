/**
 * A workspace of nothing but geospatial layers (Task 22, M12.2).
 *
 * Until now the viewer branch was gated on CITY layers alone, so a GeoJSON
 * added from the landing page wrote a row into a store nobody could see: the
 * page stayed on the drop zone, and the only way to reach the overlay was to
 * open a city model first. `hasWorkspace` fixes that — and the moment a geo
 * layer can be the FIRST thing in a workspace, it also has to be framed, or
 * the user lands on a whole-globe camera with their data somewhere over the
 * horizon.
 *
 * What is pinned here:
 *
 *   * both landing-page doors — the URL field and a dropped file — route a
 *     `.geojson` to the geo store, activate it, and show the viewer;
 *   * the first content of a scene fits ONCE, whatever its kind, and a city
 *     layer added afterwards does not fit (the camera the user arranged around
 *     their overlay outranks it, exactly as on the city-first side);
 *   * a layer with no extent (an XYZ raster) does not fit — there is nothing
 *     to fit to;
 *   * a removal while the fit is still waiting for the engine CANCELS it,
 *     rather than flying to a layer that is gone;
 *   * a restore keeps the camera it saved (the fit is suppressed for its
 *     whole scope), geo-only workspaces included.
 *
 * The engine is never imported: `NavaraViewport` is mocked (jsdom has no
 * WebGL, and `@navaramap/three` crashes at module scope under Node).
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
import { StrictMode, forwardRef, useEffect, useImperativeHandle } from "react";
import type { CitySceneHandle } from "../../../src/scene/NavaraViewport";
import type {
  GeographicCamera,
  ProjectSnapshot,
  ProjectStateStore,
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

const GEOJSON_URL = "https://example.test/parcels.geojson";
const RASTER_URL = "https://tile.example.test/{z}/{x}/{y}.png";

const CAM: GeographicCamera = {
  lng: 4.3571,
  lat: 52.0116,
  height: 800,
  heading: 30,
  pitch: -45,
  roll: 0,
};

/** A document whose only positions sit in Delft — `geoJsonBounds` walks it
 *  coordinate by coordinate, so this is what the fit is framed on. */
const FEATURE_COLLECTION = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: [4.35, 52.0] },
    },
    {
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: [4.36, 52.01] },
    },
  ],
};

// --- the mocked viewport -----------------------------------------------------

interface Gate {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

function createGate(): Gate {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Nobody may await a rejected gate (the re-arm below throws one away on
  // every unmount), so keep it from being reported as unhandled.
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

/** The engine's `ready`, controlled per test: these cases are ABOUT what
 *  happens before and after it settles, so it never resolves on its own. */
let readyGate: Gate = createGate();
const fitBounds = vi.fn();
const setCameraState = vi.fn();

vi.mock("../../../src/scene/NavaraViewport", () => ({
  NavaraViewport: forwardRef<CitySceneHandle, Record<string, unknown>>(
    function MockNavaraViewport(_props, ref) {
      useImperativeHandle(
        ref,
        () =>
          ({
            fitAll: () => {},
            fitLayer: () => {},
            fitBounds,
            alignView: () => {},
            getCameraState: () => CAM,
            setCameraState,
            getStreamingPlugin: async () => {
              throw new Error("no streaming in this suite");
            },
            // A GETTER over the CURRENT gate, exactly like the real handle: the
            // lifecycle below rejects the gate its mount owned and re-arms a
            // fresh one, so a captured promise would be a dead one.
            get ready() {
              return readyGate.promise;
            },
          }) as unknown as CitySceneHandle,
        [],
      );
      // The real viewport's lifecycle cleanup, reduced to the half that
      // matters here: a mount torn down before its engine finished starting
      // SETTLES the gate it owned (resolve-or-reject, never a hang) and
      // re-arms one for the next mount. StrictMode does that to every new
      // viewport immediately, which is what the live defect fell into.
      useEffect(
        () => () => {
          readyGate.reject(
            new Error(
              "NavaraViewport was unmounted before the 3D engine finished starting.",
            ),
          );
          readyGate = createGate();
        },
        [],
      );
      return <div data-testid="navara-viewport" />;
    },
  ),
}));

// DuckDB-wasm is irrelevant here and expensive to even import.
vi.mock("../../../src/insights/duckdb", () => ({
  initDuckDB: vi.fn(async () => {}),
  subscribeDuckDBStatus: vi.fn(() => () => {}),
  getDuckDBStatusVersion: vi.fn(() => 0),
  getEngineGeneration: vi.fn(() => 1),
  onEngineDeath: vi.fn(() => () => {}),
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
const { useGeoLayerStore } =
  await import("../../../src/features/geoLayers/geoLayerStore");
const { useWorkspaceStore, DEFAULT_WORKSPACE_NAME } =
  await import("../../../src/features/workspace/workspaceStore");
const { resetGeoLayerBoundsCache } =
  await import("../../../src/features/geoLayers/geoLayerBounds");

const model = {
  sourceEncoding: "cityjson" as const,
  metadata: { referenceSystem: "EPSG:7415" },
  bbox: null,
  objects: {},
  vertexCount: 0,
};

const emptyStore: ProjectStateStore = {
  list: async () => [],
  load: async () => null,
  save: async () => "snap-1",
  remove: async () => {},
};

const SAVED_AT = "2026-08-01T10:00:00.000Z";

/** A snapshot whose whole workspace is one URL-backed GeoJSON overlay. */
function geoOnlySnapshot(): ProjectSnapshot {
  return {
    version: "4",
    savedAt: SAVED_AT,
    label: "parcels",
    layers: [],
    geoLayers: [
      {
        name: "parcels",
        kind: "geojson",
        visible: true,
        opacity: 1,
        config: { url: GEOJSON_URL },
      },
    ],
    viewState: { camera: CAM, datetime: "2025-06-21T12:00:00.000Z" },
    pickMode: "object",
  };
}

function storeWith(snapshot: ProjectSnapshot): ProjectStateStore {
  return {
    list: async () => [
      { id: "snap-1", savedAt: SAVED_AT, label: snapshot.label },
    ],
    load: async () => snapshot,
    save: async () => "snap-1",
    remove: async () => {},
  };
}

/** The landing page's URL field: type, detect (Enter submits the form), add. */
function addUrlFromLandingPage(url: string): void {
  const field = screen.getByLabelText("Source URL");
  fireEvent.change(field, { target: { value: url } });
  fireEvent.submit(screen.getByTestId("url-source-form"));
  fireEvent.click(screen.getByRole("button", { name: "Add layer" }));
}

/** The landing page's drop zone, with the same hand-built `dataTransfer` the
 *  `SourcePicker` suite uses. */
function dropOnLandingPage(file: File): void {
  fireEvent.drop(screen.getByTestId("source-picker-drop-zone"), {
    dataTransfer: { files: [file], types: ["Files"], dropEffect: "" },
  });
}

beforeEach(() => {
  readyGate = createGate();
  fitBounds.mockClear();
  setCameraState.mockClear();
  loadFromUrl.mockReset();
  loadFromUrl.mockResolvedValue({
    model,
    bytes: new TextEncoder().encode("{}"),
    encoding: "cityjson" as const,
  });
  useLayerStore.setState({ layers: [] });
  useGeoLayerStore.setState({ layers: [] });
  useWorkspaceStore.setState({
    activeLayerId: null,
    name: DEFAULT_WORKSPACE_NAME,
  });
  // The URL → bounds cache is module state and outlives a test.
  resetGeoLayerBoundsCache();
  // `resolveGeoLayerBounds` fetches a URL-backed document; jsdom has no
  // network, and the raster case must be shown to fetch NOTHING.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => FEATURE_COLLECTION,
    })),
  );
  location.hash = "";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  location.hash = "";
});

describe("a geospatial-only workspace", () => {
  it("enters the viewer when a GeoJSON URL is added from the landing page, and fits it once", async () => {
    render(<App persistenceStore={emptyStore} />);
    addUrlFromLandingPage(GEOJSON_URL);

    // The row landed in the geo store, and NOT in the city loader.
    await waitFor(() =>
      expect(useGeoLayerStore.getState().layers).toHaveLength(1),
    );
    expect(loadFromUrl).not.toHaveBeenCalled();
    expect(useLayerStore.getState().layers).toHaveLength(0);

    // The landing page is gone: a workspace with geospatial content in it is
    // a workspace, and it is shown in the viewer.
    await waitFor(() =>
      expect(screen.getByTestId("navara-viewport")).toBeInTheDocument(),
    );
    // ...with the new layer active, so every panel describes it.
    const geoId = useGeoLayerStore.getState().layers[0]!.id;
    expect(useWorkspaceStore.getState().activeLayerId).toBe(geoId);

    // The fit waits for the engine, exactly as a restored camera does.
    expect(fitBounds).not.toHaveBeenCalled();
    readyGate.resolve();

    await waitFor(() => expect(fitBounds).toHaveBeenCalledTimes(1));
    // Framed on the document's own extent — the engine has no bounds API for
    // a geo layer, so the app computes it (`resolveGeoLayerBounds`).
    expect(fitBounds.mock.calls[0]![0]).toMatchObject({
      west: 4.35,
      south: 52.0,
      east: 4.36,
      north: 52.01,
    });
  });

  it("routes a DROPPED .geojson through the geo path, not the city loader", async () => {
    render(<App persistenceStore={emptyStore} />);
    dropOnLandingPage(
      new File([JSON.stringify(FEATURE_COLLECTION)], "parcels.geojson", {
        type: "application/json",
      }),
    );

    await waitFor(() =>
      expect(useGeoLayerStore.getState().layers).toHaveLength(1),
    );
    // The document is INLINE (a dropped file has no URL to come back to), so
    // this one needs no fetch at all.
    expect(loadFromUrl).not.toHaveBeenCalled();
    expect(useLayerStore.getState().layers).toHaveLength(0);
    await waitFor(() =>
      expect(screen.getByTestId("navara-viewport")).toBeInTheDocument(),
    );
    // Active, like the URL door's row: `addGeoSource` adds AND activates, so
    // the panels describe what the user just dropped.
    expect(useWorkspaceStore.getState().activeLayerId).toBe(
      useGeoLayerStore.getState().layers[0]!.id,
    );

    readyGate.resolve();
    await waitFor(() => expect(fitBounds).toHaveBeenCalledTimes(1));
  });

  it("does not fit again when a city layer joins the geo-only workspace", async () => {
    render(<App persistenceStore={emptyStore} />);
    addUrlFromLandingPage(GEOJSON_URL);
    await waitFor(() =>
      expect(screen.getByTestId("navara-viewport")).toBeInTheDocument(),
    );
    readyGate.resolve();
    await waitFor(() => expect(fitBounds).toHaveBeenCalledTimes(1));

    // The city layer's own fit is the VIEWPORT's business (and it declines it
    // too — `navaraViewport.test.tsx` pins that half). What must not happen
    // here is a SECOND geo fit: the workspace is no longer empty.
    act(() => {
      useLayerStore.getState().addLayer({
        id: "city-1",
        name: "delft.city.json",
        model,
        modelRef: { type: "url", url: "https://example.test/delft.city.json" },
        visible: true,
        rules: [],
        isStreaming: false,
      });
    });

    await waitFor(() =>
      expect(useLayerStore.getState().layers).toHaveLength(1),
    );
    expect(fitBounds).toHaveBeenCalledTimes(1);
  });

  it("does not fit when a city layer joins while the geo fit's bounds fetch is still in flight", async () => {
    // The other "joins" case above lets the fit complete FIRST, then adds
    // the city row — this one pins the narrower window Task 25 is about:
    // the recheck between `resolveGeoLayerBounds`'s await and `fitBounds`.
    // A held fetch is what puts the effect inside that window on demand.
    let resolveFetch!: () => void;
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = () =>
            resolve({
              ok: true,
              status: 200,
              json: async () => FEATURE_COLLECTION,
            });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<App persistenceStore={emptyStore} />);
    addUrlFromLandingPage(GEOJSON_URL);
    await waitFor(() =>
      expect(screen.getByTestId("navara-viewport")).toBeInTheDocument(),
    );
    readyGate.resolve();

    // The engine is ready and the first `stillTheOnlyRow()` check has
    // passed (still one geo row) — the effect is now awaiting the fetch.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // A city layer joins WHILE that fetch is still pending.
    act(() => {
      useLayerStore.getState().addLayer({
        id: "city-1",
        name: "delft.city.json",
        model,
        modelRef: { type: "url", url: "https://example.test/delft.city.json" },
        visible: true,
        rules: [],
        isStreaming: false,
      });
    });
    await waitFor(() =>
      expect(useLayerStore.getState().layers).toHaveLength(1),
    );

    // Only now does the bounds fetch settle — after the workspace stopped
    // being "one geo row and nothing else". The second `stillTheOnlyRow()`
    // check must catch this and skip the fit.
    await act(async () => {
      resolveFetch();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(fitBounds).not.toHaveBeenCalled();
  });

  it("does not fit an XYZ raster, which has no extent to fit to", async () => {
    render(<App persistenceStore={emptyStore} />);
    addUrlFromLandingPage(RASTER_URL);

    await waitFor(() =>
      expect(screen.getByTestId("navara-viewport")).toBeInTheDocument(),
    );
    expect(useGeoLayerStore.getState().layers[0]!.kind).toBe("raster-xyz");

    readyGate.resolve();
    // Nothing to fetch and nothing to frame: a tile template names no extent.
    await waitFor(() => expect(fetch).not.toHaveBeenCalled());
    expect(fitBounds).not.toHaveBeenCalled();
  });

  it("cancels the fit when the workspace changes before the engine is ready", async () => {
    render(<App persistenceStore={emptyStore} />);
    addUrlFromLandingPage(GEOJSON_URL);
    await waitFor(() =>
      expect(screen.getByTestId("navara-viewport")).toBeInTheDocument(),
    );

    // The geo row goes and a city model takes its place, in one beat — so the
    // viewport STAYS MOUNTED and `fitBounds` is genuinely reachable when the
    // engine finally reports ready. (Removing the only row instead would
    // unmount the viewport and make this pass for the wrong reason.) The scene
    // the pending fit was computed for no longer exists: it is dropped, and
    // the city layer's own framing is the viewport's business.
    const geoId = useGeoLayerStore.getState().layers[0]!.id;
    act(() => {
      useGeoLayerStore.getState().removeGeoLayer(geoId);
      useLayerStore.getState().addLayer({
        id: "city-1",
        name: "delft.city.json",
        model,
        modelRef: { type: "url", url: "https://example.test/delft.city.json" },
        visible: true,
        rules: [],
        isStreaming: false,
      });
    });
    act(() => readyGate.resolve());

    await waitFor(() =>
      expect(screen.getByTestId("navara-viewport")).toBeInTheDocument(),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(fitBounds).not.toHaveBeenCalled();
  });

  // The live defect of Task 22's first browser run: from the landing page a
  // `.geojson` URL brought up the viewer with the row active, and the camera
  // never moved — the fixture server logged only the layer's own request, so
  // the effect never reached `resolveGeoLayerBounds`.
  //
  // The app runs under `<React.StrictMode>` (main.tsx), which tears every
  // newly mounted component down once and remounts it. `NavaraViewport`'s
  // lifecycle cleanup settles the `ready` gate its mount owned — REJECTING it,
  // since the engine had not finished starting — and re-arms a fresh one for
  // the mount that follows. This effect runs in the very commit that mounts
  // the viewport, so it was awaiting the gate that was about to be thrown
  // away, and the rejection vanished into its (deliberately quiet) catch.
  it("fits a geo layer even when the new viewport is torn down and remounted under StrictMode", async () => {
    render(
      <StrictMode>
        <App persistenceStore={emptyStore} />
      </StrictMode>,
    );
    addUrlFromLandingPage(GEOJSON_URL);
    await waitFor(() =>
      expect(screen.getByTestId("navara-viewport")).toBeInTheDocument(),
    );

    // The gate the effect first awaited was rejected by StrictMode's teardown;
    // this resolves the one the SURVIVING mount owns, which is what the engine
    // coming up looks like.
    act(() => readyGate.resolve());
    await waitFor(() => expect(fitBounds).toHaveBeenCalledTimes(1));
  });

  it("keeps a restored camera: a geo-only restore applies its viewpoint and does not fit", async () => {
    render(<App persistenceStore={storeWith(geoOnlySnapshot())} />);
    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));

    await waitFor(() =>
      expect(useGeoLayerStore.getState().layers).toHaveLength(1),
    );
    await waitFor(() =>
      expect(screen.getByTestId("navara-viewport")).toBeInTheDocument(),
    );

    act(() => readyGate.resolve());
    // The saved camera is applied — a geo-only workspace has a viewport to
    // apply it to now — and the fit that would have replaced it is dropped,
    // because the whole restore runs inside the auto-fit suppression scope.
    await waitFor(() => expect(setCameraState).toHaveBeenCalledWith(CAM));
    expect(fitBounds).not.toHaveBeenCalled();
  });

  it("does not tell a geo-only restore to drop a file: the workspace is on screen", async () => {
    render(<App persistenceStore={storeWith(geoOnlySnapshot())} />);
    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));

    await waitFor(() =>
      expect(screen.getByTestId("navara-viewport")).toBeInTheDocument(),
    );
    // "Drop file(s) to view the model" is the CITY prompt for a workspace
    // whose layers are all file-backed and therefore unavailable. Nothing here
    // is waiting for a file: the overlay restored completely and is drawn.
    expect(screen.queryByText(/Drop file\(s\) to view the model/)).toBeNull();
  });
});
