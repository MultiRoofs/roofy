/**
 * The redesign's ONE layer list.
 *
 * The incumbent pane splits the workspace into "3D City Models" and
 * "Geospatial Layers", two headings for a question the user never asks
 * ("which store is this in?"). `LayerList` renders every layer in
 * `unifiedLayerOrder` as the same row and lets the STATE LINE say what each
 * one is — which is why the state lines are asserted per kind here rather
 * than left to `layerPresentation`'s own suite: this file pins that the row
 * SOURCES the right input for each kind (a static city's root counts, a
 * stream's resident count and status, a vector's inline feature count).
 *
 * The three rows with no store entry — an unavailable placeholder, an add in
 * flight, an add that failed — are the list's other half: a failure must
 * always leave a visible row, never a silence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { LayerList } from "../../../../src/ui/layers/LayerList";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import type { Layer } from "../../../../src/features/layers/layerStore";
import { useGeoLayerStore } from "../../../../src/features/geoLayers/geoLayerStore";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";
import { useQueryStore } from "../../../../src/features/query/queryStore";
import { useStreamStore } from "../../../../src/features/streaming/streamStore";
import type { StreamState } from "../../../../src/features/streaming/streamStore";
import type {
  CityModel,
  CityObject,
} from "../../../../src/domain/citymodel/types";

/** The one engine call a row makes. Faked so the ORDER of the two halves of a
 *  streaming remove can be observed — the stream is reachable only BY layer
 *  id, so closing it after the store entry has gone would strand the worker
 *  and its cell meshes for the lifetime of the tab. */
const streaming = vi.hoisted(() => ({ closeStreamingLayer: vi.fn() }));
vi.mock("../../../../src/features/streaming/openStreamingLayer", () => ({
  closeStreamingLayer: streaming.closeStreamingLayer,
}));

beforeEach(() => {
  streaming.closeStreamingLayer.mockClear();
  useLayerStore.setState({ layers: [] });
  useGeoLayerStore.setState({ layers: [] });
  useWorkspaceStore.setState({ activeLayerId: null });
  useQueryStore.setState({ queries: {} });
  useStreamStore.setState({ streams: {} });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useLayerStore.setState({ layers: [] });
  useGeoLayerStore.setState({ layers: [] });
  useWorkspaceStore.setState({ activeLayerId: null });
  useQueryStore.setState({ queries: {} });
  useStreamStore.setState({ streams: {} });
});

function cityObject(overrides: Partial<CityObject> = {}): CityObject {
  return {
    objectType: "Building",
    surfaces: [],
    attributes: {},
    children: [],
    parents: [],
    bbox: null,
    lod: null,
    ...overrides,
  } as CityObject;
}

function model(objectCount: number): CityModel {
  const objects: Record<string, CityObject> = {};
  for (let i = 0; i < objectCount; i += 1) objects[`b${i}`] = cityObject();
  return {
    sourceEncoding: "cityjson",
    metadata: {},
    bbox: null,
    objects,
    vertexCount: 0,
  };
}

function layer(
  overrides: Partial<Layer> & { id: string; name: string },
): Layer {
  return {
    model: model(0),
    modelRef: { type: "url", url: "https://x/a.city.json" },
    visible: true,
    rules: [],
    rulesEnabled: true,
    selectedLod: null,
    availableLods: [],
    lodMode: "auto",
    cameraSync: true,
    hiddenTypes: [],
    visibleObjectIds: null,
    availableObjectTypes: [],
    appearanceThemes: [],
    selectedAppearance: null,
    isStreaming: false,
    // REQUIRED on the real record (Task 21). The cast compiles without it,
    // but the row reads `derivedFrom !== null` — an `undefined` here would
    // make every seeded layer look derived and then dereference a null run.
    derivedFrom: null,
    ...overrides,
  } as Layer;
}

function seedCity(...layers: ReadonlyArray<Layer>): void {
  useLayerStore.setState({ layers });
}

/** A stream registered for `layerId`, resident-count and status only — the
 *  two things a streaming row's state line is made of. */
function seedStream(
  layerId: string,
  featureCount: number,
  status: StreamState["status"] = "idle",
  message: string | null = null,
): void {
  useStreamStore.setState({
    streams: {
      [layerId]: {
        handle: {
          getResidentModel: () => ({
            featureCount,
            cellCount: 1,
            objects: {},
          }),
        },
        disposers: [],
        grid: { originX: 0, originY: 0, rootCell: 100, maxLevel: 3 },
        header: {},
        level: null,
        ladder: [],
        ladderVersion: 0,
        types: [],
        typesVersion: 0,
        appearanceThemes: [],
        status,
        message,
        version: 1,
      } as unknown as StreamState,
    },
  });
}

