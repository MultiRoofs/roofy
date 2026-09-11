/**
 * The Details panel's attribute list, split by PROVENANCE (spec §8): the
 * file's own attributes stay under Attributes, and the columns a tool
 * computed for THIS layer move to a COMPUTED sub-heading with the badge and
 * the provenance tooltip.
 *
 * The split is the registry's answer, never a guess from the key's name: a
 * file is free to carry a `extent_height_m` of its own, and it must keep
 * reading as the file's value.
 */
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { LayerAttributesSection } from "../../../../src/ui/details/LayerAttributesSection";
import {
  formatProvenance,
  useComputedColumnStore,
  type Provenance,
} from "../../../../src/insights/computedColumns";
import { useLayerStore } from "../../../../src/features/layers/layerStore";

const PROVENANCE: Provenance = {
  runId: "r1",
  toolName: "Height from extent",
  summary: "All · 2 buildings",
  at: new Date(2026, 8, 10, 14, 2).getTime(),
  partial: null,
  previous: null,
};

afterEach(() => {
  cleanup();
  useComputedColumnStore.setState({ byLayer: {} });
  useLayerStore.setState({ layers: [] });
});

function computedGroup(): HTMLElement {
  return screen.getByRole("group", { name: "Computed attributes" });
}

it("lists a computed column under COMPUTED and leaves the file's own above", () => {
  useComputedColumnStore
    .getState()
    .setProvenance("L1", "extent_height_m", PROVENANCE);
  render(
    <LayerAttributesSection
      layerId="L1"
      objectType="Building"
      attributes={{ function: "x", extent_height_m: 4.2 }}
    />,
  );
  // `details-section-title` uppercases in CSS; the DOM text is the label.
  expect(screen.getByText("Computed")).toBeTruthy();
  const group = computedGroup();
  expect(within(group).getByText("extent_height_m")).toBeTruthy();
  expect(within(group).queryByText("function")).toBeNull();
  expect(screen.getByText("function")).toBeTruthy();
  expect(
    within(group)
      .getByRole("img", { name: "Computed by Roofy" })
      .getAttribute("title"),
  ).toBe(formatProvenance(PROVENANCE));
});

it("shows no COMPUTED heading when the layer has no computed columns", () => {
  render(
    <LayerAttributesSection
      layerId="L1"
      objectType="Building"
      attributes={{ function: "x" }}
    />,
  );
  expect(screen.queryByText("Computed")).toBeNull();
});

it("still shows the computed group when the file carried no attributes at all", () => {
  // The "No attributes" placeholder is about the FILE's attributes; a run's
  // results are attributes too, and swallowing them would be a lie.
  useComputedColumnStore
    .getState()
    .setProvenance("L1", "extent_height_m", PROVENANCE);
  render(
    <LayerAttributesSection
      layerId="L1"
      objectType="Building"
      attributes={{ extent_height_m: 4.2 }}
    />,
  );
  expect(within(computedGroup()).getByText("extent_height_m")).toBeTruthy();
  expect(screen.queryByText("No attributes")).toBeNull();
});
