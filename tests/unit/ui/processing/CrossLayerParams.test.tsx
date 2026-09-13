/**
 * §7.5-§7.7's PARAMETERS sections: three tools, one component, and every
 * validation string §6 puts inline.
 *
 * A `{ params, onChange }` sibling of `RoofMetricsParams` — no store, no
 * engine — so the section can be driven directly and the write-back asserted
 * as a whole bag.
 *
 * The harness holds the bag in state, which is what `ToolView` does through the
 * draft store: a controlled field whose prop never moves cannot be typed into.
 */
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CrossLayerParams } from "../../../../src/ui/processing/CrossLayerParams";
import type { ProxyOption } from "../../../../src/features/processing/buildingProxy";
import type { ToolId } from "../../../../src/features/processing/types";
import type { ColumnType } from "../../../../src/insights/computedColumns";

const PROXIES: ReadonlyArray<ProxyOption> = [
  { key: "footprint", label: "Footprint (LoD 0)", available: true, note: null },
  { key: "rectangle", label: "Extent rectangle", available: true, note: null },
  { key: "centre", label: "Extent centre", available: true, note: null },
];
const NO_FOOTPRINT: ReadonlyArray<ProxyOption> = [
  {
    key: "footprint",
    label: "Footprint (LoD 0)",
    available: false,
    note: "LoD 0 footprints are not in this layer; the bounding-box centre is used.",
  },
  ...PROXIES.slice(1),
];
const TYPES: ReadonlyMap<string, ColumnType> = new Map<string, ColumnType>([
  ["zone", "VARCHAR"],
  ["noise", "DOUBLE"],
]);

type Props = Parameters<typeof CrossLayerParams>[0];

function Harness({
  initial,
  report,
  ...rest
}: Omit<Props, "params" | "onChange"> & {
  readonly initial: Readonly<Record<string, unknown>>;
  readonly report: (next: Readonly<Record<string, unknown>>) => void;
}) {
  const [params, setParams] = useState(initial);
  return (
    <CrossLayerParams
      {...rest}
      params={params}
      onChange={(next) => {
        report(next);
        setParams(next);
      }}
    />
  );
}

