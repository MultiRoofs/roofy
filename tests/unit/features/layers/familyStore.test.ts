/**
 * The CityParquet family store: what a streamed package offers, what is open,
 * and the transactional reopen a toggle runs (rulings R-A′, R-D, R-E′).
 *
 * Engine-free, like every other app-side streaming suite: the plugin is faked
 * at the `StreamPlugin` seam (`@navaramap/*` crashes at module scope under
 * Node), and DuckDB is mocked at `familyViews`' exported functions — the one
 * module that may touch duckdb-wasm is `insights/duckdb.ts` and nothing here
 * goes near it.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type {
  FcbHeaderModel,
  FcbStreamLayerHandle,
  Grid,
  OpenStreamOptions,
} from "@cityjson/navara-flatcitybuf";

type EnsureInput = {
  readonly layerId: string;
  readonly family: string;
  readonly source: { readonly url: string } | { readonly file: File };
  readonly sourceCrs: string | null;
};
const ensureFamilyView = vi.fn(
  async (_input: EnsureInput) => ({ ok: true }) as { ok: boolean },
);
const dropFamilyView = vi.fn(async (_layerId: string, _family: string) => {});
const dropFamilyViews = vi.fn(async (_layerId: string) => {});

vi.mock("../../../../src/insights/familyViews", () => ({
  ensureFamilyView: (input: EnsureInput) => ensureFamilyView(input),
  dropFamilyView: (layerId: string, family: string) =>
    dropFamilyView(layerId, family),
  dropFamilyViews: (layerId: string) => dropFamilyViews(layerId),
}));

import {
  buildLayerFamilies,
  ensureActiveFamilyView,
  resetFamilyStoreForTest,
  defaultEnabledKeys,
  familyKeyFromName,
  familyLabel,
  getActiveFamily,
  hasFamilies,
  retryFamilyReopen,
  setFamilyEnabled,
  useFamilyStore,
  type LayerFamily,
} from "../../../../src/features/layers/familyStore";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import {
  adoptLayerTable,
  resetLayerTablesForTest,
} from "../../../../src/insights/layerTables";
import { useStreamStore } from "../../../../src/features/streaming/streamStore";
import type { StreamPlugin } from "../../../../src/features/streaming/streamPlugin";
import type { CityModel } from "../../../../src/domain/citymodel/types";

const HEADER: FcbHeaderModel = {
  version: "1.0",
  featuresCount: 10,
  extent: [0, 0, 0, 10, 10, 5],
  referenceSystem: "https://www.opengis.net/def/crs/EPSG/0/6697",
  epsg: 6697,
};
const GRID: Grid = { originX: 0, originY: 0, rootCell: 1000, maxLevel: 4 };

interface FakeHandle {
  readonly handle: FcbStreamLayerHandle;
  readonly deleted: Mock<() => void>;
}

function fakeHandle(
  tables?: ReadonlyArray<{ name: string; rowCount: number }>,
) {
  const deleted = vi.fn();
  const handle = {
    grid: GRID,
    header: tables === undefined ? HEADER : { ...HEADER, tables },
    level: null,
    version: 0,
    ladder: [],
    typesSeen: [],
    appearanceThemes: [],
    status: "idle",
    message: null,
    onStatus: () => () => {},
    onLadder: () => () => {},
    onTypes: () => () => {},
    onAppearanceThemes: () => () => {},
    onCommit: () => () => {},
    delete: deleted,
  } as unknown as FcbStreamLayerHandle;
  return { handle, deleted } satisfies FakeHandle;
}

interface FakePlugin {
  readonly plugin: StreamPlugin;
  readonly openStream: Mock<(o: OpenStreamOptions) => Promise<unknown>>;
  readonly remove: Mock<(id: string) => void>;
  readonly handles: FakeHandle[];
}

function fakePlugin(
  behaviour: (
    opts: OpenStreamOptions,
    call: number,
  ) => Promise<FcbStreamLayerHandle> | "fail" = () => "fail",
): FakePlugin {
  const handles: FakeHandle[] = [];
  let call = 0;
  const openStream = vi.fn(async (opts: OpenStreamOptions) => {
    const n = call++;
    const answer = behaviour(opts, n);
    if (answer === "fail") {
      const made = fakeHandle();
      handles.push(made);
      return made.handle;
    }
    return await answer;
  });
  const remove = vi.fn();
  return {
    plugin: { openStream, remove } as unknown as StreamPlugin,
    openStream: openStream as FakePlugin["openStream"],
    remove,
    handles,
  };
}

const MODEL: CityModel = {
  sourceEncoding: "cityparquet",
  metadata: { referenceSystem: HEADER.referenceSystem },
  bbox: null,
  objects: {},
  vertexCount: 0,
};

function familiesOf(
  ...entries: ReadonlyArray<{ key: string; href: string }>
): LayerFamily[] {
  return buildLayerFamilies(
    entries.map((e) => ({
      key: e.key,
      href: e.href,
      size: 1024,
      source: { url: `https://data.example/${e.href}` },
    })),
  );
}

function seedLayer(layerId: string, families: ReadonlyArray<LayerFamily>) {
  useLayerStore.setState({ layers: [] });
  useLayerStore.getState().addLayer({
    id: layerId,
    name: "yokohama",
    model: MODEL,
    modelRef: { type: "url", url: "https://data.example/" },
    visible: true,
    rules: [],
    isStreaming: true,
  });
  useFamilyStore.getState().setFamilies(layerId, families);
}

beforeEach(() => {
  resetLayerTablesForTest();
  // The per-layer reopen QUEUES and the farewell generations are module state:
  // a case that left a chain behind would serialise the next one behind it.
  resetFamilyStoreForTest();
  useLayerStore.setState({ layers: [] });
  useStreamStore.setState({ streams: {} });
  ensureFamilyView.mockClear();
  ensureFamilyView.mockResolvedValue({ ok: true });
  dropFamilyView.mockClear();
  dropFamilyViews.mockClear();
});

describe("family keys and labels (R-A′)", () => {
  it("strips the .parquet extension and any directory from a table name", () => {
    expect(familyKeyFromName("building.parquet")).toBe("building");
    expect(familyKeyFromName("./tiles/water_body.parquet")).toBe("water_body");
    expect(familyKeyFromName("bridge")).toBe("bridge");
  });

  it("labels a family with spaces for underscores and title case", () => {
    expect(familyLabel("building")).toBe("Building");
    expect(familyLabel("water_body")).toBe("Water Body");
    expect(familyLabel("city_furniture")).toBe("City Furniture");
  });

  it("keeps two same-key tables apart and disambiguates their labels", () => {
    const families = familiesOf(
      { key: "building", href: "east/building.parquet" },
      { key: "building", href: "west/building.parquet" },
    );
    // Distinct store keys: the table registry is keyed `${layerId}::${family}`,
    // so two families sharing one key would collide on one table.
    expect(families.map((f) => f.key)).toHaveLength(2);
    expect(new Set(families.map((f) => f.key)).size).toBe(2);
    // Both still answer as `building` for the Building default.
    expect(families.every((f) => f.rawKey === "building")).toBe(true);
    // The href is what tells them apart on screen.
    expect(families[0]!.label).toContain("east/building.parquet");
    expect(families[1]!.label).toContain("west/building.parquet");
  });

  it("leaves a unique key's label undisambiguated", () => {
    const families = familiesOf(
      { key: "building", href: "building.parquet" },
      { key: "bridge", href: "bridge.parquet" },
    );
    expect(families.map((f) => f.label)).toEqual(["Building", "Bridge"]);
  });
});

describe("default families (R-D)", () => {
  it("opens Building alone when the package has a building table", () => {
    const families = familiesOf(
      { key: "bridge", href: "bridge.parquet" },
      { key: "building", href: "building.parquet" },
      { key: "vegetation", href: "vegetation.parquet" },
    );
    expect(defaultEnabledKeys(families)).toEqual(["building"]);
  });

  it("opens every family when no table is building", () => {
    const families = familiesOf(
      { key: "bridge", href: "bridge.parquet" },
      { key: "water_body", href: "water_body.parquet" },
    );
    expect(defaultEnabledKeys(families)).toEqual(["bridge", "water_body"]);
  });

  it("reads a single-table source as a one-family package", () => {
    const families = familiesOf({ key: "yokohama", href: "yokohama.parquet" });
    expect(defaultEnabledKeys(families)).toEqual(["yokohama"]);
  });

  it("opens every building table when the key repeats", () => {
    const families = familiesOf(
      { key: "building", href: "east/building.parquet" },
      { key: "building", href: "west/building.parquet" },
      { key: "bridge", href: "bridge.parquet" },
    );
    expect(defaultEnabledKeys(families)).toEqual(
      families.filter((f) => f.rawKey === "building").map((f) => f.key),
    );
  });

  it("finds Building whatever case the key or the file name is in", () => {
    // A writer who spelt the asset key `Building` — or shipped
    // `Building.parquet` with no manifest key — must not silently open the whole
    // package.
    expect(
      defaultEnabledKeys(
        familiesOf(
          { key: "Building", href: "Building.parquet" },
          { key: "Bridge", href: "Bridge.parquet" },
        ),
      ),
    ).toEqual(["Building"]);
    // The LABEL keeps the writer's own casing; only the default's test folds it.
    expect(
      familiesOf({ key: "Building", href: "Building.parquet" })[0]!.label,
    ).toBe("Building");
  });

  it("is what `setFamilies` seeds, with the first enabled family active", () => {
    const families = familiesOf(
      { key: "bridge", href: "bridge.parquet" },
      { key: "building", href: "building.parquet" },
    );
    seedLayer("L1", families);
    const entry = useFamilyStore.getState().layers.L1!;
    expect([...entry.enabled]).toEqual(["building"]);
    expect(entry.active).toBe("building");
    expect(entry.geometry.building).toBe("open");
    expect(entry.geometry.bridge).toBe("closed");
    expect(hasFamilies("L1")).toBe(true);
    expect(getActiveFamily("L1")).toBe("building");
  });

  it("ensures the ACTIVE family's view as the layer opens (ruling S3)", async () => {
    seedLayer("L1", familiesOf({ key: "building", href: "building.parquet" }));
    await vi.waitFor(() => expect(ensureFamilyView).toHaveBeenCalledTimes(1));
    expect(ensureFamilyView.mock.calls[0]?.[0]).toMatchObject({
      layerId: "L1",
      family: "building",
      source: { url: "https://data.example/building.parquet" },
    });
    await vi.waitFor(() =>
      expect(useFamilyStore.getState().layers.L1!.table.building).toBe("ready"),
    );
  });

  it("has no families for a layer nothing registered", () => {
    expect(hasFamilies("nope")).toBe(false);
    expect(getActiveFamily("nope")).toBeNull();
  });
});

describe("the family view's own state is not the authority", () => {
  /** A live family view in the table registry, as `familyViews` adopts one. */
  function adoptView(layerId: string, family: string): void {
    adoptLayerTable(layerId, {
      table: `view_${family}`,
      sourceName: `family_${family}.parquet`,
      source: null,
      reader: null,
      extension: null,
      sourceBytes: null,
      columns: [],
      lods: [],
      sourceFeatureIds: null,
      rowCount: 1,
      fileBacked: true,
      familyKey: family,
      sourceCrs: null,
    });
  }

  it("skips the ensure only while the REGISTRY really holds the view", async () => {
    seedLayer("L1", familiesOf({ key: "building", href: "building.parquet" }));
    await vi.waitFor(() =>
      expect(useFamilyStore.getState().layers.L1!.table.building).toBe("ready"),
    );
    adoptView("L1", "building");
    ensureFamilyView.mockClear();
    // The view exists, so a second ask costs nothing.
    await ensureActiveFamilyView("L1", "building");
    expect(ensureFamilyView).not.toHaveBeenCalled();
  });

  it("rebuilds the view after an engine death condemned it", async () => {
    seedLayer("L1", familiesOf({ key: "building", href: "building.parquet" }));
    await vi.waitFor(() =>
      expect(useFamilyStore.getState().layers.L1!.table.building).toBe("ready"),
    );
    // The death clears the registry and condemns the store entry
    // (`layerTables.invalidateTablesOnEngineDeath`); the family's OWN state still
    // reads `ready`, and gating on that would leave the layer table-less for the
    // session — S3 took the bare resident table that used to cover this away.
    resetLayerTablesForTest();
    ensureFamilyView.mockClear();
    await ensureActiveFamilyView("L1", "building");
    expect(ensureFamilyView).toHaveBeenCalledTimes(1);
    expect(useFamilyStore.getState().layers.L1!.table.building).toBe("ready");
  });
});

