/**
 * §6.2 and §8 on a derived layer's ROW: the state-line tail, the "not saved"
 * marker and the "Show run log" menu item.
 *
 * `layerStateLine` is pure and tested directly; the marker and the menu item
 * need the row rendered, because what is being pinned is that both read
 * `derivedFrom` rather than a name or a heuristic.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { layerStateLine } from "../../../../src/features/layers/layerPresentation";
import { LayerRow } from "../../../../src/ui/layers/LayerRow";
import type { ActiveLayer } from "../../../../src/features/workspace/activeLayer";
import type {
  DerivedFrom,
  Layer,
} from "../../../../src/features/layers/layerStore";

/** A REAL `DerivedFrom`, bound to its own type rather than inlined: the field
 *  on `LayerStateInput` is structurally typed over `{ layerName }` alone, and
 *  an inline literal would trip the excess-property check. What the cases
 *  below want to pin is that the record `LayerList` actually holds is
 *  assignable to it. */
const fromDelft: DerivedFrom = {
  layerId: "L",
  layerName: "Delft",
  runId: "run_1",
};
const fromZones: DerivedFrom = {
  layerId: "G",
  layerName: "Zones",
  runId: "run_2",
};

describe("cityStateLine", () => {
  it("adds §6.2's 'Derived from' tail after the LoD", () => {
    expect(
      layerStateLine({
        kind: "city",
        counts: { buildings: 312, objects: 312 },
        lod: "2.2",
        derivedFrom: fromDelft,
      }),
    ).toBe("312 buildings · LoD 2.2 · Derived from Delft");
  });

  it("says nothing extra for an ordinary layer", () => {
    expect(
      layerStateLine({
        kind: "city",
        counts: { buildings: 312, objects: 312 },
        lod: "2.2",
        derivedFrom: null,
      }),
    ).toBe("312 buildings · LoD 2.2");
  });

  it("adds the tail to a derived VECTOR layer too", () => {
    expect(
      layerStateLine({
        kind: "vector",
        featureCount: 6,
        derivedFrom: fromZones,
      }),
    ).toBe("6 features · Derived from Zones");
  });

  it("is still outranked by an error and by 'Needs re-link'", () => {
    // The precedence contract in `layerPresentation.ts` is unchanged: a layer
    // that failed says so, derived or not.
    expect(
      layerStateLine({
        kind: "city",
        error: "boom",
        derivedFrom: fromDelft,
      }),
    ).toBe("Error · boom");
    expect(
      layerStateLine({
        kind: "city",
        unavailable: true,
        derivedFrom: fromDelft,
      }),
    ).toBe("Needs re-link");
  });
});

/** The city row this file's cases are all about. Cast, because `LayerRow` is
 *  store-free and reads four fields of it. Copied from `LayerRow.test.tsx`
 *  rather than imported: a fixture module shared between two suites is a
 *  third thing to keep in step. */
function cityItem(overrides: Partial<Layer> = {}): ActiveLayer {
  return {
    kind: "city",
    layer: {
      id: "l1",
      name: "Delft · solids",
      visible: true,
      isStreaming: false,
      derivedFrom: null,
      ...overrides,
    } as unknown as Layer,
  };
}

const handlers = () => ({
  onActivate: vi.fn(),
  onToggleVisible: vi.fn(),
  onRename: vi.fn(),
  onZoom: vi.fn(),
  onRemove: vi.fn(),
});

function renderRow(
  props: Partial<Parameters<typeof LayerRow>[0]> = {},
): ReturnType<typeof handlers> {
  const cbs = handlers();
  render(
    <LayerRow
      item={cityItem()}
      active={false}
      stateLine="312 buildings · LoD 2.2 · Derived from Delft"
      kind="city"
      filterChip={null}
      onOpenTable={null}
      {...cbs}
      {...props}
    />,
  );
  return cbs;
}

const openMenu = (): void => {
  fireEvent.click(screen.getByRole("button", { name: /^Layer actions/ }));
};

afterEach(cleanup);

describe("a derived layer's row", () => {
  it("marks itself 'Derived · not saved in workspaces' (§6, §8)", () => {
    renderRow({ derived: true });
    expect(screen.getByText("Derived · not saved in workspaces")).toBeTruthy();
  });

  it("offers 'Show run log' and calls it", () => {
    const onShowRunLog = vi.fn();
    renderRow({ derived: true, onShowRunLog });
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Show run log" }));
    expect(onShowRunLog).toHaveBeenCalledTimes(1);
  });

  it("disables 'Show run log' when the run has left the history", () => {
    // §6.2's own caveat: the history keeps 20 runs and a layer outlives its
    // run, so the item is disabled rather than absent — a layer that HAS a run
    // log and one whose log has aged out must not look the same.
    renderRow({ derived: true, onShowRunLog: null });
    openMenu();
    expect(screen.getByRole("button", { name: "Show run log" })).toBeDisabled();
  });

  it("shows neither on an ordinary layer", () => {
    // `onShowRunLog` is left UNDEFINED, which is what `LayerList` passes for a
    // layer with no `derivedFrom` — and the regression that matters: passing
    // `null` here instead would give every ordinary layer a disabled item.
    renderRow();
    expect(screen.queryByText("Derived · not saved in workspaces")).toBeNull();
    openMenu();
    expect(screen.queryByRole("button", { name: "Show run log" })).toBeNull();
  });
});
