/**
 * §7.6: a vector layer's computed properties "show in the vector layer's
 * records panel with the computed badge and provenance".
 *
 * The badge reads the REGISTRY, never a name pattern: a source document may
 * carry a `bld_buildings_n` of its own and it has to keep reading as the file's.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { GeoRecordsPanel } from "../../../../src/ui/table/GeoRecordsPanel";
import {
  useGeoLayerStore,
  type GeoJsonLayer,
} from "../../../../src/features/geoLayers/geoLayerStore";
import { useComputedColumnStore } from "../../../../src/insights/computedColumns";
import { useQueryStore } from "../../../../src/features/query/queryStore";

function addZones(): string {
  return useGeoLayerStore.getState().addGeoLayer({
    name: "Zones",
    kind: "geojson",
    config: {
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            id: "z1",
            properties: { zone: "A", bld_buildings_n: 3 },
            geometry: null,
          },
        ],
      },
    },
  });
}

/** Two areas, and the run's column MERGED onto them through the store — which
 *  is how a computed property actually reaches this panel (§7.6). */
function addMergedZones(): string {
  const id = useGeoLayerStore.getState().addGeoLayer({
    name: "Zones",
    kind: "geojson",
    config: {
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            id: "z1",
            properties: { zone: "A" },
            geometry: null,
          },
          {
            type: "Feature",
            id: "z2",
            properties: { zone: "B" },
            geometry: null,
          },
        ],
      },
    },
  });
  useGeoLayerStore.getState().mergeGeoFeatureProperties(
    id,
    new Map([
      ["id:string:z1", { bld_buildings_n: 7 }],
      ["id:string:z2", { bld_buildings_n: 3 }],
    ]),
  );
  useComputedColumnStore.getState().setProvenance(id, "bld_buildings_n", {
    runId: "run_1",
    toolName: "Aggregate buildings per area",
    summary: "All 10 buildings",
    at: Date.parse("2026-09-12T14:02:00"),
    partial: null,
    previous: null,
  });
  return id;
}

/** The data rows' cells, in the order the grid shows them. */
function columnCells(column: number): ReadonlyArray<string> {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[column]?.textContent ?? "");
}

/** The layer, NARROWED once — the panel takes the GeoJSON arm. */
function zonesLayer(id: string): GeoJsonLayer {
  const layer = useGeoLayerStore.getState().layers.find((l) => l.id === id);
  if (layer === undefined || layer.kind !== "geojson") {
    throw new Error(`no GeoJSON layer ${id}`);
  }
  return layer;
}

beforeEach(() => {
  useGeoLayerStore.setState({ layers: [] });
  useComputedColumnStore.setState({ byLayer: {} });
  useQueryStore.setState({ queries: {} });
});

afterEach(() => {
  // This project's setup file does not install RTL's auto-cleanup, so without
  // this the previous test's grid is still in the body and a query for "every
  // row" spans two tables.
  cleanup();
  useQueryStore.setState({ queries: {} });
});

describe("the geo records grid", () => {
  it("badges a column the registry knows, and not the file's own", () => {
    const id = addZones();
    useComputedColumnStore.getState().setProvenance(id, "bld_buildings_n", {
      runId: "run_1",
      toolName: "Aggregate buildings per area",
      summary: "All 3 buildings",
      at: Date.parse("2026-09-12T14:02:00"),
      partial: null,
      previous: null,
    });
    render(<GeoRecordsPanel layer={zonesLayer(id)} />);
    expect(screen.getAllByTitle(/Aggregate buildings per area/)).toHaveLength(
      1,
    );
  });

  it("shows a merged run's VALUES, and sorts and filters by that column", () => {
    const id = addMergedZones();
    render(<GeoRecordsPanel layer={zonesLayer(id)} />);
    // The column is in the grid because it is in the DOCUMENT, and its values
    // are the run's — the panel reads `preparedData` like every other reader.
    const computedIndex = screen
      .getAllByRole("columnheader")
      .findIndex((th) => th.textContent?.includes("bld_buildings_n"));
    expect(computedIndex).toBeGreaterThanOrEqual(0);
    expect(columnCells(computedIndex)).toEqual(["7", "3"]);

    // SORTING: the computed column behaves like any other attribute.
    fireEvent.click(
      screen.getByRole("button", { name: /Sort bld_buildings_n ascending/ }),
    );
    expect(columnCells(computedIndex)).toEqual(["3", "7"]);

    // FILTERING: a condition over the computed column narrows the rows.
    act(() => {
      useQueryStore.getState().setFilter(id, {
        logic: "AND",
        conditions: [
          { id: "c1", column: "bld_buildings_n", op: ">", value: 5 },
        ],
      });
      useQueryStore.getState().applyFilter(id);
    });
    expect(columnCells(computedIndex)).toEqual(["7"]);
  });

  it("badges nothing when the registry has nothing for this layer", () => {
    const id = addZones();
    render(<GeoRecordsPanel layer={zonesLayer(id)} />);
    expect(screen.queryByTitle(/Aggregate/)).not.toBeInTheDocument();
  });
});
