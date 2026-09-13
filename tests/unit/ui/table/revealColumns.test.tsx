/**
 * §6.2: "Open table opens the drawer on the target with the new columns
 * appended after the existing ones **and scrolled into view**." The append is
 * `appendColumns`; the scroll is a one-shot request, because the card and the
 * grid are two components with no prop between them and the grid may not be
 * mounted yet when the card is clicked.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DataGrid } from "../../../../src/ui/table/DataGrid";
import type { ColumnInfo } from "../../../../src/insights/columnKind";
import {
  clearColumnReveals,
  drainColumnReveals,
  requestColumnReveal,
  subscribeColumnReveal,
  type ColumnReveal,
} from "../../../../src/ui/table/revealColumns";

/** A listener that ACKNOWLEDGES — the grid's answer when it found a header. */
const took = () => vi.fn(() => true);
/** A listener that declines — the grid's answer for another layer, or for a
 *  layer whose headers are not on screen yet. */
const declined = () => vi.fn(() => false);

/** Live subscriptions, dropped after every case: a case that FAILS never
 *  reaches its own `stop()`, and a listener left behind would take the next
 *  case's requests and turn one failure into a cascade. */
const stops: Array<() => void> = [];
const listen = (listener: (reveal: ColumnReveal) => boolean): (() => void) => {
  const stop = subscribeColumnReveal(listener);
  stops.push(stop);
  return stop;
};

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  // The channel is module state, and an outstanding request is RETAINED — so
  // it would be delivered to the next case's first listener.
  clearColumnReveals();
});

