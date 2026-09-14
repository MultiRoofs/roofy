/**
 * §8 through the REAL `App`: a derived layer reaches neither a saved workspace
 * nor a share link, and Save says so.
 *
 * `derivedSnapshot.test.tsx` pins the pure decision. This file pins the two
 * WIRINGS of it, which is where §8 was previously broken in two different
 * ways: the save wrote a derived layer's geo row as an empty re-linkable
 * placeholder (Task 23's parting note), and the share serialization filtered
 * only on `modelRef.type === "url"` — which a derived city layer passes, since
 * it inherits its parent's `modelRef`, so the PARENT's whole model came back
 * under the derived layer's name (Strand C round-2 finding 4).
 *
 * The engine is never imported: `NavaraViewport` is mocked (jsdom has no
 * WebGL, and `@navaramap/three` crashes at module scope under Node), and the
 * duckdb / streaming / loader factories are copied verbatim from
 * `appRestoreShare.test.tsx`.
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
import { forwardRef, useImperativeHandle } from "react";
import type { CitySceneHandle } from "../../../src/scene/NavaraViewport";
import type {
  GeographicCamera,
  ProjectSnapshot,
  ProjectStateStore,
} from "../../../src/persistence/types";
import type { StreamPlugin } from "../../../src/features/streaming/streamPlugin";
import type { PlatformServices } from "../../../src/platform/types";
import {
  useWorkspaceStore,
  DEFAULT_WORKSPACE_NAME,
} from "../../../src/features/workspace/workspaceStore";
import { useGeoLayerStore } from "../../../src/features/geoLayers/geoLayerStore";

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

const DELFT_URL = "https://example.test/delft.city.json";
const ROTTERDAM_URL = "https://example.test/rotterdam.city.json";

const CAM: GeographicCamera = {
  lng: 4.3571,
  lat: 52.0116,
  height: 800,
  heading: 30,
  pitch: -45,
  roll: 0,
};

const streamPluginStub = {
  openStream: vi.fn(),
  getHandle: vi.fn(),
  handles: vi.fn(() => []),
  remove: vi.fn(),
  dispose: vi.fn(),
  suppressSettle: vi.fn(),
} as unknown as StreamPlugin;

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
            fitObjects: () => {},
            alignView: () => {},
            getCameraState: () => CAM,
            setCameraState: () => {},
            getStreamingPlugin: async () => streamPluginStub,
            ready: Promise.resolve(),
          }) as unknown as CitySceneHandle,
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

vi.mock("../../../src/features/streaming/openStreamingLayer", () => ({
  openStreamingLayer: vi.fn(async () => "stream-1"),
  closeStreamingLayer: vi.fn(),
  closeAllStreamingLayers: vi.fn(),
}));

const { App } = await import("../../../src/app/App");
const { useLayerStore } =
  await import("../../../src/features/layers/layerStore");
const { readShareHash } = await import("../../../src/persistence/urlShare");

const model = {
  sourceEncoding: "cityjson" as const,
  metadata: { referenceSystem: "EPSG:7415" },
  bbox: null,
  objects: {},
  vertexCount: 0,
};

function emptyStore(save: ProjectStateStore["save"]): ProjectStateStore {
  return {
    list: async () => [],
    load: async () => null,
    save,
    remove: async () => {},
  };
}

/** Delft, the copy a run cut from it, and Rotterdam underneath — the shape the
 *  index case needs: the derived layer sits BETWEEN two saved ones. */
function seedCityLayers(): void {
  const store = useLayerStore.getState();
  store.addLayer({
    id: "delft",
    name: "Delft",
    model,
    modelRef: { type: "url", url: DELFT_URL },
    visible: true,
    rules: [],
  });
  store.addLayer({
    id: "delft-solids",
    name: "Delft · solids",
    model,
    // A derived city layer INHERITS its parent's reference, which is exactly
    // what makes it pass the share path's `modelRef.type === "url"` filter.
    modelRef: { type: "url", url: DELFT_URL },
    visible: true,
    rules: [],
    insertAfterId: "delft",
    derivedFrom: {
      layerId: "delft",
      layerName: "Delft",
      runId: "run_1",
    },
  });
  store.addLayer({
    id: "rotterdam",
    name: "Rotterdam",
    model,
    modelRef: { type: "url", url: ROTTERDAM_URL },
    visible: true,
    rules: [],
  });
}

async function mountShell(store: ProjectStateStore): Promise<void> {
  render(<App persistenceStore={store} />);
  await waitFor(() =>
    expect(screen.getByTestId("navara-viewport")).toBeInTheDocument(),
  );
}

beforeEach(() => {
  useLayerStore.setState({ layers: [] });
  useGeoLayerStore.setState({ layers: [] });
  useWorkspaceStore.setState({
    activeLayerId: null,
    name: DEFAULT_WORKSPACE_NAME,
  });
  location.hash = "";
});

