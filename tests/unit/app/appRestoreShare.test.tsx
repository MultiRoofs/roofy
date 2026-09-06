/**
 * `App`'s save / restore / share flows against the viewport's explicit
 * readiness signal (Task C20 — the M7.6 closer).
 *
 * What these cases pin, and why each one exists:
 *
 *   * A restore no longer guesses when the camera can be applied. The old
 *     `setTimeout(..., 100)` was a bet that the engine would be up by then;
 *     the flow now waits for the handle to be published AND for
 *     `CitySceneHandle.ready` to resolve, so a slow WASM start cannot land the
 *     camera in the void — and a restore triggered from the LANDING page (the
 *     only place the snapshot list is rendered) has no viewport at all when it
 *     starts, which is exactly the case an inline `sceneRef.current?.ready`
 *     would silently skip.
 *   * `ready` is resolve-or-reject, so an engine that never starts must
 *     surface as a message rather than a silently missing camera.
 *   * A share link is processed on mount, before any viewport exists. A `.fcb`
 *     link must therefore drive the same engine-boot hold a manual `.fcb` open
 *     does (Task C14), or streaming could never be the first layer of a shared
 *     workspace.
 *   * A link minted before v3 carries a camera in a frame that no longer
 *     exists. It cannot be opened — but "nothing happened" is indistinguishable
 *     from a broken viewer, so it has to explain itself (ledger, Task C18).
 *   * Saving right after a restore can find the camera transiently
 *     unreadable: `positionGeographic` throws until the engine's first frame
 *     (Task B11a), so `getCameraState()` answers null. That must be tolerated
 *     and reported, never thrown or silently swallowed.
 *
 * The engine is never imported: `NavaraViewport` is mocked (jsdom has no
 * WebGL, and `@navaramap/three` crashes at module scope under Node — Task B1's
 * NODE_IMPORT_SAFE = false). The real round trip is Task C20's browser smoke.
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
import { isAutoFitSuppressed } from "../../../src/scene/autoFitSuppression";
import type {
  GeographicCamera,
  ProjectSnapshot,
  ProjectStateStore,
} from "../../../src/persistence/types";
import type { StreamPlugin } from "../../../src/features/streaming/streamPlugin";
import type { PlatformServices } from "../../../src/platform/types";
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

const FCB_URL = "https://example.test/delft.fcb";
const JSON_URL = "https://example.test/delft.city.json";

const CAM: GeographicCamera = {
  lng: 4.3571,
  lat: 52.0116,
  height: 800,
  heading: 30,
  pitch: -45,
  roll: 0,
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
  // Nobody may await a rejected gate (a test can finish first), so keep it
  // from being reported as an unhandled rejection.
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

/** The engine's `ready`, controlled per test: these cases are ABOUT when it
 *  settles, so it never resolves on its own. */
let readyGate: Gate = createGate();
const setCameraState = vi.fn();
/** What `getCameraState()` answers — null models the pre-first-frame window
 *  in which `positionGeographic` throws (Task B11a). */
let cameraState: GeographicCamera | null = CAM;

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
            alignView: () => {},
            getCameraState: () => cameraState,
            setCameraState,
            getStreamingPlugin: async () => streamPluginStub,
            // A getter, like the real handle: the gate is re-armed per test.
            get ready() {
              return readyGate.promise;
            },
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

/** What `openStreamingLayer` saw, and when. A zero `layersAtCall` is the
 *  evidence that the shell was up with NO layer — i.e. that the share path
 *  took the engine-boot hold. */
const openCalls: Array<{ plugin: unknown; layersAtCall: number }> = [];
/** Swapped per test: a `.fcb` open that fails is the whole point of the
 *  share-link failure case. */
let openStreamingLayerImpl: () => Promise<string> = async () => "stream-1";

