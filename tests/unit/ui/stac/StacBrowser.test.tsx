/**
 * The catalog browser's two views: the collection card grid, and the per
 * collection item picker.
 *
 * WHAT IS MOCKED, AND WHY ONLY THAT. The two fetchers are mocked because they
 * are the network (a ~53-request crawl and a DuckDB parquet read); the STORE
 * behind them is the real one, so what these tests exercise is the component
 * wired to the same guards the app ships. `StacItemMap` is mocked because
 * maplibre needs a real WebGL context that jsdom does not have — the mock keeps
 * the props it was handed so the viewport filter (which is driven ENTIRELY by
 * the map's `onViewBounds`) can be tested without a map.
 *
 * `classifyStacAsset` is NOT mocked: whether an asset gets an Add button or a
 * download link is the decision this panel exists to make, and asserting it
 * against a stub would assert nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

/** The mocked map's latest props, so a test can fire `onViewBounds` by hand. */
const mapSpy = vi.hoisted(() => ({
  props: null as {
    items: readonly { id: string }[];
    onViewBounds?: (b: [[number, number], [number, number]]) => void;
  } | null,
}));

vi.mock("../../../../src/ui/stac/StacItemMap", () => ({
  StacItemMap: (props: {
    items: readonly { id: string }[];
    onViewBounds?: (b: [[number, number], [number, number]]) => void;
  }) => {
    mapSpy.props = props;
    return <div data-testid="stac-item-map" data-count={props.items.length} />;
  },
}));
vi.mock("../../../../src/features/stac/stacClient", () => ({
  fetchStacCollections: vi.fn(),
}));
vi.mock("../../../../src/features/stac/stacItems", () => ({
  fetchCollectionItems: vi.fn(),
}));

import { fetchStacCollections } from "../../../../src/features/stac/stacClient";
import { fetchCollectionItems } from "../../../../src/features/stac/stacItems";
import { useStacStore } from "../../../../src/features/stac/stacStore";
import type {
  StacCollectionCard,
  StacItemRecord,
} from "../../../../src/features/stac/stacTypes";
import {
  ITEM_LIST_RENDER_CAP,
  StacBrowser,
} from "../../../../src/ui/stac/StacBrowser";

const collectionsMock = vi.mocked(fetchStacCollections);
const itemsMock = vi.mocked(fetchCollectionItems);

function card(overrides: Partial<StacCollectionCard> = {}): StacCollectionCard {
  const id = overrides.id ?? "3dbag";
  return {
    id,
    title: "3D BAG",
    description: "Dutch buildings, automatically reconstructed.",
    license: "CC-BY-4.0",
    extent2d: [3, 50, 8, 54],
    lods: ["1.2", "2.2"],
    coTypes: ["Building", "BuildingPart"],
    version: "2024.1",
    projCodes: ["EPSG:7415"],
    semanticSurfaces: true,
    textures: false,
    materials: null,
    cityObjectsTotal: 1234567,
    itemsParquetHref: `https://example.test/${id}/items.parquet`,
    collectionHref: `https://example.test/${id}/collection.json`,
    ...overrides,
  };
}

function item(overrides: Partial<StacItemRecord> = {}): StacItemRecord {
  return {
    id: "delft-0001",
    collectionId: "3dbag",
    bbox2d: null,
    assetHref: "https://example.test/3dbag/delft-0001.city.json",
    assetType: "application/city+json",
    lods: ["2.2"],
    coTypes: ["Building"],
    cityObjects: 42,
    projCode: "EPSG:7415",
    ...overrides,
  };
}

function rows(): HTMLElement[] {
  return screen.queryAllByTestId("stac-item-row");
}

/** Open the collection whose card carries this title, and wait for its rows. */
async function openCollection(title = "3D BAG"): Promise<void> {
  fireEvent.click(
    await screen.findByRole("button", { name: new RegExp(title) }),
  );
  await screen.findByTestId("stac-item-map");
}

beforeEach(() => {
  mapSpy.props = null;
  collectionsMock.mockReset();
  itemsMock.mockReset();
});

afterEach(() => {
  cleanup();
  useStacStore.setState({
    collectionsStatus: "idle",
    collectionsError: null,
    collections: [],
    itemsByCollection: {},
  });
});

describe("StacBrowser — collections view", () => {
  it("renders a loading status, then a card per collection", async () => {
    collectionsMock.mockResolvedValue([
      card(),
      card({ id: "tudelft", title: "TU Delft campus" }),
    ]);
    render(<StacBrowser onAddUrl={vi.fn()} />);

    expect(screen.getByText("Loading catalog…")).toBeTruthy();

    expect(await screen.findByRole("button", { name: /3D BAG/ })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /TU Delft campus/ }),
    ).toBeTruthy();
    // The badge row states what the catalog said, and only that.
    expect(screen.getAllByText("LoD 2.2").length).toBe(2);
    expect(screen.getAllByText("1,234,567 objects").length).toBe(2);
    expect(screen.queryByText("Textures")).toBeNull();
    expect(collectionsMock).toHaveBeenCalledTimes(1);
  });

  it("filters the cards by title and description", async () => {
    collectionsMock.mockResolvedValue([
      card(),
      card({
        id: "helsinki",
        title: "Helsinki",
        description: "Finnish capital city model.",
      }),
    ]);
    render(<StacBrowser onAddUrl={vi.fn()} />);
    await screen.findByRole("button", { name: /3D BAG/ });

    fireEvent.change(screen.getByLabelText("Filter collections"), {
      target: { value: "finnish" },
    });

    expect(screen.queryByRole("button", { name: /3D BAG/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Helsinki/ })).toBeTruthy();
  });

  it("disables a collection with no items index", async () => {
    collectionsMock.mockResolvedValue([
      card({ id: "no-index", title: "No Index", itemsParquetHref: null }),
    ]);
    render(<StacBrowser onAddUrl={vi.fn()} />);

    const button = await screen.findByRole("button", { name: /No Index/ });
    expect(button).toBeDisabled();
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("No items indexed")).toBeTruthy();

    fireEvent.click(button);
    expect(itemsMock).not.toHaveBeenCalled();
  });
});