describe("row counts from the stream header", () => {
  it("maps the header's tables to the OPENED families by array order", () => {
    const families = familiesOf(
      { key: "building", href: "building.parquet" },
      { key: "bridge", href: "bridge.parquet" },
    );
    seedLayer("L1", families);
    // `tables[i].name` is a LABEL, not an identity: the names here deliberately
    // do not match the family keys, and the pairing is by ORDER.
    useFamilyStore.getState().applyStreamTables(
      "L1",
      ["building", "bridge"],
      [
        { name: "0", rowCount: 884106 },
        { name: "1", rowCount: 42 },
      ],
    );
    const byKey = new Map(
      useFamilyStore.getState().layers.L1!.families.map((f) => [f.key, f]),
    );
    expect(byKey.get("building")!.rowCount).toBe(884106);
    expect(byKey.get("bridge")!.rowCount).toBe(42);
  });

  it("leaves a family with no header entry unknown", () => {
    const families = familiesOf(
      { key: "building", href: "building.parquet" },
      { key: "bridge", href: "bridge.parquet" },
    );
    seedLayer("L1", families);
    useFamilyStore
      .getState()
      .applyStreamTables("L1", ["building"], [{ name: "x", rowCount: 7 }]);
    const byKey = new Map(
      useFamilyStore.getState().layers.L1!.families.map((f) => [f.key, f]),
    );
    expect(byKey.get("building")!.rowCount).toBe(7);
    expect(byKey.get("bridge")!.rowCount).toBeNull();
  });
});

