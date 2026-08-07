/**
 * The "+ Add Layer" modal: how it opens, how it closes, and that both of its
 * affordances reach the app's ONE loading path.
 *
 * The button used to unfold a cramped inline form inside a 240 px sidebar.
 * What is checked here is the contract that replaced it — a real dialog with
 * a drop zone and a URL field, wired to the same `onAddFile` / `onAddUrl`
 * handlers the landing page uses.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const CATALOG_URL = "https://catalog.test/tile.city.json";

/** The catalog browser pulls in MapLibre and the STAC store; neither belongs
 *  in a test about the dialog that HOSTS it, and jsdom cannot run the first.
 *  A one-button stub is enough to check the wiring — that the tabpanel gets
 *  the RAW `onAddUrl`, so adding does not close the dialog. */
vi.mock("../../../../src/ui/stac/StacBrowser", () => ({
  StacBrowser: (props: { onAddUrl: (url: string) => void }) => (
    <button type="button" onClick={() => props.onAddUrl(CATALOG_URL)}>
      stub catalog add
    </button>
  ),
}));

import { LayerPanel } from "../../../../src/ui/layers/LayerPanel";
import { useLayerStore } from "../../../../src/features/layers/layerStore";

afterEach(() => {
  cleanup();
  useLayerStore.setState({ layers: [], activeLayerId: null });
});

const noop = () => {};

function renderPanel(
  overrides: {
    onAddFile?: (file: File) => void;
    onAddUrl?: (url: string) => void;
    loading?: boolean;
  } = {},
) {
  return render(
    <LayerPanel
      onAddFile={overrides.onAddFile ?? noop}
      onAddUrl={overrides.onAddUrl ?? noop}
      loading={overrides.loading ?? false}
    />,
  );
}

function openDialog(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: "+ Add Layer" }));
  return screen.getByRole("dialog");
}

/** A drop event carrying a file, the way a browser delivers one. jsdom has no
 *  real `DataTransfer`, so the shape the handler reads is supplied directly. */
function fileDrop(file: File) {
  return {
    dataTransfer: { files: [file], types: ["Files"], dropEffect: "" },
  };
}

describe("AddLayerDialog — opening and closing", () => {
  it("is closed until the Add Layer button is clicked", () => {
    renderPanel();
    expect(screen.queryByRole("dialog")).toBeNull();

    const dialog = openDialog();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText("Add layer")).toBeTruthy();
  });

  it("moves focus into the dialog and restores it to the trigger on close", () => {
    renderPanel();
    const trigger = screen.getByRole("button", { name: "+ Add Layer" });
    trigger.focus();

    const dialog = openDialog();
    expect(document.activeElement).toBe(dialog);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on Escape", () => {
    renderPanel();
    openDialog();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on a backdrop click but not on a click inside the dialog", () => {
    renderPanel();
    const dialog = openDialog();

    fireEvent.mouseDown(dialog);
    expect(screen.queryByRole("dialog")).not.toBeNull();

    fireEvent.mouseDown(screen.getByTestId("add-layer-backdrop"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("locks the page behind it from scrolling while open, and unlocks on close", () => {
    renderPanel();
    openDialog();
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.body.style.overflow).not.toBe("hidden");
  });
});

describe("AddLayerDialog — loading a source", () => {
  it("submits a pasted URL to onAddUrl and closes", () => {
    const onAddUrl = vi.fn();
    renderPanel({ onAddUrl });
    openDialog();

    fireEvent.change(screen.getByLabelText("Or load from URL:"), {
      target: { value: "  https://example.com/model.city.json  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Load" }));

    // Trimmed, and handed over exactly once.
    expect(onAddUrl.mock.calls).toEqual([
      ["https://example.com/model.city.json"],
    ]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ignores an empty URL — the Load button is disabled", () => {
    const onAddUrl = vi.fn();
    renderPanel({ onAddUrl });
    openDialog();

    const load = screen.getByRole("button", {
      name: "Load",
    }) as HTMLButtonElement;
    expect(load.disabled).toBe(true);
    fireEvent.click(load);
    expect(onAddUrl).not.toHaveBeenCalled();
  });

  it("passes a dropped file to onAddFile and closes", () => {
    const onAddFile = vi.fn();
    renderPanel({ onAddFile });
    openDialog();

    const zone = screen.getByTestId("source-picker-drop-zone");
    const file = new File(["{}"], "delft.city.json", {
      type: "application/json",
    });
    fireEvent.drop(zone, fileDrop(file));

    expect(onAddFile).toHaveBeenCalledTimes(1);
    expect((onAddFile.mock.calls[0]![0] as File).name).toBe("delft.city.json");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("highlights the drop zone while a file is dragged over it", () => {
    renderPanel();
    openDialog();

    const zone = screen.getByTestId("source-picker-drop-zone");
    expect(zone.className).not.toContain("is-dragging");

    fireEvent.dragEnter(zone, { dataTransfer: { types: ["Files"] } });
    expect(zone.className).toContain("is-dragging");
    expect(screen.getByText("Release to load this file")).toBeTruthy();

    fireEvent.dragLeave(zone, { dataTransfer: { types: ["Files"] } });
    expect(zone.className).not.toContain("is-dragging");
  });

  it("states the supported formats", () => {
    renderPanel();
    openDialog();
    expect(
      screen.getByText(".city.json · .city.jsonl · .fcb · .gml"),
    ).toBeTruthy();
  });

  it("offers the catalog as a third tab, wide, and adding from it keeps the dialog open", () => {
    const onAddUrl = vi.fn();
    renderPanel({ onAddUrl });
    const dialog = openDialog();

    // Three source families; the city model is still the default.
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "City model",
      "Geospatial",
      "Catalog",
    ]);
    expect(dialog.className).not.toContain("modal-wide");

    fireEvent.click(screen.getByRole("tab", { name: "Catalog" }));

    expect(screen.getByText("stub catalog add")).toBeTruthy();
    // Without the wide variant the collection grid collapses to one column.
    expect(screen.getByRole("dialog").className).toContain("modal-wide");

    fireEvent.click(screen.getByRole("button", { name: "stub catalog add" }));

    expect(onAddUrl.mock.calls).toEqual([[CATALOG_URL]]);
    // MULTI-ADD: the catalog panel gets the raw handler, not the closing
    // wrapper the URL field uses, so the user can queue several tiles.
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });

  it("disables both affordances while a load is in flight", () => {
    renderPanel({ loading: true });
    openDialog();

    expect(
      (
        screen.getByRole("button", {
          name: "Browse files",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("Or load from URL:") as HTMLInputElement).disabled,
    ).toBe(true);
  });
});