describe("StacBrowser — items view", () => {
  it("loads a collection's items and shows the list beside the map", async () => {
    collectionsMock.mockResolvedValue([card()]);
    itemsMock.mockResolvedValue([
      item(),
      item({ id: "delft-0002" }),
      item({ id: "rotterdam-0003" }),
    ]);
    render(<StacBrowser onAddUrl={vi.fn()} />);
    await openCollection();

    expect(itemsMock).toHaveBeenCalledTimes(1);
    expect(rows()).toHaveLength(3);
    expect(screen.getByTestId("stac-item-map").getAttribute("data-count")).toBe(
      "3",
    );
    expect(rows()[0]?.textContent).toContain("delft-0001");
    expect(rows()[0]?.textContent).toContain("CityJSON");
    expect(rows()[0]?.textContent).toContain("LoD 2.2");
    expect(rows()[0]?.textContent).toContain("42 objects");
  });

  it("filters the item list and caps the rendered rows", async () => {
    const many = Array.from({ length: ITEM_LIST_RENDER_CAP + 1 }, (_, i) =>
      item({ id: `it-${String(i).padStart(3, "0")}` }),
    );
    collectionsMock.mockResolvedValue([card()]);
    itemsMock.mockResolvedValue(many);
    render(<StacBrowser onAddUrl={vi.fn()} />);
    await openCollection();

    expect(rows()).toHaveLength(ITEM_LIST_RENDER_CAP);
    expect(
      screen.getByText(
        `Showing first ${ITEM_LIST_RENDER_CAP} of ${many.length} items — refine the filter`,
      ),
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Filter items"), {
      target: { value: "it-007" },
    });

    expect(rows()).toHaveLength(1);
    expect(screen.queryByText(/Showing first/)).toBeNull();
  });

  it("adds a loadable item once and remembers it", async () => {
    const onAddUrl = vi.fn();
    collectionsMock.mockResolvedValue([card()]);
    itemsMock.mockResolvedValue([item()]);
    render(<StacBrowser onAddUrl={onAddUrl} />);
    await openCollection();

    fireEvent.click(rows()[0]!);

    const add = screen.getByRole("button", { name: "Add to scene" });
    fireEvent.click(add);
    expect(onAddUrl).toHaveBeenCalledExactlyOnceWith(
      "https://example.test/3dbag/delft-0001.city.json",
    );

    const added = screen.getByRole("button", { name: "Added ✓" });
    expect(added).toBeDisabled();
    fireEvent.click(added);
    expect(onAddUrl).toHaveBeenCalledTimes(1);
  });

  it("offers a download link, not an Add button, for an archive asset", async () => {
    collectionsMock.mockResolvedValue([card()]);
    itemsMock.mockResolvedValue([
      item({
        id: "zipped-0001",
        assetHref: "https://example.test/3dbag/zipped-0001.zip",
        assetType: "application/zip",
      }),
    ]);
    render(<StacBrowser onAddUrl={vi.fn()} />);
    await openCollection();

    fireEvent.click(rows()[0]!);

    const link = screen.getByRole("link", { name: /download/i });
    expect(link.getAttribute("href")).toBe(
      "https://example.test/3dbag/zipped-0001.zip",
    );
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.queryByRole("button", { name: /^Add/ })).toBeNull();
  });

  it("returns to the collections view", async () => {
    collectionsMock.mockResolvedValue([card()]);
    itemsMock.mockResolvedValue([item()]);
    render(<StacBrowser onAddUrl={vi.fn()} />);
    await openCollection();

    fireEvent.click(screen.getByRole("button", { name: "← Collections" }));

    expect(screen.queryByTestId("stac-item-map")).toBeNull();
    expect(screen.getByLabelText("Filter collections")).toBeTruthy();
  });
});

describe("StacBrowser — viewport filter", () => {
  const inView = item({ id: "in-view", bbox2d: [4, 52, 4.1, 52.1] });
  const outOfView = item({ id: "out-of-view", bbox2d: [6, 53, 6.1, 53.1] });
  const noFootprint = item({ id: "no-footprint", bbox2d: null });

  async function openWithBounds(): Promise<void> {
    collectionsMock.mockResolvedValue([card()]);
    itemsMock.mockResolvedValue([inView, outOfView, noFootprint]);
    render(<StacBrowser onAddUrl={vi.fn()} />);
    await openCollection();

    act(() => {
      mapSpy.props?.onViewBounds?.([
        [3.9, 51.9],
        [4.2, 52.2],
      ]);
    });
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
  }

  it("narrows the list to the map's viewport, keeping footprint-less items", async () => {
    await openWithBounds();

    const ids = rows().map((row) => row.textContent ?? "");
    expect(ids.some((t) => t.includes("in-view"))).toBe(true);
    expect(ids.some((t) => t.includes("no-footprint"))).toBe(true);
    expect(ids.some((t) => t.includes("out-of-view"))).toBe(false);
    // The MAP keeps every footprint — only the list narrows.
    expect(screen.getByTestId("stac-item-map").getAttribute("data-count")).toBe(
      "3",
    );
  });

  it("restores the full list when the viewport filter is unchecked", async () => {
    await openWithBounds();

    fireEvent.click(screen.getByLabelText("Only items in map view"));

    expect(rows()).toHaveLength(3);
  });
});
