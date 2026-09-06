/**
 * One row of the redesign's single layer list.
 *
 * `LayerRow` is deliberately STORE-FREE: it is handed the layer, whether it
 * is active, the state line Task 16's `layerStateLine` produced and a set of
 * callbacks, and it does nothing but draw them and report what was clicked.
 * Everything that reads a store (which rows exist, what the streaming status
 * is, what "Remove" actually removes) belongs to `LayerList`, and is pinned
 * by its own suite — so this file can check the row's BEHAVIOUR (the click
 * targets that must not activate, the rename that must commit on Enter and
 * abandon on Escape, the menu's contents) without seeding four stores.
 *
 * `PlaceholderRow` is the same row for the three things that have no store
 * entry at all: a layer restored from a snapshot whose local file is gone, an
 * add still parsing, and an add that failed. None of them is activatable —
 * there is nothing to make active — and that is the one property most easily
 * lost in a refactor, so it is asserted rather than assumed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LayerRow, PlaceholderRow } from "../../../../src/ui/layers/LayerRow";
import type { ActiveLayer } from "../../../../src/features/workspace/activeLayer";
import type { Layer } from "../../../../src/features/layers/layerStore";
import type { GeoLayer } from "../../../../src/features/geoLayers/geoLayerStore";

afterEach(cleanup);

function cityItem(overrides: Partial<Layer> = {}): ActiveLayer {
  return {
    kind: "city",
    layer: {
      id: "l1",
      name: "Delft",
      visible: true,
      isStreaming: false,
      ...overrides,
    } as unknown as Layer,
  };
}

function geoItem(overrides: Partial<GeoLayer> = {}): ActiveLayer {
  return {
    kind: "geo",
    layer: {
      id: "g1",
      name: "Roads",
      visible: true,
      kind: "geojson",
      ...overrides,
    } as unknown as GeoLayer,
  };
}

const handlers = () => ({
  onActivate: vi.fn(),
  onToggleVisible: vi.fn(),
  onRename: vi.fn(),
  onZoom: vi.fn(),
  onRemove: vi.fn(),
});

function renderRow(
  props: Partial<Parameters<typeof LayerRow>[0]> = {},
): ReturnType<typeof handlers> {
  const cbs = handlers();
  render(
    <LayerRow
      item={cityItem()}
      active={false}
      stateLine="1,204 buildings · LoD 2.2"
      kind="city"
      filterChip={null}
      onOpenTable={null}
      {...cbs}
      {...props}
    />,
  );
  return cbs;
}

function openMenu(): void {
  fireEvent.click(screen.getByRole("button", { name: "Layer actions" }));
}

describe("LayerRow", () => {
  it("shows the layer's name and its state line", () => {
    renderRow();

    expect(screen.getByText("Delft")).toBeTruthy();
    expect(screen.getByText("1,204 buildings · LoD 2.2")).toBeTruthy();
  });

  it("is a listitem, and carries aria-current only when active", () => {
    const { rerender } = render(
      <LayerRow
        item={cityItem()}
        active={false}
        stateLine="x"
        kind="city"
        filterChip={null}
        onOpenTable={null}
        {...handlers()}
      />,
    );
    expect(
      screen.getByRole("listitem").getAttribute("aria-current"),
    ).toBeNull();

    rerender(
      <LayerRow
        item={cityItem()}
        active
        stateLine="x"
        kind="city"
        filterChip={null}
        onOpenTable={null}
        {...handlers()}
      />,
    );
    expect(screen.getByRole("listitem").getAttribute("aria-current")).toBe(
      "true",
    );
  });

  it("activates on a click anywhere but a control", () => {
    const cbs = renderRow();

    fireEvent.click(screen.getByText("Delft"));
    expect(cbs.onActivate).toHaveBeenCalledTimes(1);
  });

  it("activates on Enter, and is reachable by the keyboard", () => {
    const cbs = renderRow();
    const row = screen.getByRole("listitem");

    expect(row.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(row, { key: "Enter" });
    expect(cbs.onActivate).toHaveBeenCalledTimes(1);
  });

  it("toggles visibility WITHOUT activating — the eye is not a row click", () => {
    const cbs = renderRow();

    fireEvent.click(screen.getByRole("button", { name: "Hide layer" }));
    expect(cbs.onToggleVisible).toHaveBeenCalledTimes(1);
    expect(cbs.onActivate).not.toHaveBeenCalled();
  });

  it("names the eye button for what it will DO, not for the state it shows", () => {
    renderRow({ item: cityItem({ visible: false }) });

    expect(screen.getByRole("button", { name: "Show layer" })).toBeTruthy();
  });

  it("marks a hidden row so the list can dim it", () => {
    renderRow({ item: cityItem({ visible: false }) });

    expect(
      screen.getByRole("listitem").classList.contains("layer-row-hidden"),
    ).toBe(true);
  });

  it("renames on a double-click of the name, committing on Enter", () => {
    const cbs = renderRow();

    fireEvent.doubleClick(screen.getByText("Delft"));
    const field = screen.getByRole("textbox");
    fireEvent.change(field, { target: { value: "Delft 2.2" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(cbs.onRename).toHaveBeenCalledWith("Delft 2.2");
    // And it must not have activated on the way — a rename is not a pick.
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("abandons a rename on Escape, keeping the old name", () => {
    const cbs = renderRow();

    fireEvent.doubleClick(screen.getByText("Delft"));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "nonsense" },
    });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });

    expect(cbs.onRename).not.toHaveBeenCalled();
    expect(screen.getByText("Delft")).toBeTruthy();
  });

  it("opens the row menu and zooms from it", () => {
    const cbs = renderRow();

    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Zoom to layer" }));

    expect(cbs.onZoom).toHaveBeenCalledTimes(1);
    // The menu closes behind the action it performed.
    expect(screen.queryByRole("button", { name: "Zoom to layer" })).toBeNull();
  });

  it("removes from the menu", () => {
    const cbs = renderRow();

    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(cbs.onRemove).toHaveBeenCalledTimes(1);
  });

  it("starts a rename from the menu", () => {
    renderRow();

    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));

    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("offers Open table only when the row has one", () => {
    const onOpenTable = vi.fn();
    renderRow({ onOpenTable });

    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Open table" }));
    expect(onOpenTable).toHaveBeenCalledTimes(1);
  });

  it("hides Open table for a row with no table — a geo layer", () => {
    renderRow({ item: geoItem(), kind: "vector", onOpenTable: null });

    openMenu();
    expect(screen.queryByRole("button", { name: "Open table" })).toBeNull();
    // The rest of the menu is still there.
    expect(screen.getByRole("button", { name: "Zoom to layer" })).toBeTruthy();
  });

  it("does not activate the row when the menu is opened", () => {
    const cbs = renderRow();

    openMenu();
    expect(cbs.onActivate).not.toHaveBeenCalled();
  });

  it("renders the filter chip beside the state line", () => {
    renderRow({ filterChip: <span>2 filters</span> });

    expect(screen.getByText("2 filters")).toBeTruthy();
  });
});

describe("PlaceholderRow", () => {
  it("renders an unavailable layer with its Re-link and Dismiss actions", () => {
    const onRelink = vi.fn();
    const onDismiss = vi.fn();
    render(
      <PlaceholderRow
        kind="unavailable"
        name="delft.city.json"
        onRelink={onRelink}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByText("delft.city.json")).toBeTruthy();
    expect(screen.getByText("Needs re-link")).toBeTruthy();
    // A real button, not a `<label>` fronting the input: a label is not a tab
    // stop, and re-linking would be the one action here a keyboard could not
    // reach.
    expect(screen.getByRole("button", { name: "Re-link" })).toBeTruthy();

    const file = new File(["{}"], "delft.city.json");
    fireEvent.change(screen.getByTestId("relink-input"), {
      target: { files: [file] },
    });
    expect(onRelink).toHaveBeenCalledWith(file);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders an in-flight add as a loading row with no actions", () => {
    render(<PlaceholderRow kind="loading" name="delft.fcb" />);

    expect(screen.getByText("delft.fcb")).toBeTruthy();
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("renders a failed add with its reason, Retry and Dismiss", () => {
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    render(
      <PlaceholderRow
        kind="error"
        name="broken.city.json"
        message="Unsupported CityJSON version 0.9"
        onRetry={onRetry}
        onDismiss={onDismiss}
      />,
    );

    expect(
      screen.getByText("Error · Unsupported CityJSON version 0.9"),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("is never activatable: no aria-current, no tab stop, nothing to click", () => {
    render(
      <PlaceholderRow kind="error" name="broken.fcb" message="network down" />,
    );

    const row = screen.getByRole("listitem");
    expect(row.getAttribute("aria-current")).toBeNull();
    expect(row.getAttribute("tabindex")).toBeNull();
    // No click handler to fire: the row cannot become the active layer, so a
    // click on it must do nothing at all.
    expect(row.onclick).toBeNull();
  });
});
