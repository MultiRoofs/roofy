### Task 3: The capability chips tell the truth, and offer Retry

**Files:**

- Modify: `src/ui/processing/CatalogueView.tsx:27-37, 85-115`, `src/ui/processing/processing.css` (after `:169`)
- Test: `tests/unit/ui/processing/extensionChip.test.tsx`

**Interfaces:**

- Consumes: `useEligibilityContext` (Task 1 moved it onto the subscription); `ensureExtension` from `src/insights/duckdb.ts`; `toolEligibility`'s existing extension reason (`eligibility.ts:73-81`).
- Produces: nothing for later tasks.

**The Retry link is gated on the EXTENSION's state, not on the row's reason.** In M2 every extension tool is still `implemented: false`, so `toolEligibility` returns "Not available yet" and the download sentence never reaches a row (`eligibility.ts:44` outranks `:73-81`). The chip's tooltip is where the user reads it, and the Retry link must appear beside the row regardless — hence `canRetry = tool.extension !== null && extensionState[tool.extension] === "failed"` rather than a string comparison against the reason.

**The HTML problem, stated once.** `ToolRow` today renders the whole row as one `<button>` (`CatalogueView.tsx:94-113`) with the chip and the reason inside it. A Retry `<button>` cannot be nested in a `<button>`. The row is therefore wrapped in a `<div className="processing-tool-row-wrap">` and the Retry button becomes a SIBLING of the row button, after it. The row button keeps its name, description, chip and reason exactly as they are.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ui/processing/extensionChip.test.tsx`. The engine is the SAME package-level fake as Task 1's — the real `duckdb.ts`, the real `useDuckDBStatus`, and states reached by really calling `initDuckDB()` and `ensureExtension()`. Simulating the publisher here would pass while the publisher was broken, which is the whole risk this task is about.

```tsx
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
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { CityModel } from "../../../../src/domain/citymodel/types";
import type { LayerStoreActions } from "../../../../src/features/layers/layerStore";
import type { ColumnInfo } from "../../../../src/insights/columnKind";

const refuse = new Set<string>();

vi.mock("@duckdb/duckdb-wasm", () => {
  class FakeConnection {
    async query(sql: string) {
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

class FakeWorker {
  terminate() {}
}

// `layerTables` is NOT mocked — the catalogue reads its store directly — but
// nothing here builds a table, so its queries never run.
const { CatalogueView } =
  await import("../../../../src/ui/processing/CatalogueView");
const duckdb = await import("../../../../src/insights/duckdb");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useWorkspaceStore } =
  await import("../../../../src/features/workspace/workspaceStore");
const { useLayerTableStore } =
  await import("../../../../src/insights/layerTables");
const { useProcessingStore } =
  await import("../../../../src/features/processing/processingStore");

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
  vi.stubGlobal("Worker", FakeWorker);
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
    // `implemented: false`, and `eligibility.ts:44` outranks the extension
    // reason, so the row's second line reads "Not available yet". The row-level
    // reason becomes reachable when a spatial tool ships (M13.3).
    expect(chip("Spatial")).toHaveAttribute(
      "title",
      "The spatial extension could not be downloaded; check the connection and retry",
    );
    // One per spatial tool: join-by-location, aggregate-per-area,
    // distance-to-nearest (`toolRegistry.ts:62-103`).
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(3);
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
    // publishes, and the chip re-renders because it is subscribed.
    refuse.clear();
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Retry" })[0]!);
      // Let the click's un-awaited `ensureExtension` settle.
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(duckdb.isExtensionLoaded("spatial")).toBe(true);
    expect(screen.queryAllByRole("button", { name: "Retry" })).toHaveLength(0);
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
    let pending!: Promise<boolean>;
    await act(async () => {
      // Started but NOT awaited: `ensureExtension` publishes `loading`
      // synchronously before its first await resolves.
      pending = duckdb.ensureExtension("three_d");
    });
    expect(chip("3D")).toHaveAttribute(
      "title",
      "Loading the three_d extension…",
    );
    await act(async () => {
      await pending;
    });
    expect(chip("3D")).toHaveAttribute(
      "title",
      "The three_d extension is loaded",
    );
  });
});
```

If the "loading" assertion proves racy — `loadExtension`'s first `await connection.query(...)` may resolve within the same microtask drain — replace the fake connection's `query` with one that awaits a deferred the test resolves by hand, the same shape `runQueue.test.ts`'s `gate` uses. Do not weaken the assertion to a store read; the point is that the chip re-rendered.

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run tests/unit/ui/processing/extensionChip.test.tsx
```

Expected: FAIL — the tooltip is the cost sentence in all states, there is no `data-state`, and no Retry button exists.

- [ ] **Step 3: Teach the chip its states**

In `src/ui/processing/CatalogueView.tsx`, replace `CHIP_TITLE` (`:32-37`) with a function over the state:

