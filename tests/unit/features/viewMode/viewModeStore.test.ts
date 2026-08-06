/**
 * The view-mode store: three values, one action, and a default that the whole
 * viewer's camera behaviour hangs off.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_VIEW_MODE,
  VIEW_MODES,
  useViewModeStore,
} from "../../../../src/features/viewMode/viewModeStore";

beforeEach(() => {
  useViewModeStore.setState({ mode: DEFAULT_VIEW_MODE });
});

describe("viewModeStore", () => {
  it("starts in 3D — the mode the viewer has always been in", () => {
    expect(DEFAULT_VIEW_MODE).toBe("3d");
    expect(useViewModeStore.getState().mode).toBe("3d");
  });

  it("offers exactly the three modes, flattest first", () => {
    expect(VIEW_MODES).toEqual(["2d", "2.5d", "3d"]);
  });

  it("switches mode", () => {
    useViewModeStore.getState().setViewMode("2d");
    expect(useViewModeStore.getState().mode).toBe("2d");
    useViewModeStore.getState().setViewMode("2.5d");
    expect(useViewModeStore.getState().mode).toBe("2.5d");
  });

  it("keeps the same state object when the mode is set to what it already is", () => {
    const before = useViewModeStore.getState();
    useViewModeStore.getState().setViewMode("3d");
    // The viewport's mode effect flies the camera on every CHANGE; a re-set to
    // the current mode must not read as one.
    expect(useViewModeStore.getState()).toBe(before);
  });
});