vi.mock("../../../src/features/streaming/openStreamingLayer", () => ({
  openStreamingLayer: vi.fn(async (input: { plugin: unknown }) => {
    const { useLayerStore } =
      await import("../../../src/features/layers/layerStore");
    openCalls.push({
      plugin: input.plugin,
      layersAtCall: useLayerStore.getState().layers.length,
    });
    return openStreamingLayerImpl();
  }),
  closeStreamingLayer: vi.fn(),
  closeAllStreamingLayers: vi.fn(),
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
const { encodeShareState } = await import("../../../src/persistence/urlShare");

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

const SAVED_AT = "2026-08-01T10:00:00.000Z";

function snapshotWithUrlLayer(): ProjectSnapshot {
  return {
    version: "3",
    savedAt: SAVED_AT,
    label: "delft",
    layers: [
      {
        name: "delft",
        modelRef: { type: "url", url: JSON_URL },
        rules: [],
        rulesEnabled: true,
        visible: true,
      },
    ],
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

/** Click the snapshot list's Restore button (landing page only). */
async function clickRestore(): Promise<void> {
  const button = await screen.findByRole("button", { name: "Restore" });
  fireEvent.click(button);
}

beforeEach(() => {
  openCalls.length = 0;
  openStreamingLayerImpl = async () => {
    useLayerStore.getState().addLayer({
      id: "stream-1",
      name: "delft.fcb",
      model,
      modelRef: { type: "url", url: FCB_URL },
      visible: true,
      rules: [],
      rulesEnabled: true,
      isStreaming: true,
    });
    return "stream-1";
  };
  readyGate = createGate();
  setCameraState.mockClear();
  cameraState = CAM;
  loadFromUrl.mockReset();
  loadFromUrl.mockResolvedValue(loaded);
  useLayerStore.setState({ layers: [] });
  useWorkspaceStore.setState({ activeLayerId: null });
  location.hash = "";
});

afterEach(() => {
  cleanup();
  location.hash = "";
});

describe("App restore against CitySceneHandle.ready", () => {
  it("applies the saved camera only once the viewport reports ready", async () => {
    render(<App persistenceStore={storeWith(snapshotWithUrlLayer())} />);
    await clickRestore();

    // The layer restored and the shell came up...
    await waitFor(() =>
      expect(screen.getByTestId("navara-viewport")).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(useLayerStore.getState().layers).toHaveLength(1),
    );
    // ...but the engine has NOT reported ready, so no camera has been pushed.
    // The 100 ms timer this replaced would have fired long ago.
    expect(setCameraState).not.toHaveBeenCalled();

    readyGate.resolve();

    await waitFor(() => expect(setCameraState).toHaveBeenCalledWith(CAM));
  });

  // Task C26. The viewport fits itself to any NEWLY ADDED layer, and a restore
  // is nothing but new layers arriving — so unless the restore holds the
  // suppression scope across BOTH the layer adds and the camera set, the fit
  // races `setCameraState` and, landing second, throws the saved viewpoint
  // away. (The viewport's own half of this is in navaraViewport.test.tsx; here
  // the viewport is a mock, so what is under test is that App opens the scope
  // early enough and holds it long enough.)
  it("holds auto-fit suppressed across the layer adds AND the camera set, then releases it", async () => {
    expect(isAutoFitSuppressed()).toBe(false);

    let suppressedWhenCameraSet: boolean | null = null;
    setCameraState.mockImplementationOnce(() => {
      suppressedWhenCameraSet = isAutoFitSuppressed();
    });

    render(<App persistenceStore={storeWith(snapshotWithUrlLayer())} />);
    await clickRestore();

    // Layers have landed and the engine has not reported ready yet: the fit
    // this guards would fire in exactly this window.
    await waitFor(() =>
      expect(useLayerStore.getState().layers).toHaveLength(1),
    );
    expect(isAutoFitSuppressed()).toBe(true);

    readyGate.resolve();
    await waitFor(() => expect(setCameraState).toHaveBeenCalledWith(CAM));

    // The camera landed INSIDE the scope — that is the whole point.
    expect(suppressedWhenCameraSet).toBe(true);
    // ...and the scope closed afterwards, so an ordinary later layer add still
    // frames itself.
    await waitFor(() => expect(isAutoFitSuppressed()).toBe(false));
  });

  it("releases the auto-fit suppression even when the restore fails", async () => {
    render(
      <App
        persistenceStore={
          {
            list: async () => [{ id: "s1", label: "w", savedAt: 1 }],
            load: async () => {
              throw new Error("storage exploded");
            },
            save: async () => {},
            remove: async () => {},
          } as unknown as Parameters<typeof App>[0]["persistenceStore"]
        }
      />,
    );
    await clickRestore();

    await waitFor(() => expect(isAutoFitSuppressed()).toBe(false));
  });

  it("restores the layers and explains the failure when the engine never starts", async () => {
    render(<App persistenceStore={storeWith(snapshotWithUrlLayer())} />);
    await clickRestore();

    await waitFor(() =>
      expect(screen.getByTestId("navara-viewport")).toBeInTheDocument(),
    );
    readyGate.reject(new Error("wasm boom"));

    // The workspace itself survived: only the camera could not be applied.
    await waitFor(() =>
      expect(
        screen.getByText(/could not start: wasm boom/),
      ).toBeInTheDocument(),
    );
    expect(useLayerStore.getState().layers).toHaveLength(1);
    expect(setCameraState).not.toHaveBeenCalled();
  });

  it("does not wait on a viewport that will never mount", async () => {
    // Every layer is file-backed, so nothing renders and no engine starts:
    // the restore must finish with its "re-select the file" prompt rather
    // than hanging on a readiness signal that can never arrive.
    const snapshot: ProjectSnapshot = {
      ...snapshotWithUrlLayer(),
      layers: [
        {
          name: "delft",
          modelRef: { type: "file", fileName: "delft.city.json" },
          rules: [],
          rulesEnabled: true,
          visible: true,
        },
      ],
    };
    render(<App persistenceStore={storeWith(snapshot)} />);
    await clickRestore();

    // Both the persistent banner and the restore toast say it.
    await waitFor(() =>
      expect(
        screen.getAllByText(/needs? a local file re-selected/).length,
      ).toBeGreaterThan(0),
    );
    expect(screen.queryByTestId("navara-viewport")).toBeNull();
    expect(setCameraState).not.toHaveBeenCalled();
  });
});

/** A current share link carrying one `.fcb` layer. */
function fcbShareHash(): string {
  return (
    "#" +
    encodeShareState({
      v: 3,
      layers: [
        {
          name: "delft.fcb",
          modelUrl: FCB_URL,
          rules: [],
          rulesEnabled: true,
          visible: true,
        },
      ],
      cam: CAM,
      dt: "2025-06-21T12:00:00.000Z",
      pm: "object",
    })
  );
}

describe("App share-hash restore", () => {
  it("cold-loads a .fcb share link through the engine-boot hold and restores the camera", async () => {
    location.hash = fcbShareHash();

    render(<App persistenceStore={storeWith(null)} />);

    // The shell came up for a workspace that has no layer yet — the boot hold
    // the share path takes, exactly like a manual .fcb open (Task C14).
    await waitFor(() =>
      expect(screen.getByTestId("navara-viewport")).toBeInTheDocument(),
    );
    await waitFor(() => expect(openCalls).toHaveLength(1));
    expect(openCalls[0]!.plugin).toBe(streamPluginStub);
    expect(openCalls[0]!.layersAtCall).toBe(0);

    // Camera still gated on readiness, as in the restore path.
    expect(setCameraState).not.toHaveBeenCalled();
    readyGate.resolve();
    await waitFor(() => expect(setCameraState).toHaveBeenCalledWith(CAM));
  });

  it("says so when the link is from an older version instead of ignoring it", async () => {
    const legacy =
      "share=" +
      btoa(
        JSON.stringify({
          layers: [
            {
              name: "delft",
              modelUrl: JSON_URL,
              rules: [],
              rulesEnabled: true,
              visible: true,
            },
          ],
          cp: [50, 50, 50],
          ct: [0, 0, 0],
          dt: "2025-06-21T12:00:00.000Z",
          pm: "object",
        }),
      );
    location.hash = "#" + legacy;

    render(<App persistenceStore={storeWith(null)} />);

    await waitFor(() =>
      expect(screen.getByText(/older version of Roofy/)).toBeInTheDocument(),
    );
    // Nothing was opened from a link whose camera cannot be trusted...
    expect(loadFromUrl).not.toHaveBeenCalled();
    expect(useLayerStore.getState().layers).toHaveLength(0);
    // ...and the dead hash is off the URL, so a reload does not re-explain it.
    expect(location.hash).toBe("");
  });

  it("reports a share layer that fails to open instead of showing a bare landing page", async () => {
    // A .fcb source that 404s, fails admission, or times out waiting for the
    // engine. The open ran (so the boot hold was taken and released), no layer
    // landed, and the user is back on the drop zone — which without a message
    // is indistinguishable from the link having done nothing at all.
    openStreamingLayerImpl = async () => {
      throw new Error("Streaming refused: non-metric CRS");
    };
    location.hash = fcbShareHash();

    render(<App persistenceStore={storeWith(null)} />);

    await waitFor(() => expect(openCalls).toHaveLength(1));
    await waitFor(() =>
      expect(
        screen.getByText("1 layer failed to load from the share link."),
      ).toBeInTheDocument(),
    );
    expect(useLayerStore.getState().layers).toHaveLength(0);
    // No viewport to point, so no camera was pushed and no 15 s wait for one.
    expect(screen.queryByTestId("navara-viewport")).toBeNull();
    expect(setCameraState).not.toHaveBeenCalled();
  });
});

/** Put the viewer shell up with one ordinary layer, without going through a
 *  restore — the save cases care about the camera, not the snapshot. */
async function mountShellWithLayer(): Promise<void> {
  useLayerStore.getState().addLayer({
    id: "layer-1",
    name: "delft",
    model,
    modelRef: { type: "url", url: JSON_URL },
    visible: true,
    rules: [],
    rulesEnabled: true,
  });
  await waitFor(() =>
    expect(screen.getByTestId("navara-viewport")).toBeInTheDocument(),
  );
}

describe("App save with a camera that is not readable yet", () => {
  it("reports the transiently-null camera instead of silently saving nothing", async () => {
    const save = vi.fn(async () => "snap-2");
    const store: ProjectStateStore = { ...storeWith(null), save };
    render(<App persistenceStore={store} />);
    await mountShellWithLayer();

    // The engine is up but has not rendered its first frame, so
    // `positionGeographic` throws and the handle answers null (Task B11a).
    cameraState = null;
    fireEvent.click(screen.getByRole("button", { name: "Save workspace" }));

    await waitFor(() =>
      expect(screen.getByText(/still starting/)).toBeInTheDocument(),
    );
    expect(save).not.toHaveBeenCalled();
  });

  it("reports the same for a share link, rather than minting one with no viewpoint", async () => {
    const writeText = vi.fn(async () => true);
    render(
      <App
        persistenceStore={storeWith(null)}
        platform={{ clipboard: { writeText } } as unknown as PlatformServices}
      />,
    );
    await mountShellWithLayer();

    cameraState = null;
    fireEvent.click(screen.getByRole("button", { name: "Share this view" }));

    await waitFor(() =>
      expect(
        screen.getByText(/still starting — try sharing again/),
      ).toBeInTheDocument(),
    );
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("App share", () => {
  it("opens a dialog showing the link, and copies it on open", async () => {
    const writeText = vi.fn(async () => true);
    render(
      <App
        persistenceStore={storeWith(null)}
        platform={{ clipboard: { writeText } } as unknown as PlatformServices}
      />,
    );
    await mountShellWithLayer();

    fireEvent.click(screen.getByRole("button", { name: "Share this view" }));

    // The link is on screen — the whole point: a 2.5 s toast was evidence
    // that had usually vanished before the user looked for it.
    const dialog = await screen.findByRole("dialog");
    const field = screen.getByLabelText("Share link") as HTMLInputElement;
    expect(dialog).toContainElement(field);
    expect(field.value).toContain("#share=");

    // ...and it still reached the clipboard without a second click.
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(field.value);
    expect((await screen.findByRole("status")).textContent).toMatch(/copied/i);
  });

  it("says so in the dialog when the clipboard refuses, instead of leaving no link", async () => {
    const writeText = vi.fn(async () => false);
    render(
      <App
        persistenceStore={storeWith(null)}
        platform={{ clipboard: { writeText } } as unknown as PlatformServices}
      />,
    );
    await mountShellWithLayer();

    fireEvent.click(screen.getByRole("button", { name: "Share this view" }));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(/couldn't copy/i),
    );
    expect(
      (screen.getByLabelText("Share link") as HTMLInputElement).value,
    ).toContain("#share=");
  });

  it("closes on Escape", async () => {
    render(
      <App
        persistenceStore={storeWith(null)}
        platform={
          {
            clipboard: { writeText: vi.fn(async () => true) },
          } as unknown as PlatformServices
        }
      />,
    );
    await mountShellWithLayer();

    fireEvent.click(screen.getByRole("button", { name: "Share this view" }));
    await screen.findByRole("dialog");

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("App save success", () => {
  it("confirms the save and says where the workspace will be", async () => {
    const save = vi.fn(async () => "snap-2");
    render(<App persistenceStore={{ ...storeWith(null), save }} />);
    await mountShellWithLayer();

    fireEvent.click(screen.getByRole("button", { name: "Save workspace" }));

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    // Silence used to be the only signal that a save had worked.
    await waitFor(() =>
      expect(
        screen.getByText(/Workspace saved.*next time you open Roofy/),
      ).toBeInTheDocument(),
    );
  });
});

describe("App toast timers", () => {
  afterEach(() => vi.useRealTimers());

  it("does not let an expiring message take the next one down with it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<App persistenceStore={storeWith(null)} />);
    await mountShellWithLayer();
    cameraState = null;

    // A 3 s status toast...
    fireEvent.click(screen.getByRole("button", { name: "Save workspace" }));
    await waitFor(() =>
      expect(screen.getByText(/try saving again/)).toBeInTheDocument(),
    );

    // ...replaced one second later by another message, which is entitled to
    // its own full 3 s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    fireEvent.click(screen.getByRole("button", { name: "Share this view" }));
    await waitFor(() =>
      expect(screen.getByText(/try sharing again/)).toBeInTheDocument(),
    );

    // Past the FIRST toast's expiry: the second must still be on screen —
    // one timer per toast, cleared before the next is armed.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(screen.getByText(/try sharing again/)).toBeInTheDocument();

    // ...and it does go away on its own schedule.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.queryByText(/try sharing again/)).toBeNull();
  });
});
