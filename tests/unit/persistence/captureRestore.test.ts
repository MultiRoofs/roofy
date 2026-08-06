/**
 * Unit tests for captureSnapshot and restoreSnapshot.
 *
 * captureSnapshot is a pure function taking explicit params.
 * restoreSnapshot writes to Zustand stores (selection, solar).
 * Layer state (including rules) is handled by the layer store,
 * restored by the caller (App.tsx), not by restoreSnapshot.
 *
 * Snapshot v3 stores the camera geographically
 * (`{lng, lat, height, heading, pitch, roll}`); v1/v2 snapshots carried two
 * scene-space 3-tuples and are rejected outright rather than migrated.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { captureSnapshot } from "../../../src/persistence/captureSnapshot";
import { restoreSnapshot } from "../../../src/persistence/restoreSnapshot";
import { UnsupportedSnapshotVersionError } from "../../../src/persistence/types";
import type { GeographicCamera } from "../../../src/persistence/types";
import type { GeographicCameraState } from "../../../src/scene/geographicCamera";
import { useSelectionStore } from "../../../src/features/selection/selectionStore";
import { useSolarStore } from "../../../src/features/solar/solarStore";
import type { Rule } from "../../../src/features/rules/types";

const CAM = {
  lng: 4.3571,
  lat: 52.0116,
  height: 800,
  heading: 30,
  pitch: -45,
  roll: 0,
} as const;

/**
 * Compile-time guard that the snapshot's `GeographicCamera` and the scene's
 * `GeographicCameraState` stay one shape. They are declared separately so
 * persistence never imports the scene layer (and vice versa); this assignment
 * fails `tsc` the moment either side gains or renames a field.
 */
const _sceneToSnapshot: GeographicCamera = CAM satisfies GeographicCameraState;
void _sceneToSnapshot;

const testRule: Rule = {
  id: "r1",
  name: "South-facing",
  color: "#ff0000",
  conditions: [{ field: "azimuthDeg", operator: ">", value: 135 }],
  logic: "AND",
  enabled: true,
};

beforeEach(() => {
  useSelectionStore.setState({
    mode: "object",
    selections: [],
    hovered: null,
  });
  useSolarStore.setState({
    datetime: new Date(Date.UTC(2025, 5, 21, 12, 0, 0)),
    latLon: null,
    sunPosition: null,
  });
});

describe("captureSnapshot", () => {
  it("captures provided values into a snapshot", () => {
    const snapshot = captureSnapshot({
      label: "Test",
      layers: [
        {
          name: "delft",
          modelRef: { type: "url", url: "https://example.com/model.city.json" },
          rules: [testRule],
          rulesEnabled: false,
          visible: true,
        },
      ],
      camera: CAM,
      datetime: new Date("2025-12-21T10:00:00Z"),
      pickMode: "surface",
    });

    expect(snapshot.version).toBe("3");
    expect(snapshot.label).toBe("Test");
    expect(snapshot.layers).toHaveLength(1);
    expect(snapshot.layers![0]!.name).toBe("delft");
    expect(snapshot.layers![0]!.rules).toHaveLength(1);
    expect(snapshot.layers![0]!.rules[0]!.name).toBe("South-facing");
    expect(snapshot.layers![0]!.rulesEnabled).toBe(false);
    expect(snapshot.viewState.camera).toEqual(CAM);
    expect(snapshot.viewState.datetime).toBe("2025-12-21T10:00:00.000Z");
    expect(snapshot.pickMode).toBe("surface");
    expect(snapshot.savedAt).toBeTruthy();
  });

  it("is a pure function — does not read from stores", () => {
    // Capture with specific values — should use params, not store state
    const snapshot = captureSnapshot({
      label: "Pure",
      layers: [],
      camera: CAM,
      datetime: new Date("2030-01-01T00:00:00Z"),
      pickMode: "object",
    });

    expect(snapshot.layers).toHaveLength(0);
  });
});