const geoStore = () => useGeoLayerStore.getState();

function renderList(props: Partial<Parameters<typeof LayerList>[0]> = {}): {
  onZoomToLayer: ReturnType<typeof vi.fn>;
  onOpenTable: ReturnType<typeof vi.fn>;
  dismissFailed: ReturnType<typeof vi.fn>;
} {
  const onZoomToLayer = vi.fn();
  const onOpenTable = vi.fn();
  const dismissFailed = vi.fn();
  render(
    <LayerList
      onZoomToLayer={onZoomToLayer}
      onOpenTable={onOpenTable}
      dismissFailed={dismissFailed}
      {...props}
    />,
  );
  return { onZoomToLayer, onOpenTable, dismissFailed };
}

function rowFor(name: string): HTMLElement {
  const row = screen.getByText(name).closest('[role="listitem"]');
  if (!row) throw new Error(`no row for ${name}`);
  return row as HTMLElement;
}

function menuOf(name: string): void {
  const row = rowFor(name);
  const trigger = row.querySelector('[aria-label^="Layer actions"]');
  fireEvent.click(trigger as Element);
}

describe("LayerList — the rows", () => {
  it("is one list, in the unified order: city rows, then geo rows", () => {
    seedCity(layer({ id: "l1", name: "Delft" }));
    geoStore().addGeoLayer({
      name: "OSM",
      kind: "raster-xyz",
      config: { urlTemplate: "https://tile.example/{z}/{x}/{y}.png" },
    });
    renderList();

    expect(screen.getAllByRole("list")).toHaveLength(1);
    const names = screen
      .getAllByRole("listitem")
      .map((row) => row.querySelector(".layer-row-name")?.textContent);
    expect(names).toEqual(["Delft", "OSM"]);
  });

  it("gives a static city row its root-object count and LoD", () => {
    seedCity(
      layer({ id: "l1", name: "Delft", model: model(3), selectedLod: "2.2" }),
    );
    renderList();

    expect(screen.getByText("3 buildings · LoD 2.2")).toBeTruthy();
  });

  it("gives a streaming row its resident count, from the stream store", () => {
    seedCity(layer({ id: "s1", name: "delft.fcb", isStreaming: true }));
    seedStream("s1", 1240);
    renderList();

    expect(screen.getByText("Streaming · 1,240 currently loaded")).toBeTruthy();
  });

  it("copies a stream's own error message into the row's state line", () => {
    seedCity(layer({ id: "s1", name: "delft.fcb", isStreaming: true }));
    seedStream("s1", 0, "error", "the tile server refused the range request");
    renderList();

    expect(
      screen.getByText("Error · the tile server refused the range request"),
    ).toBeTruthy();
  });

  it("counts an inline GeoJSON's features, and names a raster by its kind", () => {
    geoStore().addGeoLayer({
      name: "Roads",
      kind: "geojson",
      config: {
        data: { type: "FeatureCollection", features: [{}, {}, {}, {}, {}, {}] },
      },
    });
    geoStore().addGeoLayer({
      name: "OSM",
      kind: "raster-xyz",
      config: { urlTemplate: "https://tile.example/{z}/{x}/{y}.png" },
    });
    renderList();

    expect(screen.getByText("6 features")).toBeTruthy();
    expect(screen.getByText("Raster")).toBeTruthy();
  });

  it("keeps a GeoJSON row's applied-filter chip visible while inactive", () => {
    const id = geoStore().addGeoLayer({
      name: "Roads",
      kind: "geojson",
      config: { data: { type: "FeatureCollection", features: [{}, {}] } },
    });
    useQueryStore.getState().setFilter(id, {
      logic: "AND",
      conditions: [{ id: "name", column: "name", op: "contains", value: "A" }],
    });
    useQueryStore.getState().applyFilter(id);
    renderList();

    expect(rowFor("Roads").textContent).toContain("1 filter");
  });

  it("says a snapshot-restored geo layer needs its file back", () => {
    geoStore().addGeoLayer({ name: "Roads", kind: "geojson", config: {} });
    renderList();

    expect(screen.getByText("Needs re-link")).toBeTruthy();
  });

  it("re-links a snapshot-restored geo layer from its own row, and becomes live", async () => {
    geoStore().addGeoLayer({ name: "Roads", kind: "geojson", config: {} });
    renderList();

    const file = new File(
      [JSON.stringify({ type: "FeatureCollection", features: [{}] })],
      "roads.geojson",
    );
    fireEvent.change(screen.getByTestId("relink-input"), {
      target: { files: [file] },
    });

    await waitFor(() => expect(screen.getByText("1 feature")).toBeTruthy());
    expect(screen.queryByText("Needs re-link")).toBeNull();
    // The row is a live vector row now: the data it was given is what a real
    // add would have produced, so the geo store holds it.
    expect(geoStore().layers[0]).toMatchObject({
      kind: "geojson",
      config: { data: { type: "FeatureCollection", features: [{}] } },
    });
  });

  it("shows a re-link parse failure inline, and keeps offering Re-link", async () => {
    geoStore().addGeoLayer({ name: "Roads", kind: "geojson", config: {} });
    renderList();

    fireEvent.change(screen.getByTestId("relink-input"), {
      target: { files: [new File(["not json"], "roads.geojson")] },
    });

    await waitFor(() =>
      expect(
        screen.getByText("Error · This file is not valid JSON."),
      ).toBeTruthy(),
    );
    // Still unavailable — a failed re-link must not strand the user without
    // a way to try again.
    expect(screen.getByRole("button", { name: "Re-link Roads" })).toBeTruthy();
  });

  it("removes a snapshot-restored geo layer from its own row", () => {
    const id = geoStore().addGeoLayer({
      name: "Roads",
      kind: "geojson",
      config: {},
    });
    renderList();

    fireEvent.click(screen.getByRole("button", { name: "Remove Roads" }));

    expect(geoStore().layers.find((l) => l.id === id)).toBeUndefined();
  });
});

