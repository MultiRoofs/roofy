import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { AnalysisTab } from "../../../../src/ui/inspector/AnalysisTab";
import { useSelectionStore } from "../../../../src/features/selection/selectionStore";
import type { Surface } from "../../../../src/domain/citymodel/types";

/** A unit square at height `z`, so area and normal are exact. */
function flatSquare(type: Surface["type"], z: number): Surface {
  return {
    type,
    rings: [
      [
        [0, 0, z],
        [1, 0, z],
        [1, 1, z],
        [0, 1, z],
      ],
    ],
    attributes: {},
    lod: "2",
  };
}

// Index 0/1 are roofs, 2 is a wall — the wall is what surface picking can
// land on that the roof-only list never showed.
const SURFACES: Surface[] = [
  flatSquare("RoofSurface", 10),
  flatSquare("RoofSurface", 12),
  {
    type: "WallSurface",
    rings: [
      [
        [0, 0, 0],
        [1, 0, 0],
        [1, 0, 10],
        [0, 0, 10],
      ],
    ],
    attributes: {},
    lod: "2",
  },
];

afterEach(() => {
  cleanup();
  useSelectionStore.setState({ mode: "object", selections: [] });
});

describe("AnalysisTab", () => {
  it("defaults to the building aggregate in object pick mode", () => {
    render(<AnalysisTab surfaces={SURFACES} selectedSurfaceIndex={null} />);
    expect(screen.getByText("Roof Analysis")).toBeTruthy();
  });

  it("lists every roof surface under the Surface scope in object pick mode", () => {
    render(<AnalysisTab surfaces={SURFACES} selectedSurfaceIndex={null} />);
    fireEvent.click(screen.getByText("Surface"));
    expect(screen.getByText("Roof Surface #0")).toBeTruthy();
    expect(screen.getByText("Roof Surface #1")).toBeTruthy();
    // The wall never joins the roof list.
    expect(screen.queryByText(/Wall Surface/)).toBeNull();
  });

  it("shows ONLY the picked surface in surface pick mode", () => {
    useSelectionStore.setState({ mode: "surface" });
    render(<AnalysisTab surfaces={SURFACES} selectedSurfaceIndex={1} />);
    // Surface scope is the default when a surface was picked...
    expect(screen.getByText("Roof Surface #1")).toBeTruthy();
    // ...and the sibling roofs stay out of it.
    expect(screen.queryByText("Roof Surface #0")).toBeNull();
    expect(screen.queryByText("Roof Analysis")).toBeNull();
  });

  it("shows a picked non-roof surface under its real type", () => {
    useSelectionStore.setState({ mode: "surface" });
    render(<AnalysisTab surfaces={SURFACES} selectedSurfaceIndex={2} />);
    expect(screen.getByText("Wall Surface #2")).toBeTruthy();
  });

  it("still reaches the building aggregate through the toggle in surface pick mode", () => {
    useSelectionStore.setState({ mode: "surface" });
    render(<AnalysisTab surfaces={SURFACES} selectedSurfaceIndex={1} />);
    fireEvent.click(screen.getByText("Building"));
    expect(screen.getByText("Roof Analysis")).toBeTruthy();
  });

  it("keeps the placeholder for a roofless object in object mode", () => {
    const walls = [SURFACES[2]!];
    render(<AnalysisTab surfaces={walls} selectedSurfaceIndex={null} />);
    expect(
      screen.getByText("No roof surfaces found on this object"),
    ).toBeTruthy();
  });

  it("analyses a picked wall even when the object has no roofs", () => {
    useSelectionStore.setState({ mode: "surface" });
    const walls = [SURFACES[2]!];
    render(<AnalysisTab surfaces={walls} selectedSurfaceIndex={0} />);
    expect(screen.getByText("Wall Surface #0")).toBeTruthy();
  });
});
