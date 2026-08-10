/**
 * Asserted through table ROLES rather than class names: the panel's job is to
 * present attributes as a real data table, and roles survive a restyle.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { AttributePanel } from "../../../../src/ui/viewport/AttributePanel";
import type { CityObject } from "../../../../src/domain/citymodel/types";

function obj(patch: Partial<CityObject> & { id: string }): CityObject {
  return {
    objectType: "Building",
    attributes: {},
    surfaces: [],
    bbox: null,
    children: [],
    parents: [],
    lod: null,
    ...patch,
  } as CityObject;
}

/** The key/value pairs of the rendered table body, in order. */
function bodyRows(): ReadonlyArray<readonly [string, string]> {
  const body = screen.getByRole("table").querySelector("tbody")!;
  return [...body.querySelectorAll("tr")].map(
    (tr) =>
      [
        tr.querySelector("th")!.textContent ?? "",
        tr.querySelector("td")!.textContent ?? "",
      ] as const,
  );
}

describe("AttributePanel", () => {
  afterEach(cleanup);

  it("renders nothing when nothing is selected", () => {
    const { container } = render(<AttributePanel objects={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("puts a single object's attributes in a table of Attribute/Value rows", () => {
    const building = obj({
      id: "b1",
      attributes: { b3_dak_type: "slanted", b3_h_dak_50p: 12.3 },
    });
    render(<AttributePanel objects={[building]} />);

    const headers = screen
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
    expect(headers).toEqual(["Attribute", "Value"]);
    expect(bodyRows()).toEqual([
      ["b3_dak_type", "slanted"],
      ["b3_h_dak_50p", "12.3"],
    ]);
  });

  it("keeps the value tooltip a long value would otherwise hide", () => {
    render(
      <AttributePanel
        objects={[obj({ id: "b1", attributes: { identificatie: "NL.IMBAG" } })]}
      />,
    );
    const cell = within(screen.getByRole("table")).getByText("NL.IMBAG");
    expect(cell.getAttribute("title")).toBe("NL.IMBAG");
  });

  it("shows a BuildingPart the attributes it inherits, and says where from", () => {
    const building = obj({
      id: "NL.IMBAG.Pand.0503100000025026",
      attributes: { b3_dak_type: "slanted" },
      children: ["NL.IMBAG.Pand.0503100000025026-0"],
    });
    const part = obj({
      id: "NL.IMBAG.Pand.0503100000025026-0",
      objectType: "BuildingPart",
      parents: [building.id],
    });
    render(
      <AttributePanel
        objects={[part]}
        objectsById={{ [building.id]: building, [part.id]: part }}
      />,
    );

    expect(screen.getByText(`Inherited from ${building.id}`)).not.toBeNull();
    expect(bodyRows()).toEqual([["b3_dak_type", "slanted"]]);
  });

  it("aggregates a multi-selection and names the mode in the Value header", () => {
    const objects = [
      obj({ id: "a", attributes: { height: 10, use: "residential" } }),
      obj({ id: "b", attributes: { height: 20, use: "office" } }),
    ];
    render(<AttributePanel objects={objects} />);

    expect(screen.getByText("Attributes (2)")).not.toBeNull();
    expect(
      screen.getAllByRole("columnheader").map((th) => th.textContent),
    ).toEqual(["Attribute", "Value (avg)"]);
    // Numeric keys aggregate; disagreeing strings collapse to "mixed".
    expect(bodyRows()).toEqual([
      ["height", "15"],
      ["use", "mixed"],
    ]);

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "sum" },
    });
    expect(
      screen.getAllByRole("columnheader").map((th) => th.textContent),
    ).toEqual(["Attribute", "Value (sum)"]);
    expect(bodyRows()[0]).toEqual(["height", "30"]);
  });

  it("says so when the selection carries no attributes at all", () => {
    render(<AttributePanel objects={[obj({ id: "a" })]} />);
    expect(screen.getByText("No attributes")).not.toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("hides the table body while collapsed", () => {
    render(
      <AttributePanel objects={[obj({ id: "a", attributes: { h: 1 } })]} />,
    );
    expect(screen.queryByRole("table")).not.toBeNull();
    fireEvent.click(screen.getByTitle("Collapse"));
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.click(screen.getByTitle("Expand"));
    expect(screen.queryByRole("table")).not.toBeNull();
  });
});
