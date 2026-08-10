import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getCameraPose,
  publishCameraPose,
  subscribeCameraPose,
} from "../../../src/scene/cameraPose";

describe("cameraPose", () => {
  beforeEach(() => {
    publishCameraPose(null);
  });

  it("hands out the pose that was last published", () => {
    expect(getCameraPose()).toBeNull();
    publishCameraPose({ heading: 42, pitch: -30, lat: 52 });
    expect(getCameraPose()).toEqual({ heading: 42, pitch: -30, lat: 52 });
  });

  // The pose carries the scale bar's two inputs as well as the compass's two:
  // one publisher, one beat, one subscription — see this module's own comment.
  it("carries the latitude and the zoom the scale bar reads", () => {
    publishCameraPose({ heading: 0, pitch: -60, lat: 52.01, zoom: 15.5 });
    expect(getCameraPose()).toEqual({
      heading: 0,
      pitch: -60,
      lat: 52.01,
      zoom: 15.5,
    });
  });

  it("publishes a zoom change on a camera that has not turned", () => {
    const listener = vi.fn();
    publishCameraPose({ heading: 0, pitch: -60, lat: 52, zoom: 15 });
    subscribeCameraPose(listener);
    // A pure zoom moves neither the heading nor the pitch; treating the pose
    // as unchanged would freeze the scale bar at the wrong scale.
    publishCameraPose({ heading: 0, pitch: -60, lat: 52, zoom: 16 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getCameraPose()!.zoom).toBe(16);
    // Sub-hundredth drift is not a zoom.
    publishCameraPose({ heading: 0, pitch: -60, lat: 52, zoom: 16.001 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("treats the arrival of a zoom as a change", () => {
    const listener = vi.fn();
    publishCameraPose({ heading: 0, pitch: -60, lat: 52 });
    subscribeCameraPose(listener);
    publishCameraPose({ heading: 0, pitch: -60, lat: 52, zoom: 14 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("publishes a pan that only changed the latitude", () => {
    const listener = vi.fn();
    publishCameraPose({ heading: 0, pitch: -60, lat: 52, zoom: 14 });
    subscribeCameraPose(listener);
    publishCameraPose({ heading: 0, pitch: -60, lat: 60, zoom: 14 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("notifies every subscriber on a real change", () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribeCameraPose(a);
    const offB = subscribeCameraPose(b);
    publishCameraPose({ heading: 10, pitch: -20, lat: 52 });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offB();
    publishCameraPose({ heading: 90, pitch: -20, lat: 52 });
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("swallows sub-degree drift, so a still camera re-renders nobody", () => {
    const listener = vi.fn();
    subscribeCameraPose(listener);
    publishCameraPose({ heading: 10, pitch: -20, lat: 52 });
    expect(listener).toHaveBeenCalledTimes(1);
    const settled = getCameraPose();
    // Below the epsilon: not a movement, so neither the snapshot nor the
    // subscribers move either (a changed snapshot alone would tear
    // `useSyncExternalStore` into an infinite render loop).
    publishCameraPose({ heading: 10.02, pitch: -20.01, lat: 52 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getCameraPose()).toBe(settled);
    // Above it: a movement.
    publishCameraPose({ heading: 10.2, pitch: -20, lat: 52 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("treats the arrival and the loss of a camera as changes", () => {
    const listener = vi.fn();
    subscribeCameraPose(listener);
    publishCameraPose(null);
    expect(listener).not.toHaveBeenCalled();
    publishCameraPose({ heading: 0, pitch: -60, lat: 52 });
    expect(listener).toHaveBeenCalledTimes(1);
    publishCameraPose(null);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getCameraPose()).toBeNull();
  });

  it("survives a listener that unsubscribes from inside its own callback", () => {
    // React does exactly this on unmount; iterating the live set would skip
    // whichever listener followed it.
    const second = vi.fn();
    const off = subscribeCameraPose(() => off());
    subscribeCameraPose(second);
    publishCameraPose({ heading: 5, pitch: -10, lat: 52 });
    expect(second).toHaveBeenCalledTimes(1);
  });
});
