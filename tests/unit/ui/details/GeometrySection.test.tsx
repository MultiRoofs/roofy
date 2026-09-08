import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GeometrySection } from "../../../../src/ui/details/GeometrySection";

const object = {
  id: "r",
  objectType: "Building",
  attributes: {},
  surfaces: [],
  bbox: null,
  children: [],
  parents: [],
  lod: null,
} as const;
describe("GeometrySection streaming geometry", () => {
  it("does not fabricate zero counts when rings are unavailable", () => {
    render(<GeometrySection object={object} geometryAvailable={false} />);
    expect(screen.getAllByText("Unavailable")).toHaveLength(4);
    expect(screen.getByText("Building")).toBeTruthy();
  });
});
