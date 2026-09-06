/**
 * The Add Layer dialog's geospatial tab.
 *
 * That tab is now the one the dialog OPENS on (2026-08-10 spec), so the first
 * test pins the default and the second pins the `initialTab` prop that lets a
 * caller ask for a different one. The rest is the geospatial tab's contract:
 * a URL is classified by shape but overridable, and a dropped file is
 * validated before it becomes a layer (a CityJSON file being the mistake most
 * worth catching, since this viewer's own format is JSON too).
 */
import { afterEach, describe, expect, it } from "vitest";
import type { AddUrlResult } from "../../../../src/ui/stac/StacBrowser";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { AddLayerDialog } from "../../../../src/ui/layers/AddLayerDialog";
import { LayerPanel } from "../../../../src/ui/layers/LayerPanel";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import { useGeoLayerStore } from "../../../../src/features/geoLayers/geoLayerStore";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";

afterEach(() => {
  cleanup();
  useLayerStore.setState({ layers: [] });
  useWorkspaceStore.setState({ activeLayerId: null });
  useGeoLayerStore.setState({ layers: [] });
});

const noop = () => {};
/** The URL path now reports whether a layer landed; this suite never looks. */
const noopUrl = async () => ({ ok: true }) as const;

function renderPanel(
  onAddUrl: (url: string) => Promise<AddUrlResult> = noopUrl,
) {
  return render(
    <LayerPanel
      onAddFile={noop}
      onAddFiles={noop}
      onAddUrl={onAddUrl}
      loading={false}
    />,
  );
}

function openDialog(): void {
  fireEvent.click(screen.getByRole("button", { name: "+ Add Layer" }));
}

function openGeospatialTab(): void {
  openDialog();
  fireEvent.click(screen.getByRole("tab", { name: /geospatial/i }));
}

const geoLayers = () => useGeoLayerStore.getState().layers;

function geoFile(name: string, body: unknown): File {
  return new File([JSON.stringify(body)], name, { type: "application/json" });
}

describe("AddLayerDialog — tabs", () => {
  it("opens on the geospatial tab", () => {
    renderPanel();
    openDialog();

    expect(screen.getByRole("tab", { name: /geospatial/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("geo-drop-zone")).toBeInTheDocument();
  });

  it("opens on the tab named by initialTab", () => {
    render(
      <AddLayerDialog
        initialTab="city"
        onClose={() => {}}
        onAddFile={() => {}}
        onAddFiles={() => {}}
        onAddUrl={async () => ({ ok: true as const })}
        loading={false}
      />,
    );

    expect(screen.getByRole("tab", { name: /city model/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("switches to the geospatial tab and back", () => {
    renderPanel();
    openGeospatialTab();

    expect(screen.queryByTestId("source-picker-drop-zone")).toBeNull();
    expect(screen.getByLabelText(/source url/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /city model/i }));
    expect(screen.getByTestId("source-picker-drop-zone")).toBeTruthy();
  });
});

describe("AddLayerDialog — a geospatial URL", () => {
  function submitUrl(url: string): void {
    fireEvent.change(screen.getByLabelText(/source url/i), {
      target: { value: url },
    });
    fireEvent.click(screen.getByRole("button", { name: /^add layer$/i }));
  }

  it("classifies an XYZ template and adds a raster layer", () => {
    renderPanel();
    openGeospatialTab();

    submitUrl("https://tile.example/{z}/{x}/{y}.png");

    expect(geoLayers()).toHaveLength(1);
    expect(geoLayers()[0]).toMatchObject({
      kind: "raster-xyz",
      config: { urlTemplate: "https://tile.example/{z}/{x}/{y}.png" },
    });
    // The dialog closes on a successful add, like the city-model tab.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("classifies a tileset.json as 3D Tiles", () => {
    renderPanel();
    openGeospatialTab();

    submitUrl("https://tiles.example/paris/tileset.json");

    expect(geoLayers()[0]).toMatchObject({
      kind: "3d-tiles",
      config: { url: "https://tiles.example/paris/tileset.json" },
    });
  });

  it("shows the detected kind, and honours an explicit override", () => {
    renderPanel();
    openGeospatialTab();

    fireEvent.change(screen.getByLabelText(/source url/i), {
      target: { value: "https://tile.example/{z}/{x}/{y}.png" },
    });
    const select = screen.getByLabelText(/layer type/i) as HTMLSelectElement;
    // Detected, not guessed at render time.
    expect(select.value).toBe("raster-xyz");

    fireEvent.change(select, { target: { value: "geojson" } });
    fireEvent.click(screen.getByRole("button", { name: /^add layer$/i }));

    expect(geoLayers()[0]).toMatchObject({
      kind: "geojson",
      config: { url: "https://tile.example/{z}/{x}/{y}.png" },
    });
  });

  it("refuses a URL that is not one", () => {
    renderPanel();
    openGeospatialTab();

    submitUrl("not a url");

    expect(geoLayers()).toHaveLength(0);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/not a valid url/i)).toBeTruthy();
  });
});

describe("AddLayerDialog — a dropped GeoJSON file", () => {
  function drop(file: File): void {
    fireEvent.drop(screen.getByTestId("geo-drop-zone"), {
      dataTransfer: { files: [file], types: ["Files"], dropEffect: "" },
    });
  }

  it("parses the document and adds it inline", async () => {
    renderPanel();
    openGeospatialTab();

    drop(
      geoFile("parcels.geojson", { type: "FeatureCollection", features: [] }),
    );

    await waitFor(() => expect(geoLayers()).toHaveLength(1));
    expect(geoLayers()[0]).toMatchObject({
      name: "parcels.geojson",
      kind: "geojson",
      config: { data: { type: "FeatureCollection", features: [] } },
    });
  });

  it("REFUSES a CityJSON file and points at the other tab", async () => {
    renderPanel();
    openGeospatialTab();

    drop(
      geoFile("delft.city.json", {
        type: "CityJSON",
        version: "2.0",
        CityObjects: {},
      }),
    );

    await waitFor(() =>
      expect(screen.getByText(/city model tab/i)).toBeTruthy(),
    );
    expect(geoLayers()).toHaveLength(0);
    // Still open: the user has to see why, and the other tab is one click away.
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("refuses a file that is not GeoJSON at all", async () => {
    renderPanel();
    openGeospatialTab();

    drop(new File(["<html>"], "page.json", { type: "application/json" }));

    await waitFor(() =>
      expect(screen.getByText(/not valid JSON/i)).toBeTruthy(),
    );
    expect(geoLayers()).toHaveLength(0);
  });
});
