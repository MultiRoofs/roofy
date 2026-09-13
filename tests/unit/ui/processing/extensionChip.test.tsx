/**
 * Spec §5: the chip's tooltip says whether the extension is loaded and, if
 * not, what loading costs; a failed extension mutes the chip, disables the
 * tools that need it with the download reason, and offers a Retry link that
 * attempts the load again.
 *
 * The engine underneath is a fake at the `@duckdb/duckdb-wasm` boundary, so
 * every state this file asserts was really published by `duckdb.ts` and
 * delivered by `useDuckDBStatus`. A hand-rolled fake publisher would go on
 * passing if either of them broke.
 *
 * `duckdb.ts` is a module SINGLETON — a loaded extension stays loaded for the
 * rest of the file — so each case resets the module registry and re-imports
 * the whole consumer graph. The stores have to come from that same fresh
 * graph: a statically imported `useLayerStore` would be a different instance
 * from the one the freshly imported `CatalogueView` reads.
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
import type { CityModel } from "../../../../src/domain/citymodel/types";
import type { LayerStoreActions } from "../../../../src/features/layers/layerStore";
import type { ColumnInfo } from "../../../../src/insights/columnKind";

/** Which extensions the fake engine refuses, and an optional gate that holds
 *  every INSTALL/LOAD open so the in-flight "loading" state can be observed
 *  without counting microtasks. */
const refuse = new Set<string>();
let gate: Promise<void> | null = null;
let openGate: (() => void) | null = null;

function armGate(): void {
  gate = new Promise<void>((resolve) => {
    openGate = resolve;
  });
}

function releaseGate(): void {
  openGate?.();
  gate = null;
  openGate = null;
}

vi.mock("@duckdb/duckdb-wasm", () => {
  class FakeConnection {
    async query(sql: string) {
      const held = gate;
      if (held) await held;
      const named = /^(?:INSTALL|LOAD)\s+(\w+)/.exec(sql);
      if (named && refuse.has(named[1]!)) {
        throw new Error(`Extension "${named[1]!}" not found\nLINE 1: ${sql}`);
      }
      return { getChild: () => null, numRows: 0 };
    }
  }
  return {
    AsyncDuckDB: class {
      async instantiate() {}
      async connect() {
        return new FakeConnection();
      }
    },
    ConsoleLogger: class {},
    LogLevel: { WARNING: 2 },
    getJsDelivrBundles: () => ({}),
    selectBundle: async () => ({
      mainWorker: "https://example.test/duckdb-worker.js",
      mainModule: "https://example.test/duckdb.wasm",
    }),
  };
});

// jsdom has neither of these, and `doInit` uses both to wrap the CDN worker.
// The listener methods are real because `doInit` registers its own `error` and
// `messageerror` handlers on the worker it builds (spec §6.1's detection).
class FakeWorker {
  addEventListener() {}
  removeEventListener() {}
  postMessage() {}
  terminate() {}
}

type CatalogueModule =
  typeof import("../../../../src/ui/processing/CatalogueView");
type DuckdbModule = typeof import("../../../../src/insights/duckdb");
type LayerStoreModule =
  typeof import("../../../../src/features/layers/layerStore");
type WorkspaceModule =
  typeof import("../../../../src/features/workspace/workspaceStore");
type LayerTablesModule = typeof import("../../../../src/insights/layerTables");
type ProcessingModule =
  typeof import("../../../../src/features/processing/processingStore");
type GeoLayerModule =
  typeof import("../../../../src/features/geoLayers/geoLayerStore");

let CatalogueView: CatalogueModule["CatalogueView"];
let duckdb: DuckdbModule;
let useLayerStore: LayerStoreModule["useLayerStore"];
let useWorkspaceStore: WorkspaceModule["useWorkspaceStore"];
let useLayerTableStore: LayerTablesModule["useLayerTableStore"];
let useProcessingStore: ProcessingModule["useProcessingStore"];
let useGeoLayerStore: GeoLayerModule["useGeoLayerStore"];

