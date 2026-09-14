import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CameraCluster } from "../../../../src/ui/viewport/CameraCluster";
import { useViewModeStore } from "../../../../src/features/viewMode/viewModeStore";

afterEach(cleanup);
it("cycles camera views through a single named icon button", () => {
  useViewModeStore.setState({ mode: "2.5d" });
  render(
    <CameraCluster
      onZoomIn={vi.fn()}
      onZoomOut={vi.fn()}
      onResetNorth={vi.fn()}
      onFit={vi.fn()}
      fitTitle="Fit active layer"
      onFitSelection={vi.fn()}
      selectionPresent={false}
      selectionTitle="Zoom to selection"
    />,
  );
  for (const [current, next, value] of [
    ["Angled", "Free 3D", "3d"],
    ["Free 3D", "Top-down", "2d"],
    ["Top-down", "Angled", "2.5d"],
  ]) {
    const button = screen.getByRole("button", {
      name: `Camera view: ${current}. Switch to ${next}`,
    });
    expect(button.textContent).toBe("");
    fireEvent.click(button);
    expect(useViewModeStore.getState().mode).toBe(value);
  }
  expect(screen.getByRole("button", { name: "Fit active layer" })).toBeTruthy();
});
