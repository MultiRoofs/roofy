import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RenderingPanel } from "../../../src/ui/viewport/RenderingPanel";
import {
  DEFAULT_ATMOSPHERE_STATE,
  useAtmosphereStore,
} from "../../../src/features/atmosphere/atmosphereStore";
import { useTilesStore } from "../../../src/features/tiles/tilesStore";
import {
  DEFAULT_RENDER_DEBUG_STATE,
  useRenderDebugStore,
} from "../../../src/features/debug/renderDebugStore";
import { useBasemapStore } from "../../../src/features/basemap/basemapStore";

describe("RenderingPanel", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    useAtmosphereStore.setState({
      cloudCoverage: 0.3,
      lensFlareEnabled: true,
      precipitation: "none",
    });
    useTilesStore.setState({ enabled: false });
    useBasemapStore.setState({ basemapId: "osm" });
    useRenderDebugStore.setState({
      ...DEFAULT_RENDER_DEBUG_STATE,
    });
  });

  it("updates the render stores from the panel controls", () => {
    render(<RenderingPanel onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("Aerial Perspective"));
    fireEvent.click(screen.getByLabelText("Sun Shadows"));
    fireEvent.change(screen.getByLabelText("Exposure"), {
      target: { value: "14" },
    });
    // Last, because it disables the pass-backed controls here AND in the
    // toolbar's Weather popover.
    fireEvent.click(screen.getByLabelText("Post Processing"));

    expect(useRenderDebugStore.getState()).toMatchObject({
      postProcessingEnabled: false,
      aerialPerspectiveEnabled: false,
      sunShadowsEnabled: false,
      exposure: 14,
    });
  });

  // Weather is a toolbar popover now (`ui/toolbar/WeatherMenu.tsx`), beside the
  // sun. Its controls must not ALSO be here, or the two surfaces are two
  // widgets for one subject again — the exact thing the move undid.
  it("hosts no weather control, which moved to the toolbar", () => {
    const { container } = render(<RenderingPanel onClose={() => {}} />);

    for (const gone of ["Clouds", "Cloud Coverage", "Lens Flare"]) {
      expect(screen.queryByLabelText(gone)).toBeNull();
    }
    expect(screen.queryByLabelText("Precipitation")).toBeNull();
    expect(container.querySelector("#advanced-precipitation")).toBeNull();
  });

  it("toggles the streaming fetch-box diagnostic, which starts off", () => {
    render(<RenderingPanel onClose={() => {}} />);
    const toggle = screen.getByLabelText("Streaming Fetch Box");
    expect(toggle).not.toBeChecked();
    // Independent of the post chain: the outline is a mesh, not a pass.
    expect(toggle).not.toBeDisabled();

    fireEvent.click(toggle);
    expect(useRenderDebugStore.getState().streamQueryBoxEnabled).toBe(true);
    fireEvent.click(toggle);
    expect(useRenderDebugStore.getState().streamQueryBoxEnabled).toBe(false);
  });

  it("offers no control without an engine counterpart", () => {
    render(<RenderingPanel onClose={() => {}} />);

    // The three that were pure state until this pass. They are gone rather
    // than wired: their counterpart is the city mesh's three.js material,
    // which lives in @cityjson/navara-cityjson, not in the app.
    //
    // "Ambient Light" joins them for the opposite reason: it HAD a counterpart
    // (`view.addLight({ ambient })`), but it belonged to the scene-lights
    // calibration the scene no longer uses — the aerial-perspective pass lights
    // the frame from the physical atmosphere now, so a flat fill term is pure
    // over-exposure.
    for (const gone of [
      "City Shadows",
      "Double Sided",
      "City Material",
      "Ambient Light",
    ]) {
      expect(screen.queryByLabelText(gone)).toBeNull();
    }
  });

  // The master toggle governs this panel's own pass-backed control and, across
  // surfaces, every control in the toolbar's Weather popover (pinned in
  // `toolbar/WeatherMenu.test.tsx`).
  it("disables the post-processing controls when the chain is off", () => {
    useRenderDebugStore.setState({ postProcessingEnabled: false });
    render(<RenderingPanel onClose={() => {}} />);

    expect(screen.getByLabelText("Aerial Perspective")).toBeDisabled();
    // Exposure and shadows are independent of the post chain.
    expect(screen.getByLabelText("Sun Shadows")).not.toBeDisabled();
    expect(screen.getByLabelText("Exposure")).not.toBeDisabled();
  });

  // Grouped by SUBJECT, not by which store or pass a control happens to come
  // from. Two sections since weather left for the toolbar: how the scene is
  // drawn, and what the viewer will tell you about itself.
  it("groups the controls into Light & passes and Diagnostics", () => {
    const { container } = render(<RenderingPanel onClose={() => {}} />);

    const titles = [...container.querySelectorAll(".attr-section-title")].map(
      (el) => el.textContent,
    );
    expect(titles).toEqual(["Light & passes", "Diagnostics"]);

    const sections = [...container.querySelectorAll(".attr-section")];
    const sectionAt = (index: number): Element => {
      const section = sections[index];
      if (!section) throw new Error(`no section at ${index}`);
      return section;
    };
    const labelsIn = (index: number) =>
      [...sectionAt(index).querySelectorAll("[aria-label]")].map((el) =>
        el.getAttribute("aria-label"),
      );
    expect(labelsIn(0)).toEqual([
      "Exposure",
      "Sun Shadows",
      "Post Processing",
      "Aerial Perspective",
    ]);
    expect(sectionAt(1).textContent).toContain("Streaming Fetch Box");
  });

  // The reset is a PANEL-WIDE footer action, and it reaches ACROSS SURFACES:
  // weather now lives in the toolbar popover, but its values are still part of
  // what "reset render settings" restores. A reset bound to `renderDebugStore`
  // alone would leave cloud coverage, precipitation and lens flare exactly
  // where the user left them while claiming a clean slate — which is why this
  // test asserts BOTH stores are back at their defaults.
  it("resets every rendering, weather and diagnostic control, in both stores", () => {
    useAtmosphereStore.setState({
      cloudCoverage: 0.6,
      lensFlareEnabled: false,
    });
    useRenderDebugStore.setState({
      postProcessingEnabled: false,
      cloudsEnabled: false,
      aerialPerspectiveEnabled: false,
      sunShadowsEnabled: false,
      exposure: 1,
    });

    render(<RenderingPanel onClose={() => {}} />);

    fireEvent.click(screen.getByText("Reset render settings"));

    expect(useRenderDebugStore.getState()).toMatchObject(
      DEFAULT_RENDER_DEBUG_STATE,
    );
    expect(useAtmosphereStore.getState()).toMatchObject(
      DEFAULT_ATMOSPHERE_STATE,
    );
  });

  // The backdrop is a choice of what to look AT, not of how the scene is
  // rendered: its one home is the left sidebar (`BasemapPanel`,
  // `GoogleTilesPanel`). The reset must not reach those stores either.
  it("hosts no backdrop control, and leaves the backdrop stores alone", () => {
    useTilesStore.setState({ enabled: true });
    useBasemapStore.setState({ basemapId: "esri-imagery" });
    const { container } = render(<RenderingPanel onClose={() => {}} />);

    expect(
      container.querySelector(".advanced-settings-header")?.textContent,
    ).toContain("Rendering");
    expect(screen.queryByText("Backdrop")).toBeNull();
    expect(screen.queryByLabelText("Google 3D Tiles")).toBeNull();
    expect(screen.queryByLabelText("Basemap")).toBeNull();

    fireEvent.click(screen.getByText("Reset render settings"));

    expect(useTilesStore.getState().enabled).toBe(true);
    expect(useBasemapStore.getState().basemapId).toBe("esri-imagery");
  });
});
