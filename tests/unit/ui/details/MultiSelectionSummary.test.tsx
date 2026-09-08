import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MultiSelectionSummary } from "../../../../src/ui/details/MultiSelectionSummary";

const objects = [
  {
    id: "root",
    objectType: "Building",
    attributes: {},
    surfaces: [],
    bbox: null,
    children: ["part"],
    parents: [],
    lod: null,
  },
] as const;

describe("MultiSelectionSummary resident metrics", () => {
  it("renders root-plus-part resident roof area supplied by Details resolution", () => {
    render(
      <MultiSelectionSummary
        objects={objects}
        roofAreaByObjectId={{ root: 42.5 }}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText("42.5 m²")).toBeTruthy();
  });

  it("reports an evicted resident metric as unavailable", () => {
    render(
      <MultiSelectionSummary
        objects={objects}
        roofAreaByObjectId={{ root: null }}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText("Unavailable")).toBeTruthy();
  });
});
