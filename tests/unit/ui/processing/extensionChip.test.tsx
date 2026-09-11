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

let CatalogueView: CatalogueModule["CatalogueView"];
let duckdb: DuckdbModule;
let useLayerStore: LayerStoreModule["useLayerStore"];
let useWorkspaceStore: WorkspaceModule["useWorkspaceStore"];
let useLayerTableStore: LayerTablesModule["useLayerTableStore"];
let useProcessingStore: ProcessingModule["useProcessingStore"];

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
          rowCount: 2,
        },
      },
    },
  });
  return id;
}

/** The chip for one extension. Both chips carry their label as their text. */
const chip = (label: "Spatial" | "3D") => screen.getAllByText(label)[0]!;

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
  addCityLayer();
});

afterEach(() => {
  cleanup();
  useWorkspaceStore.getState().setActiveLayerId(null);
  vi.unstubAllGlobals();
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
    expect(screen.queryAllByRole("button", { name: "Retry" })).toHaveLength(0);
  });

  it("mutes the chip and offers Retry when the REAL load fails", async () => {
    refuse.add("spatial");
    await act(async () => {
      await duckdb.initDuckDB();
    });
    render(<CatalogueView />);
    await act(async () => {
      await duckdb.ensureExtension("spatial");
    });
    expect(chip("Spatial")).toHaveAttribute("data-state", "failed");
    // §5's sentence lives on the CHIP in M2: all three spatial tools are still
    // `implemented: false`, and `eligibility.ts`'s "Not available yet"
    // outranks the extension reason, so the row's second line reads "Not
    // available yet". The row-level reason becomes reachable when a spatial
    // tool ships (M13.3).
    expect(chip("Spatial")).toHaveAttribute(
      "title",
      "The spatial extension could not be downloaded; check the connection and retry",
    );
    // One per spatial tool: join-by-location, aggregate-per-area,
    // distance-to-nearest.
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(3);
    // The 3D chip is untouched, and carries no Retry of its own.
    expect(chip("3D")).toHaveAttribute("data-state", "unloaded");
  });

  it("Retry asks the engine to load the extension again, and the chip follows", async () => {
    refuse.add("spatial");
    await act(async () => {
      await duckdb.initDuckDB();
    });
    render(<CatalogueView />);
    await act(async () => {
      await duckdb.ensureExtension("spatial");
    });
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(3);

    // The network comes back, and the user presses Retry. Nothing here fakes a
    // status: the click calls `ensureExtension`, which really loads and really
    // publishes, and the chip re-renders because it is subscribed. The click's
    // promise is un-awaited by design, so the assertion waits for the render
    // rather than counting the chain's microtasks.
    refuse.clear();
    fireEvent.click(screen.getAllByRole("button", { name: "Retry" })[0]!);
    await waitFor(() => {
      expect(screen.queryAllByRole("button", { name: "Retry" })).toHaveLength(
        0,
      );
    });
    expect(duckdb.isExtensionLoaded("spatial")).toBe(true);
    expect(chip("Spatial")).toHaveAttribute(
      "title",
      "The spatial extension is loaded",
    );
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