type LayerInput = Parameters<LayerStoreActions["addLayer"]>[0];

function column(name: string): ColumnInfo {
  return { name, type: "VARCHAR", kind: "scalar" };
}

/** A ready city layer, so ONLY the extension can disable a cross-layer row. */
function addCityLayer(): string {
  const model = {
    sourceEncoding: "cityjson",
    metadata: { referenceSystem: undefined },
    bbox: null,
    objects: {},
    vertexCount: 0,
  } as unknown as CityModel;
  const input: LayerInput = {
    name: "Delft",
    model,
    modelRef: { type: "url", url: "https://x/delft.city.json" },
    visible: true,
    rules: [],
    colorBy: "surface",
  };
  const id = useLayerStore.getState().addLayer(input);
  useWorkspaceStore.getState().setActiveLayerId(id);
  useLayerTableStore.setState({
    tables: {
      [id]: {
        state: "ready",
        info: {
          table: "layer_1",
          sourceName: null,
          source: null,
          reader: "read_cityjson",
          columns: [column("id"), column("feature_id")],
          lods: [],
          extension: "city.json",
          sourceBytes: null,
          rowCount: 2,
        },
      },
    },
  });
  return id;
}

/** An areas layer, so a SHIPPED cross-layer tool's row has nothing left to be
 *  disabled for but the extension. */
function addZones(): void {
  useGeoLayerStore.getState().addGeoLayer({
    name: "Zones",
    kind: "geojson",
    config: {
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            id: "z1",
            properties: {},
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [4, 52],
                  [5, 52],
                  [5, 53],
                  [4, 52],
                ],
              ],
            },
          },
        ],
      },
    },
  });
}

/** The chip for one extension. Both chips carry their label as their text. */
const chip = (label: "Spatial" | "3D") => screen.getAllByText(label)[0]!;

/** The Retry links for one extension. The accessible name says WHICH
 *  extension, because a failed `spatial` renders one Retry per spatial tool
 *  and three buttons all named "Retry" are indistinguishable to a screen
 *  reader; the visible text stays "Retry". */
const retries = (ext: "spatial" | "three_d") =>
  screen.queryAllByRole("button", {
    name: `Retry loading the ${ext} extension`,
  });

/** The sentence §5 gives a download failure, on the chip, the Retry link and
 *  the row's accessible description. */
const FAILED_REASON =
  "The spatial extension could not be downloaded; check the connection and retry";
/** The same sentence for the other lazy extension. */
const FAILED_REASON_3D =
  "The three_d extension could not be downloaded; check the connection and retry";

/** An OFFLINE browser, as `navigator.onLine` reports it. Restored by the
 *  `restoreAllMocks` in `afterEach`. */
function goOffline(): void {
  vi.spyOn(Navigator.prototype, "onLine", "get").mockReturnValue(false);
}

beforeEach(async () => {
  refuse.clear();
  gate = null;
  openGate = null;
  vi.stubGlobal("Worker", FakeWorker);
  // A fresh copy of the whole graph per case: `duckdb.ts` boots once per
  // module instance, and an extension it loaded in one case would still be
  // loaded in the next.
  vi.resetModules();
  ({ CatalogueView } =
    await import("../../../../src/ui/processing/CatalogueView"));
  duckdb = await import("../../../../src/insights/duckdb");
  ({ useLayerStore } =
    await import("../../../../src/features/layers/layerStore"));
  ({ useWorkspaceStore } =
    await import("../../../../src/features/workspace/workspaceStore"));
  ({ useLayerTableStore } =
    await import("../../../../src/insights/layerTables"));
  ({ useProcessingStore } =
    await import("../../../../src/features/processing/processingStore"));
  ({ useGeoLayerStore } =
    await import("../../../../src/features/geoLayers/geoLayerStore"));
  // Stubbed AFTER the dynamic imports (as `useDuckDBStatus.test.tsx` does, for
  // the same reason): vitest's module runner calls `new URL(...)` while
  // resolving an import, and this object stub is not constructible.
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => "blob:fake",
    revokeObjectURL: () => {},
  });
  useProcessingStore.getState().resetForTest();
  useLayerStore.getState().removeAllLayers();
  useLayerTableStore.setState({ tables: {} });
  useGeoLayerStore.setState({ layers: [] });
  addCityLayer();
});

