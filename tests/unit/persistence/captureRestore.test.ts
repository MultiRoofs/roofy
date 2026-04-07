/**
 * Unit tests for captureSnapshot and restoreSnapshot.
 *
 * captureSnapshot is now a pure function taking explicit params.
 * restoreSnapshot writes to Zustand stores.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { captureSnapshot } from "../../../src/persistence/captureSnapshot";
import { restoreSnapshot } from "../../../src/persistence/restoreSnapshot";
import { useRuleStore } from "../../../src/features/rules/ruleStore";
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
  useRuleStore.setState({ rules: [], enabled: true });
  useSelectionStore.setState({ mode: "object", selection: null, hovered: null });
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
      modelRef: { type: "url", url: "https://example.com/model.city.json" },
      cameraPosition: [10, 20, 30],
      cameraTarget: [0, 5, 0],
      datetime: new Date("2025-12-21T10:00:00Z"),
      rules: [testRule],
      rulesEnabled: false,
      pickMode: "surface",
    });

    expect(snapshot.version).toBe("1");
    expect(snapshot.label).toBe("Test");
    expect(snapshot.modelRef).toEqual({ type: "url", url: "https://example.com/model.city.json" });
    expect(snapshot.viewState.cameraPosition).toEqual([10, 20, 30]);
    expect(snapshot.viewState.cameraTarget).toEqual([0, 5, 0]);
    expect(snapshot.viewState.datetime).toBe("2025-12-21T10:00:00.000Z");
    expect(snapshot.rules).toHaveLength(1);
    expect(snapshot.rules[0]!.name).toBe("South-facing");
    expect(snapshot.rulesEnabled).toBe(false);
    expect(snapshot.pickMode).toBe("surface");
    expect(snapshot.savedAt).toBeTruthy();
  });

  it("is a pure function — does not read from stores", () => {
    // Set stores to specific values
    useRuleStore.setState({ rules: [testRule], enabled: false });

    // Capture with different values — should use params, not store state
    const snapshot = captureSnapshot({
      label: "Pure",
      modelRef: null,
      cameraPosition: [0, 0, 0],
      cameraTarget: [0, 0, 0],
      datetime: new Date("2030-01-01T00:00:00Z"),
      rules: [],
      rulesEnabled: true,
      pickMode: "object",
    });

    expect(snapshot.rules).toHaveLength(0);
    expect(snapshot.rulesEnabled).toBe(true);
  });
});

describe("restoreSnapshot", () => {
  it("restores all store state from a snapshot", () => {
    const snapshot = captureSnapshot({
      label: "Restore test",
      modelRef: null,
      cameraPosition: [100, 200, 300],
      cameraTarget: [10, 10, 10],
      datetime: new Date(Date.UTC(2025, 5, 21, 12, 0, 0)),
      rules: [],
      rulesEnabled: true,
      pickMode: "object",
    });

    // Mutate stores
    useRuleStore.setState({ rules: [testRule], enabled: false });
    useSelectionStore.setState({ mode: "surface" });

    const viewState = restoreSnapshot(snapshot);

    expect(useRuleStore.getState().rules).toHaveLength(0);
    expect(useRuleStore.getState().enabled).toBe(true);
    expect(useSelectionStore.getState().mode).toBe("object");
    expect(useSelectionStore.getState().selection).toBeNull();
    expect(viewState.cameraPosition).toEqual([100, 200, 300]);
    expect(viewState.cameraTarget).toEqual([10, 10, 10]);
  });

  it("restores datetime to the solar store", () => {
    const snapshot = captureSnapshot({
      label: "Datetime test",
      modelRef: null,
      cameraPosition: [0, 0, 0],
      cameraTarget: [0, 0, 0],
      datetime: new Date("2025-12-21T10:00:00Z"),
      rules: [],
      rulesEnabled: true,
      pickMode: "object",
    });

    restoreSnapshot(snapshot);

    const { datetime } = useSolarStore.getState();
    expect(datetime.toISOString()).toBe("2025-12-21T10:00:00.000Z");
  });

  it("round-trips rules with conditions", () => {
    const snapshot = captureSnapshot({
      label: "Rules round-trip",
      modelRef: null,
      cameraPosition: [0, 0, 0],
      cameraTarget: [0, 0, 0],
      datetime: new Date(Date.UTC(2025, 5, 21, 12, 0, 0)),
      rules: [testRule],
      rulesEnabled: false,
      pickMode: "object",
    });

    useRuleStore.setState({ rules: [], enabled: true });
    restoreSnapshot(snapshot);

    const { rules, enabled } = useRuleStore.getState();
    expect(rules).toHaveLength(1);
    expect(rules[0]!.id).toBe("r1");
    expect(rules[0]!.conditions[0]!.field).toBe("azimuthDeg");
    expect(enabled).toBe(false);
  });

  it("handles invalid datetime gracefully", () => {
    const snapshot = captureSnapshot({
      label: "Bad datetime",
      modelRef: null,
      cameraPosition: [0, 0, 0],
      cameraTarget: [0, 0, 0],
      datetime: new Date(Date.UTC(2025, 5, 21, 12, 0, 0)),
      rules: [],
      rulesEnabled: true,
      pickMode: "object",
    });

    // Manually corrupt the datetime
    const corrupted = { ...snapshot, viewState: { ...snapshot.viewState, datetime: "not-a-date" } };

    // Should not throw
    const before = useSolarStore.getState().datetime;
    restoreSnapshot(corrupted);
    const after = useSolarStore.getState().datetime;

    // Datetime should remain unchanged (invalid date skipped)
    expect(after.toISOString()).toBe(before.toISOString());
  });
});