describe("enabling a family reopens the stream (R-E′)", () => {
  it("reopens under the same layer id with BOTH sources", async () => {
    const families = familiesOf(
      { key: "building", href: "building.parquet" },
      { key: "bridge", href: "bridge.parquet" },
    );
    seedLayer("L1", families);
    const first = fakeHandle();
    useStreamStore.getState().register("L1", {
      handle: first.handle,
      disposers: [],
      grid: GRID,
      header: HEADER,
      level: null,
      ladder: [],
      ladderVersion: 0,
      types: [],
      typesVersion: 0,
      appearanceThemes: [],
      status: "idle",
      message: null,
      version: 3,
      generation: 0,
    });
    const layerBefore = useLayerStore.getState().layers[0]!;
    // Two tables now, and their `name`s match no family key: the pairing is by
    // ARRAY ORDER against the families the stream was opened with.
    const second = fakeHandle([
      { name: "0", rowCount: 884106 },
      { name: "1", rowCount: 42 },
    ]);
    const plugin = fakePlugin(async () => second.handle);

    const outcome = await setFamilyEnabled({
      plugin: plugin.plugin,
      layerId: "L1",
      family: "bridge",
      enabled: true,
    });

    expect(outcome.ok).toBe(true);
    expect(plugin.openStream).toHaveBeenCalledTimes(1);
    const opts = plugin.openStream.mock.calls[0]![0];
    expect(opts.id).toBe("L1");
    expect(opts.source).toEqual({
      urls: [
        "https://data.example/building.parquet",
        "https://data.example/bridge.parquet",
      ],
    });
    // The OLD layer went through the plugin, never `handle.delete()` alone:
    // the registry keeps its entry and the next open fails the duplicate-id
    // check.
    expect(plugin.remove).toHaveBeenCalledWith("L1");
    expect(first.deleted).not.toHaveBeenCalled();
    // The replacement is registered, and the viewport can TELL it is a
    // replacement.
    const entry = useStreamStore.getState().streams.L1!;
    expect(entry.handle).toBe(second.handle);
    expect(entry.generation).toBe(1);
    // The layer row is untouched: same id, same object, so rules, hidden types
    // and the camera the user arranged all survive.
    expect(useLayerStore.getState().layers[0]).toBe(layerBefore);
    expect(useLayerStore.getState().layers).toHaveLength(1);
    // Tables are not the reopen's business.
    expect(dropFamilyView).not.toHaveBeenCalled();
    expect(dropFamilyViews).not.toHaveBeenCalled();
    // The newly opened family's size is known from the header the reopen got —
    // without this, a family enabled after the first open would read "? rows"
    // for the rest of the session.
    const counts = new Map(
      useFamilyStore
        .getState()
        .layers.L1!.families.map((f) => [f.key, f.rowCount]),
    );
    expect(counts.get("building")).toBe(884106);
    expect(counts.get("bridge")).toBe(42);
  });

  it("seeds the reopened stream from the layer row, not from defaults", async () => {
    seedLayer(
      "L1",
      familiesOf(
        { key: "building", href: "building.parquet" },
        { key: "bridge", href: "bridge.parquet" },
      ),
    );
    useLayerStore.getState().setHiddenTypes("L1", ["Bridge"]);
    const second = fakeHandle();
    const plugin = fakePlugin(async () => second.handle);
    await setFamilyEnabled({
      plugin: plugin.plugin,
      layerId: "L1",
      family: "bridge",
      enabled: true,
    });
    const opts = plugin.openStream.mock.calls[0]![0];
    expect(opts.hiddenTypes).toEqual(["Bridge"]);
    expect(opts.visible).toBe(true);
    // `undefined` would let the reopen re-pick a texture theme the user turned
    // off; the row's own answer is the one that carries over.
    expect(opts.appearance).toBeNull();
  });

  it("disabling a family reopens with the rest and drops its view", async () => {
    seedLayer(
      "L1",
      familiesOf(
        { key: "building", href: "building.parquet" },
        { key: "bridge", href: "bridge.parquet" },
      ),
    );
    const plugin = fakePlugin(async () => fakeHandle().handle);
    await setFamilyEnabled({
      plugin: plugin.plugin,
      layerId: "L1",
      family: "bridge",
      enabled: true,
    });
    plugin.openStream.mockClear();
    await setFamilyEnabled({
      plugin: plugin.plugin,
      layerId: "L1",
      family: "bridge",
      enabled: false,
    });
    expect(plugin.openStream.mock.calls[0]![0].source).toEqual({
      url: "https://data.example/building.parquet",
    });
    expect([...useFamilyStore.getState().layers.L1!.enabled]).toEqual([
      "building",
    ]);
  });

  it("refuses to close the LAST open family", async () => {
    seedLayer("L1", familiesOf({ key: "building", href: "building.parquet" }));
    const plugin = fakePlugin(async () => fakeHandle().handle);
    const outcome = await setFamilyEnabled({
      plugin: plugin.plugin,
      layerId: "L1",
      family: "building",
      enabled: false,
    });
    expect(outcome.ok).toBe(false);
    expect(plugin.openStream).not.toHaveBeenCalled();
    expect([...useFamilyStore.getState().layers.L1!.enabled]).toEqual([
      "building",
    ]);
  });

  it("rolls the enabled set back and records failed + retry when the open throws", async () => {
    seedLayer(
      "L1",
      familiesOf(
        { key: "building", href: "building.parquet" },
        { key: "bridge", href: "bridge.parquet" },
      ),
    );
    const plugin = fakePlugin(() => {
      throw new Error("the worker could not open west/bridge.parquet");
    });
    const outcome = await setFamilyEnabled({
      plugin: plugin.plugin,
      layerId: "L1",
      family: "bridge",
      enabled: true,
    });
    expect(outcome.ok).toBe(false);
    const entry = useFamilyStore.getState().layers.L1!;
    // The enabled set is back to what is actually open.
    expect([...entry.enabled]).toEqual(["building"]);
    expect(entry.reopen.state).toBe("failed");
    expect(entry.reopen.state === "failed" && entry.reopen.message).toContain(
      "west/bridge.parquet",
    );
    // The layer row survives a failed reopen — there is something to retry.
    expect(useLayerStore.getState().layers).toHaveLength(1);
  });

  it("leaves NOTHING open after a failure, so undoing the toggle still reopens", async () => {
    seedLayer(
      "L1",
      familiesOf(
        { key: "building", href: "building.parquet" },
        { key: "bridge", href: "bridge.parquet" },
      ),
    );
    let fail = true;
    const plugin = fakePlugin(() => {
      if (fail) throw new Error("nope");
      return Promise.resolve(fakeHandle().handle);
    });
    await setFamilyEnabled({
      plugin: plugin.plugin,
      layerId: "L1",
      family: "bridge",
      enabled: true,
    });
    // The stream is GONE, so nothing is open — not "building is still open".
    expect(useStreamStore.getState().streams.L1).toBeUndefined();
    const failed = useFamilyStore.getState().layers.L1!;
    expect(failed.opened).toEqual([]);
    expect(failed.geometry.building).toBe("failed");

    // Toggling the family on and off again must NOT read as "the desired set is
    // already open" and quietly clear the failure — that would leave a layer
    // with no geometry, no `failed` state and no Retry.
    fail = false;
    plugin.openStream.mockClear();
    await setFamilyEnabled({
      plugin: plugin.plugin,
      layerId: "L1",
      family: "bridge",
      enabled: true,
    });
    await setFamilyEnabled({
      plugin: plugin.plugin,
      layerId: "L1",
      family: "bridge",
      enabled: false,
    });
    expect(plugin.openStream).toHaveBeenCalled();
    expect(useStreamStore.getState().streams.L1).toBeDefined();
    expect(useFamilyStore.getState().layers.L1!.opened).toEqual(["building"]);
    expect(useFamilyStore.getState().layers.L1!.reopen.state).toBe("idle");
  });

  it("keeps a Retry alive across TWO consecutive failures", async () => {
    seedLayer(
      "L1",
      familiesOf(
        { key: "building", href: "building.parquet" },
        { key: "bridge", href: "bridge.parquet" },
      ),
    );
    let fail = true;
    const plugin = fakePlugin(() => {
      if (fail) throw new Error("the server blipped");
      return Promise.resolve(fakeHandle().handle);
    });
    await setFamilyEnabled({
      plugin: plugin.plugin,
      layerId: "L1",
      family: "bridge",
      enabled: true,
    });
    // A SECOND failure must not roll back to the empty `opened` the first one
    // left: that would empty the desired set, and the third attempt would find
    // no families to open at all — an inert Retry for the rest of the session.
    const second = await retryFamilyReopen({
      plugin: plugin.plugin,
      layerId: "L1",
    });
    expect(second.ok).toBe(false);
    const failed = useFamilyStore.getState().layers.L1!;
    expect([...failed.enabled]).toEqual(["building"]);
    expect(failed.reopen.state).toBe("failed");
    expect(failed.geometry.building).toBe("failed");

    fail = false;
    const third = await retryFamilyReopen({
      plugin: plugin.plugin,
      layerId: "L1",
    });
    expect(third.ok).toBe(true);
    expect(useFamilyStore.getState().layers.L1!.opened).toEqual(["building"]);
    expect(useFamilyStore.getState().layers.L1!.reopen.state).toBe("idle");
    expect(useStreamStore.getState().streams.L1).toBeDefined();
  });

  it("retries a failed reopen with a HIGHER handle generation", async () => {
    seedLayer(
      "L1",
      familiesOf(
        { key: "building", href: "building.parquet" },
        { key: "bridge", href: "bridge.parquet" },
      ),
    );
    let fail = true;
    const plugin = fakePlugin(() => {
      if (fail) throw new Error("nope");
      return Promise.resolve(fakeHandle().handle);
    });
    await setFamilyEnabled({
      plugin: plugin.plugin,
      layerId: "L1",
      family: "bridge",
      enabled: true,
    });
    expect(useStreamStore.getState().streams.L1).toBeUndefined();
    fail = false;
    const outcome = await retryFamilyReopen({
      plugin: plugin.plugin,
      layerId: "L1",
    });
    expect(outcome.ok).toBe(true);
    // NOT 0: a handle a reopen produced must never earn the sole-layer camera
    // fit, and the generation is how the viewport knows.
    expect(useStreamStore.getState().streams.L1!.generation).toBeGreaterThan(0);
    expect(useFamilyStore.getState().layers.L1!.reopen.state).toBe("idle");
  });

  it("serialises two rapid toggles into ONE open and leaks no worker", async () => {
    seedLayer(
      "L1",
      familiesOf(
        { key: "building", href: "building.parquet" },
        { key: "bridge", href: "bridge.parquet" },
        { key: "vegetation", href: "vegetation.parquet" },
      ),
    );
    const first = fakeHandle();
    useStreamStore.getState().register("L1", {
      handle: first.handle,
      disposers: [],
      grid: GRID,
      header: HEADER,
      level: null,
      ladder: [],
      ladderVersion: 0,
      types: [],
      typesVersion: 0,
      appearanceThemes: [],
      status: "idle",
      message: null,
      version: 0,
      generation: 0,
    });
    const opened: FakeHandle[] = [];
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const plugin = fakePlugin(async (_opts, call) => {
      if (call === 0) await gate;
      const made = fakeHandle();
      opened.push(made);
      return made.handle;
    });

    const a = setFamilyEnabled({
      plugin: plugin.plugin,
      layerId: "L1",
      family: "bridge",
      enabled: true,
    });
    const b = setFamilyEnabled({
      plugin: plugin.plugin,
      layerId: "L1",
      family: "vegetation",
      enabled: true,
    });
    release();
    await Promise.all([a, b]);

    // The queued job reads the LATEST desired set, so one open covers both
    // toggles and the second finds nothing left to do.
    expect(plugin.openStream).toHaveBeenCalledTimes(1);
    expect(plugin.openStream.mock.calls[0]![0].source).toEqual({
      urls: [
        "https://data.example/building.parquet",
        "https://data.example/bridge.parquet",
        "https://data.example/vegetation.parquet",
      ],
    });
    // Exactly one worker is live: the old layer was removed through the plugin
    // once, and every handle the plugin made is either registered or deleted.
    expect(plugin.remove).toHaveBeenCalledTimes(1);
    expect(useStreamStore.getState().streams.L1!.handle).toBe(
      opened[0]!.handle,
    );
    for (const made of opened.slice(1)) {
      expect(made.deleted).toHaveBeenCalled();
    }
  });

  it("disposes a completion for a layer that was removed while it was open", async () => {
    seedLayer(
      "L1",
      familiesOf(
        { key: "building", href: "building.parquet" },
        { key: "bridge", href: "bridge.parquet" },
      ),
    );
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const late = fakeHandle();
    const plugin = fakePlugin(async () => {
      await gate;
      return late.handle;
    });
    const pending = setFamilyEnabled({
      plugin: plugin.plugin,
      layerId: "L1",
      family: "bridge",
      enabled: true,
    });
    // The worker is genuinely booting before the layer goes: a removal that
    // landed BEFORE the open started would simply never open anything, which is
    // not the race this guards.
    await vi.waitFor(() => expect(plugin.openStream).toHaveBeenCalled());
    useFamilyStore.getState().forgetLayer("L1");
    release();
    const outcome = await pending;
    expect(outcome.ok).toBe(false);
    // Nothing registered, and the worker the plugin just started is gone
    // through the plugin (never `handle.delete()` alone): once to tear the old
    // stream down, once to dispose the completion nobody wants.
    expect(useStreamStore.getState().streams.L1).toBeUndefined();
    expect(plugin.remove).toHaveBeenCalledTimes(2);
    expect(plugin.remove).toHaveBeenLastCalledWith("L1");
    expect(late.deleted).not.toHaveBeenCalled();
    expect(useFamilyStore.getState().layers.L1).toBeUndefined();
  });
});
