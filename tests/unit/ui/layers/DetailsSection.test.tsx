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
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../../../src/insights/familyViews", () => ({
  // The family store ensures the ACTIVE family's view (ruling S3); there is no
  // DuckDB in a jsdom suite, so it simply succeeds.
  ensureFamilyView: vi.fn(async () => ({ ok: true }) as const),
  dropFamilyView: vi.fn(async () => {}),
  dropFamilyViews: vi.fn(async () => {}),
}));
vi.mock("../../../../src/features/cityparquet/familySourceCrs", () => ({
  familySourceCrs: vi.fn(async () => "EPSG:6697"),
}));

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
import {
  buildLayerFamilies,
  resetFamilyStoreForTest,
  useFamilyStore,
} from "../../../../src/features/layers/familyStore";
import { useShellStore } from "../../../../src/ui/shell/shellStore";
import { setStreamPlugin } from "../../../../src/features/streaming/streamPlugin";
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
  resetFamilyStoreForTest();
  setStreamPlugin(null);
  useShellStore.setState({ drawerOpen: false });
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
    objectsCount?: number;
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
        header: {
          version: "1",
          featuresCount: undefined,
          ...(over.objectsCount !== undefined
            ? { objectsCount: over.objectsCount }
            : {}),
          extent: undefined,
          referenceSystem: undefined,
          epsg: 28992,
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
    // The part is not a row of its own AND not a second building: it has a
    // parent, so it counts toward nothing.
    expect(screen.queryByText("BuildingPart")).toBeNull();
  });

  it("mounts the object-type toggles and the appearance selector", () => {
    // Both controls decide for THEMSELVES whether they have anything to
    // offer — one group is nothing to choose between, and a model with no
    // appearance has no themes — so the fixture gives each something to show.
    render(
      <DetailsSection
        item={city({
          availableObjectTypes: ["Building", "Road"],
          appearanceThemes: [{ kind: "material", name: "default" }],
        })}
      />,
    );
    expect(screen.getByLabelText("Object types")).toBeTruthy();
    expect(screen.getByLabelText("Appearance")).toBeTruthy();
  });

  it("offers per-layer LoD checkboxes, not the global streaming control", () => {
    render(<DetailsSection item={city({ availableLods: ["1.2", "2.2"] })} />);
    expect(
      screen.getByRole("group", { name: "Levels of detail" }),
    ).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "LoD 1.2" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "LoD 2.2" })).toBeChecked();
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

  it("says how many of the dataset's objects are loaded, and that the table covers only those", () => {
    seedStream("L", {
      featureCount: 12301,
      cellCount: 7,
      objectsCount: 884106,
    });
    render(<DetailsSection item={city({ isStreaming: true })} />);
    const line = screen.getByText(
      "Showing the objects in view — 12,301 of 884,106 loaded. The table and statistics cover loaded objects only.",
    );
    // The cell count and the cache qualification survive in the tooltip.
    expect(line.getAttribute("title")).toContain("7 resident cells");
  });

  it("says how many objects are loaded when the stream does not know its dataset's size", () => {
    seedStream("L", { featureCount: 1204, cellCount: 3 });
    render(<DetailsSection item={city({ isStreaming: true })} />);
    expect(
      screen.getByText(
        "Showing the objects in view — 1,204 loaded. The table and statistics cover loaded objects only.",
      ),
    ).toBeTruthy();
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

/**
 * Ruling R-D/S4's UI: a streamed CityParquet package is a SET of object
 * families, and this block is where the user says which of them to render and
 * which one's table to browse. A family is OPENED; a type is VISIBLE — two
 * different questions, two different blocks, which is why the assertions below
 * check both survive side by side.
 */
describe("DetailsSection — object families", () => {
  function seedFamilies(
    over: {
      readonly enabled?: readonly string[];
      readonly rowCounts?: Readonly<Record<string, number>>;
    } = {},
  ): void {
    const families = buildLayerFamilies([
      {
        key: "building",
        href: "building.parquet",
        size: 4096,
        source: { url: "https://x/building.parquet" },
      },
      {
        key: "bridge",
        href: "bridge.parquet",
        size: 512,
        source: { url: "https://x/bridge.parquet" },
      },
      {
        key: "water_body",
        href: "water_body.parquet",
        size: 256,
        source: { url: "https://x/water_body.parquet" },
      },
    ]).map((family) => ({
      ...family,
      rowCount: over.rowCounts?.[family.key] ?? null,
    }));
    useFamilyStore.getState().setFamilies("L", families, over.enabled);
    // A toggle reopens the stream, so it needs the live plugin; the engine-down
    // case has its own assertion below.
    setStreamPlugin({
      openStream: async () => ({}) as never,
      remove: () => {},
    });
  }

  it("says the table covers the whole family, not only what is in view", () => {
    // The old line — "The table and statistics cover loaded objects only" — is
    // FALSE for a family view: it reads the file, so it answers for rows the
    // camera never delivered. What is partial is the SCENE.
    seedStream("L", {
      featureCount: 12301,
      cellCount: 7,
      objectsCount: 884106,
    });
    seedFamilies({ rowCounts: { building: 884106 } });
    render(<DetailsSection item={city({ isStreaming: true })} />);
    const line = screen.getByText(
      "Showing the objects in view — 12,301 of 884,106 loaded. The table and statistics cover the whole family, whatever is on screen.",
    );
    expect(line.getAttribute("title")).toContain("7 resident cells");
  });

  it("lists every available family with its own state", () => {
    seedFamilies({ rowCounts: { building: 1204 } });
    render(<DetailsSection item={city({ isStreaming: true })} />);
    const group = screen.getByRole("group", { name: "Object families" });
    expect(group.textContent).toContain("Building");
    expect(group.textContent).toContain("Bridge");
    expect(group.textContent).toContain("Water Body");
    // The OPEN family reports the size of its FILE — not what is loaded, which
    // is the note above's reading and the status bar's.
    expect(group.textContent).toContain("Opened · 1,204 objects");
    expect(group.textContent).toContain("Not opened");
  });

  it("says what is opened and what is merely available", () => {
    seedFamilies();
    render(<DetailsSection item={city({ isStreaming: true })} />);
    expect(
      screen.getByText("Building opened · 2 more families available"),
    ).toBeTruthy();
  });

  it("offers a Retry for a family whose reopen failed", () => {
    seedFamilies();
    useFamilyStore.setState((s) => ({
      layers: {
        ...s.layers,
        L: {
          ...s.layers.L!,
          opened: [],
          geometry: { ...s.layers.L!.geometry, building: "failed" },
          reopen: { state: "failed", message: "the server hung up" },
        },
      },
    }));
    render(<DetailsSection item={city({ isStreaming: true })} />);
    const group = screen.getByRole("group", { name: "Object families" });
    expect(group.textContent).toContain("Failed");
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
  });

  it("opens a CLOSED family's table without opening its geometry", () => {
    seedFamilies();
    render(<DetailsSection item={city({ isStreaming: true })} />);
    fireEvent.click(screen.getByRole("button", { name: "Show Bridge table" }));
    // The table panel now shows the bridge family…
    expect(useFamilyStore.getState().layers.L!.active).toBe("bridge");
    expect(useShellStore.getState().drawerOpen).toBe(true);
    // …and nothing about its geometry changed: attributes without rendering.
    expect(useFamilyStore.getState().layers.L!.geometry.bridge).toBe("closed");
    expect([...useFamilyStore.getState().layers.L!.enabled]).toEqual([
      "building",
    ]);
  });

  it("keeps the LAST open family's toggle disabled — a layer must render something", () => {
    seedFamilies();
    render(<DetailsSection item={city({ isStreaming: true })} />);
    const toggle = screen.getByRole("checkbox", {
      name: "Show Building geometry",
    });
    expect((toggle as HTMLInputElement).disabled).toBe(true);
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Show Bridge geometry",
        }) as HTMLInputElement
      ).disabled,
    ).toBe(false);
  });

  it("cannot toggle geometry with no 3D engine, but can still open a table", () => {
    seedFamilies();
    setStreamPlugin(null);
    render(<DetailsSection item={city({ isStreaming: true })} />);
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Show Bridge geometry",
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    // A view over the file needs no engine at all.
    fireEvent.click(screen.getByRole("button", { name: "Show Bridge table" }));
    expect(useFamilyStore.getState().layers.L!.active).toBe("bridge");
  });

  it("keeps object VISIBILITY a separate block from the families", () => {
    seedStream("L", { types: ["Building", "Bridge"] });
    seedFamilies();
    render(<DetailsSection item={city({ isStreaming: true })} />);
    expect(screen.getByRole("group", { name: "Object families" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Object types" })).toBeTruthy();
  });

  it("shows no families block for a layer that has none", () => {
    render(<DetailsSection item={city()} />);
    expect(screen.queryByRole("group", { name: "Object families" })).toBeNull();
  });
});