function renderSection(
  toolId: ToolId,
  params: Record<string, unknown>,
  over: Partial<Props> = {},
) {
  const onChange = vi.fn();
  render(
    <Harness
      toolId={toolId}
      initial={params}
      report={onChange}
      proxies={PROXIES}
      sourcePropertyKeys={["zone", "noise"]}
      sourcePropertyTypes={TYPES}
      sourceHasFeatureIds
      numericColumns={["roof_area_m2", "b3_h_dak_max"]}
      {...over}
    />,
  );
  return onChange;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** The `<p>` an aria-describedby points at, or null. Residual B11's whole
 *  point is that a row's sentence is ATTACHED to that row's controls, not
 *  floating under the section. */
function describedBy(control: HTMLElement): string | null {
  const id = control.getAttribute("aria-describedby");
  return id === null ? null : (document.getElementById(id)?.textContent ?? "");
}

describe("the building-geometry radio (§7.5)", () => {
  it("offers the three proxies and checks the one in the bag", () => {
    renderSection("join-by-location", { proxy: "rectangle" });
    expect(
      screen.getByRole("radio", { name: "Extent rectangle" }),
    ).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Footprint (LoD 0)" }),
    ).toBeEnabled();
  });

  it("disables the footprint and shows §7.5's muted line", () => {
    renderSection(
      "join-by-location",
      { proxy: "centre" },
      { proxies: NO_FOOTPRINT },
    );
    expect(
      screen.getByRole("radio", { name: "Footprint (LoD 0)" }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        "LoD 0 footprints are not in this layer; the bounding-box centre is used.",
      ),
    ).toBeInTheDocument();
  });

  it("writes the whole bag back on a change", async () => {
    const onChange = renderSection("join-by-location", {
      proxy: "footprint",
      predicate: "intersects",
      fields: ["zone"],
      tie: "first",
      writeMatchCount: false,
    });
    await userEvent.click(screen.getByRole("radio", { name: "Extent centre" }));
    expect(onChange).toHaveBeenCalledWith({
      proxy: "centre",
      predicate: "intersects",
      fields: ["zone"],
      tie: "first",
      writeMatchCount: false,
    });
  });

  /**
   * §7.5: `centre within` "forces the centre proxy". The radio has to SAY so —
   * the run is going to use the centre whatever the bag was opened on, and a
   * footprint left selected beside it is a promise the run does not keep.
   */
  it("forces and shows the centre proxy under 'centre within' (§7.5)", () => {
    renderSection("join-by-location", {
      proxy: "footprint",
      predicate: "centreWithin",
      fields: ["zone"],
    });
    expect(screen.getByRole("radio", { name: "Extent centre" })).toBeChecked();
    const footprint = screen.getByRole("radio", { name: "Footprint (LoD 0)" });
    expect(footprint).toBeDisabled();
    expect(footprint.closest("label")).toHaveAttribute(
      "title",
      "Forces the centre proxy",
    );
    expect(
      screen.getByRole("radio", { name: "Extent rectangle" }),
    ).toBeDisabled();
    // …and the tie rule that needs an area proxy goes with it (§6).
    const option = screen.getByRole("option", { name: /largest overlap/ });
    expect(option).toBeDisabled();
    expect(option).toHaveAttribute(
      "title",
      "Largest overlap needs a footprint or rectangle",
    );
  });

  it("forces the centre proxy for Aggregate too (§7.6 shares §7.5's)", () => {
    renderSection("aggregate-per-area", {
      proxy: "rectangle",
      predicate: "centreWithin",
      rows: [{ op: "count", column: null }],
    });
    expect(screen.getByRole("radio", { name: "Extent centre" })).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Extent rectangle" }),
    ).toBeDisabled();
  });

  it("leaves the proxies alone for Distance, which has no predicate", () => {
    renderSection("distance-to-nearest", {
      proxy: "footprint",
      predicate: "centreWithin",
    });
    expect(
      screen.getByRole("radio", { name: "Footprint (LoD 0)" }),
    ).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Extent rectangle" }),
    ).toBeEnabled();
  });

  it("renders only its own tool's controls", () => {
    renderSection("join-by-location", { fields: ["zone"] });
    expect(screen.queryByLabelText("Max search distance (m)")).toBeNull();
    expect(screen.queryByLabelText("Aggregate 1")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "+ Add aggregate" }),
    ).toBeNull();
  });
});

