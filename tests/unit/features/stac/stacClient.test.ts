/**
 * The STAC catalog client.
 *
 * `fetch` is MOCKED throughout — a unit test that reached the real Google
 * Cloud Storage bucket would be flaky, slow, and would fan 50-odd requests at
 * someone else's bucket on every `vitest run`.
 *
 * What matters here is what a UI cannot check for itself: that a relative
 * child href is resolved against the ROOT catalog's URL (a bare join would
 * request `./aaa/collection.json` and 404), that one broken collection out of
 * fifty does not empty the browser, that a dead root says so loudly, and that
 * the crawl stays inside its concurrency budget instead of opening one socket
 * per collection.
 *
 * `console.warn` is silenced globally: the skip path is EXPECTED to warn, and
 * a green run should not look like a broken one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COLLECTION_FETCH_CONCURRENCY,
  fetchStacCollections,
  STAC_CATALOG_URL,
} from "../../../../src/features/stac/stacClient";

const ROOT = "https://storage.googleapis.com/city3d-stac/catalog.json";

function catalogJson() {
  return {
    type: "Catalog",
    id: "root",
    links: [
      { href: "./aaa/collection.json", rel: "child", type: "application/json" },
      { href: "./bbb/collection.json", rel: "child", type: "application/json" },
      { href: "./catalog.json", rel: "self" },
    ],
  };
}

function collectionJson(id: string) {
  return {
    type: "Collection",
    id,
    title: id.toUpperCase(),
    description: "",
    extent: {},
    summaries: {},
  };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchStacCollections", () => {
  it("points at the published catalog", () => {
    expect(STAC_CATALOG_URL).toBe(ROOT);
  });

  it("crawls child links resolved against the root URL and sorts by title", async () => {
    const fetched: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetched.push(url);
        const body =
          url === ROOT
            ? catalogJson()
            : collectionJson(url.includes("/aaa/") ? "zzz-last" : "aaa-first");
        return { ok: true, status: 200, json: async () => body };
      }),
    );
    const cards = await fetchStacCollections();
    expect(fetched[0]).toBe(ROOT);
    expect(fetched).toContain(
      "https://storage.googleapis.com/city3d-stac/aaa/collection.json",
    );
    expect(cards.map((c) => c.id)).toEqual(["aaa-first", "zzz-last"]); // title-sorted
  });

  it("skips a failing collection but keeps the rest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/aaa/"))
          return { ok: false, status: 404, json: async () => ({}) };
        return {
          ok: true,
          status: 200,
          json: async () =>
            url === ROOT ? catalogJson() : collectionJson("bbb"),
        };
      }),
    );
    const cards = await fetchStacCollections();
    expect(cards).toHaveLength(1);
    expect(cards[0]!.id).toBe("bbb");
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("throws a friendly error when the root itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    );
    await expect(fetchStacCollections()).rejects.toThrow(/catalog/i);
  });

  it("caps in-flight collection fetches at COLLECTION_FETCH_CONCURRENCY", async () => {
    const links = Array.from({ length: 20 }, (_, i) => ({
      href: `./c${i}/collection.json`,
      rel: "child",
    }));
    let inFlight = 0,
      peak = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === ROOT)
          return {
            ok: true,
            status: 200,
            json: async () => ({ type: "Catalog", id: "r", links }),
          };
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        return {
          ok: true,
          status: 200,
          json: async () => collectionJson(url.match(/c(\d+)/)![0]),
        };
      }),
    );
    await fetchStacCollections();
    expect(peak).toBeLessThanOrEqual(COLLECTION_FETCH_CONCURRENCY);
    expect(peak).toBeGreaterThan(1); // ...but it IS parallel, not serial
  });

  it("passes the abort signal to every request and lets AbortError through", async () => {
    const controller = new AbortController();
    const seen: (AbortSignal | undefined)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { signal?: AbortSignal }) => {
        seen.push(init?.signal);
        if (url !== ROOT) {
          const error = new Error("aborted");
          error.name = "AbortError";
          throw error;
        }
        return { ok: true, status: 200, json: async () => catalogJson() };
      }),
    );
    await expect(fetchStacCollections(controller.signal)).rejects.toMatchObject(
      { name: "AbortError" },
    );
    expect(seen.every((s) => s === controller.signal)).toBe(true);
  });
});
