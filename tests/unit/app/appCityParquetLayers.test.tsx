/**
 * `App`'s CityParquet paths: the two URL-restore sites.
 *
 * Why these cases exist:
 *
 *   * A snapshot and a share link each rebuild a URL layer with their OWN copy
 *     of the loader hook's routing, so each has to be pinned separately — the
 *     fcb equivalents are in `appRestoreShare.test.tsx` for the same reason.
 *     Both use a `gs://` source on purpose: it carries no extension at all, so
 *     a site that classified with `detectEncoding` would read it as CityJSON
 *     and hand parquet bytes (or a bucket listing) to `JSON.parse`.
 *
 * The engine is never imported (`NavaraViewport` is mocked — jsdom has no
 * WebGL and `@navaramap/three` crashes at module scope under Node), and the
 * CityParquet READER is mocked while its ROUTING (`sourceClassify`) stays
 * real: which arm a URL takes is precisely what is under test.
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
import type { CityModel } from "../../../src/domain/citymodel/types";
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

/** A package directory in a bucket: no extension, so `detectEncoding` reads
 *  it as "cityjson" and only `isCityParquetUrl` gets it right. */
const PARQUET_URL = "gs://city3d/delft/";
const JSON_URL = "https://example.test/delft.city.json";

const CAM: GeographicCamera = {
  lng: 4.3571,
  lat: 52.0116,
  height: 800,
  heading: 30,
  pitch: -45,
  roll: 0,
};

const parquetModel: CityModel = {
  sourceEncoding: "cityparquet",
  metadata: { referenceSystem: "https://www.opengis.net/def/crs/EPSG/0/28992" },
  bbox: null,
  objects: {},
  vertexCount: 0,
};

const jsonModel: CityModel = {
  sourceEncoding: "cityjson",
  metadata: { referenceSystem: "EPSG:7415" },
  bbox: null,
  objects: {},
  vertexCount: 0,
};

/** What `loadFromUrl` resolves since Task 15: the model PLUS the decoded
 *  source bytes and the encoding, for the layer's DuckDB table. */
const jsonLoaded = {
  model: jsonModel,
  bytes: new TextEncoder().encode("{}"),
  encoding: "cityjson" as const,
};

vi.mock("../../../src/scene/NavaraViewport", () => ({
  NavaraViewport: forwardRef<CitySceneHandle, Record<string, unknown>>(
    function MockNavaraViewport(_props, ref) {
      useImperativeHandle(
        ref,
        () =>
          ({
            fitAll: () => {},
            fitLayer: () => {},
            fitBounds: () => {},
            alignView: () => {},
            getCameraState: () => CAM,
            setCameraState: () => {},
            getStreamingPlugin: () => Promise.resolve({}),
            ready: Promise.resolve(),
          }) as unknown as CitySceneHandle,
        [],
      );
      return <div data-testid="navara-viewport" />;
    },
  ),
}));

/** DuckDB's analytics surface, controlled per test. `extensionReady` is what
 *  would put the effect on the extension branch at all — no surviving test in
 *  this file needs a ready engine, so it stays false throughout. */
let extensionReady = false;

vi.mock("../../../src/analytics/duckdb", () => ({
  initDuckDB: vi.fn(async () => {}),
  getDuckDBStatus: vi.fn(() =>
    extensionReady
      ? {
          state: "ready",
          extensions: {
            cityjson: { state: "loaded" },
            spatial: { state: "unloaded" },
            three_d: { state: "unloaded" },
          },
          loadedExtensions: [{ name: "cityjson", version: "0.4.0" }],
          platform: "wasm_eh",
        }
      : { state: "uninitialized" },
  ),
  isExtensionLoaded: vi.fn(() => extensionReady),
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

/** The CityJSON path — asserted NOT to be taken for a CityParquet source. */
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

/** Only the I/O is replaced; `cityParquetLayerNameFromUrl` and the classifier
 *  stay real, because the routing is the thing being tested. */
const loadCityParquetFromUrl = vi.fn();
const loadCityParquetFromFiles = vi.fn();
vi.mock(
  "../../../src/features/cityparquet/loadCityParquet",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../src/features/cityparquet/loadCityParquet")
    >()),
    loadCityParquetFromUrl: (url: string) => loadCityParquetFromUrl(url),
    loadCityParquetFromFiles: (files: ReadonlyArray<File>) =>
      loadCityParquetFromFiles(files),
  }),
);

