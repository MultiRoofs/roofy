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

  it("picks precipitation, which is one choice rather than two switches", () => {
    render(<RenderingPanel onClose={() => {}} />);
    const picker = screen.getByLabelText("Precipitation");
    expect((picker as HTMLSelectElement).value).toBe("none");
    fireEvent.change(picker, { target: { value: "rain" } });
    expect(useAtmosphereStore.getState().precipitation).toBe("rain");
    // Selecting snow REPLACES rain: Navara models them as two meshes and
    // asking for both at once is not a state the scene can be in.
    fireEvent.change(picker, { target: { value: "snow" } });
    expect(useAtmosphereStore.getState().precipitation).toBe("snow");
    fireEvent.change(picker, { target: { value: "none" } });
    expect(useAtmosphereStore.getState().precipitation).toBe("none");
  });

  it("updates the render stores from the panel controls", () => {
    render(<RenderingPanel onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("Clouds"));
    fireEvent.click(screen.getByLabelText("Aerial Perspective"));
    fireEvent.click(screen.getByLabelText("Lens Flare"));
    fireEvent.click(screen.getByLabelText("Sun Shadows"));
    fireEvent.change(screen.getByLabelText("Exposure"), {
      target: { value: "14" },
    });
    // Last, because it disables the pass-backed controls in both sections.
    fireEvent.click(screen.getByLabelText("Post Processing"));

    expect(useRenderDebugStore.getState()).toMatchObject({
      postProcessingEnabled: false,
      // Clouds default OFF now, so the one click above turns them ON — the
      // assertion is "the control wrote to the store", not "everything is off".
      cloudsEnabled: true,
      aerialPerspectiveEnabled: false,
      sunShadowsEnabled: false,
      exposure: 14,
    });
    expect(useAtmosphereStore.getState().lensFlareEnabled).toBe(false);
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

  // The whole Weather section is pass-backed, so its master toggle lives one
  // section up in Rendering — the dependency crosses the section boundary and
  // that is what this pins.
  it("disables the post-processing controls when the chain is off", () => {
    useRenderDebugStore.setState({ postProcessingEnabled: false });
    render(<RenderingPanel onClose={() => {}} />);

    expect(screen.getByLabelText("Clouds")).toBeDisabled();
    expect(screen.getByLabelText("Aerial Perspective")).toBeDisabled();
    expect(screen.getByLabelText("Lens Flare")).toBeDisabled();
    expect(screen.getByLabelText("Cloud Coverage")).toBeDisabled();
    // Exposure and shadows are independent of the post chain.
    expect(screen.getByLabelText("Sun Shadows")).not.toBeDisabled();
    expect(screen.getByLabelText("Exposure")).not.toBeDisabled();
  });

  // Grouped by SUBJECT, not by which store or pass a control happens to come
  // from: the panel is read top-down by someone who wants "less cloud", not by
  // someone who knows lens flare is an effect and coverage is atmosphere state.
  it("groups the controls into Rendering, Weather and Diagnostics", () => {
    const { container } = render(<RenderingPanel onClose={() => {}} />);

    const titles = [...container.querySelectorAll(".attr-section-title")].map(
      (el) => el.textContent,
    );
    expect(titles).toEqual(["Rendering", "Weather", "Diagnostics"]);

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
    expect(labelsIn(1)).toEqual(["Clouds", "Cloud Coverage", "Lens Flare"]);
    // The precipitation picker is labelled by a <label for>, not aria-label.
    expect(sectionAt(1).querySelector("#advanced-precipitation")).toBeTruthy();
    expect(sectionAt(2).textContent).toContain("Streaming Fetch Box");
  });

  // The reset is a PANEL-WIDE footer action now, not a button tucked inside
  // the last section resetting only one of the two stores the panel's controls
  // come from. Neither store maps to a section — lens flare, cloud coverage and
  // precipitation live in `atmosphereStore` purely for historical reasons — so
  // a reset bound to one alone would leave part of every section untouched.
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