```tsx
type ExtensionName = "spatial" | "three_d";

const CHIP_COST: Readonly<Record<ExtensionName, string>> = {
  spatial:
    "Loads the spatial extension on first run (about 24 MB, once per session)",
  three_d:
    "Loads the three_d extension on first run (about 1 MB, once per session)",
};

/**
 * Spec §5: "The chip's tooltip says whether the extension is loaded, and if
 * not, what loading costs." The failed tooltip is the same sentence the
 * disabled rows carry, so the chip and the reason cannot disagree.
 */
function chipTitle(
  name: ExtensionName,
  state: "unloaded" | "loading" | "loaded" | "failed",
): string {
  if (state === "loaded") return `The ${name} extension is loaded`;
  if (state === "loading") return `Loading the ${name} extension…`;
  if (state === "failed") {
    return `The ${name} extension could not be downloaded; check the connection and retry`;
  }
  return CHIP_COST[name];
}
```

**[adapted copy]**, decided — the loaded and loading sentences. The failed one is §5's own reason, verbatim. Decision 3.

- [ ] **Step 4: Restructure the row and add Retry**

Replace `ToolRow` (`CatalogueView.tsx:85-115`) with:

```tsx
function ToolRow({
  tool,
  eligibility,
  extensionState,
}: {
  readonly tool: ToolDefinition;
  readonly eligibility: Eligibility;
  readonly extensionState: Readonly<
    Record<"spatial" | "three_d", "unloaded" | "loading" | "loaded" | "failed">
  >;
}) {
  const reason = eligibility.ok ? null : eligibility.reason;
  const ext = tool.extension;
  // §5's Retry belongs to the one reason it can act on. A row disabled for any
  // other reason — no city layer, a failed table — is not a download away from
  // working, and a Retry there would be a button that does nothing visible.
  const canRetry = ext !== null && extensionState[ext] === "failed";
  return (
    // A wrapper, because the Retry link is a BUTTON and the row is a button:
    // nesting them is invalid HTML and browsers un-nest it unpredictably.
    <div className="processing-tool-row-wrap">
      <button
        type="button"
        className="processing-tool-row"
        aria-disabled={reason !== null}
        title={reason ?? undefined}
        onClick={() => openToolView(tool.id)}
      >
        <span className="processing-tool-row__head">
          <span className="processing-tool-row__name">{tool.name}</span>
          {ext !== null && (
            <span
              className="processing-chip"
              data-state={extensionState[ext]}
              title={chipTitle(ext, extensionState[ext])}
            >
              {CHIP_LABEL[ext]}
            </span>
          )}
        </span>
        <span className="processing-tool-row__desc">{tool.description}</span>
        {reason !== null && (
          <span className="processing-tool-row__reason">{reason}</span>
        )}
      </button>
      {canRetry && (
        <button
          type="button"
          className="processing-retry"
          // `ensureExtension`, NOT `retryEngine`: the engine is up, one
          // extension is not. Rebooting DuckDB would rebuild every layer table
          // to fix a download. The result is not awaited — the status publishes
          // `loading` and then `loaded`/`failed`, and the chip follows.
          onClick={() => {
            void ensureExtension(ext);
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}
```

In `CatalogueView` itself, pass the state down: `<ToolRow key={tool.id} tool={tool} eligibility={toolEligibility(tool, ctx)} extensionState={ctx.extensionState} />` (`CatalogueView.tsx:70-74`). Add `import { ensureExtension } from "../../insights/duckdb";` at the top.

- [ ] **Step 5: Style the two new pieces**

Append to `src/ui/processing/processing.css` after the `.processing-chip` block (`:162-169`):

```css
/* One row and, when its extension failed, its Retry link beside it (spec §5).
   The wrapper carries the row's bottom margin so the link does not gain one. */
.processing-tool-row-wrap {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  margin-bottom: 4px;
}
.processing-tool-row-wrap .processing-tool-row {
  margin-bottom: 0;
}
/* A muted chip: still readable, visibly not a capability you have. */
.processing-chip[data-state="failed"] {
  background: var(--control-hover);
  color: var(--fg-muted);
}
.processing-chip[data-state="loading"] {
  opacity: 0.6;
}
/* A link, not a control: the row it sits beside is already a 2-line list item,
   and a 38px filled button next to it would read as the row's primary action. */
.processing-retry {
  flex-shrink: 0;
  align-self: center;
  padding: 2px 8px !important;
  min-height: 0 !important;
  background: transparent !important;
  border: none !important;
  color: var(--accent);
  font-size: 12px;
  text-decoration: underline;
}
.processing-retry:hover {
  background: var(--control-hover) !important;
}
```

- [ ] **Step 6: Run the tests**

```bash
npx vitest run tests/unit/ui/processing
npx tsc -b --noEmit
```

Expected: PASS, including the existing `CatalogueView.test.tsx` (the row button keeps its role, name and reason text).

- [ ] **Step 7: Commit**

```bash
git add src/ui/processing/CatalogueView.tsx src/ui/processing/processing.css \
  tests/unit/ui/processing/extensionChip.test.tsx
git commit -m "feat(processing): the capability chips follow the extension and offer Retry"
```

---
