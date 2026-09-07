/**
 * Direct unit coverage for the temporary geo-feature view (`data-temporary`
 * marks it for removal in Task 12.3). The load-bearing proof that a picked
 * geo feature's properties actually reach the screen through `App` lives in
 * tests/unit/app/appViewerShell.test.tsx ("shows the picked geo feature's
 * layer name and properties") — this file is the component in isolation.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GeoFeatureDetailsTemp } from "../../../../src/ui/inspector/GeoFeatureDetailsTemp";
import { useGeoLayerStore } from "../../../../src/features/geoLayers/geoLayerStore";
import type { GeoFeatureSelection } from "../../../../src/domain/selection/types";

afterEach(() => {
  cleanup();
  useGeoLayerStore.setState({ layers: [] });
});

it("shows the layer's name and the feature's properties", () => {
  const geoLayerId = useGeoLayerStore.getState().addGeoLayer({
    name: "roads",
    kind: "geojson",
    config: { url: "https://x/roads.geojson" },
  });
  const selection: GeoFeatureSelection = {
    geoLayerId,
    batchId: 3,
    properties: { highway: "residential", lanes: 2 },
  };

  render(<GeoFeatureDetailsTemp selection={selection} onClose={() => {}} />);

  expect(screen.getByText("roads")).toBeTruthy();
  expect(screen.getByText("highway")).toBeTruthy();
  expect(screen.getByText("residential")).toBeTruthy();
  expect(screen.getByText("lanes")).toBeTruthy();
  expect(screen.getByText("2")).toBeTruthy();
});

it("falls back to 'Feature' when the layer is gone", () => {
  const selection: GeoFeatureSelection = {
    geoLayerId: "gone",
    batchId: 1,
    properties: { a: "b" },
  };

  render(<GeoFeatureDetailsTemp selection={selection} onClose={() => {}} />);

  expect(screen.getByText("Feature")).toBeTruthy();
});

it("shows an explicit placeholder for a feature with no properties", () => {
  const geoLayerId = useGeoLayerStore.getState().addGeoLayer({
    name: "roads",
    kind: "geojson",
    config: { url: "https://x/roads.geojson" },
  });
  const selection: GeoFeatureSelection = {
    geoLayerId,
    batchId: 1,
    properties: {},
  };

  render(<GeoFeatureDetailsTemp selection={selection} onClose={() => {}} />);

  expect(screen.getByText("No attributes")).toBeTruthy();
});

it("calls onClose from its close button", () => {
  const geoLayerId = useGeoLayerStore.getState().addGeoLayer({
    name: "roads",
    kind: "geojson",
    config: { url: "https://x/roads.geojson" },
  });
  const onClose = vi.fn();
  render(
    <GeoFeatureDetailsTemp
      selection={{ geoLayerId, batchId: 1, properties: {} }}
      onClose={onClose}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Close panel" }));

  expect(onClose).toHaveBeenCalledOnce();
});

describe("GeoFeatureDetailsTemp", () => {
  it("is marked temporary for Task 12.3", () => {
    const geoLayerId = useGeoLayerStore.getState().addGeoLayer({
      name: "roads",
      kind: "geojson",
      config: { url: "https://x/roads.geojson" },
    });
    const { container } = render(
      <GeoFeatureDetailsTemp
        selection={{ geoLayerId, batchId: 1, properties: {} }}
        onClose={() => {}}
      />,
    );

    expect(container.querySelector('[data-temporary="12.3"]')).toBeTruthy();
  });
});
