/**
 * The Add Layer dialog: WHERE the source is, then WHAT it is.
 *
 * The dialog used to ask the user to pick a family first — "City model" or
 * "Geospatial" — and then guessed the format silently inside it. Its tabs are
 * now the three PLACES a source can come from (File, URL, Catalog), and the
 * format is detected, shown, and correctable before anything is loaded.
 *
 * What is pinned here:
 *  - the detection line and its correction select, on both the File and the
 *    URL tab, and that a pick alone adds NOTHING (the user confirms);
 *  - that the correction reaches the caller as the `override` argument of
 *    `onAddFile` / `onAddFiles` / `onAddUrl` — the loader's encoding override;
 *  - that a geospatial result never goes near the city loader: the dialog
 *    writes it to `geoLayerStore` itself and activates it;
 *  - the modal chrome that was here before (Escape, backdrop, focus).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { AddUrlResult } from "../../../../src/ui/stac/StacBrowser";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const CATALOG_URL = "https://catalog.test/tile.city.json";

/** The catalog browser pulls in MapLibre and the STAC store; neither belongs
 *  in a test about the dialog that HOSTS it, and jsdom cannot run the first.
 *  A one-button stub is enough to check the wiring — that the tabpanel gets
 *  the RAW `onAddUrl`, so adding does not close the dialog. */
vi.mock("../../../../src/ui/stac/StacBrowser", () => ({
  StacBrowser: (props: {
    onAddUrl: (url: string) => Promise<AddUrlResult>;
  }) => (
    <button type="button" onClick={() => props.onAddUrl(CATALOG_URL)}>
      stub catalog add
    </button>
  ),
}));

import { AddLayerDialog } from "../../../../src/ui/layers/AddLayerDialog";
import type { DetectedSource } from "../../../../src/features/layers/detectSource";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import { useGeoLayerStore } from "../../../../src/features/geoLayers/geoLayerStore";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";

afterEach(() => {
  cleanup();
  useLayerStore.setState({ layers: [] });
  useGeoLayerStore.setState({ layers: [] });
  useWorkspaceStore.setState({ activeLayerId: null });
});

const noop = () => {};
const noopUrl = async () => ({ ok: true }) as const;

interface Handlers {
  onAddFile?: (file: File, override?: DetectedSource) => void;
  onAddFiles?: (files: File[], override?: DetectedSource) => void;
  onAddUrl?: (url: string, override?: DetectedSource) => Promise<AddUrlResult>;
  loading?: boolean;
}

/** The dialog's real host is a button that opens it and takes focus back when
 *  it closes; this is that, and nothing else. */
function Harness(props: Handlers) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        + Add layer
      </button>
      {open && (
        <AddLayerDialog
          onClose={() => setOpen(false)}
          onAddFile={props.onAddFile ?? noop}
          onAddFiles={props.onAddFiles ?? noop}
          onAddUrl={props.onAddUrl ?? noopUrl}
          loading={props.loading ?? false}
        />
      )}
    </>
  );
}

function openDialog(handlers: Handlers = {}): HTMLElement {
  render(<Harness {...handlers} />);
  fireEvent.click(screen.getByRole("button", { name: "+ Add layer" }));
  return screen.getByRole("dialog");
}

function openUrlTab(handlers: Handlers = {}): HTMLElement {
  const dialog = openDialog(handlers);
  fireEvent.click(screen.getByRole("tab", { name: "URL" }));
  return dialog;
}

/** A drop event carrying files, the way a browser delivers one. jsdom has no
 *  real `DataTransfer`, so the shape the handler reads is supplied directly. */
function drop(...files: File[]): void {
  fireEvent.drop(screen.getByTestId("source-picker-drop-zone"), {
    dataTransfer: { files, types: ["Files"], dropEffect: "" },
  });
}

/** Type a URL and ask for it to be classified, the way a user leaving the
 *  field does. */
function typeUrl(url: string): void {
  const field = screen.getByLabelText("Source URL");
  fireEvent.change(field, { target: { value: url } });
  fireEvent.blur(field);
}

const addLayerButton = () =>
  screen.getByRole("button", { name: "Add layer" }) as HTMLButtonElement;

const detectionLine = () => screen.getByTestId("detected-source").textContent;

const changeSelect = () =>
  screen.getByLabelText("Change…") as HTMLSelectElement;

function geoFile(name: string, body: unknown): File {
  return new File([JSON.stringify(body)], name, { type: "application/json" });
}

const geoLayers = () => useGeoLayerStore.getState().layers;