afterEach(() => {
  cleanup();
  useWorkspaceStore.getState().setActiveLayerId(null);
  vi.unstubAllGlobals();
  // Belt and braces for the `console.warn` spies in the failure cases: an
  // assertion that fails before its own `mockRestore()` would otherwise leave
  // console.warn silenced for every test after it.
  vi.restoreAllMocks();
});

describe("the capability chips (spec §5)", () => {
  it("offers the loading cost while the extension is unloaded", async () => {
    await act(async () => {
      await duckdb.initDuckDB();
    });
    render(<CatalogueView />);
    expect(chip("Spatial")).toHaveAttribute(
      "title",
      "Loads the spatial extension on first run (about 24 MB, once per session)",
    );
    expect(chip("3D")).toHaveAttribute(
      "title",
      "Loads the three_d extension on first run (about 1 MB, once per session)",
    );
  });

  it("mutes BOTH lazy chips when the engine boots OFFLINE (spec §5, scenario 6)", async () => {
    // §5: "When the extension cannot be fetched (THE BOOT-TIME CHECK FAILED, or
    // a load attempt failed) the chip turns muted…". Without that check an
    // offline reload leaves both lazy extensions `unloaded`, which reads as
    // "not fetched YET" and offers the download COST — so the user is told
    // nothing about why the spatial tools will not work, and Retry (which is
    // `failed`-only) is nowhere on the panel.
    goOffline();
    await act(async () => {
      await duckdb.initDuckDB();
    });
    render(<CatalogueView />);

    expect(chip("Spatial")).toHaveAttribute("data-state", "failed");
    expect(chip("Spatial")).toHaveAttribute("title", FAILED_REASON);
    expect(chip("3D")).toHaveAttribute("data-state", "failed");
    expect(chip("3D")).toHaveAttribute("title", FAILED_REASON_3D);
    // One Retry per spatial tool (three) and per 3D tool (two).
    expect(retries("spatial")).toHaveLength(3);
    expect(retries("three_d")).toHaveLength(2);
    // The engine RECORDED a reason of its own, so the status tooltip and the
    // run queue's warning have something true to say about the failure.
    const status = duckdb.getDuckDBStatus();
    expect(status.state === "ready" && status.extensions.spatial).toEqual({
      state: "failed",
      error: FAILED_REASON,
    });
    expect(status.state === "ready" && status.extensions.three_d).toEqual({
      state: "failed",
      error: FAILED_REASON_3D,
    });
    // §5: "Height from extent and Roof metrics need no extension and stay
    // enabled offline." The engine itself is up — only the two downloads are
    // out of reach.
    for (const name of [/Roof metrics to attributes/, /Height from extent/]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute(
        "aria-disabled",
        "false",
      );
    }
  });

  it("recovers an offline boot's extension only when Retry asks", async () => {
    // No `online`-event auto-clear: Retry is the door. The chip stays muted
    // while the network comes back, and `ensureExtension` — not a reboot — is
    // what loads the extension and publishes `loaded`.
    goOffline();
    await act(async () => {
      await duckdb.initDuckDB();
    });
    render(<CatalogueView />);
    expect(retries("spatial")).toHaveLength(3);

    // The network is back. Nothing has asked the engine for anything, so
    // nothing has changed on the panel.
    vi.restoreAllMocks();
    await act(async () => {
      await Promise.resolve();
    });
    expect(chip("Spatial")).toHaveAttribute("data-state", "failed");
    expect(retries("spatial")).toHaveLength(3);

    fireEvent.click(retries("spatial")[0]!);
    await waitFor(() => {
      expect(chip("Spatial")).toHaveAttribute(
        "title",
        "The spatial extension is loaded",
      );
    });
    expect(duckdb.isExtensionLoaded("spatial")).toBe(true);
    expect(retries("spatial")).toHaveLength(0);
    // The OTHER one is untouched: one extension's Retry is not the other's.
    expect(chip("3D")).toHaveAttribute("data-state", "failed");
    expect(retries("three_d")).toHaveLength(2);
  });

  it("says so once the extension is loaded, and does so on a REAL load", async () => {
    await act(async () => {
      await duckdb.initDuckDB();
    });
    render(<CatalogueView />);
    await act(async () => {
      await duckdb.ensureExtension("spatial");
    });
    expect(chip("Spatial")).toHaveAttribute(
      "title",
      "The spatial extension is loaded",
    );
    // The other chip is untouched: one extension's state is not the other's.
    expect(chip("3D")).toHaveAttribute(
      "title",
      "Loads the three_d extension on first run (about 1 MB, once per session)",
    );
    expect(retries("spatial")).toHaveLength(0);
  });

  it("mutes the chip and offers Retry when the REAL load fails", async () => {
    // The refused load is EXPECTED, and `loadExtension` reports it on
    // console.warn. Scoped so the run stays quiet AND the report is asserted
    // rather than merely suppressed.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    refuse.add("spatial");
    await act(async () => {
      await duckdb.initDuckDB();
    });
    render(<CatalogueView />);
    await act(async () => {
      await duckdb.ensureExtension("spatial");
    });
    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).includes('DuckDB extension "spatial" did not load'),
      ),
    ).toBe(true);
    expect(chip("Spatial")).toHaveAttribute("data-state", "failed");
    // §5's sentence lives on the CHIP whatever the row says. Aggregate and
    // Distance are still `implemented: false`, so `eligibility.ts`'s "Not
    // available yet" outranks the extension reason on their rows; Join ships
    // now, so ITS row reaches the download reason once a vector layer is there
    // — the case below.
    expect(chip("Spatial")).toHaveAttribute("title", FAILED_REASON);
    // One per spatial tool: join-by-location, aggregate-per-area,
    // distance-to-nearest.
    expect(retries("spatial")).toHaveLength(3);
    // The 3D chip is untouched, and carries no Retry of its own.
    expect(chip("3D")).toHaveAttribute("data-state", "unloaded");
    expect(retries("three_d")).toHaveLength(0);
    warn.mockRestore();
  });

  it("puts §5's download reason on a SHIPPED spatial tool's own row", async () => {
    // The path that was unreachable while every spatial tool was
    // `implemented: false`: Join ships, the workspace has a city layer and an
    // areas layer, so nothing outranks the extension — and §5's sentence is the
    // row's own reason rather than only the chip's tooltip.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    addZones();
    refuse.add("spatial");
    await act(async () => {
      await duckdb.initDuckDB();
    });
    render(<CatalogueView />);
    await act(async () => {
      await duckdb.ensureExtension("spatial");
    });
    const join = screen.getByRole("button", {
      name: /Join attributes by location/,
    });
    expect(join).toHaveAttribute("title", FAILED_REASON);
    expect(join.textContent).toContain(FAILED_REASON);
    // Aggregate has not shipped, so its row still says the outranking reason.
    const aggregate = screen.getByRole("button", {
      name: /Aggregate buildings per area/,
    });
    expect(aggregate).toHaveAttribute("title", "Not available yet");
    warn.mockRestore();
  });

  it("puts the failure reason where a keyboard can reach it", async () => {
    // A `title` on a non-focusable `<span>` is a mouse-only tooltip: the chip
    // cannot be tabbed to, and the row a keyboard DOES land on says a reason of
    // its own (here "Add a vector layer to join with", with no areas layer in
    // this workspace). So the same sentence is an accessible DESCRIPTION on
    // both focusable elements, and a `title` on the Retry link itself.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    refuse.add("spatial");
    await act(async () => {
      await duckdb.initDuckDB();
    });
    render(<CatalogueView />);
    await act(async () => {
      await duckdb.ensureExtension("spatial");
    });
    const row = screen.getByRole("button", {
      name: /Join attributes by location/,
    });
    expect(row).toHaveAccessibleDescription(FAILED_REASON);
    const retry = retries("spatial")[0]!;
    expect(retry).toHaveAccessibleDescription(FAILED_REASON);
    expect(retry).toHaveAttribute("title", FAILED_REASON);
    // The visible text is still the one word the design calls for.
    expect(retry.textContent).toBe("Retry");
    // Failure-only: a row whose extension is merely unloaded describes nothing,
    // or every disabled row would carry a download sentence that is not true
    // of it.
    const solids = screen.getByRole("button", { name: /Measure solids/ });
    expect(solids).not.toHaveAttribute("aria-describedby");

    // The described element is CLIPPED, never hidden: `display: none` or
    // `aria-hidden` would take the sentence out of the accessibility tree
    // along with the pixels, and `toHaveAccessibleDescription` above would be
    // the only place it existed. It also sits in the wrapper that reveals it on
    // focus (`processing.css`'s `:focus-within` rule — jsdom applies no CSS, so
    // the pixels are the browser smoke's half of this check).
    const described = document.getElementById(
      row.getAttribute("aria-describedby")!,
    );
    expect(described?.textContent).toBe(FAILED_REASON);
    expect(described).not.toHaveAttribute("aria-hidden");
    expect(described).toHaveClass("processing-sr-only");
    expect(described?.closest(".processing-tool-row-wrap")).toBe(
      retry.closest(".processing-tool-row-wrap"),
    );
    warn.mockRestore();
  });

  it("Retry asks the engine to load the extension again, and the chip follows", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    refuse.add("spatial");
    await act(async () => {
      await duckdb.initDuckDB();
    });
    render(<CatalogueView />);
    await act(async () => {
      await duckdb.ensureExtension("spatial");
    });
    expect(retries("spatial")).toHaveLength(3);
    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).includes('DuckDB extension "spatial" did not load'),
      ),
    ).toBe(true);

    // The network comes back, and the user presses Retry. Nothing here fakes a
    // status: the click calls `ensureExtension`, which really loads and really
    // publishes, and the chip re-renders because it is subscribed. The click's
    // promise is un-awaited by design, so the assertion waits for the render
    // rather than counting the chain's microtasks.
    refuse.clear();
    fireEvent.click(retries("spatial")[0]!);
    // Waits for the LOADED tooltip, not for the Retry links to go: those
    // disappear the moment the state leaves "failed", which is the start of
    // the attempt, not its success. Waiting on their absence would let the
    // assertions below race the remaining queries.
    await waitFor(() => {
      expect(chip("Spatial")).toHaveAttribute(
        "title",
        "The spatial extension is loaded",
      );
    });
    expect(duckdb.isExtensionLoaded("spatial")).toBe(true);
    expect(retries("spatial")).toHaveLength(0);
    warn.mockRestore();
  });

  it("shows the loading state while a load is in flight", async () => {
    await act(async () => {
      await duckdb.initDuckDB();
    });
    render(<CatalogueView />);
    // Armed only now, so the boot's own `INSTALL cityjson` ran to completion:
    // from here every query hangs until the test releases it.
    armGate();
    let pending!: Promise<boolean>;
    await act(async () => {
      // Started but NOT awaited: `ensureExtension` publishes `loading`
      // synchronously, before its first await.
      pending = duckdb.ensureExtension("three_d");
    });
    expect(chip("3D")).toHaveAttribute("data-state", "loading");
    expect(chip("3D")).toHaveAttribute(
      "title",
      "Loading the three_d extension…",
    );
    await act(async () => {
      releaseGate();
      await pending;
    });
    expect(chip("3D")).toHaveAttribute(
      "title",
      "The three_d extension is loaded",
    );
  });
});
