/**
 * The active layer's Details section: what this layer IS (source, format,
 * CRS, extent, what is in it) and the per-layer knobs that used to be crammed
 * into the layer row — LoD, appearance, object types, and for a streaming
 * layer the camera-sync freeze and the resident-cache readout.
 *
 * The two LoD controls are NOT interchangeable and this file pins which one
 * appears: a static layer gets its own per-layer dropdown, a streaming layer
 * gets the GLOBAL control (its ladder is discovered cell by cell, so a
 * per-layer dropdown is empty exactly when it is first looked at) — labelled
 * as global, so nobody reads it as this layer's setting.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DetailsSection } from "../../../../src/ui/layers/DetailsSection";
import {
  useLayerStore,
  type Layer,
} from "../../../../src/features/layers/layerStore";
import {
  useGeoLayerStore,
  type GeoLayer,
} from "../../../../src/features/geoLayers/geoLayerStore";
import { useStreamStore } from "../../../../src/features/streaming/streamStore";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";
import type { ActiveLayer } from "../../../../src/features/workspace/activeLayer";
import type {
  CityModel,
  CityObject,
} from "../../../../src/domain/citymodel/types";

afterEach(() => {
  cleanup();
  useLayerStore.setState({ layers: [] });
  useGeoLayerStore.setState({ layers: [] });
  useStreamStore.setState({ streams: {} });
  useWorkspaceStore.setState({ activeLayerId: null });
});

function cityObject(overrides: Partial<CityObject> & { id: string }) {
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

function model(overrides: Partial<CityModel> = {}): CityModel {
  return {
    sourceEncoding: "cityjson",
    metadata: {
      referenceSystem: "https://www.opengis.net/def/crs/EPSG/0/7415",
    },
    bbox: [84616.2, 446548.5, 0, 85084.9, 447017.3, 24.6],
    objects: {},
    vertexCount: 0,
    ...overrides,
  };
}

function cityLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: "L",
    name: "Delft",
    model: model(),
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
    ...overrides,
  } as Layer;
}

function city(overrides: Partial<Layer> = {}): ActiveLayer {
  const layer = cityLayer(overrides);
  useLayerStore.setState({ layers: [layer] });
  useWorkspaceStore.setState({ activeLayerId: layer.id });
  return { kind: "city", layer };
}

/** Seed a stream as `openStreamingLayer` would, with a handle that answers
 *  the one question the resident-cache line asks it. */
function seedStream(
  id: string,
  over: {
    types?: readonly string[];
    featureCount?: number;
    cellCount?: number;
  },
): void {
  useStreamStore.setState((s) => ({
    streams: {
      ...s.streams,
      [id]: {
        handle: {
          getResidentModel: () => ({
            objects: {},
            cellCount: over.cellCount ?? 3,
            featureCount: over.featureCount ?? 1204,
            surfaceAttrKeys: [],
          }),
        },
        status: "idle",
        message: null,
        level: null,
        grid: null,
        ladder: ["2.2"],
        ladderVersion: 1,
        types: over.types ?? [],
        typesVersion: 1,
        appearanceThemes: [],
        version: 1,
        disposers: [],
      } as never,
    },
  }));
}

