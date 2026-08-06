/**
 * The catalog browser's cache.
 *
 * The REAL store is exercised here — only the two fetchers are mocked — because
 * everything worth testing about this module is its guard logic: that a crawl of
 * ~53 collections happens once per session and not once per panel open, that a
 * collection's items are read once and not once per row click, and that the one
 * state where a repeat call MUST re-fetch ("error") is not swallowed by the same
 * guard that suppresses the others. A mocked store would assert nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const collectionsMock = vi.mocked(fetchStacCollections);
const itemsMock = vi.mocked(fetchCollectionItems);

function card(id: string, title = id): StacCollectionCard {
  return {
    id,
    title,
    description: "",
    license: null,
    extent2d: null,
    lods: [],
    coTypes: [],
    version: null,
    projCodes: [],
    semanticSurfaces: null,
    textures: null,
    materials: null,
    cityObjectsTotal: null,
    itemsParquetHref: `https://example.test/${id}/items.parquet`,
    collectionHref: `https://example.test/${id}/collection.json`,
  };
}

function item(id: string, collectionId: string): StacItemRecord {
  return {
    id,
    collectionId,
    bbox2d: null,
    assetHref: null,
    assetType: null,
    lods: [],
    coTypes: [],
    cityObjects: null,
    projCode: null,
  };
}

/** A promise plus the handles to settle it, so a test can observe the store
 *  WHILE a fetch is still in flight — the only way to assert the loading
 *  guard rather than just its outcome. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  collectionsMock.mockReset();
  itemsMock.mockReset();
});

afterEach(() => {
  useStacStore.setState({
    collectionsStatus: "idle",
    collectionsError: null,
    collections: [],
    itemsByCollection: {},
  });
});

describe("stacStore collections", () => {
  it("goes loading then ready, keeping the fetcher's order", async () => {
    const cards = [card("a", "Amsterdam"), card("d", "Delft")];
    const gate = deferred<StacCollectionCard[]>();
    collectionsMock.mockReturnValue(gate.promise);

    useStacStore.getState().loadCollections();
    expect(useStacStore.getState().collectionsStatus).toBe("loading");
    expect(useStacStore.getState().collectionsError).toBeNull();

    gate.resolve(cards);
    await vi.waitFor(() =>
      expect(useStacStore.getState().collectionsStatus).toBe("ready"),
    );
    expect(useStacStore.getState().collections).toEqual(cards);
    expect(useStacStore.getState().collectionsError).toBeNull();
  });

  it("does not re-crawl once ready", async () => {
    collectionsMock.mockResolvedValue([card("a")]);

    useStacStore.getState().loadCollections();
    await vi.waitFor(() =>
      expect(useStacStore.getState().collectionsStatus).toBe("ready"),
    );

    useStacStore.getState().loadCollections();
    useStacStore.getState().loadCollections();
    expect(collectionsMock).toHaveBeenCalledTimes(1);
  });

  it("does not re-crawl while a crawl is in flight", () => {
    collectionsMock.mockReturnValue(deferred<StacCollectionCard[]>().promise);

    useStacStore.getState().loadCollections();
    useStacStore.getState().loadCollections();
    expect(collectionsMock).toHaveBeenCalledTimes(1);
  });

  it("treats an empty catalog as ready, not as an error", async () => {
    collectionsMock.mockResolvedValue([]);

    useStacStore.getState().loadCollections();
    await vi.waitFor(() =>
      expect(useStacStore.getState().collectionsStatus).toBe("ready"),
    );
    expect(useStacStore.getState().collections).toEqual([]);
    expect(useStacStore.getState().collectionsError).toBeNull();

    useStacStore.getState().loadCollections();
    expect(collectionsMock).toHaveBeenCalledTimes(1);
  });

  it("records the failure message, and retryCollections crawls again", async () => {
    collectionsMock.mockRejectedValueOnce(
      new Error("Could not reach the 3D city catalog."),
    );

    useStacStore.getState().loadCollections();
    await vi.waitFor(() =>
      expect(useStacStore.getState().collectionsStatus).toBe("error"),
    );
    expect(useStacStore.getState().collectionsError).toBe(
      "Could not reach the 3D city catalog.",
    );

    collectionsMock.mockResolvedValueOnce([card("a")]);
    useStacStore.getState().retryCollections();
    await vi.waitFor(() =>
      expect(useStacStore.getState().collectionsStatus).toBe("ready"),
    );
    expect(collectionsMock).toHaveBeenCalledTimes(2);
    expect(useStacStore.getState().collectionsError).toBeNull();
    expect(useStacStore.getState().collections).toHaveLength(1);
  });

  it("re-crawls on a plain loadCollections after an error", async () => {
    collectionsMock.mockRejectedValueOnce(new Error("down"));
    useStacStore.getState().loadCollections();
    await vi.waitFor(() =>
      expect(useStacStore.getState().collectionsStatus).toBe("error"),
    );

    collectionsMock.mockResolvedValueOnce([card("a")]);
    useStacStore.getState().loadCollections();
    await vi.waitFor(() =>
      expect(useStacStore.getState().collectionsStatus).toBe("ready"),
    );
    expect(collectionsMock).toHaveBeenCalledTimes(2);
  });

  it("does not open a second crawl when retried mid-flight", () => {
    collectionsMock.mockReturnValue(deferred<StacCollectionCard[]>().promise);
    useStacStore.getState().loadCollections();
    useStacStore.getState().retryCollections();
    expect(collectionsMock).toHaveBeenCalledTimes(1);
    expect(useStacStore.getState().collectionsStatus).toBe("loading");
  });

  it("re-crawls when retried from a ready cache", async () => {
    collectionsMock.mockResolvedValueOnce([card("a")]);
    useStacStore.getState().loadCollections();
    await vi.waitFor(() =>
      expect(useStacStore.getState().collectionsStatus).toBe("ready"),
    );

    collectionsMock.mockResolvedValueOnce([card("a"), card("b")]);
    useStacStore.getState().retryCollections();
    await vi.waitFor(() =>
      expect(useStacStore.getState().collections).toHaveLength(2),
    );
    expect(collectionsMock).toHaveBeenCalledTimes(2);
  });

  it("survives a rejection that is not an Error", async () => {
    collectionsMock.mockRejectedValueOnce("boom");
    useStacStore.getState().loadCollections();
    await vi.waitFor(() =>
      expect(useStacStore.getState().collectionsStatus).toBe("error"),
    );
    expect(useStacStore.getState().collectionsError).toBeTruthy();
  });
});

describe("stacStore items", () => {
  it("caches per collection id and does not re-read a ready entry", async () => {
    const a = card("a");
    const b = card("b");
    itemsMock.mockImplementation(async (c) => [item(`${c.id}-1`, c.id)]);

    useStacStore.getState().loadItems(a);
    expect(useStacStore.getState().itemsByCollection.a?.status).toBe("loading");

    await vi.waitFor(() =>
      expect(useStacStore.getState().itemsByCollection.a?.status).toBe("ready"),
    );
    useStacStore.getState().loadItems(b);
    await vi.waitFor(() =>
      expect(useStacStore.getState().itemsByCollection.b?.status).toBe("ready"),
    );

    const entries = useStacStore.getState().itemsByCollection;
    expect(entries.a?.items.map((i) => i.id)).toEqual(["a-1"]);
    expect(entries.b?.items.map((i) => i.id)).toEqual(["b-1"]);
    expect(entries.a?.error).toBeNull();

    useStacStore.getState().loadItems(a);
    useStacStore.getState().loadItems(b);
    expect(itemsMock).toHaveBeenCalledTimes(2);
  });

  it("does not re-read while that collection is loading", () => {
    itemsMock.mockReturnValue(deferred<StacItemRecord[]>().promise);
    useStacStore.getState().loadItems(card("a"));
    useStacStore.getState().loadItems(card("a"));
    expect(itemsMock).toHaveBeenCalledTimes(1);
  });

  it("records one collection's error without touching the others", async () => {
    const a = card("a");
    const b = card("b");
    itemsMock.mockImplementation(async (c) => {
      if (c.id === "b")
        throw new Error("This collection has no item index yet.");
      return [item("a-1", "a")];
    });

    useStacStore.getState().loadItems(a);
    useStacStore.getState().loadItems(b);
    await vi.waitFor(() => {
      const entries = useStacStore.getState().itemsByCollection;
      expect(entries.a?.status).toBe("ready");
      expect(entries.b?.status).toBe("error");
    });

    const entries = useStacStore.getState().itemsByCollection;
    expect(entries.b?.error).toBe("This collection has no item index yet.");
    expect(entries.b?.items).toEqual([]);
    expect(entries.a?.error).toBeNull();
    expect(entries.a?.items).toHaveLength(1);
  });

  it("re-reads a failed collection when loadItems is called again (the retry path)", async () => {
    const a = card("a");
    itemsMock.mockRejectedValueOnce(
      new Error("Could not download the item index for this collection."),
    );

    useStacStore.getState().loadItems(a);
    await vi.waitFor(() =>
      expect(useStacStore.getState().itemsByCollection.a?.status).toBe("error"),
    );

    itemsMock.mockResolvedValueOnce([item("a-1", "a")]);
    useStacStore.getState().loadItems(a);
    expect(useStacStore.getState().itemsByCollection.a?.error).toBeNull();
    await vi.waitFor(() =>
      expect(useStacStore.getState().itemsByCollection.a?.status).toBe("ready"),
    );
    expect(itemsMock).toHaveBeenCalledTimes(2);
    expect(useStacStore.getState().itemsByCollection.a?.items).toHaveLength(1);
  });

  it("treats a collection with no items as ready and does not re-read it", async () => {
    itemsMock.mockResolvedValue([]);
    useStacStore.getState().loadItems(card("a"));
    await vi.waitFor(() =>
      expect(useStacStore.getState().itemsByCollection.a?.status).toBe("ready"),
    );
    useStacStore.getState().loadItems(card("a"));
    expect(itemsMock).toHaveBeenCalledTimes(1);
  });
});
