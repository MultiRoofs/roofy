/**
 * The active layer's Filter section: a SUMMARY of the applied filter, not a
 * second filter builder.
 *
 * The bar that composes a filter lives in the data drawer, where the columns
 * are; this section says what is currently applied, in the same words the bar
 * used to say it (`OP_LABELS`, `valueText`), and offers the two things a
 * summary owes its reader — a way back to the bar, and a way out.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/** The map-filter bridge is the one thing this section reaches outside the
 *  stores, and its real module pulls in DuckDB. Mocked to the single call
 *  "Clear filter" owes the map. */
const clearMapFilter = vi.fn();
vi.mock("../../../../src/features/query/mapFilterSync", () => ({
  clearMapFilter: (layerId: string) => clearMapFilter(layerId),
}));

const { FilterSection } =
  await import("../../../../src/ui/layers/FilterSection");
const { useQueryStore } =
  await import("../../../../src/features/query/queryStore");
const { useShellStore, defaultShellState } =
  await import("../../../../src/ui/shell/shellStore");
const { useGeoLayerStore } =
  await import("../../../../src/features/geoLayers/geoLayerStore");
import type { Layer } from "../../../../src/features/layers/layerStore";
import type { GeoLayer } from "../../../../src/features/geoLayers/geoLayerStore";
import type { ActiveLayer } from "../../../../src/features/workspace/activeLayer";
import type { FilterGroup } from "../../../../src/features/query/types";

afterEach(() => {
  cleanup();
  clearMapFilter.mockClear();
  useQueryStore.setState({ queries: {} });
  useGeoLayerStore.setState({ layers: [] });
  useShellStore.setState(defaultShellState(1440, 900));
});

function city(isStreaming = false): ActiveLayer {
  return {
    kind: "city",
    layer: { id: "L", name: "Delft", isStreaming } as unknown as Layer,
  };
}

function geo(kind: GeoLayer["kind"]): ActiveLayer {
  return {
    kind: "geo",
    layer: { id: "G", name: "basemap", kind } as unknown as GeoLayer,
  };
}

function applyFilter(layerId: string, filter: FilterGroup): void {
  useQueryStore.getState().setFilter(layerId, filter);
  useQueryStore.getState().applyFilter(layerId);
}

const TWO_CONDITIONS: FilterGroup = {
  logic: "AND",
  conditions: [
    { id: "c1", column: "roof_area", op: ">=", value: 120 },
    { id: "c2", column: "type", op: "contains", value: "Building" },
  ],
};

describe("FilterSection — nothing applied", () => {
  it("says a filter reaches both the map and the table", () => {
    render(<FilterSection item={city()} />);
    expect(
      screen.getByText(
        "No filter. Filters apply to the map and the table together.",
      ),
    ).toBeTruthy();
  });

  it("tells a streaming layer the map half is not available yet", () => {
    render(<FilterSection item={city(true)} />);
    expect(
      screen.getByText(
        "No filter. Table only — map filtering for streaming layers is not available yet.",
      ),
    ).toBeTruthy();
  });

  it("offers no buttons: there is nothing to edit or clear", () => {
    render(<FilterSection item={city()} />);
    expect(screen.queryByRole("button", { name: "Clear filter" })).toBeNull();
  });
});

describe("FilterSection — a filter applied", () => {
  it("reads the conditions back in the bar's own vocabulary", () => {
    applyFilter("L", TWO_CONDITIONS);
    render(<FilterSection item={city()} />);
    expect(screen.getByText("roof_area ≥ 120")).toBeTruthy();
    expect(screen.getByText("type contains Building")).toBeTruthy();
    expect(screen.getByText("AND")).toBeTruthy();
  });

  it("shows a nullary operator without inventing a value for it", () => {
    applyFilter("L", {
      logic: "AND",
      conditions: [{ id: "c1", column: "height", op: "isNull", value: "" }],
    });
    render(<FilterSection item={city()} />);
    expect(screen.getByText("height is empty")).toBeTruthy();
  });

  it("sends 'Edit in table' to the drawer, and touches nothing else", () => {
    applyFilter("L", TWO_CONDITIONS);
    // A request aimed at ANOTHER layer, still waiting for that layer's panel
    // to consume it. Clearing requests is `ActiveLayerPanel`'s job, and a
    // blind `requestSection(null)` here would swallow this one.
    useShellStore.setState({
      requestedSection: { layerId: "OTHER", section: "filter" },
    });
    render(<FilterSection item={city()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit in table" }));
    expect(useShellStore.getState().drawerOpen).toBe(true);
    expect(useShellStore.getState().requestedSection).toEqual({
      layerId: "OTHER",
      section: "filter",
    });
  });

  it("clears the query AND the drawn set — a stale id set is worse than none", () => {
    applyFilter("L", TWO_CONDITIONS);
    render(<FilterSection item={city()} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(useQueryStore.getState().queries["L"]!.applied).toBeNull();
    expect(clearMapFilter).toHaveBeenCalledWith("L");
  });
});

describe("FilterSection — record capabilities", () => {
  it("truthfully says a raster has no browsable records", () => {
    render(<FilterSection item={geo("raster-xyz")} />);
    expect(
      screen.getByText("This layer has no browsable records."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit in table" })).toBeNull();
  });

  it("keeps a tileset non-browsable while GeoJSON gets the shared filter", () => {
    render(<FilterSection item={geo("3d-tiles")} />);
    expect(
      screen.getByText("This layer has no browsable records."),
    ).toBeTruthy();
    cleanup();
    render(<FilterSection item={geo("geojson")} />);
    expect(
      screen.getByText(
        "No filter. Filters apply to the map and the table together.",
      ),
    ).toBeTruthy();
  });
});