describe("AddLayerDialog — the three places a source comes from", () => {
  it("offers File, URL and Catalog, and opens on File", () => {
    openDialog();

    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "File",
      "URL",
      "Catalog",
    ]);
    expect(screen.getByRole("tab", { name: "File" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("source-picker-drop-zone")).toBeTruthy();
  });

  it("opens on the tab named by initialTab", () => {
    render(
      <AddLayerDialog
        initialTab="url"
        onClose={noop}
        onAddFile={noop}
        onAddFiles={noop}
        onAddUrl={noopUrl}
        loading={false}
      />,
    );

    expect(screen.getByRole("tab", { name: "URL" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("keeps the catalog on the raw handler, so adding does not close it", () => {
    const onAddUrl = vi.fn(async () => ({ ok: true }) as const);
    const dialog = openDialog({ onAddUrl });

    fireEvent.click(screen.getByRole("tab", { name: "Catalog" }));
    expect(dialog.className).toContain("modal-wide");

    fireEvent.click(screen.getByRole("button", { name: "stub catalog add" }));

    expect(onAddUrl.mock.calls).toEqual([[CATALOG_URL]]);
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });
});

describe("AddLayerDialog — the File tab", () => {
  it("does not add on the drop: it names the format and waits to be told", () => {
    const onAddFile = vi.fn();
    openDialog({ onAddFile });

    const file = new File(["{}"], "delft.city.json");
    drop(file);

    expect(onAddFile).not.toHaveBeenCalled();
    expect(detectionLine()).toContain("CityJSON");
    expect(screen.getByText("delft.city.json")).toBeTruthy();

    fireEvent.click(addLayerButton());

    expect(onAddFile.mock.calls).toEqual([
      [file, { kind: "city", encoding: "cityjson", label: "CityJSON" }],
    ]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("hands over the CORRECTED format when the user changes it", () => {
    const onAddFile = vi.fn();
    openDialog({ onAddFile });

    drop(new File(["{}"], "tile.json"));
    expect(detectionLine()).toContain("CityJSON");

    fireEvent.change(changeSelect(), { target: { value: "city:cityjsonseq" } });
    expect(detectionLine()).toContain("CityJSONSeq");
    fireEvent.click(addLayerButton());

    expect(onAddFile.mock.calls[0]![1]).toEqual({
      kind: "city",
      encoding: "cityjsonseq",
      label: "CityJSONSeq",
    });
  });

  it("says so — and refuses to add — when it cannot tell what a file is", () => {
    openDialog();

    drop(new File(["hello"], "notes.txt"));

    expect(detectionLine()).toContain("Unknown format");
    expect(addLayerButton().disabled).toBe(true);
  });

  it("takes a multi-file drop as ONE CityParquet package", () => {
    const onAddFiles = vi.fn();
    const onAddFile = vi.fn();
    openDialog({ onAddFile, onAddFiles });

    const table = new File(["{}"], "building.parquet");
    const meta = new File(["{}"], "metadata.json");
    drop(table, meta);

    expect(detectionLine()).toContain("CityParquet");
    fireEvent.click(addLayerButton());

    expect(onAddFiles.mock.calls[0]![0]).toEqual([table, meta]);
    expect(onAddFile).not.toHaveBeenCalled();
  });

  it("adds a dropped GeoJSON file INLINE, never through the city loader", async () => {
    const onAddFile = vi.fn();
    openDialog({ onAddFile });

    drop(
      geoFile("parcels.geojson", { type: "FeatureCollection", features: [] }),
    );
    expect(detectionLine()).toContain("GeoJSON");
    fireEvent.click(addLayerButton());

    await waitFor(() => expect(geoLayers()).toHaveLength(1));
    expect(geoLayers()[0]).toMatchObject({
      name: "parcels.geojson",
      kind: "geojson",
      config: { data: { type: "FeatureCollection", features: [] } },
    });
    expect(onAddFile).not.toHaveBeenCalled();
    // The layer the user just added is the one the panels describe.
    expect(useWorkspaceStore.getState().activeLayerId).toBe(geoLayers()[0]!.id);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("refuses a CityJSON file corrected to GeoJSON, and stays open to say why", async () => {
    openDialog();

    drop(
      geoFile("delft.city.json", {
        type: "CityJSON",
        version: "2.0",
        CityObjects: {},
      }),
    );
    fireEvent.change(changeSelect(), { target: { value: "geo:geojson" } });
    fireEvent.click(addLayerButton());

    await waitFor(() => expect(screen.getByText(/not GeoJSON/i)).toBeTruthy());
    expect(geoLayers()).toHaveLength(0);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("disables browsing while a load is in flight", () => {
    openDialog({ loading: true });

    expect(
      (
        screen.getByRole("button", {
          name: "Browse files",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});

describe("AddLayerDialog — the URL tab", () => {
  it("detects on blur and hands the URL and its format to onAddUrl", () => {
    const onAddUrl = vi.fn(async () => ({ ok: true }) as const);
    openUrlTab({ onAddUrl });

    typeUrl("  https://example.com/model.city.json  ");

    expect(detectionLine()).toContain("CityJSON");
    fireEvent.click(addLayerButton());

    expect(onAddUrl.mock.calls).toEqual([
      [
        "https://example.com/model.city.json",
        { kind: "city", encoding: "cityjson", label: "CityJSON" },
      ],
    ]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("detects on Enter too, and honours a correction to FlatCityBuf", () => {
    // Parameters declared, so `mock.calls[0]` is the two-element tuple this
    // assertion destructures rather than the empty one a bare fake implies.
    const onAddUrl = vi.fn(
      async (_url: string, _override?: DetectedSource) =>
        ({ ok: true }) as const,
    );
    openUrlTab({ onAddUrl });

    fireEvent.change(screen.getByLabelText("Source URL"), {
      target: { value: "https://example.com/model.json" },
    });
    fireEvent.submit(screen.getByTestId("url-source-form"));
    expect(detectionLine()).toContain("CityJSON");

    fireEvent.change(changeSelect(), { target: { value: "city:flatcitybuf" } });
    fireEvent.click(addLayerButton());

    expect(onAddUrl.mock.calls[0]![1]).toMatchObject({
      kind: "city",
      encoding: "flatcitybuf",
    });
  });

  it("classifies an XYZ template, adds it to the geo store and activates it", () => {
    const onAddUrl = vi.fn(async () => ({ ok: true }) as const);
    openUrlTab({ onAddUrl });

    typeUrl("https://tile.example/{z}/{x}/{y}.png");
    expect(detectionLine()).toContain("XYZ raster tiles");
    fireEvent.click(addLayerButton());

    expect(geoLayers()).toHaveLength(1);
    expect(geoLayers()[0]).toMatchObject({
      kind: "raster-xyz",
      config: { urlTemplate: "https://tile.example/{z}/{x}/{y}.png" },
    });
    expect(onAddUrl).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().activeLayerId).toBe(geoLayers()[0]!.id);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("classifies a tileset.json as 3D Tiles", () => {
    openUrlTab();

    typeUrl("https://tiles.example/paris/tileset.json");
    expect(detectionLine()).toContain("3D Tiles");
    fireEvent.click(addLayerButton());

    expect(geoLayers()[0]).toMatchObject({
      kind: "3d-tiles",
      config: { url: "https://tiles.example/paris/tileset.json" },
    });
  });

  it("routes an unrecognised URL corrected to GeoJSON into the geo store", () => {
    const onAddUrl = vi.fn(async () => ({ ok: true }) as const);
    openUrlTab({ onAddUrl });

    typeUrl("https://example.com/features.txt");
    expect(detectionLine()).toContain("Unknown format");
    expect(addLayerButton().disabled).toBe(true);

    fireEvent.change(changeSelect(), { target: { value: "geo:geojson" } });
    fireEvent.click(addLayerButton());

    expect(geoLayers()[0]).toMatchObject({
      kind: "geojson",
      config: { url: "https://example.com/features.txt" },
    });
    expect(onAddUrl).not.toHaveBeenCalled();
  });

  it("offers an optional name for a geospatial layer", () => {
    openUrlTab();

    typeUrl("https://tile.example/{z}/{x}/{y}.png");
    fireEvent.change(screen.getByLabelText("Layer name"), {
      target: { value: "Aerial 2024" },
    });
    fireEvent.click(addLayerButton());

    expect(geoLayers()[0]!.name).toBe("Aerial 2024");
  });

  it("has no name field for a city model — the file name is the name", () => {
    openUrlTab();

    typeUrl("https://example.com/model.city.json");

    expect(screen.queryByLabelText("Layer name")).toBeNull();
  });

  it("refuses a URL that is not one, and stays open", () => {
    openUrlTab();

    typeUrl("not a url");
    fireEvent.change(changeSelect(), { target: { value: "geo:geojson" } });
    fireEvent.click(addLayerButton());

    expect(geoLayers()).toHaveLength(0);
    expect(screen.getByText(/not a valid url/i)).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("cannot add before anything has been detected", () => {
    openUrlTab();

    expect(screen.queryByTestId("detected-source")).toBeNull();
    expect(addLayerButton().disabled).toBe(true);
  });
});

describe("AddLayerDialog — modal chrome", () => {
  it("moves focus into the dialog and restores it to the trigger on close", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "+ Add layer" });
    trigger.focus();
    fireEvent.click(trigger);

    expect(document.activeElement).toBe(screen.getByRole("dialog"));

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on Escape and on a backdrop click, but not on a click inside", () => {
    const dialog = openDialog();

    fireEvent.mouseDown(dialog);
    expect(screen.queryByRole("dialog")).not.toBeNull();

    fireEvent.mouseDown(screen.getByTestId("add-layer-backdrop"));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "+ Add layer" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("locks the page behind it from scrolling while open", () => {
    openDialog();
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.body.style.overflow).not.toBe("hidden");
  });
});