describe("Join attributes by location (§7.5)", () => {
  it("lists the source's properties with their types, all ticked by default", () => {
    renderSection("join-by-location", { fields: ["zone", "noise"] });
    expect(screen.getByRole("checkbox", { name: /zone/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /noise/ })).toBeChecked();
    expect(screen.getByText(/noise/)).toHaveTextContent("DOUBLE");
  });

  it("unticks a field and writes the SOURCE order back", async () => {
    const onChange = renderSection("join-by-location", {
      fields: ["zone", "noise"],
    });
    await userEvent.click(screen.getByRole("checkbox", { name: /zone/ }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ fields: ["noise"] }),
    );
  });

  it("disables largest overlap on the centre proxy, with §6's own text", () => {
    renderSection("join-by-location", { proxy: "centre", tie: "first" });
    const option = screen.getByRole("option", { name: /largest overlap/ });
    expect(option).toBeDisabled();
    expect(option).toHaveAttribute(
      "title",
      "Largest overlap needs a footprint or rectangle",
    );
  });

  it("forces the match count on when the tie rule is 'count only' (§7.5)", async () => {
    const onChange = renderSection("join-by-location", {
      proxy: "footprint",
      predicate: "intersects",
      fields: ["zone"],
      tie: "first",
      writeMatchCount: false,
    });
    await userEvent.selectOptions(
      screen.getByLabelText("When several areas match"),
      "countOnly",
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ tie: "countOnly", writeMatchCount: true }),
    );
    expect(
      screen.getByRole("checkbox", { name: /Also write the match count/ }),
    ).toBeDisabled();
  });

  it("shows a search box only past twelve fields (§7.5)", () => {
    const many = Array.from({ length: 13 }, (_, i) => `p${i}`);
    renderSection(
      "join-by-location",
      { fields: many },
      { sourcePropertyKeys: many, sourcePropertyTypes: new Map() },
    );
    expect(screen.getByLabelText("Search fields")).toBeInTheDocument();
  });

  it("has no search box at twelve fields", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `p${i}`);
    renderSection(
      "join-by-location",
      { fields: twelve },
      { sourcePropertyKeys: twelve, sourcePropertyTypes: new Map() },
    );
    expect(screen.queryByLabelText("Search fields")).toBeNull();
  });

  /**
   * Minor review finding: §6 flags a copied-field collision "on the second
   * field", so the sentence has to be attached to THAT checkbox — the same
   * shape Aggregate's row errors already have.
   */
  it("flags a colliding field on the SECOND checkbox, and only it", () => {
    renderSection(
      "join-by-location",
      { fields: ["Zone Name", "zone_name"] },
      {
        sourcePropertyKeys: ["Zone Name", "zone_name"],
        sourcePropertyTypes: new Map(),
      },
    );
    expect(
      describedBy(screen.getByRole("checkbox", { name: /^Zone Name/ })),
    ).toBeNull();
    expect(
      describedBy(screen.getByRole("checkbox", { name: /^zone_name/ })),
    ).toBe("'zone_name' resolves to the same column");
    // ONE sentence on screen, beside the field — not a second copy under the
    // whole section.
    expect(
      screen.getAllByText("'zone_name' resolves to the same column"),
    ).toHaveLength(1);
  });

  it("keeps a section-level sentence that belongs to no field", () => {
    renderSection("join-by-location", {
      proxy: "centre",
      tie: "largestOverlap",
      fields: ["zone", "noise"],
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Largest overlap needs a footprint or rectangle",
    );
  });

  it("says inline why a join that copies nothing cannot run", () => {
    renderSection("join-by-location", { fields: [], writeMatchCount: false });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Pick at least one measure",
    );
  });
});

describe("Distance to nearest (§7.7)", () => {
  it("shows the 500 m default and writes a typed limit back", async () => {
    const onChange = renderSection("distance-to-nearest", {
      proxy: "footprint",
      maxDistanceM: 500,
      writeNearestId: false,
      nearestIdProperty: null,
    });
    const input = screen.getByLabelText("Max search distance (m)");
    expect(input).toHaveValue(500);
    await userEvent.clear(input);
    await userEvent.type(input, "250");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ maxDistanceM: 250 }),
    );
  });

  it("says §6's own sentence for a limit that is not positive", () => {
    // **[adapted copy A11]**
    renderSection("distance-to-nearest", { maxDistanceM: 0 });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A distance limit must be a positive number",
    );
  });

  it("offers the feature's own id when the source has one", () => {
    renderSection("distance-to-nearest", {
      writeNearestId: true,
      nearestIdProperty: null,
    });
    expect(screen.getByLabelText("Nearest feature's id")).toHaveValue("");
    expect(
      screen.getByRole("option", { name: "The feature's id" }),
    ).toBeInTheDocument();
  });

  it("has no 'feature's id' option when the source has none", () => {
    renderSection(
      "distance-to-nearest",
      { writeNearestId: true, nearestIdProperty: null },
      { sourceHasFeatureIds: false },
    );
    expect(
      screen.queryByRole("option", { name: "The feature's id" }),
    ).not.toBeInTheDocument();
    // §7.7's own sentence, as the placeholder AND as the blocking error.
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose the property to copy",
    );
  });

  it("hides the property select while the checkbox is off", () => {
    renderSection("distance-to-nearest", {
      writeNearestId: false,
      nearestIdProperty: null,
    });
    expect(screen.queryByLabelText("Nearest feature's id")).toBeNull();
  });
});