afterEach(() => {
  cleanup();
  location.hash = "";
});

describe("App save with a derived layer", () => {
  it("omits it from the snapshot and repoints the active index", async () => {
    const save = vi.fn(async (_snapshot: ProjectSnapshot) => "snap-1");
    seedCityLayers();
    await mountShell(emptyStore(save));
    act(() => {
      useWorkspaceStore.setState({ activeLayerId: "rotterdam" });
    });

    fireEvent.click(screen.getByRole("button", { name: "Save workspace" }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const snapshot = save.mock.calls[0]![0];
    expect(snapshot.layers?.map((l) => l.name)).toEqual(["Delft", "Rotterdam"]);
    // Rotterdam is index 2 of three layers and index 1 of the two written.
    // An index taken before the filter would reopen Delft.
    expect(snapshot.activeLayer).toEqual({ kind: "city", index: 1 });
    // Nothing new is persisted: `derivedFrom` never reaches the snapshot,
    // because `App` names the fields it writes one by one.
    expect(snapshot.layers?.every((l) => !("derivedFrom" in l))).toBe(true);
  });

  it("omits a derived GEO layer too, and counts both kinds in the toast", async () => {
    const save = vi.fn(async (_snapshot: ProjectSnapshot) => "snap-1");
    seedCityLayers();
    const geo = useGeoLayerStore.getState();
    // `addGeoLayer` mints the id; the copy is spliced under the parent with
    // the one it handed back, exactly as `prepareDerivedVectorLayer` does.
    const zonesId = geo.addGeoLayer({
      name: "Zones",
      kind: "geojson",
      config: {},
    });
    geo.addGeoLayer({
      name: "Zones · buildings",
      kind: "geojson",
      config: {},
      insertAfterId: zonesId,
      derivedFrom: { layerId: zonesId, layerName: "Zones", runId: "run_2" },
    });
    await mountShell(emptyStore(save));

    fireEvent.click(screen.getByRole("button", { name: "Save workspace" }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const snapshot = save.mock.calls[0]![0];
    // Before this task the copy landed here as an empty re-linkable row.
    expect(snapshot.geoLayers?.map((l) => l.name)).toEqual(["Zones"]);
    // [adapted copy A16], beside the existing success sentence.
    await waitFor(() =>
      expect(
        screen.getByText(
          /2 derived layers are not saved; export them to keep them/,
        ),
      ).toBeInTheDocument(),
    );
  });

  it("says §8's singular sentence for one skipped layer", async () => {
    const save = vi.fn(async (_snapshot: ProjectSnapshot) => "snap-1");
    seedCityLayers();
    await mountShell(emptyStore(save));

    fireEvent.click(screen.getByRole("button", { name: "Save workspace" }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.getByText(
          /Workspace saved.*1 derived layer is not saved; export it to keep it/,
        ),
      ).toBeInTheDocument(),
    );
  });

  it("leaves the ordinary toast alone when nothing was skipped", async () => {
    const save = vi.fn(async (_snapshot: ProjectSnapshot) => "snap-1");
    useLayerStore.getState().addLayer({
      id: "delft",
      name: "Delft",
      model,
      modelRef: { type: "url", url: DELFT_URL },
      visible: true,
      rules: [],
    });
    await mountShell(emptyStore(save));

    fireEvent.click(screen.getByRole("button", { name: "Save workspace" }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const toast = await screen.findByText(/Workspace saved/);
    expect(toast.textContent).toBe(
      "Workspace saved — you'll find it here next time you open Roofy.",
    );
  });
});

describe("App share with a derived layer", () => {
  it("mints a link that does not carry it — decoded", async () => {
    const save = vi.fn(async () => "snap-1");
    seedCityLayers();
    render(
      <App
        persistenceStore={emptyStore(save)}
        platform={
          {
            clipboard: { writeText: vi.fn(async () => true) },
          } as unknown as PlatformServices
        }
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("navara-viewport")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Share this view" }));

    const field = (await screen.findByLabelText(
      "Share link",
    )) as HTMLInputElement;
    const decoded = readShareHash(field.value.slice(field.value.indexOf("#")));
    expect(decoded.kind).toBe("ok");
    if (decoded.kind !== "ok") throw new Error("unreadable link");
    // The derived layer's NAME is nowhere in the payload...
    expect(decoded.state.layers.map((l) => l.name)).toEqual([
      "Delft",
      "Rotterdam",
    ]);
    // ...and the parent's URL is carried ONCE, so opening the link cannot
    // restore the whole of Delft a second time under the copy's name.
    expect(
      decoded.state.layers.filter((l) => l.modelUrl === DELFT_URL),
    ).toHaveLength(1);
  });
});
