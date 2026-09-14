/**
 * §8 splits a picked feature's attributes by PROVENANCE, and §7.6 says a vector
 * layer's computed properties behave "like any other attribute" — so the
 * columns a tool wrote for THIS layer move into a COMPUTED group with the badge
 * and the provenance tooltip, exactly as they do for a city object.
 *
 * The split is the registry's answer and never a guess from the key's name: a
 * source document may carry a `bld_buildings_n` of its own.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { GeoFeatureDetails } from "../../../../src/ui/details/GeoFeatureDetails";
import { useComputedColumnStore } from "../../../../src/insights/computedColumns";

const selection = {
  geoLayerId: "GEO",
  batchId: 4,
  stableFeatureId: "id:string:z1",
  properties: { zone: "A", bld_buildings_n: 3 },
};

beforeEach(() => {
  useComputedColumnStore.setState({ byLayer: {} });
});

// The setup file does not install RTL's auto-cleanup, so each case would
// otherwise query the previous case's DOM as well as its own.
afterEach(cleanup);

describe("GeoFeatureDetails", () => {
  it("puts a run's column in the COMPUTED group with its provenance", () => {
    useComputedColumnStore.getState().setProvenance("GEO", "bld_buildings_n", {
      runId: "run_1",
      toolName: "Aggregate buildings per area",
      summary: "All 3 buildings",
      at: Date.parse("2026-09-12T14:02:00"),
      partial: null,
      previous: null,
    });
    render(<GeoFeatureDetails selection={selection} />);
    const group = screen.getByRole("group", { name: "Computed attributes" });
    expect(within(group).getByText("bld_buildings_n")).toBeInTheDocument();
    // The VALUE is shown beside it, in the computed group and nowhere else.
    expect(within(group).getByText("3")).toBeInTheDocument();
    expect(within(group).queryByText("zone")).toBeNull();
    expect(
      screen.getByTitle(/Aggregate buildings per area/),
    ).toBeInTheDocument();
  });

  it("leaves a same-named property of the FILE's own where it is", () => {
    render(<GeoFeatureDetails selection={selection} />);
    expect(
      screen.queryByRole("group", { name: "Computed attributes" }),
    ).toBeNull();
    // Also in the summary rows, so the row itself is counted rather than found.
    expect(screen.getAllByText("bld_buildings_n").length).toBeGreaterThan(0);
    expect(screen.queryByTitle(/Aggregate/)).toBeNull();
  });
});