describe("Aggregate buildings per area (§7.6)", () => {
  it("renders one row per aggregate, count with no column select", () => {
    renderSection("aggregate-per-area", {
      rows: [{ op: "count", column: null }],
    });
    expect(screen.getByLabelText("Aggregate 1")).toHaveValue("count");
    expect(screen.queryByLabelText("Column 1")).not.toBeInTheDocument();
  });

  it("offers the source's NUMERIC columns beside a sum", () => {
    renderSection("aggregate-per-area", {
      rows: [{ op: "sum", column: "roof_area_m2" }],
    });
    expect(screen.getByLabelText("Column 1")).toHaveValue("roof_area_m2");
    expect(
      screen.getByRole("option", { name: "b3_h_dak_max" }),
    ).toBeInTheDocument();
  });

  it("shows the unfilled column select's own sentence (§7.6)", () => {
    // Reachable when the source layer has no numeric column at all. The select
    // must not render its first option as if it were chosen — the bag says
    // null, and `crossLayerParamsError` blocks Run with the same sentence.
    renderSection(
      "aggregate-per-area",
      { rows: [{ op: "sum", column: null }] },
      { numericColumns: [] },
    );
    expect(screen.getByLabelText("Column 1")).toHaveValue("");
    expect(
      screen.getByRole("option", { name: "Choose a column to summarise" }),
    ).toBeInTheDocument();
  });

  it("adds and removes rows", async () => {
    const onChange = renderSection("aggregate-per-area", {
      proxy: "footprint",
      predicate: "intersects",
      rows: [{ op: "count", column: null }],
    });
    await userEvent.click(
      screen.getByRole("button", { name: "+ Add aggregate" }),
    );
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        rows: [
          { op: "count", column: null },
          { op: "count", column: null },
        ],
      }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Remove aggregate 2" }),
    );
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ rows: [{ op: "count", column: null }] }),
    );
  });

  /**
   * Residual B11: §6's validation is inline, and Aggregate's offences belong to
   * ONE row. Both cases assert the ASSOCIATION, not just the presence of the
   * text — the placeholder option carries the same sentence, so a `getByText`
   * would pass over a sentence attached to nothing.
   */
  it("puts A17 beside the offending row, and only that row", () => {
    renderSection("aggregate-per-area", {
      rows: [
        { op: "count", column: null },
        { op: "sum", column: null },
      ],
    });
    expect(describedBy(screen.getByLabelText("Aggregate 1"))).toBeNull();
    expect(describedBy(screen.getByLabelText("Aggregate 2"))).toBe(
      "Choose a column to summarise",
    );
    expect(describedBy(screen.getByLabelText("Column 2"))).toBe(
      "Choose a column to summarise",
    );
  });

  it("flags a duplicate output column on the SECOND row (§6)", () => {
    renderSection("aggregate-per-area", {
      rows: [
        { op: "sum", column: "roof_area_m2" },
        { op: "sum", column: "roof_area_m2" },
      ],
    });
    expect(describedBy(screen.getByLabelText("Aggregate 1"))).toBeNull();
    expect(describedBy(screen.getByLabelText("Aggregate 2"))).toBe(
      "'sum_roof_area_m2' resolves to the same column",
    );
  });

  it("says §6's sentence for an empty aggregate list", () => {
    renderSection("aggregate-per-area", { rows: [] });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Pick at least one measure",
    );
  });

  it("keeps a chosen column when the operator changes to another measure", async () => {
    const onChange = renderSection("aggregate-per-area", {
      rows: [{ op: "sum", column: "roof_area_m2" }],
    });
    await userEvent.selectOptions(screen.getByLabelText("Aggregate 1"), "mean");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        rows: [{ op: "mean", column: "roof_area_m2" }],
      }),
    );
  });
});
