import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { CameraControls } from "../../../../src/ui/viewport/CameraControls";
import { publishCameraPose } from "../../../../src/scene/cameraPose";
import {
  DEFAULT_VIEW_MODE,
  useViewModeStore,
} from "../../../../src/features/viewMode/viewModeStore";

function handlers() {
  return {
    onResetNorth: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onTiltUp: vi.fn(),
    onTiltDown: vi.fn(),
  };
}

describe("CameraControls", () => {
  beforeEach(() => {
    publishCameraPose(null);
    useViewModeStore.setState({ mode: DEFAULT_VIEW_MODE });
  });

  afterEach(() => {
    cleanup();
    publishCameraPose(null);
    useViewModeStore.setState({ mode: DEFAULT_VIEW_MODE });
  });

  it("shows the live bearing and cardinal, and turns the dial to match", () => {
    render(<CameraControls {...handlers()} />);
    act(() => publishCameraPose({ heading: 90, pitch: -45, lat: 52 }));

    const compass = screen.getByRole("button", { name: /reset heading/i });
    expect(compass.textContent).toContain("090°");
    expect(compass.textContent).toContain("E");
    // The dial is rotated by the NEGATED heading, so its N points at north.
    const dial = compass.querySelector(".camera-compass-dial");
    expect(dial).not.toBeNull();
    expect((dial as HTMLElement).style.transform).toBe("rotate(270deg)");
  });

  it("re-renders as the camera turns, without being handed a prop", () => {
    render(<CameraControls {...handlers()} />);
    act(() => publishCameraPose({ heading: 0, pitch: -60, lat: 52 }));
    expect(
      screen.getByRole("button", { name: /reset heading/i }).textContent,
    ).toContain("000°");
    act(() => publishCameraPose({ heading: 225, pitch: -60, lat: 52 }));
    const compass = screen.getByRole("button", { name: /reset heading/i });
    expect(compass.textContent).toContain("225°");
    expect(compass.textContent).toContain("SW");
  });

  it("reads the tilt out in degrees below the horizon", () => {
    render(<CameraControls {...handlers()} />);
    act(() => publishCameraPose({ heading: 0, pitch: -32.6, lat: 52 }));
    expect(screen.getByTitle("Tilt below the horizon").textContent).toBe("33°");
  });

  it("wires every button to its own callback", () => {
    const h = handlers();
    render(<CameraControls {...h} />);
    act(() => publishCameraPose({ heading: 10, pitch: -45, lat: 52 }));

    screen.getByRole("button", { name: /reset heading/i }).click();
    screen.getByRole("button", { name: "Zoom in" }).click();
    screen.getByRole("button", { name: "Zoom out" }).click();
    screen.getByRole("button", { name: /towards the horizon/i }).click();
    screen.getByRole("button", { name: /towards a plan view/i }).click();

    expect(h.onResetNorth).toHaveBeenCalledTimes(1);
    expect(h.onZoomIn).toHaveBeenCalledTimes(1);
    expect(h.onZoomOut).toHaveBeenCalledTimes(1);
    expect(h.onTiltUp).toHaveBeenCalledTimes(1);
    expect(h.onTiltDown).toHaveBeenCalledTimes(1);
  });

  it("is inert, but still in place, while there is no camera", () => {
    const h = handlers();
    const { container } = render(<CameraControls {...h} />);
    // The engine has not rendered its first frame: every button refuses, and
    // the cluster is dimmed rather than removed — it must not appear and
    // disappear under the cursor.
    expect(container.querySelector(".camera-controls.is-idle")).not.toBeNull();
    for (const button of screen.getAllByRole("button")) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      button.click();
    }
    expect(h.onZoomIn).not.toHaveBeenCalled();
    expect(h.onResetNorth).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /reset heading/i }).textContent,
    ).toContain("000°");
  });

  it("goes back to idle when the camera goes away", () => {
    const { container } = render(<CameraControls {...handlers()} />);
    act(() => publishCameraPose({ heading: 33, pitch: -45, lat: 52 }));
    expect(container.querySelector(".camera-controls.is-idle")).toBeNull();
    act(() => publishCameraPose(null));
    expect(container.querySelector(".camera-controls.is-idle")).not.toBeNull();
  });

  // The view modes reach the cluster through `viewModePolicy`, not through a
  // second copy of "what 2D forbids".
  it("locks the tilt buttons in 2D, and says why", () => {
    useViewModeStore.setState({ mode: "2d" });
    const h = handlers();
    render(<CameraControls {...h} />);
    act(() => publishCameraPose({ heading: 0, pitch: -89.9, lat: 52 }));

    const up = screen.getByRole("button", {
      name: /towards the horizon/i,
    }) as HTMLButtonElement;
    expect(up.disabled).toBe(true);
    expect(up.title).toMatch(/2D/);
    up.click();
    expect(h.onTiltUp).not.toHaveBeenCalled();
    // Zooming and re-centring on north still work — 2D is a plan view, not a
    // frozen one.
    expect(
      (screen.getByRole("button", { name: "Zoom in" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("keeps the tilt buttons in 2.5D, where they snap back to the pinned angle", () => {
    useViewModeStore.setState({ mode: "2.5d" });
    const h = handlers();
    render(<CameraControls {...h} />);
    act(() => publishCameraPose({ heading: 0, pitch: -60, lat: 52 }));
    screen.getByRole("button", { name: /towards the horizon/i }).click();
    expect(h.onTiltUp).toHaveBeenCalledTimes(1);
  });
});