describe("LayerList — what a row does", () => {
  it("activates the layer it is clicked on", () => {
    seedCity(
      layer({ id: "l1", name: "Delft" }),
      layer({ id: "l2", name: "Rotterdam" }),
    );
    renderList();

    fireEvent.click(screen.getByText("Rotterdam"));
    expect(useWorkspaceStore.getState().activeLayerId).toBe("l2");
  });

  it("marks the active row, whichever store it lives in", () => {
    seedCity(layer({ id: "l1", name: "Delft" }));
    const geoId = geoStore().addGeoLayer({
      name: "OSM",
      kind: "raster-xyz",
      config: { urlTemplate: "https://tile.example/{z}/{x}/{y}.png" },
    });
    useWorkspaceStore.setState({ activeLayerId: geoId });
    renderList();

    expect(rowFor("OSM").getAttribute("aria-current")).toBe("true");
    expect(rowFor("Delft").getAttribute("aria-current")).toBeNull();
  });

  it("toggles a city layer's visibility from the eye", () => {
    seedCity(layer({ id: "l1", name: "Delft" }));
    renderList();

    fireEvent.click(screen.getByRole("button", { name: "Hide Delft" }));
    expect(useLayerStore.getState().layers[0]!.visible).toBe(false);
  });

  it("toggles a geo layer's visibility from the eye", () => {
    geoStore().addGeoLayer({
      name: "OSM",
      kind: "raster-xyz",
      config: { urlTemplate: "https://tile.example/{z}/{x}/{y}.png" },
    });
    renderList();

    fireEvent.click(screen.getByRole("button", { name: "Hide OSM" }));
    expect(useGeoLayerStore.getState().layers[0]!.visible).toBe(false);
  });

  it("renames a city layer in the store", () => {
    seedCity(layer({ id: "l1", name: "Delft" }));
    renderList();

    fireEvent.doubleClick(screen.getByText("Delft"));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Delft LoD 2.2" },
    });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    expect(useLayerStore.getState().layers[0]!.name).toBe("Delft LoD 2.2");
  });

  it("renames a geo layer in the store", () => {
    geoStore().addGeoLayer({
      name: "OSM",
      kind: "raster-xyz",
      config: { urlTemplate: "https://tile.example/{z}/{x}/{y}.png" },
    });
    renderList();

    fireEvent.doubleClick(screen.getByText("OSM"));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Basemap" },
    });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    expect(useGeoLayerStore.getState().layers[0]!.name).toBe("Basemap");
  });

  it("removes a city layer from the menu", () => {
    seedCity(layer({ id: "l1", name: "Delft" }));
    renderList();

    menuOf("Delft");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(useLayerStore.getState().layers).toHaveLength(0);
  });

  it("removes a geo layer from the menu", () => {
    geoStore().addGeoLayer({
      name: "OSM",
      kind: "raster-xyz",
      config: { urlTemplate: "https://tile.example/{z}/{x}/{y}.png" },
    });
    renderList();

    menuOf("OSM");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(useGeoLayerStore.getState().layers).toHaveLength(0);
  });

  it("offers no Zoom for a raster row — an XYZ template names no extent", () => {
    geoStore().addGeoLayer({
      name: "OSM",
      kind: "raster-xyz",
      config: { urlTemplate: "https://tile.example/{z}/{x}/{y}.png" },
    });
    renderList();

    menuOf("OSM");
    // A button that could only ever toast teaches users to ignore the menu.
    expect(screen.queryByRole("button", { name: "Zoom to layer" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
  });

  it("offers no Zoom for a geo layer whose file never came back", () => {
    geoStore().addGeoLayer({ name: "Roads", kind: "geojson", config: {} });
    renderList();

    menuOf("Roads");
    expect(screen.queryByRole("button", { name: "Zoom to layer" })).toBeNull();
  });

  it("closes the stream BEFORE dropping a streaming layer from the store", () => {
    seedCity(layer({ id: "s1", name: "delft.fcb", isStreaming: true }));
    seedStream("s1", 10);
    const removeLayer = vi.spyOn(useLayerStore.getState(), "removeLayer");
    renderList();

    menuOf("delft.fcb");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    // `getStreamPlugin()` is null in a test with no viewport; what matters is
    // that the close happens, with this layer's id, and happens FIRST.
    expect(streaming.closeStreamingLayer).toHaveBeenCalledWith(null, "s1");
    expect(removeLayer).toHaveBeenCalledWith("s1");
    expect(
      streaming.closeStreamingLayer.mock.invocationCallOrder[0]!,
    ).toBeLessThan(removeLayer.mock.invocationCallOrder[0]!);
  });

  it("zooms to the layer the menu belongs to", () => {
    seedCity(layer({ id: "l1", name: "Delft" }));
    const { onZoomToLayer } = renderList();

    menuOf("Delft");
    fireEvent.click(screen.getByRole("button", { name: "Zoom to layer" }));

    expect(onZoomToLayer).toHaveBeenCalledTimes(1);
    expect(onZoomToLayer.mock.calls[0]![0]).toMatchObject({
      kind: "city",
      layer: { id: "l1" },
    });
  });

  it("opens the table for city and GeoJSON rows", () => {
    seedCity(layer({ id: "l1", name: "Delft" }));
    geoStore().addGeoLayer({
      name: "Roads",
      kind: "geojson",
      config: { url: "https://x/roads.geojson" },
    });
    const { onOpenTable } = renderList();

    menuOf("Roads");
    fireEvent.click(screen.getByRole("button", { name: "Open table" }));
    const roadsId = geoStore().layers[0]!.id;
    expect(onOpenTable).toHaveBeenCalledWith(roadsId);
    fireEvent.keyDown(document, { key: "Escape" });

    menuOf("Delft");
    fireEvent.click(screen.getByRole("button", { name: "Open table" }));
    expect(onOpenTable).toHaveBeenLastCalledWith("l1");
  });
});

describe("LayerList — rows with no store entry", () => {
  it("renders an unavailable placeholder from extraRows, and re-links it", () => {
    const onRelink = vi.fn();
    const onDismiss = vi.fn();
    renderList({
      extraRows: [
        {
          id: "u1",
          name: "delft.city.json",
          kind: "unavailable",
          onRelink,
          onDismiss,
        },
      ],
    });

    expect(screen.getByText("Needs re-link")).toBeTruthy();
    const file = new File(["{}"], "delft.city.json");
    fireEvent.change(screen.getByTestId("relink-input"), {
      target: { files: [file] },
    });
    expect(onRelink).toHaveBeenCalledWith(file);
  });

  it("renders an in-flight add as a loading row", () => {
    renderList({ pending: [{ id: "a1", name: "delft.fcb" }] });

    expect(screen.getByText("delft.fcb")).toBeTruthy();
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("renders a failed add as an error row that can be retried or dismissed", () => {
    const retry = vi.fn();
    const dismissFailed = vi.fn();
    renderList({
      failed: [
        { id: "a1", name: "broken.fcb", message: "network down", retry },
      ],
      dismissFailed,
    });

    expect(screen.getByText("Error · network down")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Retry/ }));
    expect(retry).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /^Dismiss/ }));
    expect(dismissFailed).toHaveBeenCalledWith("a1");
  });

  it("an error row is not activatable — it has no layer to activate", () => {
    seedCity(layer({ id: "l1", name: "Delft" }));
    useWorkspaceStore.setState({ activeLayerId: "l1" });
    renderList({
      failed: [
        {
          id: "a1",
          name: "broken.fcb",
          message: "network down",
          retry: vi.fn(),
        },
      ],
    });

    const row = rowFor("broken.fcb");
    expect(row.getAttribute("tabindex")).toBeNull();
    expect(row.getAttribute("aria-current")).toBeNull();
    fireEvent.click(row);
    expect(useWorkspaceStore.getState().activeLayerId).toBe("l1");
  });
});
