/**
 * The scale bar overlay.
 *
 * The maths is pinned in `tests/unit/scene/mapScale.test.ts`; what is asserted
 * here is the wiring — it reads the SAME camera-pose publisher the compass
 * does (no second engine subscription), and it shows nothing rather than a
 * made-up scale when the engine has not reported a zoom yet.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { publishCameraPose } from "../../../../src/scene/cameraPose";
import { ScaleBar } from "../../../../src/ui/viewport/ScaleBar";

beforeEach(() => {
  publishCameraPose(null);
});

afterEach(() => {
  cleanup();
  publishCameraPose(null);
});

describe("ScaleBar", () => {
  it("renders nothing before the engine reports a camera", () => {
    const { container } = render(<ScaleBar />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing while the camera has no zoom to report", () => {
    const { container } = render(<ScaleBar />);
    act(() => publishCameraPose({ heading: 0, pitch: -60, lat: 52 }));
    expect(container.firstChild).toBeNull();
  });

  it("shows a rounded distance for the current zoom", () => {
    render(<ScaleBar />);
    // 52°N, zoom 17: ~0.73 m/px, so ~88 m fits in 120 px -> the 50 m rung.
    act(() => publishCameraPose({ heading: 0, pitch: -60, lat: 52, zoom: 17 }));
    expect(screen.getByText("50 m")).toBeTruthy();
  });

  it("shrinks the distance it represents as the camera zooms in", () => {
    // Not strictly per step: the 1-2-5 ladder is coarser than a zoom level, so
    // two neighbouring zooms can legitimately share a rung. Over two steps the
    // ground distance must fall.
    render(<ScaleBar />);
    act(() => publishCameraPose({ heading: 0, pitch: -60, lat: 0, zoom: 12 }));
    expect(screen.getByText("2 km")).toBeTruthy();
    act(() => publishCameraPose({ heading: 0, pitch: -60, lat: 0, zoom: 14 }));
    expect(screen.getByText("1 km")).toBeTruthy();
    act(() => publishCameraPose({ heading: 0, pitch: -60, lat: 0, zoom: 18 }));
    expect(screen.getByText("50 m")).toBeTruthy();
  });

  it("draws the bar at the width the scale asks for", () => {
    const { container } = render(<ScaleBar />);
    act(() => publishCameraPose({ heading: 0, pitch: -60, lat: 52, zoom: 17 }));
    const bar = container.querySelector(".scale-bar-track") as HTMLElement;
    expect(bar).toBeTruthy();
    expect(Number.parseFloat(bar.style.width)).toBeGreaterThan(0);
    expect(Number.parseFloat(bar.style.width)).toBeLessThanOrEqual(120);
  });

  it("says that the scale is the one at the centre of the view", () => {
    const { container } = render(<ScaleBar />);
    act(() => publishCameraPose({ heading: 0, pitch: -60, lat: 52, zoom: 17 }));
    const root = container.querySelector(".scale-bar") as HTMLElement;
    expect(root.title).toMatch(/centre/i);
  });

  it("disappears again when the camera does", () => {
    const { container } = render(<ScaleBar />);
    act(() => publishCameraPose({ heading: 0, pitch: -60, lat: 52, zoom: 17 }));
    expect(container.firstChild).not.toBeNull();
    act(() => publishCameraPose(null));
    expect(container.firstChild).toBeNull();
  });
});
