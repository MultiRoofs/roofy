/**
 * §7.6: a vector layer's computed properties "show in the vector layer's
 * records panel with the computed badge and provenance".
 *
 * The badge reads the REGISTRY, never a name pattern: a source document may
 * carry a `bld_buildings_n` of its own and it has to keep reading as the file's.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GeoRecordsPanel } from "../../../../src/ui/table/GeoRecordsPanel";
import {
  useGeoLayerStore,
  type GeoJsonLayer,
} from "../../../../src/features/geoLayers/geoLayerStore";
import { useComputedColumnStore } from "../../../../src/insights/computedColumns";

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

  it("badges nothing when the registry has nothing for this layer", () => {
    const id = addZones();
    render(<GeoRecordsPanel layer={zonesLayer(id)} />);
    expect(screen.queryByTitle(/Aggregate/)).not.toBeInTheDocument();
  });
});
