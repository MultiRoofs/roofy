/**
 * The identity trail: breadcrumb labels, and the actions a crumb carries.
 */
import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IdentityTrail } from "../../../../src/ui/details/IdentityTrail";

describe("IdentityTrail", () => {
  it("renders the layer crumb as a button that activates the layer", () => {
    const onActivateLayer = vi.fn();
    render(
      <IdentityTrail
        trail={[
          { label: "Delft", act: "activate-layer" },
          { label: "Building …25028", act: "current" },
        ]}
        fullId="NL.IMBAG.Pand.0503100000025028"
        onActivateLayer={onActivateLayer}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delft" }));
    expect(onActivateLayer).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("renders a building crumb as a button that narrows to the building", () => {
    const onNarrow = vi.fn();
    render(
      <IdentityTrail
        trail={[
          { label: "Delft", act: "activate-layer" },
          { label: "Building …25028", act: "narrow-to-building" },
          { label: "Roof surface 0", act: "current" },
        ]}
        fullId="NL.IMBAG.Pand.0503100000025028"
        onActivateLayer={() => {}}
        onNarrowToBuilding={onNarrow}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Building …25028" }));
    expect(onNarrow).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("shows the full id in mono", () => {
    render(
      <IdentityTrail
        trail={[{ label: "Delft", act: "activate-layer" }]}
        fullId="NL.IMBAG.Pand.0503100000025028"
        onActivateLayer={() => {}}
      />,
    );
    expect(screen.getByText("NL.IMBAG.Pand.0503100000025028")).toBeTruthy();
    cleanup();
  });
});
