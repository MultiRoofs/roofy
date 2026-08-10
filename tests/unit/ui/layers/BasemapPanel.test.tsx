import { afterEach, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { BasemapPanel } from "../../../../src/ui/layers/BasemapPanel";
import { useBasemapStore } from "../../../../src/features/basemap/basemapStore";
import { BASEMAPS, DEFAULT_BASEMAP_ID } from "../../../../src/scene/basemaps";

afterEach(() => {
  cleanup();
  useBasemapStore.setState({ basemapId: DEFAULT_BASEMAP_ID });
});

describe("BasemapPanel", () => {
  it("lists every catalogue option and selects the store's current one", () => {
    render(<BasemapPanel />);
    const select = screen.getByLabelText("Basemap") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(
      BASEMAPS.filter((b) => !b.hidden).map((b) => b.id),
    );
    expect([...select.options].map((o) => o.textContent)).toEqual(
      BASEMAPS.filter((b) => !b.hidden).map((b) => b.label),
    );
    expect(select.value).toBe(DEFAULT_BASEMAP_ID);
  });

  it("writes the picked option to the store", () => {
    render(<BasemapPanel />);
    fireEvent.change(screen.getByLabelText("Basemap"), {
      target: { value: "esri-imagery" },
    });
    expect(useBasemapStore.getState().basemapId).toBe("esri-imagery");
  });

  it("follows a change made elsewhere (the advanced-settings panel)", () => {
    render(<BasemapPanel />);
    act(() => useBasemapStore.setState({ basemapId: "none" }));
    expect((screen.getByLabelText("Basemap") as HTMLSelectElement).value).toBe(
      "none",
    );
  });
});