describe("restoreSnapshot", () => {
  it("restores selection and solar state from a snapshot", () => {
    const snapshot = captureSnapshot({
      label: "Restore test",
      layers: [],
      camera: CAM,
      datetime: new Date(Date.UTC(2025, 5, 21, 12, 0, 0)),
      pickMode: "object",
    });

    // Mutate stores
    useSelectionStore.setState({
      mode: "surface",
      selections: [{ kind: "object", layerId: "layer-1", objectId: "b1" }],
    });

    const viewState = restoreSnapshot(snapshot);

    expect(useSelectionStore.getState().mode).toBe("object");
    expect(useSelectionStore.getState().selections).toEqual([]);
    expect(viewState.camera).toEqual(CAM);
  });

  it("restores datetime to the solar store", () => {
    const snapshot = captureSnapshot({
      label: "Datetime test",
      layers: [],
      camera: CAM,
      datetime: new Date("2025-12-21T10:00:00Z"),
      pickMode: "object",
    });

    restoreSnapshot(snapshot);

    const { datetime } = useSolarStore.getState();
    expect(datetime.toISOString()).toBe("2025-12-21T10:00:00.000Z");
  });

  it("captures layers with rules correctly for round-trip", () => {
    const snapshot = captureSnapshot({
      label: "Rules round-trip",
      layers: [
        {
          name: "test-layer",
          modelRef: { type: "url", url: "https://example.com/model.city.json" },
          rules: [testRule],
          rulesEnabled: false,
          visible: true,
        },
      ],
      camera: CAM,
      datetime: new Date(Date.UTC(2025, 5, 21, 12, 0, 0)),
      pickMode: "object",
    });

    // Rules are stored in the snapshot's layers array
    expect(snapshot.layers).toHaveLength(1);
    expect(snapshot.layers![0]!.rules).toHaveLength(1);
    expect(snapshot.layers![0]!.rules[0]!.id).toBe("r1");
    expect(snapshot.layers![0]!.rules[0]!.conditions[0]!.field).toBe(
      "azimuthDeg",
    );
    expect(snapshot.layers![0]!.rulesEnabled).toBe(false);
  });

  it("survives a JSON round-trip, the shape localStorage and the share hash actually store", () => {
    const snapshot = captureSnapshot({
      label: "JSON round-trip",
      layers: [],
      camera: CAM,
      datetime: new Date("2025-12-21T10:00:00Z"),
      pickMode: "surface",
    });

    const viewState = restoreSnapshot(
      JSON.parse(JSON.stringify(snapshot)) as typeof snapshot,
    );

    expect(viewState.camera).toEqual(CAM);
    expect(viewState.datetime).toBe("2025-12-21T10:00:00.000Z");
    expect(useSelectionStore.getState().mode).toBe("surface");
  });

  it("handles invalid datetime gracefully", () => {
    const snapshot = captureSnapshot({
      label: "Bad datetime",
      layers: [],
      camera: CAM,
      datetime: new Date(Date.UTC(2025, 5, 21, 12, 0, 0)),
      pickMode: "object",
    });

    // Manually corrupt the datetime
    const corrupted = {
      ...snapshot,
      viewState: { ...snapshot.viewState, datetime: "not-a-date" },
    };

    // Should not throw
    const before = useSolarStore.getState().datetime;
    restoreSnapshot(corrupted);
    const after = useSolarStore.getState().datetime;

    // Datetime should remain unchanged (invalid date skipped)
    expect(after.toISOString()).toBe(before.toISOString());
  });

  it("rejects a v2 snapshot with a clear message instead of silently restoring a broken camera", () => {
    const v2 = {
      version: "2",
      savedAt: new Date().toISOString(),
      label: "old",
      layers: [],
      viewState: {
        cameraPosition: [1, 2, 3],
        cameraTarget: [0, 0, 0],
        datetime: new Date().toISOString(),
      },
      pickMode: "object",
    };
    expect(() => restoreSnapshot(v2 as never)).toThrow(
      UnsupportedSnapshotVersionError,
    );
    expect(() => restoreSnapshot(v2 as never)).toThrow(/older version/i);
  });

  it("rejects a v1 snapshot too", () => {
    expect(() => restoreSnapshot({ version: "1" } as never)).toThrow(
      UnsupportedSnapshotVersionError,
    );
  });

  it("names the version it found in the error", () => {
    try {
      restoreSnapshot({ version: "2" } as never);
      expect.unreachable("restoreSnapshot should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(UnsupportedSnapshotVersionError);
      expect((e as UnsupportedSnapshotVersionError).found).toBe("2");
      expect((e as Error).name).toBe("UnsupportedSnapshotVersionError");
    }
  });

  it("rejects a snapshot with no version at all", () => {
    expect(() =>
      restoreSnapshot({
        label: "x",
        viewState: { camera: CAM, datetime: "" },
      } as never),
    ).toThrow(UnsupportedSnapshotVersionError);
  });

  it("does NOT mutate the selection or solar stores when it rejects", () => {
    useSelectionStore.setState({
      mode: "surface",
      selections: [],
      hovered: null,
    });
    const datetimeBefore = useSolarStore.getState().datetime;
    expect(() => restoreSnapshot({ version: "2" } as never)).toThrow();
    expect(useSelectionStore.getState().mode).toBe("surface");
    expect(useSolarStore.getState().datetime).toBe(datetimeBefore);
  });
});

describe("view mode round trip", () => {
  it("captures the view mode into the snapshot's view state", () => {
    const snapshot = captureSnapshot({
      label: "L",
      layers: [],
      camera: CAM,
      datetime: new Date(Date.UTC(2025, 5, 21, 12, 0, 0)),
      pickMode: "object",
      viewMode: "2d",
    });
    expect(snapshot.viewState.viewMode).toBe("2d");
  });

  it("omits the field entirely when the viewer is in the default mode", () => {
    // Same convention as the other optional snapshot fields: absent means
    // "whatever the default is", so a 3D workspace writes no extra bytes.
    const snapshot = captureSnapshot({
      label: "L",
      layers: [],
      camera: CAM,
      datetime: new Date(Date.UTC(2025, 5, 21, 12, 0, 0)),
      pickMode: "object",
      viewMode: "3d",
    });
    expect(snapshot.viewState.viewMode).toBeUndefined();
  });

  it("hands the saved mode back to the caller on restore", () => {
    const snapshot = captureSnapshot({
      label: "L",
      layers: [],
      camera: CAM,
      datetime: new Date(Date.UTC(2025, 5, 21, 12, 0, 0)),
      pickMode: "object",
      viewMode: "2.5d",
    });
    expect(restoreSnapshot(snapshot).viewMode).toBe("2.5d");
  });
});

describe("scene theme round trip", () => {
  const base = {
    label: "L",
    layers: [],
    camera: CAM,
    datetime: new Date(Date.UTC(2025, 5, 21, 12, 0, 0)),
    pickMode: "object",
  } as const;

  it("captures the scene theme into the snapshot's view state", () => {
    const snapshot = captureSnapshot({ ...base, sceneTheme: "cyber" });
    expect(snapshot.viewState.sceneTheme).toBe("cyber");
  });

  it("omits the field entirely when the viewer is in the default theme", () => {
    // Exactly the `viewMode` convention: absent means "the default", so a
    // photoreal workspace writes no extra bytes.
    const snapshot = captureSnapshot({ ...base, sceneTheme: "photoreal" });
    expect(snapshot.viewState.sceneTheme).toBeUndefined();
  });

  it("hands the saved theme back to the caller on restore", () => {
    const snapshot = captureSnapshot({ ...base, sceneTheme: "wireframe" });
    expect(restoreSnapshot(snapshot).sceneTheme).toBe("wireframe");
  });

  it("reads a snapshot written before themes existed as photoreal", () => {
    const snapshot = captureSnapshot(base);
    expect(snapshot.viewState.sceneTheme).toBeUndefined();
    expect(restoreSnapshot(snapshot).sceneTheme).toBe("photoreal");
  });

  it("reads a hand-edited or truncated theme as photoreal", () => {
    // The value drives the RENDERER — an unknown theme would have no policy
    // entry to look up, so `sceneThemePolicy` would hand back `undefined` and
    // every environment push would throw. Unknown reads as the default, which
    // is always safe.
    const snapshot = captureSnapshot({ ...base, sceneTheme: "cyber" });
    const tampered = {
      ...snapshot,
      viewState: { ...snapshot.viewState, sceneTheme: "neon-dreams" },
    };
    expect(restoreSnapshot(tampered as never).sceneTheme).toBe("photoreal");
  });
});
