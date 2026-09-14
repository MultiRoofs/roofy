/**
 * The details summary section: rows, and the "Belongs to" link selecting the
 * owning building.
 */
import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SummarySection } from "../../../../src/ui/details/SummarySection";

describe("SummarySection", () => {
  it("renders rows as key/value pairs", () => {
    render(
      <SummarySection
        rows={[
          { label: "Roof area", value: "150.0 m²" },
          { label: "Height", value: "12.4 m" },
        ]}
      />,
    );

    expect(screen.getByText("Roof area")).toBeTruthy();
    expect(screen.getByText("150.0 m²")).toBeTruthy();
    expect(screen.getByText("Height")).toBeTruthy();
    cleanup();
  });

  it("renders an owner row as a link that selects the owner", () => {
    const onSelectOwner = vi.fn();
    render(
      <SummarySection
        rows={[{ label: "Belongs to", value: "Building …25028", act: "owner" }]}
        onSelectOwner={onSelectOwner}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Building …25028" }));
    expect(onSelectOwner).toHaveBeenCalledTimes(1);
    cleanup();
  });
});