describe("the column-reveal channel", () => {
  it("offers a request to live listeners until one takes it", () => {
    const a = declined();
    const b = took();
    const stopA = listen(a);
    const stopB = listen(b);
    requestColumnReveal("L1", ["solid_volume_m3", "solid_valid"]);
    expect(a).toHaveBeenCalledWith({
      layerId: "L1",
      columns: ["solid_volume_m3", "solid_valid"],
    });
    expect(b).toHaveBeenCalledTimes(1);
    stopA();
    stopB();
  });

  it("delivers to a listener that subscribes AFTER the request", () => {
    // The grid mounts when the drawer opens, which is AFTER the card's click.
    // A pure event bus would drop the request on the floor.
    requestColumnReveal("L1", ["solid_valid"]);
    const late = took();
    const stop = listen(late);
    expect(late).toHaveBeenCalledWith({
      layerId: "L1",
      columns: ["solid_valid"],
    });
    stop();
  });

  it("RETAINS a request no listener acknowledged", () => {
    // The regression this channel was rewritten for. A grid mounted on
    // ANOTHER layer, or on this one before its columns have arrived, cannot
    // scroll to anything — and consuming the request there loses it for good:
    // the drawer opens on the right layer a moment later and never scrolls.
    const other = declined();
    const stopOther = listen(other);
    requestColumnReveal("L1", ["solid_valid"]);
    expect(other).toHaveBeenCalledTimes(1);
    stopOther();

    const right = took();
    const stop = listen(right);
    expect(right).toHaveBeenCalledWith({
      layerId: "L1",
      columns: ["solid_valid"],
    });
    stop();
  });

  it("re-offers outstanding requests on DRAIN, for columns that arrive late", () => {
    // The grid is mounted on L1 the whole time; its headers appear when the
    // query answers. `drainColumnReveals` is what the grid calls then.
    const grid = vi.fn(() => false);
    const stop = listen(grid);
    requestColumnReveal("L1", ["solid_valid"]);
    expect(grid).toHaveBeenCalledTimes(1);

    grid.mockReturnValue(true);
    drainColumnReveals(grid);
    expect(grid).toHaveBeenCalledTimes(2);

    // Taken: a later drain has nothing to re-offer.
    drainColumnReveals(grid);
    expect(grid).toHaveBeenCalledTimes(2);
    stop();
  });

  it("is consumed ONCE, whoever takes it", () => {
    requestColumnReveal("L1", ["solid_valid"]);
    const first = took();
    listen(first)();
    expect(first).toHaveBeenCalledTimes(1);
    const second = took();
    const stop = listen(second);
    expect(second).not.toHaveBeenCalled();
    stop();
  });

  it("keeps ONE outstanding request per layer, the latest", () => {
    // Two runs on two layers, both waiting for their grid; and a second run on
    // L1 supersedes the first — the user is looking at the newest card.
    requestColumnReveal("L1", ["a"]);
    requestColumnReveal("L2", ["b"]);
    requestColumnReveal("L1", ["c"]);
    const seen: Array<ReadonlyArray<string>> = [];
    const stop = listen((reveal) => {
      seen.push(reveal.columns);
      return true;
    });
    expect(seen).toEqual([["c"], ["b"]]);
    stop();
  });

  it("forgets a SUPERSEDED request even when the new one is taken at once", () => {
    // Round-2 residual C11, and the ONE shape that detects it: A must still be
    // PENDING when B arrives — so the grid declines A (its columns are not on
    // screen yet) — and B must be acknowledged IMMEDIATELY, which is the path
    // that returns early. A request recorded only after every listener declined
    // would leave A in the map, and the grid's next drain — one column-list
    // change later — would scroll back to the previous run's columns.
    const grid = vi.fn(() => false);
    const stop = listen(grid);
    requestColumnReveal("L1", ["a"]);
    expect(grid).toHaveBeenCalledTimes(1);
    expect(grid).toHaveBeenLastCalledWith({ layerId: "L1", columns: ["a"] });

    // The second run's columns ARE on screen, so this one is honoured at once.
    grid.mockReturnValue(true);
    requestColumnReveal("L1", ["b"]);
    expect(grid).toHaveBeenCalledTimes(2);
    expect(grid).toHaveBeenLastCalledWith({ layerId: "L1", columns: ["b"] });

    // Nothing is outstanding: the drain offers nothing at all. A retained A
    // would be delivered here — and taken, since the grid now acknowledges.
    drainColumnReveals(grid);
    expect(grid).toHaveBeenCalledTimes(2);
    stop();
  });

  it("replaces a pending request that nothing has taken yet", () => {
    const idle = declined();
    const stopIdle = listen(idle);
    requestColumnReveal("L1", ["a"]);
    requestColumnReveal("L1", ["b"]);
    stopIdle();

    const seen: Array<ReadonlyArray<string>> = [];
    const stop = listen((reveal) => {
      seen.push(reveal.columns);
      return true;
    });
    expect(seen).toEqual([["b"]]);
    stop();
  });

  it("stops delivering to an unsubscribed listener", () => {
    const listener = took();
    listen(listener)();
    requestColumnReveal("L1", ["x"]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("ignores an EMPTY column list — there is nothing to scroll to", () => {
    const listener = took();
    const stop = listen(listener);
    requestColumnReveal("L1", []);
    expect(listener).not.toHaveBeenCalled();
    stop();
  });
});

// ---------------------------------------------------------------------------
// The grid's half of the contract: it is the thing that finds the header and
// scrolls, and its answer is what keeps or consumes the request.

const COLUMNS: ReadonlyArray<ColumnInfo> = [
  { name: "id", type: "VARCHAR", kind: "scalar" },
  { name: "solid_volume_m3", type: "DOUBLE", kind: "scalar" },
];
const ROWS = [{ id: "B1", solid_volume_m3: 12 }];

function grid(over: Partial<Parameters<typeof DataGrid>[0]> = {}) {
  return (
    <DataGrid
      columns={COLUMNS}
      rows={ROWS}
      sort={null}
      selectedIds={new Set()}
      onSort={vi.fn()}
      onRowClick={vi.fn()}
      layerId="L1"
      {...over}
    />
  );
}

type ScrollIntoView = (arg?: boolean | ScrollIntoViewOptions) => void;

describe("DataGrid honouring a reveal", () => {
  let scrollIntoView: Mock<ScrollIntoView>;

  beforeEach(() => {
    // jsdom implements no scrolling at all, so the method the grid calls has
    // to be supplied here — its ARGUMENTS are the assertion.
    scrollIntoView = vi.fn<ScrollIntoView>();
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  afterEach(() => {
    cleanup();
    clearColumnReveals();
  });

  it("scrolls a mounted grid to the run's own column", () => {
    render(grid());
    requestColumnReveal("L1", ["solid_volume_m3"]);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    // NEAREST in both axes: the drawer is scrolled sideways to the column, and
    // the page must not jump vertically to do it.
    expect(scrollIntoView).toHaveBeenCalledWith({
      inline: "nearest",
      block: "nearest",
    });
    const header = screen
      .getAllByRole("columnheader")
      .find((h) => h.textContent?.includes("solid_volume_m3"));
    expect(scrollIntoView.mock.instances[0]).toBe(header);
  });

  it("leaves ANOTHER layer's request outstanding for the grid that switches to it", () => {
    const { rerender } = render(grid({ layerId: "L2" }));
    requestColumnReveal("L1", ["solid_volume_m3"]);
    expect(scrollIntoView).not.toHaveBeenCalled();
    // The user activates L1: the same grid, now on the right layer, drains it.
    rerender(grid({ layerId: "L1" }));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("waits for the columns to arrive before it scrolls", () => {
    // A mounted grid with no rows renders the empty placeholder and NOT one
    // `<th>` — there is nothing to scroll to, and consuming the request there
    // would lose the scroll the user asked for.
    const { rerender } = render(grid({ rows: [] }));
    requestColumnReveal("L1", ["solid_volume_m3"]);
    expect(scrollIntoView).not.toHaveBeenCalled();

    rerender(grid({ rows: ROWS }));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("ignores a column this grid is not showing", () => {
    // Hidden by the column chooser: the request stays outstanding rather than
    // being swallowed by a grid that cannot honour it.
    render(grid());
    requestColumnReveal("L1", ["roof_area_m2"]);
    expect(scrollIntoView).not.toHaveBeenCalled();
    const other = took();
    const stop = listen(other);
    expect(other).toHaveBeenCalledWith({
      layerId: "L1",
      columns: ["roof_area_m2"],
    });
    stop();
  });

  it("scrolls to the FIRST requested column it is showing", () => {
    // Scrolling to the LAST would leave the others off-screen to its left.
    render(grid());
    requestColumnReveal("L1", ["id", "solid_volume_m3"]);
    const header = screen
      .getAllByRole("columnheader")
      .find((h) => h.textContent?.includes("id"));
    expect(scrollIntoView.mock.instances[0]).toBe(header);
  });
});