const { App } = await import("../../../src/app/App");
const { useLayerStore } =
  await import("../../../src/features/layers/layerStore");
const { encodeShareState } = await import("../../../src/persistence/urlShare");

const SAVED_AT = "2026-08-08T10:00:00.000Z";

const RULE = {
  id: "r1",
  name: "flat roofs",
  color: "#ff0000",
  conditions: [],
  logic: "AND" as const,
  enabled: true,
};

function snapshotWith(layers: ProjectSnapshot["layers"]): ProjectSnapshot {
  return {
    version: "3",
    savedAt: SAVED_AT,
    label: "delft",
    layers,
    viewState: { camera: CAM, datetime: "2025-06-21T12:00:00.000Z" },
    pickMode: "object",
  };
}

function storeWith(snapshot: ProjectSnapshot | null): ProjectStateStore {
  return {
    list: async () =>
      snapshot === null
        ? []
        : [{ id: "snap-1", savedAt: SAVED_AT, label: snapshot.label }],
    load: async () => snapshot,
    save: async () => "snap-1",
    remove: async () => {},
  };
}

async function clickRestore(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "Restore" }));
}

function shareHash(
  layers: Parameters<typeof encodeShareState>[0]["layers"],
): string {
  return (
    "#" +
    encodeShareState({
      v: 3,
      layers,
      cam: CAM,
      dt: "2025-06-21T12:00:00.000Z",
      pm: "object",
    })
  );
}

beforeEach(() => {
  extensionReady = false;
  loadFromUrl.mockReset();
  loadFromUrl.mockResolvedValue(jsonLoaded);
  loadCityParquetFromUrl.mockReset();
  loadCityParquetFromUrl.mockResolvedValue(parquetModel);
  loadCityParquetFromFiles.mockReset();
  loadCityParquetFromFiles.mockResolvedValue(parquetModel);
  useLayerStore.setState({ layers: [], activeLayerId: null });
  location.hash = "";
});

afterEach(() => {
  cleanup();
  location.hash = "";
});

describe("App snapshot restore — CityParquet layers", () => {
  it("rebuilds a gs:// package layer through the CityParquet loader, with its saved settings", async () => {
    render(
      <App
        persistenceStore={storeWith(
          snapshotWith([
            {
              name: "delft",
              modelRef: { type: "url", url: PARQUET_URL },
              rules: [RULE],
              rulesEnabled: false,
              visible: false,
              hiddenTypes: ["Building"],
            },
          ]),
        )}
      />,
    );
    await clickRestore();

    await waitFor(() =>
      expect(useLayerStore.getState().layers).toHaveLength(1),
    );
    expect(loadCityParquetFromUrl).toHaveBeenCalledWith(PARQUET_URL);
    // The CityJSON path would have parsed a bucket listing as JSON.
    expect(loadFromUrl).not.toHaveBeenCalled();

    const layer = useLayerStore.getState().layers[0]!;
    expect(layer.model.sourceEncoding).toBe("cityparquet");
    expect(layer.modelRef).toEqual({ type: "url", url: PARQUET_URL });
    expect(layer.rules).toEqual([RULE]);
    expect(layer.rulesEnabled).toBe(false);
    expect(layer.visible).toBe(false);
    expect(layer.hiddenTypes).toEqual(["Building"]);
  });

  it("counts a failing CityParquet layer and still restores its siblings", async () => {
    loadCityParquetFromUrl.mockRejectedValue(
      new Error("Plain https URLs cannot be listed"),
    );

    render(
      <App
        persistenceStore={storeWith(
          snapshotWith([
            {
              name: "delft-parquet",
              modelRef: { type: "url", url: PARQUET_URL },
              rules: [],
              rulesEnabled: true,
              visible: true,
            },
            {
              name: "delft-json",
              modelRef: { type: "url", url: JSON_URL },
              rules: [],
              rulesEnabled: true,
              visible: true,
            },
          ]),
        )}
      />,
    );
    await clickRestore();

    await waitFor(() =>
      expect(screen.getByText(/1 layer failed to restore/)).toBeInTheDocument(),
    );
    const layers = useLayerStore.getState().layers;
    expect(layers).toHaveLength(1);
    expect(layers[0]!.name).toBe("delft-json");
  });
});

