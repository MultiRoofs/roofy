/**
 * Unit tests for captureSnapshot and restoreSnapshot.
 *
 * captureSnapshot is a pure function taking explicit params.
 * restoreSnapshot writes to Zustand stores (selection, solar).
 * Layer state (including rules) is handled by the layer store,
 * restored by the caller (App.tsx), not by restoreSnapshot.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { captureSnapshot } from "../../../src/persistence/captureSnapshot";
import { restoreSnapshot } from "../../../src/persistence/restoreSnapshot";
import { useSelectionStore } from "../../../src/features/selection/selectionStore";
import { useSolarStore } from "../../../src/features/solar/solarStore";
import type { Rule } from "../../../src/features/rules/types";

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
    selection: null,
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
      cameraPosition: [10, 20, 30],
      cameraTarget: [0, 5, 0],
      datetime: new Date("2025-12-21T10:00:00Z"),
      pickMode: "surface",
    });

    expect(snapshot.version).toBe("2");
    expect(snapshot.label).toBe("Test");
    expect(snapshot.layers).toHaveLength(1);
    expect(snapshot.layers![0]!.name).toBe("delft");
    expect(snapshot.layers![0]!.rules).toHaveLength(1);
    expect(snapshot.layers![0]!.rules[0]!.name).toBe("South-facing");
    expect(snapshot.layers![0]!.rulesEnabled).toBe(false);
    expect(snapshot.viewState.cameraPosition).toEqual([10, 20, 30]);
    expect(snapshot.viewState.cameraTarget).toEqual([0, 5, 0]);
    expect(snapshot.viewState.datetime).toBe("2025-12-21T10:00:00.000Z");
    expect(snapshot.pickMode).toBe("surface");
    expect(snapshot.savedAt).toBeTruthy();
  });

  it("is a pure function — does not read from stores", () => {
    // Capture with specific values — should use params, not store state
    const snapshot = captureSnapshot({
      label: "Pure",
      layers: [],
      cameraPosition: [0, 0, 0],
      cameraTarget: [0, 0, 0],
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
      cameraPosition: [100, 200, 300],
      cameraTarget: [10, 10, 10],
      datetime: new Date(Date.UTC(2025, 5, 21, 12, 0, 0)),
      pickMode: "object",
    });

    // Mutate stores
    useSelectionStore.setState({ mode: "surface" });

    const viewState = restoreSnapshot(snapshot);

    expect(useSelectionStore.getState().mode).toBe("object");
    expect(useSelectionStore.getState().selection).toBeNull();
    expect(viewState.cameraPosition).toEqual([100, 200, 300]);
    expect(viewState.cameraTarget).toEqual([10, 10, 10]);
  });

  it("restores datetime to the solar store", () => {
    const snapshot = captureSnapshot({
      label: "Datetime test",
      layers: [],
      cameraPosition: [0, 0, 0],
      cameraTarget: [0, 0, 0],
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
      cameraPosition: [0, 0, 0],
      cameraTarget: [0, 0, 0],
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

  it("handles invalid datetime gracefully", () => {
    const snapshot = captureSnapshot({
      label: "Bad datetime",
      layers: [],
      cameraPosition: [0, 0, 0],
      cameraTarget: [0, 0, 0],
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
});