describe("DetailsSection — what a static city layer is", () => {
  it("reads out source, format, CRS and extent", () => {
    render(<DetailsSection item={city()} />);
    expect(screen.getByText("https://x/a.city.json")).toBeTruthy();
    expect(screen.getByText("CityJSON")).toBeTruthy();
    expect(screen.getByText("EPSG:7415")).toBeTruthy();
    expect(
      screen.getByText("84,616.2, 446,548.5 → 85,084.9, 447,017.3 (EPSG:7415)"),
    ).toBeTruthy();
  });

  it("shortens a long source from the middle, keeping host and file name", () => {
    const url =
      "https://data.3dbag.nl/v20240420/tiles/9/280/560/9-280-560.city.json";
    render(<DetailsSection item={city({ modelRef: { type: "url", url } })} />);
    const shown = screen.getByTitle(url);
    expect(shown.textContent).toContain("…");
    expect(shown.textContent!.startsWith("https://data.3")).toBe(true);
    expect(shown.textContent!.endsWith(".city.json")).toBe(true);
  });

  it("names a local file rather than pretending it has a URL", () => {
    render(
      <DetailsSection
        item={city({ modelRef: { type: "file", fileName: "delft.city.json" } })}
      />,
    );
    expect(screen.getByText("delft.city.json")).toBeTruthy();
  });

  it("counts ROOT objects by type — a BuildingPart is not a second building", () => {
    render(
      <DetailsSection
        item={city({
          model: model({
            objects: {
              b1: cityObject({ id: "b1" }),
              b2: cityObject({ id: "b2" }),
              p1: cityObject({
                id: "p1",
                objectType: "BuildingPart",
                parents: ["b1"],
              }),
              r1: cityObject({ id: "r1", objectType: "Road" }),
            },
          }),
        })}
      />,
    );
    expect(screen.getByText("Building")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("Road")).toBeTruthy();
  });

  it("offers the per-layer LoD dropdown, not the global streaming one", () => {
    render(<DetailsSection item={city({ availableLods: ["1.2", "2.2"] })} />);
    expect(screen.getByTitle("Level of Detail")).toBeTruthy();
    expect(
      screen.queryByLabelText(/applies to every streaming layer/),
    ).toBeNull();
  });

  it("reveals the raw metadata only when asked", () => {
    render(<DetailsSection item={city()} />);
    const disclosure = screen.getByRole("button", { name: "Metadata" });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(disclosure);
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/"referenceSystem"/)).toBeTruthy();
  });
});

describe("DetailsSection — a streaming layer", () => {
  it("labels the LoD control as the global one it is", () => {
    seedStream("L", {});
    render(<DetailsSection item={city({ isStreaming: true })} />);
    expect(
      screen.getByLabelText(
        "Streaming level of detail (applies to every streaming layer)",
      ),
    ).toBeTruthy();
    expect(screen.queryByTitle("Level of Detail")).toBeNull();
  });

  it("reads the resident cache, qualified as the cache and not the view", () => {
    seedStream("L", { featureCount: 1204, cellCount: 7 });
    render(<DetailsSection item={city({ isStreaming: true })} />);
    const line = screen.getByText(/1,?204 features/);
    expect(line.getAttribute("title")).toContain(
      "not exactly what's on screen right now",
    );
  });

  it("freezes and unfreezes the extract through the camera-sync toggle", () => {
    seedStream("L", {});
    render(<DetailsSection item={city({ isStreaming: true })} />);
    const toggle = screen.getByRole("button", { name: /camera sync/i });
    expect(toggle.textContent).toBe("SYNC");
    fireEvent.click(toggle);
    expect(
      useLayerStore.getState().layers.find((l) => l.id === "L")!.cameraSync,
    ).toBe(false);
  });

  it("lists the object types discovered so far, from the stream", () => {
    seedStream("L", { types: ["Building", "Bridge"] });
    render(<DetailsSection item={city({ isStreaming: true })} />);
    expect(screen.getByText("Building, Bridge")).toBeTruthy();
  });
});

describe("DetailsSection — a geospatial layer", () => {
  it("says what it is and where it came from, and claims no CRS", () => {
    const id = useGeoLayerStore.getState().addGeoLayer({
      name: "roads",
      kind: "geojson",
      config: { url: "https://x/roads.geojson" },
    });
    const layer = useGeoLayerStore
      .getState()
      .layers.find((l) => l.id === id) as GeoLayer;
    render(<DetailsSection item={{ kind: "geo", layer }} />);
    expect(screen.getByText("https://x/roads.geojson")).toBeTruthy();
    expect(screen.getByText("GeoJSON")).toBeTruthy();
    expect(screen.queryByText("CRS")).toBeNull();
  });
});
