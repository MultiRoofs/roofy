import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GeoRecordsPanel } from "../../../../src/ui/table/GeoRecordsPanel";
import { normalizeGeoJsonDocument } from "../../../../src/features/geoLayers/geoJsonRecords";
import { useQueryStore } from "../../../../src/features/query/queryStore";
import { useSelectionStore } from "../../../../src/features/selection/selectionStore";
import { type GeoLayer } from "../../../../src/features/geoLayers/geoLayerStore";
import { DEFAULT_GEO_LAYER_STYLE } from "../../../../src/features/geoLayers/geoLayerStyle";
vi.mock("../../../../src/platform/download", () => ({ downloadBlob: vi.fn() }));
const layer = (
  config: Record<string, unknown>,
): Extract<GeoLayer, { kind: "geojson" }> =>
  ({
    id: "g",
    name: "Roofs",
    kind: "geojson",
    visible: true,
    opacity: 1,
    style: DEFAULT_GEO_LAYER_STYLE,
    config,
  }) as Extract<GeoLayer, { kind: "geojson" }>;
const data = normalizeGeoJsonDocument({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "a",
      properties: { id: "source-a", name: "Alpha" },
      geometry: null,
    },
    {
      type: "Feature",
      id: "b",
      properties: { id: "source-b", name: "Beta" },
      geometry: null,
    },
  ],
}).data;
afterEach(() => {
  useQueryStore.setState({ queries: {} });
  useSelectionStore.getState().clear();
});
describe("GeoRecordsPanel", () => {
  it("keeps source id visible while selecting by stable feature identity", () => {
    render(
      <GeoRecordsPanel
        layer={layer({ preparedData: data, preparation: "ready" })}
      />,
    );
    expect(screen.getByText("source-a")).toBeTruthy();
    fireEvent.click(screen.getByText("source-a"));
    expect(useSelectionStore.getState().geoSelection).toMatchObject({
      stableFeatureId: "id:string:a",
      properties: { id: "source-a" },
    });
  });
  it("shows loading, retry and no-record capability states", () => {
    const { rerender } = render(
      <GeoRecordsPanel layer={layer({ url: "x", preparation: "loading" })} />,
    );
    expect(screen.getByText(/Loading vector records/)).toBeTruthy();
    rerender(
      <GeoRecordsPanel
        layer={layer({
          url: "x",
          preparation: "failed",
          preparationError: "offline",
        })}
      />,
    );
    expect(screen.getByText(/Could not load vector records/)).toBeTruthy();
    rerender(<GeoRecordsPanel layer={layer({ preparation: "ready" })} />);
    expect(screen.getByText(/no records available/)).toBeTruthy();
    rerender(
      <GeoRecordsPanel
        layer={layer({
          preparedData: normalizeGeoJsonDocument({
            type: "Feature",
            properties: {},
            geometry: null,
          }).data,
          preparation: "ready",
        })}
      />,
    );
    expect(screen.getByText(/no attributes to browse/)).toBeTruthy();
  });
});
