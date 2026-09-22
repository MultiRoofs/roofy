/**
 * The browser size probes behind the static/stream decision, over a stubbed
 * `fetch` — the real fixture's bytes for the footer read.
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserFooterSize,
  browserHeadLength,
} from "../../../../src/features/cityparquet/sourceSizes";

const FIXTURE = path.resolve(
  import.meta.dirname!,
  "../../../../packages/cityjson-navara-plugins/packages/navara-cityparquet/tests/fixtures/multigroup-cityparquet/building.parquet",
);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browserHeadLength", () => {
  it("answers a HEAD's Content-Length", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 200,
          headers: { "Content-Length": "351272960" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await browserHeadLength("https://x.test/a.parquet")).toBe(351272960);
    expect(fetchMock).toHaveBeenCalledWith("https://x.test/a.parquet", {
      method: "HEAD",
    });
  });

  it("is null without a usable length, on an error status, or a failed fetch", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 200 }));
    expect(await browserHeadLength("https://x.test/a.parquet")).toBeNull();
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(null, {
          status: 403,
          headers: { "Content-Length": "10" },
        }),
    );
    expect(await browserHeadLength("https://x.test/a.parquet")).toBeNull();
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await browserHeadLength("https://x.test/a.parquet")).toBeNull();
  });
});

describe("browserFooterSize", () => {
  it("sums the row groups' compressed sizes from a ranged footer read", async () => {
    const bytes = new Uint8Array(await readFile(FIXTURE));
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      const range = new Headers(init?.headers).get("Range");
      if (init?.method === "HEAD" || range === null) {
        // No length from HEAD: the buffer falls back to a ranged probe.
        return new Response(null, { status: 200 });
      }
      const [, s, e] = /bytes=(\d+)-(\d+)/.exec(range)!;
      const slice = bytes.slice(Number(s), Number(e) + 1);
      return new Response(slice, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${s}-${e}/${String(bytes.byteLength)}`,
          "Content-Length": String(slice.byteLength),
        },
      });
    });
    const size = await browserFooterSize("https://x.test/big.parquet");
    expect(size).not.toBeNull();
    expect(size!).toBeGreaterThan(0);
    // The row groups' sum, not the file's length: the footer and the magic
    // bytes are outside every row group.
    expect(size!).toBeLessThan(bytes.byteLength);
  });

  it("is null when the server serves no ranges", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 200 }));
    expect(await browserFooterSize("https://x.test/big.parquet")).toBeNull();
  });
});
