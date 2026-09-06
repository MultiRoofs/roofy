import { describe, it, expect, beforeEach } from "vitest";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";

describe("workspaceStore", () => {
  beforeEach(() => useWorkspaceStore.setState({ activeLayerId: null }));
  it("starts with no active layer", () => {
    expect(useWorkspaceStore.getState().activeLayerId).toBeNull();
  });
  it("sets and clears the active layer id", () => {
    useWorkspaceStore.getState().setActiveLayerId("a");
    expect(useWorkspaceStore.getState().activeLayerId).toBe("a");
    useWorkspaceStore.getState().setActiveLayerId(null);
    expect(useWorkspaceStore.getState().activeLayerId).toBeNull();
  });
});
