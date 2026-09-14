### Task 20: The OUTPUT destination and the Name rule

**Files:**

- Create: `src/features/processing/deriveLayer.ts` — **the NAME RULES ONLY** (Task 21 extends the same file with `DerivedPlan` and the `prepare…` functions; nobody else creates it).
- Modify: `src/features/processing/types.ts` (`ToolDestination`, `ToolDefinition.destinations`), `src/features/processing/toolRegistry.ts` (`destinations: ["layer"]` on all seven), `src/features/processing/processingStore.ts` (`ToolDraft.destination`, `ToolDraft.newLayerName`), `src/ui/processing/ToolView.tsx` (the two radios, the Name field, the scoped replace warning, the request), `src/ui/processing/useToolForm.ts` (`prefilledName`, `newLayerName`, `nameError`, `inherited`, the `runReason` precedence), `src/features/processing/runQueue.ts` (`RunRequest.destination`/`newLayerName` and the head's destination pre-flight).
- Test: `tests/unit/ui/processing/outputDestination.test.tsx`, `tests/unit/features/processing/deriveLayer.test.ts` (the name cases).

**Interfaces:**

- Consumes: `Layer` (`features/layers/layerStore`), `GeoLayer` (`features/geoLayers/geoLayerStore`), `ToolId`, and — for the prefill — `ToolDraft.sourceLayerId`, which **Task 15 added** together with the SOURCE select in TARGET.
- Produces:

  ```ts
  // src/features/processing/types.ts
  export type ToolDestination = "layer" | "new";
  // ToolDefinition gains:
  //   destinations: ReadonlyArray<ToolDestination>   // required on all seven

  // src/features/processing/processingStore.ts — ToolDraft gains:
  //   destination: ToolDestination
  //   newLayerName: string | null

  // src/features/processing/runQueue.ts — RunRequest gains:
  //   destination: ToolDestination
  //   newLayerName: string | null

  // src/features/processing/deriveLayer.ts  (this task CREATES the module)
  /** §6's A2 reason, in ONE place: the form's disabled radio, the form's own
   *  run reason and the queue's head pre-flight all say the same sentence, and
   *  a UI module is not a home the run queue may import from. */
  export const STREAMING_NO_NEW_LAYER: string;
  export function derivedLayerName(
    targetName: string,
    toolId: ToolId,
    sourceName: string | null,
  ): string;
  export function nameTaken(
    name: string,
    layers: ReadonlyArray<Layer>,
    geoLayers: ReadonlyArray<GeoLayer>,
  ): boolean;
  export function disambiguate(
    name: string,
    layers: ReadonlyArray<Layer>,
    geoLayers: ReadonlyArray<GeoLayer>,
  ): { readonly name: string; readonly renamed: boolean };
  ```

  **Why there is a third parameter** (now in the ledger, so this is a reason and not a deviation): a two-parameter `derivedLayerName(targetName, toolId)` CANNOT produce two of §6's seven prefilled names — `"Delft + Zones"` (Join) and `"Delft · nearest Roads"` (Distance) both contain the SOURCE layer's name. `sourceName: string | null` is the smallest honest fix; `null` yields the source-free fallback documented in the module. Every caller — Tasks 20, 21, 22, 23 and both UI call sites — uses the three-parameter form.

- Task 21 ADDS `DerivedPlan` and `prepareDerivedCityLayer` to the same module; Task 22 consumes `disambiguate`; Task 23 adds `prepareDerivedVectorLayer`.

**Intent:** §6's OUTPUT section as the spec draws it: two radios replacing today's single disabled one, a Name field prefilled `<target> · <tool noun>`, uniqueness compared trimmed and case-insensitively across ALL layers of the workspace, an empty or duplicate name flagged inline at Run, and the replace warning scoped to the copy (`2 inherited computed columns will be replaced in the new layer`). Gating the radio on `destinations` is what lets this land before the machinery exists without putting a live radio in front of nothing — the same staging M2 used for `implemented`, and the reason this task is separately rejectable. The streaming disabled reason is **[adapted copy A2]**. A reviewer rejects it for a radio that is reachable before Task 22, for a uniqueness check that misses geo layers, or for a name rule that differs between Run and publication.

**The gating shape, decided once so every later task inherits it.** BOTH radios are always rendered — §6 draws two, and a hidden second destination is an answer the user has to assume, which is exactly the reasoning the current single disabled radio was written with (`ToolView.tsx`'s comment at the `Write to` field). `New layer` is `disabled` when the tool's `destinations` does not include `"new"` (no reason line: nothing is wrong with the user's form, the tool simply has no such destination yet, and Run's own reason is not about this), and `disabled` with **[adapted copy A2]** as its `title` and as a note under the radios when the tool DOES offer it but the chosen target `isStreaming` (Design decision (f)'s third parent kind).

**Disabling the radio is NOT enough, and this is the part a reviewer checks.** The destination lives on the DRAFT, which survives a retarget: choose `New layer` on a static target, then switch the target to a streaming one and the draft still reads `destination: "new"` while the radio it came from is disabled. So the restriction is stated THREE times from one constant — the radio's `disabled` and note, the form's own `runReason` (which is what actually refuses Run), and `execute`'s head pre-flight, which refuses a request built from a stale draft or by hand. The constant lives in `deriveLayer.ts` and not in `ToolView.tsx`, because `runQueue` may not import a UI module and two copies of a sentence are two sentences.

**Two new validation strings, and they are NOT in the spec.** §6 says "an empty or duplicate name is flagged inline at Run" and gives no sentence. The owner accepted both at the plan gate (Decisions recorded, item 5): **[adapted copy A13]** `Name the new layer` and **[adapted copy A14]** `A layer is already called that`, written to §6's own terse pattern (compare `Pick at least one measure`, `Choose the property to copy`). They are now rows in the front matter's adapted-copy table; implement them verbatim.

- [ ] **Step 1: Write the failing test for the name rules**

Create `tests/unit/features/processing/deriveLayer.test.ts`:

```ts
/**
 * §6's derived-layer NAMES: the seven prefills, and the uniqueness rule the
 * form checks at Run and the publication re-checks (§6, "The name is
 * re-checked at publication").
 *
 * Pure — no store, no engine. `nameTaken`/`disambiguate` are typed against
 * `Layer` and `GeoLayer` because that is what their two callers hold, but they
 * read exactly ONE field, so the fixtures below are name-only stand-ins rather
 * than two full literals per case. A test that built real records here would be
 * asserting `addLayer`'s defaults, which is another suite's job.
 */
import { describe, expect, it } from "vitest";
import type { GeoLayer } from "../../../../src/features/geoLayers/geoLayerStore";
import type { Layer } from "../../../../src/features/layers/layerStore";
import {
  derivedLayerName,
  disambiguate,
  nameTaken,
} from "../../../../src/features/processing/deriveLayer";

const city = (name: string): Layer => ({ name }) as unknown as Layer;
const geo = (name: string): GeoLayer => ({ name }) as unknown as GeoLayer;

describe("derivedLayerName", () => {
  it("is spec §6's prefill for each of the seven tools", () => {
    expect(derivedLayerName("Delft", "roof-metrics", null)).toBe(
      "Delft · roof metrics",
    );
    expect(derivedLayerName("Delft", "measure-solids", null)).toBe(
      "Delft · solids",
    );
    expect(derivedLayerName("Delft", "validate-solids", null)).toBe(
      "Delft · validation",
    );
    expect(derivedLayerName("Delft", "height-from-extent", null)).toBe(
      "Delft · extent",
    );
    expect(derivedLayerName("Delft", "join-by-location", "Zones")).toBe(
      "Delft + Zones",
    );
    expect(derivedLayerName("Zones", "aggregate-per-area", "Delft")).toBe(
      "Zones · buildings",
    );
    expect(derivedLayerName("Delft", "distance-to-nearest", "Roads")).toBe(
      "Delft · nearest Roads",
    );
  });

  it("drops the source segment when no source is chosen yet", () => {
    // The form prefills on every render, including before the SOURCE select
    // has an answer. Run is already refused then (Task 11's source reason), so
    // the name only has to be printable and stable — not runnable.
    expect(derivedLayerName("Delft", "join-by-location", null)).toBe("Delft");
    expect(derivedLayerName("Delft", "distance-to-nearest", null)).toBe(
      "Delft · nearest",
    );
  });
});

describe("nameTaken", () => {
  it("compares trimmed and case-insensitively, across BOTH stores", () => {
    const layers = [city("Delft")];
    const geoLayers = [geo("Zones")];
    expect(nameTaken("Delft", layers, geoLayers)).toBe(true);
    expect(nameTaken("  delft ", layers, geoLayers)).toBe(true);
    expect(nameTaken("ZONES", layers, geoLayers)).toBe(true);
    expect(nameTaken("Delft · solids", layers, geoLayers)).toBe(false);
  });

  it("does not call an EMPTY name taken — that is the other error", () => {
    // Two messages, two causes: an empty name is A13, a duplicate is A14, and
    // a blank string matching a blank layer name would report the wrong one.
    expect(nameTaken("", [city("Delft")], [])).toBe(false);
    expect(nameTaken("   ", [city("Delft")], [])).toBe(false);
  });
});

describe("disambiguate", () => {
  it("leaves a free name alone and says it did not rename", () => {
    expect(disambiguate("Delft · solids", [city("Delft")], [])).toEqual({
      name: "Delft · solids",
      renamed: false,
    });
  });

  it("appends ' (2)' and reports the rename (§6, §10.12)", () => {
    expect(
      disambiguate("Delft · solids", [city("Delft · solids")], []),
    ).toEqual({ name: "Delft · solids (2)", renamed: true });
  });

  it("walks past a taken ' (2)' rather than colliding again", () => {
    expect(
      disambiguate(
        "Delft · solids",
        [city("Delft · solids"), city("Delft · solids (2)")],
        [],
      ),
    ).toEqual({ name: "Delft · solids (3)", renamed: true });
  });

  it("counts a GEO layer's name as taken, and trims before appending", () => {
    expect(
      disambiguate("  Zones · buildings  ", [], [geo("Zones · buildings")]),
    ).toEqual({ name: "Zones · buildings (2)", renamed: true });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing/deriveLayer.test.ts
```

Expected: FAIL — `Failed to resolve import ".../src/features/processing/deriveLayer"`; the module does not exist.

- [ ] **Step 3: Create `deriveLayer.ts` with the name rules**

Create `src/features/processing/deriveLayer.ts`:

```ts
/**
 * A derived layer's NAME (spec §6, OUTPUT).
 *
 * The name rules live in their own module — the one Task 21 then extends with
 * the functions that BUILD a derived layer — because three callers need the
 * same answer at three different times and only one of them is a run: the FORM
 * prefills the Name field and validates what the user typed, `submitRun`
 * freezes it (§6.1's frozen parameters include "the destination and new-layer
 * name"), and the PUBLICATION re-checks it, because "a queued run or a rename
 * in between can take it" (§6). A second copy of the comparison rule is how
 * Run and publication come to disagree about what is unique.
 *
 * Everything here is pure: no store, no DuckDB, no React.
 */
import type { GeoLayer } from "../geoLayers/geoLayerStore";
import type { Layer } from "../layers/layerStore";
import type { ToolId } from "./types";

/**
 * Why §6's New-layer destination is refused on a streaming target
 * (**[adapted copy A2]**, Decisions recorded item 1).
 *
 * THREE places say it and all three import this: the radio's `title` and the
 * note under it, the form's `runReason` (a draft that already chose "new"
 * survives a retarget onto a streaming layer, and the disabled radio does not
 * unchoose it), and `execute`'s head pre-flight. `ToolView.tsx` would be the
 * obvious home and is the wrong one — `runQueue.ts` may not import a UI module,
 * and a second copy of a sentence is a second sentence.
 */
export const STREAMING_NO_NEW_LAYER =
  "New layer is not available for a streaming layer: its loaded buildings carry no geometry to copy.";

/**
 * Spec §6's prefilled name for a tool: "<target> · <tool noun>".
 *
 * The seven the spec spells out are "Delft · solids", "Delft · roof metrics",
 * "Delft · validation", "Delft · extent", "Delft + Zones", "Zones · buildings"
 * and "Delft · nearest Roads" — so two of them name the SOURCE layer as well,
 * which is why this takes three arguments and not two. `sourceName` is null
 * whenever the form has no source yet (the select is empty, or the tool has no
 * `sourceKind`); those two names then drop the source segment rather than
 * printing a placeholder, because Run is refused for the missing source anyway
 * and a name the user can read is worth more than one they have to decode.
 *
 * Exhaustive over `ToolId` with no `default`: a tool added without a noun is a
 * compile error here, which is where it should be.
 */
export function derivedLayerName(
  targetName: string,
  toolId: ToolId,
  sourceName: string | null,
): string {
  switch (toolId) {
    case "roof-metrics":
      return `${targetName} · roof metrics`;
    case "measure-solids":
      return `${targetName} · solids`;
    case "validate-solids":
      return `${targetName} · validation`;
    case "height-from-extent":
      return `${targetName} · extent`;
    case "aggregate-per-area":
      // The TARGET is the vector layer here (§7.6's reversed direction), so
      // this reads "Zones · buildings" and not "Delft · …".
      return `${targetName} · buildings`;
    case "join-by-location":
      return sourceName === null ? targetName : `${targetName} + ${sourceName}`;
    case "distance-to-nearest":
      return sourceName === null
        ? `${targetName} · nearest`
        : `${targetName} · nearest ${sourceName}`;
  }
}

/**
 * §6's comparison rule, in one place: "unique among all layers of the
 * workspace, compared trimmed and case-insensitively".
 *
 * An EMPTY name is never "taken", whatever the layer list holds: the form has
 * two different messages for an empty name and a duplicate one, and folding
 * them together would report the wrong cause for a cleared field.
 */
const fold = (name: string): string => name.trim().toLowerCase();

export function nameTaken(
  name: string,
  layers: ReadonlyArray<Layer>,
  geoLayers: ReadonlyArray<GeoLayer>,
): boolean {
  const wanted = fold(name);
  if (wanted === "") return false;
  return (
    layers.some((l) => fold(l.name) === wanted) ||
    geoLayers.some((l) => fold(l.name) === wanted)
  );
}

/**
 * §6's publication rule: "a conflict then gets ' (2)' appended and the result
 * card says so, rather than failing a finished run" (and §10 scenario 12).
 *
 * The suffix counts UP past names that are themselves taken, so publishing
 * twice gives " (2)" and " (3)" rather than two layers called " (2)". The loop
 * has no bound because the candidate set is infinite and the layer list is
 * finite — it cannot run more times than there are layers plus one.
 */
export function disambiguate(
  name: string,
  layers: ReadonlyArray<Layer>,
  geoLayers: ReadonlyArray<GeoLayer>,
): { readonly name: string; readonly renamed: boolean } {
  if (!nameTaken(name, layers, geoLayers)) return { name, renamed: false };
  // Trimmed before the suffix: "Zones · buildings  (2)" would be the one name
  // the user did not ask for.
  const base = name.trim();
  for (let n = 2; ; n += 1) {
    const candidate = `${base} (${n})`;
    if (!nameTaken(candidate, layers, geoLayers)) {
      return { name: candidate, renamed: true };
    }
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing/deriveLayer.test.ts
```

Expected: PASS, 9 cases. `derivedLayerName` returning `name` untrimmed on the no-conflict branch is deliberate: the form already prints what the user typed, and `submitRun` freezes the same string.

- [ ] **Step 5: Write the failing test for the OUTPUT destination**

Create `tests/unit/ui/processing/outputDestination.test.tsx`. The mock block is `ToolView.test.tsx`'s verbatim (same four `vi.mock` calls, same imports) — repeated rather than shared because a fixture module shared between two suites is a third thing to keep in step:

```tsx
/**
 * Spec §6's OUTPUT destination: two radios, the Name field and its two
 * validation messages, the replace warning scoped to the copy, and the
 * `destination` / `newLayerName` the form freezes into the request.
 *
 * The run queue is mocked: what this pins is the REQUEST the form builds and
 * the copy on screen, never the execution (Task 22 owns that).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CityModel } from "../../../../src/domain/citymodel/types";
import type { LayerStoreActions } from "../../../../src/features/layers/layerStore";
import type { ColumnInfo } from "../../../../src/insights/columnKind";

vi.mock("../../../../src/insights/duckdb", () => ({
  formatDuckDBError: (e: unknown) => String(e),
  subscribeDuckDBStatus: vi.fn(() => () => {}),
  getDuckDBStatusVersion: vi.fn(() => 0),
  getEngineGeneration: vi.fn(() => 1),
  onEngineDeath: vi.fn(() => () => {}),
  getDuckDBStatus: vi.fn(() => ({
    state: "ready",
    extensions: {
      cityjson: { state: "loaded" },
      spatial: { state: "unloaded" },
      three_d: { state: "unloaded" },
    },
    loadedExtensions: [],
    platform: "wasm_eh",
  })),
  isExtensionLoaded: vi.fn(() => true),
  ensureExtension: vi.fn(async () => true),
  runQuery: vi.fn(async () => ({ ok: false, message: "no engine" })),
  ddl: vi.fn(async () => ({ ok: false, message: "no engine" })),
  registerBuffer: vi.fn(async () => false),
  dropBuffer: vi.fn(async () => {}),
  readFile: vi.fn(async () => null),
  queryDuckDB: vi.fn(async () => null),
  queryParquetBuffer: vi.fn(async () => null),
  initDuckDB: vi.fn(async () => {}),
}));

vi.mock("../../../../src/features/processing/runQueue", () => ({
  submitRun: vi.fn(() => "run_1"),
  retryRun: vi.fn(() => "run_2"),
  cancelRun: vi.fn(),
  undoRun: vi.fn(async () => {}),
}));

const counts = {
  all: 2 as number | null,
  matching: null as number | null,
  selected: 0 as number | null,
  loading: false,
  message: null as string | null,
};
vi.mock("../../../../src/ui/table/useLayerCounts", () => ({
  useLayerCounts: () => counts,
}));

const { ToolView } = await import("../../../../src/ui/processing/ToolView");
const { submitRun } =
  await import("../../../../src/features/processing/runQueue");
const { useProcessingStore } =
  await import("../../../../src/features/processing/processingStore");
const { useLayerStore } =
  await import("../../../../src/features/layers/layerStore");
const { useGeoLayerStore } =
  await import("../../../../src/features/geoLayers/geoLayerStore");
const { useWorkspaceStore } =
  await import("../../../../src/features/workspace/workspaceStore");
const { useLayerTableStore } =
  await import("../../../../src/insights/layerTables");
const { useComputedColumnStore } =
  await import("../../../../src/insights/computedColumns");
const { useQueryStore } =
  await import("../../../../src/features/query/queryStore");
const { TOOLS } =
  await import("../../../../src/features/processing/toolRegistry");

type LayerInput = Parameters<LayerStoreActions["addLayer"]>[0];

function column(name: string): ColumnInfo {
  return { name, type: "DOUBLE", kind: "scalar" };
}

function addCityLayer(
  name = "Delft",
  columns: ReadonlyArray<ColumnInfo> = [],
  isStreaming = false,
): string {
  const model = {
    sourceEncoding: "cityjson",
    metadata: { referenceSystem: undefined },
    bbox: null,
    objects: {},
    vertexCount: 0,
  } as unknown as CityModel;
  const input: LayerInput = {
    name,
    model,
    modelRef: { type: "url", url: "https://x/delft.city.json" },
    visible: true,
    rules: [],
    colorBy: "surface",
    isStreaming,
  };
  const id = useLayerStore.getState().addLayer(input);
  useWorkspaceStore.getState().setActiveLayerId(id);
  useLayerTableStore.setState({
    tables: {
      ...useLayerTableStore.getState().tables,
      [id]: {
        state: "ready",
        info: {
          table: "layer_1",
          sourceName: null,
          source: null,
          reader: null,
          columns,
          lods: [],
          rowCount: 2,
        },
      },
    },
  });
  return id;
}

const newLayerRadio = () =>
  screen.getByRole("radio", { name: "New layer" }) as HTMLInputElement;
const thisLayerRadio = () =>
  screen.getByRole("radio", { name: /^This layer/ }) as HTMLInputElement;

/**
 * Give ONE tool the `"new"` destination for the length of one case.
 *
 * This task deliberately ships `destinations: ["layer"]` on all seven entries —
 * the alternative, shipping `"new"` early so a test can click the radio, is
 * exactly the "radio reachable before Task 22" a reviewer must reject. So the
 * cases that exercise the Name field override the registry entry for their own
 * duration and put it back. `vi.spyOn(tool, "destinations", "get")` cannot be
 * used: `destinations` is a data property on an object literal, not an
 * accessor. Tasks 22 and 23 delete this helper with the last `["layer"]`.
 */
function withNewLayer(toolId: string, body: () => void): void {
  const tool = TOOLS.find((t) => t.id === toolId);
  if (!tool) throw new Error(`no tool ${toolId}`);
  const before = tool.destinations;
  const set = (value: ReadonlyArray<string>) =>
    Object.defineProperty(tool, "destinations", {
      value,
      configurable: true,
      writable: true,
    });
  set(["layer", "new"]);
  try {
    body();
  } finally {
    set(before);
  }
}

beforeEach(() => {
  counts.all = 2;
  counts.matching = null;
  counts.selected = 0;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useProcessingStore.getState().resetForTest();
  useLayerStore.getState().removeAllLayers();
  useGeoLayerStore.getState().removeAllGeoLayers();
  useWorkspaceStore.getState().setActiveLayerId(null);
  useLayerTableStore.setState({ tables: {} });
  useComputedColumnStore.setState({ byLayer: {} });
  useQueryStore.setState({ queries: {} });
});

describe("OUTPUT destination", () => {
  it("offers BOTH of §6's radios, with This layer checked", () => {
    addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    expect(thisLayerRadio().checked).toBe(true);
    expect(newLayerRadio().checked).toBe(false);
  });

  it("disables New layer for a tool whose destinations do not include it", () => {
    // The staging gate: every entry is `["layer"]` until Tasks 22 and 23 flip
    // them, so the radio is visible (§6 draws two) and unreachable.
    addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    expect(newLayerRadio().disabled).toBe(true);
    expect(screen.queryByText("Name")).toBeNull();
  });

  it("shows the Name field prefilled once New layer is chosen", () => {
    withNewLayer("height-from-extent", () => {
      addCityLayer();
      render(<ToolView toolId="height-from-extent" />);
      fireEvent.click(newLayerRadio());
      const name = screen.getByLabelText("Name") as HTMLInputElement;
      expect(name.value).toBe("Delft · extent");
    });
  });

  it("flags an EMPTY name inline at Run and refuses to run", () => {
    withNewLayer("height-from-extent", () => {
      addCityLayer();
      render(<ToolView toolId="height-from-extent" />);
      fireEvent.click(newLayerRadio());
      fireEvent.change(screen.getByLabelText("Name"), {
        target: { value: "   " },
      });
      expect(screen.getByRole("alert").textContent).toBe("Name the new layer");
      expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    });
  });

  it("flags a name an existing layer already has, GEO layers included", () => {
    withNewLayer("height-from-extent", () => {
      addCityLayer();
      useGeoLayerStore.getState().addGeoLayer({
        kind: "geojson",
        name: "Zones",
        config: { data: { type: "FeatureCollection", features: [] } },
      });
      render(<ToolView toolId="height-from-extent" />);
      fireEvent.click(newLayerRadio());
      fireEvent.change(screen.getByLabelText("Name"), {
        target: { value: " zones " },
      });
      expect(screen.getByRole("alert").textContent).toBe(
        "A layer is already called that",
      );
      expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    });
  });

  it("scopes the replace warning to the COPY when writing to a new layer", () => {
    withNewLayer("height-from-extent", () => {
      const id = addCityLayer("Delft", [
        column("id"),
        column("extent_height_m"),
        column("extent_zmin_m"),
      ]);
      // Both existing columns are INHERITED computed ones; a source column of
      // the same name is still the prefix error, unchanged.
      for (const name of ["extent_height_m", "extent_zmin_m"]) {
        useComputedColumnStore.getState().setProvenance(id, name, {
          runId: "run_0",
          toolName: "Height from extent",
          summary: "All 2 buildings",
          at: Date.now(),
          partial: null,
          previous: null,
        });
      }
      render(<ToolView toolId="height-from-extent" />);
      fireEvent.click(newLayerRadio());
      expect(
        screen.getByText(
          "2 inherited computed columns will be replaced in the new layer",
        ),
      ).toBeTruthy();
      expect(
        screen.queryByText(/of these columns exist; they will be replaced/),
      ).toBeNull();
    });
  });

  it("freezes the destination and the name into the request", () => {
    withNewLayer("height-from-extent", () => {
      addCityLayer();
      render(<ToolView toolId="height-from-extent" />);
      fireEvent.click(newLayerRadio());
      fireEvent.submit(screen.getByRole("button", { name: "Run" }));
      expect(vi.mocked(submitRun).mock.calls[0]?.[0]).toMatchObject({
        destination: "new",
        newLayerName: "Delft · extent",
      });
    });
  });

  it("sends destination 'layer' and a null name by default", () => {
    addCityLayer();
    render(<ToolView toolId="height-from-extent" />);
    fireEvent.submit(screen.getByRole("button", { name: "Run" }));
    expect(vi.mocked(submitRun).mock.calls[0]?.[0]).toMatchObject({
      destination: "layer",
      newLayerName: null,
    });
  });

  it("refuses New layer on a STREAMING target, with A2's reason", () => {
    withNewLayer("height-from-extent", () => {
      addCityLayer("Delft", [], true);
      render(<ToolView toolId="height-from-extent" />);
      expect(newLayerRadio().disabled).toBe(true);
      expect(
        screen.getByText(
          "New layer is not available for a streaming layer: its loaded buildings carry no geometry to copy.",
        ),
      ).toBeTruthy();
    });
  });

  it("REFUSES RUN when a chosen New layer is retargeted to a streaming layer", () => {
    // The draft outlives the radio. Disabling the control says nothing about
    // the `destination: "new"` already on the draft, and without this the form
    // would offer Run for a destination it has just declared impossible.
    withNewLayer("height-from-extent", () => {
      const stat = addCityLayer("Delft", []);
      render(<ToolView toolId="height-from-extent" />);
      fireEvent.click(newLayerRadio());
      expect(screen.getByRole("button", { name: "Run" })).toBeEnabled();

      const streaming = addCityLayer("Delft stream", [], true);
      expect(stat).not.toBe(streaming);
      fireEvent.change(screen.getByLabelText("Layer"), {
        target: { value: streaming },
      });

      expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
      expect(
        screen.getByText(
          "New layer is not available for a streaming layer: its loaded buildings carry no geometry to copy.",
        ),
      ).toBeTruthy();
    });
  });
});
```

(`Layer` is TARGET's existing select — `aria-label="Layer"`, `ToolView.tsx:125`;
Task 15 adds `Source layer` beside it and leaves this one's label alone.
`addCityLayer` returns the id it added, and the second call leaves the first
layer in the store, so the retarget is a real change of target rather than a
re-render of the same one.)

- [ ] **Step 6: Run it and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/ui/processing/outputDestination.test.tsx
```

Expected: FAIL — the first case already fails with `Unable to find an accessible element with the role "radio" and name "New layer"`, and `tool.destinations` is `undefined` in the helper.

- [ ] **Step 7: Add `ToolDestination` and `destinations` to the tool definition**

In `src/features/processing/types.ts`, add the type beside `ToolExtension`:

```ts
export type ToolExtension = "spatial" | "three_d";

/**
 * Spec §6's OUTPUT destination: "This layer" adds columns to the target,
 * "New layer" creates a derived layer and leaves the target untouched.
 */
export type ToolDestination = "layer" | "new";
```

and the field on `ToolDefinition`, immediately after its last required field. Quote to find the site (it is the end of the interface, and no earlier M3 task touches it):

```ts
  /** False until a later milestone ships the executor. */
  readonly implemented: boolean;
```

Insert ABOVE that line:

```ts
  /**
   * Which of §6's two "Write to" destinations this tool offers, in display
   * order. Always contains `"layer"`.
   *
   * The second radio is RENDERED whatever this says — §6 draws two, and a
   * hidden destination is one the user has to assume — and disabled when
   * `"new"` is absent. It is the same staging `implemented` gives an executor:
   * the form can land before the machinery, without a live control in front of
   * nothing.
   */
  readonly destinations: ReadonlyArray<ToolDestination>;
```

- [ ] **Step 8: Give all seven registry entries `destinations: ["layer"]`**

In `src/features/processing/toolRegistry.ts`, add the line to each of the seven literals, beside its `implemented`. All seven are `["layer"]` in this task; Task 22 adds `"new"` to the six city-target implemented tools and Task 23 to `aggregate-per-area`. For example:

```ts
    defaultPrefix: "roof_",
    outputColumns: (prefix, params) =>
      roofColumnNames(prefix, roofParams(params)),
```

becomes (the `destinations` line added, everything else untouched):

```ts
    defaultPrefix: "roof_",
    destinations: ["layer"],
    outputColumns: (prefix, params) =>
      roofColumnNames(prefix, roofParams(params)),
```

Do the same for `measure-solids`, `validate-solids`, `height-from-extent`, `join-by-location`, `aggregate-per-area` and `distance-to-nearest` — the line goes directly under each entry's `defaultPrefix`. `npx tsc -b --noEmit` is the check that none was missed: `destinations` is required.

- [ ] **Step 9: Put the destination and the name on the draft**

In `src/features/processing/processingStore.ts`, extend `ToolDraft`:

```ts
/** The form's draft (spec §6: kept per tool for the session). */
export interface ToolDraft {
  readonly targetLayerId: string | null;
  readonly scope: Scope;
  readonly lod: string | null;
  readonly prefix: string;
  readonly params: Readonly<Record<string, unknown>>;
}
```

becomes — `sourceLayerId` is already there from Task 15, so add only the last two fields:

```ts
/** The form's draft (spec §6: kept per tool for the session). */
export interface ToolDraft {
  readonly targetLayerId: string | null;
  readonly sourceLayerId: string | null;
  readonly scope: Scope;
  readonly lod: string | null;
  readonly prefix: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly destination: ToolDestination;
  /**
   * What the user typed in §6's Name field, or null for "whatever the tool
   * would prefill".
   *
   * Null rather than the prefilled string, so a draft kept while the user
   * changes the TARGET follows the new target's name instead of freezing the
   * old one's — the same reason `lod` is dropped on a retarget.
   */
  readonly newLayerName: string | null;
}
```

and widen the import at the top of the file:

```ts
import type { RunRecord, Scope, ToolId } from "./types";
```

to

```ts
import type { RunRecord, Scope, ToolDestination, ToolId } from "./types";
```

- [ ] **Step 10: Resolve the prefill, the name error and the inherited columns in `useToolForm`**

In `src/ui/processing/useToolForm.ts`:

1. Import the store and the name rules. Beside the existing layer-store import:

```ts
import { useLayerStore } from "../../features/layers/layerStore";
```

add

```ts
import { useGeoLayerStore } from "../../features/geoLayers/geoLayerStore";
import {
  derivedLayerName,
  nameTaken,
  STREAMING_NO_NEW_LAYER,
} from "../../features/processing/deriveLayer";
```

2. **[adapted copy A13, A14]**, as two constants beside `PREFIX_RE`:

```ts
/** §6: "an empty or duplicate name is flagged inline at Run". The spec gives
 *  no sentence for either; both are [adapted copy], written to §6's own terse
 *  pattern and approved at the plan gate. */
const NAME_EMPTY = "Name the new layer";
const NAME_TAKEN = "A layer is already called that";
```

3. Subscribe to the geo layers, beside the city ones:

```ts
const layers = useLayerStore((s) => s.layers);
```

gains a line under it:

```ts
const geoLayers = useGeoLayerStore((s) => s.layers);
```

4. The default draft gets the two new fields. `base`'s `stored === undefined` branch:

```ts
      ? {
          targetLayerId: defaultTarget,
          scope: "all",
          lod: null,
          prefix: tool.defaultPrefix,
          params: {},
        }
```

becomes (keeping whatever Task 15 added for `sourceLayerId`):

```ts
      ? {
          targetLayerId: defaultTarget,
          sourceLayerId: null,
          scope: "all",
          lod: null,
          prefix: tool.defaultPrefix,
          params: {},
          destination: "layer",
          newLayerName: null,
        }
```

5. After `const paramsError = tool.validateParams?.(draft.params) ?? null;`, add the name block:

```ts
// §6's prefill, "<target> · <tool noun>". Two of the seven names contain the
// SOURCE layer's name, so it is looked up from whichever store holds it —
// `sourceKind` decides which, but the id is unique across both, so one
// lookup with a fallback is enough and cannot pick the wrong layer.
const sourceName =
  draft.sourceLayerId === null
    ? null
    : (layers.find((l) => l.id === draft.sourceLayerId)?.name ??
      geoLayers.find((l) => l.id === draft.sourceLayerId)?.name ??
      null);
const prefilledName =
  target === null ? "" : derivedLayerName(target.name, toolId, sourceName);
const newLayerName = draft.newLayerName ?? prefilledName;
// Only for the destination it is about: a name left invalid under "This
// layer" must not disable Run for a run that creates no layer at all.
const nameError =
  draft.destination !== "new"
    ? null
    : newLayerName.trim() === ""
      ? NAME_EMPTY
      : nameTaken(newLayerName, layers, geoLayers)
        ? NAME_TAKEN
        : null;
// §6.2's A2 case, as a REFUSAL and not only a disabled radio: the draft
// keeps `destination: "new"` across a retarget, so a form that only greyed
// the control would still offer Run for a destination it has just declared
// impossible. Same constant as the radio's title and the head's pre-flight.
const newLayerBlocked =
  tool.destinations.includes("new") && target?.isStreaming === true;
const destinationReason =
  draft.destination === "new" && newLayerBlocked
    ? STREAMING_NO_NEW_LAYER
    : null;
// §6: the replace warning is SCOPED TO THE COPY for a New-layer run — "2
// inherited computed columns will be replaced in the new layer". The
// non-computed collisions are already the prefix error (`sourceCollisions`),
// so what is left of `existing` is exactly the inherited computed columns.
const inherited = existing.filter((c) => computedLower.has(c.toLowerCase()));
```

6. The `runReason` chain gains OUTPUT's two reasons, after the parameters and before the scope — the order the user reads the form's own sections in for everything OUTPUT owns. `destinationReason` comes first of the two: when the destination itself is impossible, what the user typed in Name is not the thing to complain about.

```ts
const runReason = !eligibility.ok
  ? eligibility.reason
  : (lods.emptyReason ?? prefixError ?? paramsError ?? scopeReason);
```

becomes

```ts
const runReason = !eligibility.ok
  ? eligibility.reason
  : (lods.emptyReason ??
    prefixError ??
    paramsError ??
    destinationReason ??
    nameError ??
    scopeReason);
```

7. The returned object gains four entries, beside `existing`:

```ts
    columns,
    existing,
```

becomes

```ts
    columns,
    existing,
    inherited,
    newLayerName,
    nameError,
    // §6's A2 case: the tool offers the destination, this target cannot take
    // it (Design decision (f) — a streaming parent has no geometry to copy).
    // Computed in step 5 above, because `runReason` needs it too.
    newLayerBlocked,
    destinationReason,
```

- [ ] **Step 11: Render §6's two radios, the Name field and the scoped warning**

In `src/ui/processing/ToolView.tsx`:

1. Import **[adapted copy A2]** — it is declared in `deriveLayer.ts` (step 3), because the head's pre-flight says the same sentence and `runQueue.ts` may not import a UI module:

```ts
import { STREAMING_NO_NEW_LAYER } from "../../features/processing/deriveLayer";
```

2. The whole `Write to` field is replaced. Find it by this code:

```tsx
<div className="processing-field">
  <span>Write to</span>
  <div className="processing-radios" role="radiogroup" aria-label="Write to">
    <label>
      {/* `readOnly` beside `checked`: the radio can never change (it is
                  the only destination), and React asks for one or the other. */}
      <input type="radio" name="writeTo" checked readOnly disabled />
      This layer{f.target === null ? "" : ` (${f.target.name})`}
    </label>
  </div>
</div>
```

and replace it with:

```tsx
<div className="processing-field">
  <span>Write to</span>
  <div className="processing-radios" role="radiogroup" aria-label="Write to">
    <label>
      <input
        type="radio"
        name="writeTo"
        checked={f.draft.destination === "layer"}
        onChange={() => f.setDraft({ destination: "layer" })}
      />
      This layer{f.target === null ? "" : ` (${f.target.name})`}
    </label>
    {/* Rendered whatever the tool offers — §6 draws two destinations,
                and one the user cannot see is one they have to assume — and
                disabled when the tool has no such destination yet. No reason
                line for that case: nothing is wrong with the form. */}
    <label title={f.newLayerBlocked ? STREAMING_NO_NEW_LAYER : undefined}>
      <input
        type="radio"
        name="writeTo"
        disabled={!f.tool.destinations.includes("new") || f.newLayerBlocked}
        checked={f.draft.destination === "new"}
        onChange={() => f.setDraft({ destination: "new" })}
      />
      New layer
    </label>
  </div>
  {f.newLayerBlocked && (
    <p className="processing-note">{STREAMING_NO_NEW_LAYER}</p>
  )}
</div>;
{
  f.draft.destination === "new" && (
    <>
      <label className="processing-field">
        <span>Name</span>
        <input
          type="text"
          aria-label="Name"
          value={f.newLayerName}
          onChange={(e) => f.setDraft({ newLayerName: e.target.value })}
          aria-invalid={f.nameError !== null}
        />
      </label>
      {f.nameError !== null && (
        <p className="processing-error" role="alert">
          {f.nameError}
        </p>
      )}
    </>
  );
}
```

3. The replace warning becomes the destination's own. Find:

```tsx
{
  f.existing.length > 0 && f.prefixError === null && (
    <p className="processing-warning">
      <span aria-hidden="true">⚠ </span>
      <span>
        {f.existing.length} of these columns exist; they will be replaced.
      </span>
    </p>
  );
}
```

and replace with:

```tsx
{
  /* §6: for This layer the warning lists what is on the TARGET; for New
            layer it is scoped to the copy, and only the INHERITED computed
            columns are replaceable — a collision with a source attribute is
            still the prefix error above. */
}
{
  f.draft.destination === "new"
    ? f.inherited.length > 0 &&
      f.prefixError === null && (
        <p className="processing-warning">
          <span aria-hidden="true">⚠ </span>
          <span>
            {plural(
              f.inherited.length,
              "inherited computed column",
              "inherited computed columns",
            )}{" "}
            will be replaced in the new layer
          </span>
        </p>
      )
    : f.existing.length > 0 &&
      f.prefixError === null && (
        <p className="processing-warning">
          <span aria-hidden="true">⚠ </span>
          <span>
            {f.existing.length} of these columns exist; they will be replaced.
          </span>
        </p>
      );
}
```

4. The request carries both fields. Find:

```tsx
      prefix: f.draft.prefix,
```

inside `submitRun({ … })` and add under it:

```tsx
      destination: f.draft.destination,
      // NULL for "This layer", never the prefill: the frozen request is the
      // reproducible record (§6.4), and a name on a run that created no layer
      // would read as one that did.
      newLayerName: f.draft.destination === "new" ? f.newLayerName : null,
```

5. Suppress the echoed OUTPUT reasons under Run, beside the two that are already suppressed — the rule being that a reason already shown against the field it is about is not repeated under the button. The name error is printed by the Name field's own `role="alert"`; the destination reason is printed by the note under the radios, so it would otherwise appear TWICE on screen for a retargeted draft. Find:

```tsx
const footerReason =
  f.runReason !== null &&
  (f.runReason === f.prefixError || f.runReason === f.paramsError)
    ? null
    : f.runReason;
```

and replace with:

```tsx
const footerReason =
  f.runReason !== null &&
  (f.runReason === f.prefixError ||
    f.runReason === f.paramsError ||
    f.runReason === f.nameError ||
    f.runReason === f.destinationReason)
    ? null
    : f.runReason;
```

- [ ] **Step 12: Freeze the destination in the request, and refuse an unbuilt one at the head**

In `src/features/processing/runQueue.ts`:

1. `RunRequest` gains the two fields. After Task 11 it reads as the ledger spells it; add:

```ts
  readonly destination: ToolDestination;
  /** §6's Name field, frozen; null for `destination === "layer"`. */
  readonly newLayerName: string | null;
```

and widen the type import (`ToolDestination` from `./types`), plus `STREAMING_NO_NEW_LAYER` from `./deriveLayer`.

2. The head's own re-validation, in TWO guards. §6.1's "a queued run re-validates these" is the reason both exist: a destination can be unreachable from the form and still arrive in a request — from a draft frozen before a retarget, from `retryRun` replaying a frozen request, or from a caller that builds one by hand.

The first guard goes at the TOP of the pre-flight block, directly under Task 11's tool lookup and its source refusal. Find (Task 11 moved this lookup to the top of the block and deleted the later one):

```ts
const tool = toolById(request.toolId);
// §5's own reason, at the head: a vector-target tool with no source has no
```

and insert BETWEEN those two lines:

```ts
// A destination the tool does not offer has not shipped yet, which is the
// same fact an unimplemented tool reports and so reads with the same
// sentence. It is checked before anything is resolved, because it depends
// on nothing but the request.
if (request.destination === "new" && !tool.destinations.includes("new")) {
  patch(id, {
    status: "failed",
    error: "Not available yet",
    elapsedMs: elapsed(),
  });
  return;
}
```

The second guard needs the TARGET, so it goes directly after Task 11's `target` resolution. Find:

```ts
// A CITY source IS the compute layer — `submitRun` made it so — and a
// VECTOR source is built in the "source" phase (Task 13).
```

and insert ABOVE that comment:

```ts
// §6's A2 refusal, the head's copy of it. The form disables the radio, but
// the DRAFT keeps `destination: "new"` across a retarget onto a streaming
// layer, and `retryRun` replays a request frozen before one. Only a CITY
// destination can be streaming: a vector copy is a GeoJSON document, and
// `target.kind === "vector"` means the parent is the vector layer.
if (
  request.destination === "new" &&
  target.kind === "city" &&
  target.layer.isStreaming
) {
  patch(id, {
    status: "failed",
    error: STREAMING_NO_NEW_LAYER,
    elapsedMs: elapsed(),
  });
  return;
}
```

3. One case for each guard, in `tests/unit/features/processing/runQueue.test.ts` (its `layer()` fixture already takes overrides, and `request()` is a `submitRun` input — `snapshot` and `tableName` are `submitRun`'s own work, so neither case adds a field):

```ts
/** Give ONE registry entry the `"new"` destination for the length of one
 *  case — `destinations` is a data property on an object literal, so
 *  `vi.spyOn(tool, "destinations", "get")` cannot be used. The same trick
 *  `outputDestination.test.tsx` uses, copied rather than shared: a fixture
 *  module between two suites is a third thing to keep in step. */
function withNewLayer(
  toolId: string,
  value: ReadonlyArray<string>,
): () => void {
  const tool = TOOLS.find((t) => t.id === toolId);
  if (!tool) throw new Error(`no tool ${toolId}`);
  const before = tool.destinations;
  const set = (next: ReadonlyArray<string>) =>
    Object.defineProperty(tool, "destinations", {
      value: next,
      configurable: true,
      writable: true,
    });
  set(value);
  return () => set(before);
}

it("refuses a New-layer request for a tool that does not offer it", async () => {
  const id = submitRun(request({ destination: "new", newLayerName: "X" }));
  await vi.waitFor(() => expect(runById(id)?.status).toBe("failed"));
  expect(runById(id)?.error).toBe("Not available yet");
});

it("refuses a New-layer request on a STREAMING target, with A2's reason", async () => {
  // The form's radio is disabled for this case, so the request can only
  // arrive from a draft frozen before a retarget (or from `retryRun`
  // replaying one) — which is exactly what this guard is for.
  const restore = withNewLayer("height-from-extent", ["layer", "new"]);
  try {
    useLayerStore.setState({ layers: [{ ...layer(), isStreaming: true }] });
    const id = submitRun(request({ destination: "new", newLayerName: "X" }));
    await vi.waitFor(() => expect(runById(id)?.status).toBe("failed"));
    expect(runById(id)?.error).toBe(
      "New layer is not available for a streaming layer: its loaded buildings carry no geometry to copy.",
    );
  } finally {
    restore();
  }
});
```

with `TOOLS` added to the suite's imports from `src/features/processing/toolRegistry`. The FIRST case is deleted by Task 22, which gives the six city tools `"new"` for real; the second survives it and drops the helper along with the `["layer"]` it was working around.

- [ ] **Step 13: Run the two new suites and the ones this touches**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing/deriveLayer.test.ts \
  tests/unit/ui/processing/outputDestination.test.tsx \
  tests/unit/ui/processing/ToolView.test.tsx \
  tests/unit/ui/processing/useToolForm.test.tsx \
  tests/unit/features/processing/runQueue.test.ts
```

Expected: PASS. `ToolView.test.tsx` and `runQueue.test.ts` need `destination: "layer", newLayerName: null` added to their `request()` / `submitRun` fixtures — `tsc` names every site. Then:

```bash
npx tsc -b --noEmit
npx vp check
```

Expected: clean, and the warning count still 56.

- [ ] **Step 14: Commit**

```bash
git add src/features/processing/deriveLayer.ts \
  src/features/processing/types.ts \
  src/features/processing/toolRegistry.ts \
  src/features/processing/processingStore.ts \
  src/features/processing/runQueue.ts \
  src/ui/processing/ToolView.tsx \
  src/ui/processing/useToolForm.ts \
  tests/unit/features/processing/deriveLayer.test.ts \
  tests/unit/ui/processing/outputDestination.test.tsx \
  tests/unit/ui/processing/ToolView.test.tsx \
  tests/unit/features/processing/runQueue.test.ts
git commit -m "feat: the OUTPUT section offers a destination and names the new layer"
```