describe("App share-link restore — CityParquet layers", () => {
  it("rebuilds a shared gs:// package layer through the CityParquet loader", async () => {
    location.hash = shareHash([
      {
        name: "delft",
        modelUrl: PARQUET_URL,
        rules: [],
        rulesEnabled: true,
        visible: true,
      },
    ]);

    render(<App persistenceStore={storeWith(null)} />);

    await waitFor(() =>
      expect(useLayerStore.getState().layers).toHaveLength(1),
    );
    expect(loadCityParquetFromUrl).toHaveBeenCalledWith(PARQUET_URL);
    expect(loadFromUrl).not.toHaveBeenCalled();
    const layer = useLayerStore.getState().layers[0]!;
    expect(layer.model.sourceEncoding).toBe("cityparquet");
    expect(layer.modelRef).toEqual({ type: "url", url: PARQUET_URL });
  });

  it("counts a failing shared CityParquet layer without dropping the rest of the link", async () => {
    loadCityParquetFromUrl.mockRejectedValue(new Error("File not found (404)"));
    location.hash = shareHash([
      {
        name: "delft-parquet",
        modelUrl: PARQUET_URL,
        rules: [],
        rulesEnabled: true,
        visible: true,
      },
      {
        name: "delft-json",
        modelUrl: JSON_URL,
        rules: [],
        rulesEnabled: true,
        visible: true,
      },
    ]);

    render(<App persistenceStore={storeWith(null)} />);

    await waitFor(() =>
      expect(
        screen.getByText("1 layer failed to load from the share link."),
      ).toBeInTheDocument(),
    );
    const layers = useLayerStore.getState().layers;
    expect(layers).toHaveLength(1);
    expect(layers[0]!.name).toBe("delft-json");
  });
});

/**
 * A failed GROUP add has to be visible from wherever it was attempted.
 *
 * `loadError` is rendered inline — in the LANDING branch only. Inside the
 * viewer shell the Add Layer dialog closes on the way out, so before this the
 * "no CityParquet object tables" sentence went nowhere at all and dropping two
 * wrong files simply did nothing.
 */
describe("App — a failed group add is reported", () => {
  const NO_TABLES = "No CityParquet object tables in the selection.";

  /** Two files, the way a browser delivers a multi-file drop. jsdom has no
   *  real `DataTransfer`, so the shape the handler reads is supplied. */
  function dropTwoFiles(): void {
    fireEvent.drop(screen.getByTestId("source-picker-drop-zone"), {
      dataTransfer: {
        files: [new File(["a"], "a.city.json"), new File(["b"], "b.city.json")],
        types: ["Files"],
        dropEffect: "",
      },
    });
  }

  it("toasts the loader's message inside the viewer shell", async () => {
    loadCityParquetFromFiles.mockRejectedValue(new Error(NO_TABLES));
    render(<App persistenceStore={storeWith(null)} />);
    // A layer, so the shell is up and the landing page's inline error slot is
    // not on screen.
    useLayerStore.getState().addLayer({
      id: "layer-1",
      name: "delft",
      model: jsonModel,
      modelRef: { type: "url", url: JSON_URL },
      visible: true,
      rules: [],
      rulesEnabled: true,
    });

    fireEvent.click(await screen.findByRole("button", { name: "+ Add Layer" }));
    // The dialog opens on the geospatial tab; the city-model drop zone is the
    // one this group add goes through.
    fireEvent.click(screen.getByRole("tab", { name: /city model/i }));
    dropTwoFiles();

    await waitFor(() =>
      expect(loadCityParquetFromFiles).toHaveBeenCalledTimes(1),
    );
    const toast = await waitFor(() => {
      const el = document.querySelector(".toast");
      if (el === null) throw new Error("no toast yet");
      return el;
    });
    expect(toast.textContent).toBe(NO_TABLES);
    // The dialog closed on the way out, as it does for a single file.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("reports it ONCE on the landing page — inline, with no toast", async () => {
    loadCityParquetFromFiles.mockRejectedValue(new Error(NO_TABLES));
    render(<App persistenceStore={storeWith(null)} />);

    dropTwoFiles();

    expect(await screen.findByText(NO_TABLES)).toBeTruthy();
    expect(document.querySelector(".error-message")?.textContent).toBe(
      NO_TABLES,
    );
    expect(document.querySelector(".toast")).toBeNull();
  });
});
