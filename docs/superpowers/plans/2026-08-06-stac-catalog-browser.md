# STAC Catalog Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users browse the Open3D City STAC catalog (53 collections, ~14.8k items) and add any item's 3D city model asset to the scene — from a "Browse catalog" button on the landing page and a "Catalog" tab in the Add Layer dialog.

**Architecture:** A `src/features/stac/` feature (pure fetch client + DuckDB-backed stac-geoparquet item reader + Zustand cache store) and a `src/ui/stac/` UI (collection cards → item picker with a MapLibre mini-map). Adding an item funnels its `assets.data.href` into the app's existing single URL-loading path (`onAddUrl` → `App.handleUrl` → `useLayerFileLoader.addLayerFromUrl`), which already handles format routing, engine boot, loading and error state. A small domain change adds gzip support to remote loads because the largest CORS-clean collection (3D BAG, 8,941 items) serves `.city.json.gz`.

**Tech Stack:** React 19 + TypeScript + Zustand (existing), DuckDB-wasm (existing, for reading `items.parquet`), **maplibre-gl (new dependency)** for the item mini-map, `DecompressionStream` (browser built-in) for gzip.

## Global Constraints

- The real STAC root is `https://storage.googleapis.com/city3d-stac/catalog.json` (NOT `https://catalog.open3d.city/`, which is a marketing page). CORS is `*` on the whole bucket.
- All hrefs in catalog/collection JSON are **relative** — always resolve against the document URL with `new URL(href, base).href`.
- **Never follow `rel:"item"` links** — they 404 (generator bug: real path inserts `items/`). Items come only from the collection's `items-geoparquet` asset (`type: application/vnd.apache.parquet`, roles include `collection-mirror`). 22 of 53 collections have no parquet → show "No items indexed", non-navigable.
- The parquet `bbox` column is a **6-field 3D struct** (`xmin,ymin,zmin,xmax,ymax,zmax`); `assets` is a struct with exactly one field `data`. Query scalar projections only (no WKB `geometry`, no struct columns in the result set).
- Summary values are messy: `city3d:lods` may be strings (`["1.2"]`) **or numbers** (`[2]`) and may contain non-numeric `"T"`; `city3d:city_objects` in collection summaries is `{min,max,total}`; some collection bboxes are in projected metres, not degrees — validate `|lng| ≤ 180 && |lat| ≤ 90` before using any bbox on a map or the collection is shown without a footprint.
- Live asset media types: `application/city+json` (8,948), `application/zip` (5,624), `application/gml+xml` (194). There are **no** `.fcb`/`.jsonl` assets today, but classification must still route by the app's `detectEncoding` so future ones work. `application/zip` is NOT loadable — render a Download link instead of an Add button.
- Engine-binding isolation, pinned deps, and test conventions per CLAUDE.md. All work is app-side (no submodule changes). Import tests from `"vitest"`, never `"vite-plus/test"`. Typecheck with `npx tsc -b --noEmit`.
- After the `npm install` for maplibre-gl, re-run `pnpm install` inside `packages/cityjson-navara-plugins` (CLAUDE.md rule).
- Commit convention: prefix + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` (CLAUDE.md L148); run typecheck before each commit. Stage explicit paths — never `git add -A` (it would sweep the plan doc, `package-lock.json` noise, or an unintended submodule pointer into a feature commit). Commit this plan document separately as `docs:` before Task 1's commit.

---

### Task 1: Gzip-aware remote model loading

The 3D BAG assets are `https://data.3dbag.nl/.../*.city.json.gz` with `content-type: application/gzip`. Two server behaviours exist in the wild: body arrives still-gzipped (magic bytes `1f 8b`), or the server sets `Content-Encoding: gzip` and fetch auto-decompresses. Sniff magic bytes; never trust the extension for decompression (but DO strip `.gz` for encoding detection).

**Files:**

- Modify: `src/domain/citymodel/detectEncoding.ts` (strip a trailing `.gz` before extension matching)
- Modify: `src/domain/citymodel/loadCityModel.ts` (`loadFromUrl` fetches bytes and gunzips when needed)
- Modify: `src/platform/types.ts` + `src/platform/browser.ts` (add `fetchBytes` to `HttpClient`)
- Test: `tests/unit/domain/citymodel/detectEncoding.test.ts` (extend), `tests/unit/domain/citymodel/loadCityModel.test.ts` (extend)

**Interfaces:**

- Consumes: existing `detectEncoding(nameOrUrl)`, `loadFromUrl(url, http?)`, `HttpClient`.
- Produces: `HttpClient.fetchBytes(url: string): Promise<{ ok: boolean; status: number; statusText: string; bytes: Uint8Array }>` — the **same envelope shape as the existing `fetchText`** (which returns `{ ok, status, statusText, text }` and never throws on non-2xx; `loadFromUrl`'s friendly 404/other-HTTP branches read those fields, so a bare `Promise<Uint8Array>` would kill them). Also: exported `decodeModelBytes(bytes: Uint8Array): Promise<string>` (gunzip-if-gzip-magic then UTF-8 decode) from `loadCityModel.ts`; `detectEncoding("x.city.jsonl.gz") === "cityjsonseq"`. Read the real `fetchText` in `src/platform/browser.ts` + `src/platform/types.ts` first and mirror it exactly.

- [ ] **Step 1: Write failing tests**

In `detectEncoding.test.ts` add:

```ts
it("strips a trailing .gz before matching the extension", () => {
  expect(detectEncoding("tile.city.json.gz")).toBe("cityjson");
  expect(detectEncoding("tile.city.jsonl.gz")).toBe("cityjsonseq");
  expect(
    detectEncoding("https://data.3dbag.nl/v1/tiles/10/1/2/t.city.json.gz?x=1"),
  ).toBe("cityjson");
  expect(detectEncoding("model.gml.gz")).toBe("citygml");
});
```

In `loadCityModel.test.ts` add (follow the file's existing fake-http pattern; if it currently fakes `fetchText`, the fake gains `fetchBytes`):

```ts
import { gzipSync } from "node:zlib";

// Envelope fakes mirror the real fetchText contract: never throw on non-2xx,
// return { ok, status, statusText, ... } and let loadFromUrl branch on it.
function okBytes(bytes: Uint8Array) {
  return {
    fetchText: async () => {
      throw new Error("unused");
    },
    fetchBytes: async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      bytes,
    }),
  };
}

it("gunzips a body that still carries gzip magic bytes", async () => {
  const json = minimalCityJsonText(); // build inline or reuse fixtures/two-buildings.city.json text
  const gzipped = new Uint8Array(gzipSync(Buffer.from(json)));
  const model = await loadFromUrl(
    "https://example.com/tile.city.json.gz",
    okBytes(gzipped),
  );
  expect(Object.keys(model.objects).length).toBeGreaterThan(0);
});

it("passes plain (already-decompressed) bytes through as text", async () => {
  const json = minimalCityJsonText();
  const model = await loadFromUrl(
    "https://example.com/tile.city.json.gz",
    okBytes(new TextEncoder().encode(json)),
  );
  expect(Object.keys(model.objects).length).toBeGreaterThan(0);
});

it("keeps the friendly 404 message on the bytes path", async () => {
  const http = {
    fetchText: async () => {
      throw new Error("unused");
    },
    fetchBytes: async () => ({
      ok: false,
      status: 404,
      statusText: "Not Found",
      bytes: new Uint8Array(),
    }),
  };
  await expect(
    loadFromUrl("https://example.com/gone.city.json", http),
  ).rejects.toThrow(/not found|404/i); // match the exact wording of the existing 404 branch in loadCityModel.ts
});
```

- [ ] **Step 2: Run tests, verify they fail** — `npx vitest run tests/unit/domain/citymodel/` — expect failures (no `fetchBytes`, `.gz` falls through to default handling of the full extension).

- [ ] **Step 3: Implement**

`detectEncoding.ts`: inside the existing pathname-based matcher, after computing the lowercased path, add `if (path.endsWith(".gz")) path = path.slice(0, -3);` before the extension checks.

`platform/types.ts`: add to `HttpClient` (match `fetchText`'s exact envelope style — copy its doc comment tone and field names, swapping `text` for `bytes`):

```ts
/** Fetch a URL as raw bytes. Same contract as fetchText: resolves the
 *  envelope on ANY HTTP status (callers branch on ok/status); rejects only
 *  on network-level failure. */
fetchBytes(url: string): Promise<{ ok: boolean; status: number; statusText: string; bytes: Uint8Array }>;
```

(If `fetchText`'s envelope is a named exported interface, add a sibling `BytesResponse` next to it rather than an inline type.)

`platform/browser.ts`: implement alongside `fetchText` mirroring its structure; body via `await res.arrayBuffer()` → `new Uint8Array(...)`.

`loadCityModel.ts`:

```ts
const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

/** Gunzip when the payload carries gzip magic bytes (server sent the .gz file
 *  verbatim); pass through otherwise (server already decompressed via
 *  Content-Encoding, or the file was never gzipped). */
export async function decodeModelBytes(bytes: Uint8Array): Promise<string> {
  if (
    bytes.length > 2 &&
    bytes[0] === GZIP_MAGIC_0 &&
    bytes[1] === GZIP_MAGIC_1
  ) {
    // Response (not Blob) as the byte source: in tests the Response and
    // DecompressionStream globals come from the same (Node) realm, whereas
    // jsdom's Blob.stream() would brand-check-fail against Node's streams.
    const body = new Response(bytes as BodyInit).body;
    if (!body) return new TextDecoder().decode(bytes);
    return await new Response(
      body.pipeThrough(new DecompressionStream("gzip")),
    ).text();
  }
  return new TextDecoder().decode(bytes);
}
```

Change `loadFromUrl` to call `http.fetchBytes(url)` instead of `fetchText`; the envelope has the same `ok`/`status`/`statusText` fields, so every existing friendly-error branch (network/CORS catch, 404, other HTTP) keeps working by swapping the field it reads from `text` to `bytes` + `await decodeModelBytes(...)`. Update every `HttpClient` fake in the test suite (`grep -rn "fetchText" tests/`) to add a `fetchBytes` member with the envelope shape.

- [ ] **Step 4: Verify** — `npx vitest run tests/unit/domain tests/unit/features/layers tests/unit/platform && npx tsc -b --noEmit` — all green. Put the two gzip tests in a NEW file `tests/unit/domain/citymodel/loadCityModelGzip.test.ts` starting with the `// @vitest-environment node` pragma so `DecompressionStream`/`Response` are Node's own — do NOT polyfill anything, and NEVER stub `DecompressionStream` with a passthrough (that would make the test pass on broken code). Note the existing `loadCityModel.test.ts` has no fake-http precedent (its only `loadFromUrl` test is the `.fcb` early-throw) and no `minimalCityJson` fixture — build the minimal CityJSON inline or reuse `fixtures/two-buildings.city.json` text the way `cjFixtureText` does. The one existing `HttpClient` fake to extend is in `tests/unit/platform/browser.test.ts`.

- [ ] **Step 5: Commit** — `git add src/domain src/platform tests/unit && git commit -m "feat: gzip-aware remote model loading (.city.json.gz)"`

---

### Task 2: STAC types + pure normalization (summaries, assets, bboxes)

All the messy-data coercion lives in pure, Node-testable modules with zero fetch/DOM.

**Files:**

- Create: `src/features/stac/stacTypes.ts`, `src/features/stac/stacNormalize.ts`, `src/features/stac/stacAssets.ts`
- Test: `tests/unit/features/stac/stacNormalize.test.ts`, `tests/unit/features/stac/stacAssets.test.ts`

**Interfaces (Produces — later tasks depend on these exact shapes):**

```ts
// stacTypes.ts
export interface StacCollectionCard {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly license: string | null;
  /** Validated WGS84 [minLng, minLat, maxLng, maxLat], or null when the
   *  collection's bbox is missing/degenerate/in projected metres. */
  readonly extent2d: readonly [number, number, number, number] | null;
  readonly lods: readonly string[];
  readonly coTypes: readonly string[];
  readonly version: string | null;
  readonly projCodes: readonly string[];
  readonly semanticSurfaces: boolean | null; // null = unknown
  readonly textures: boolean | null;
  readonly materials: boolean | null;
  readonly cityObjectsTotal: number | null;
  /** Absolute URL of the stac-geoparquet items mirror, or null (22/53). */
  readonly itemsParquetHref: string | null;
  /** Absolute URL of the collection.json this card came from. */
  readonly collectionHref: string;
}

export interface StacItemRecord {
  readonly id: string;
  readonly collectionId: string;
  /** Validated WGS84 [minLng, minLat, maxLng, maxLat], or null. */
  readonly bbox2d: readonly [number, number, number, number] | null;
  readonly assetHref: string | null;
  readonly assetType: string | null;
  readonly lods: readonly string[];
  readonly coTypes: readonly string[];
  readonly cityObjects: number | null;
  readonly projCode: string | null;
}

export type StacAssetKind =
  | "cityjson"
  | "cityjsonseq"
  | "flatcitybuf"
  | "citygml"
  | "archive"
  | "unknown";
export interface StacAssetInfo {
  readonly kind: StacAssetKind;
  /** true when the app can load it via addLayerFromUrl */
  readonly loadable: boolean;
  /** short human label, e.g. "CityJSON", "CityGML", "ZIP archive" */
  readonly label: string;
}
```

```ts
// stacNormalize.ts
export function flattenSummary(value: unknown): readonly string[]; // array|scalar|nested → string[]; numbers → String(n); non-primitives dropped
export function summaryBoolean(value: unknown): boolean | null; // [true]→true, [false]→false, true→true, false→false; [true,false]/absent/non-boolean→null
export function cityObjectsTotal(value: unknown): number | null; // {total}→total, number→number, else null
export function validBbox2d(
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number,
): readonly [number, number, number, number] | null;
export function extent2dFromCollection(
  collection: unknown,
): readonly [number, number, number, number] | null; // reads extent.spatial.bbox[0] (4 OR 6 numbers)
export function collectionCardFromJson(
  json: unknown,
  collectionHref: string,
): StacCollectionCard | null; // null when not a usable Collection (no id)
```

```ts
// stacAssets.ts
export function classifyStacAsset(
  href: string | null,
  mediaType: string | null,
): StacAssetInfo;
```

- [ ] **Step 1: Write failing tests**

`stacNormalize.test.ts` — cover exactly the live catalog's shapes:

```ts
describe("flattenSummary", () => {
  it("keeps string arrays", () =>
    expect(flattenSummary(["0", "1.2"])).toEqual(["0", "1.2"]));
  it("coerces numeric arrays (degraded collections emit [2])", () =>
    expect(flattenSummary([1, 2, 3])).toEqual(["1", "2", "3"]));
  it("keeps non-numeric LoDs like Japan PLATEAU's 'T'", () =>
    expect(flattenSummary(["2", "T"])).toEqual(["2", "T"]));
  it("wraps scalars", () =>
    expect(flattenSummary("EPSG:7415")).toEqual(["EPSG:7415"]));
  it("flattens one level of nesting and drops objects/null/undefined", () =>
    expect(flattenSummary([["a"], "b", null, { min: 1 }])).toEqual(["a", "b"]));
  it("returns [] for absent", () =>
    expect(flattenSummary(undefined)).toEqual([]));
});

describe("cityObjectsTotal", () => {
  it("reads {min,max,total}", () =>
    expect(cityObjectsTotal({ min: 2, max: 10370, total: 21555522 })).toBe(
      21555522,
    ));
  it("passes plain numbers", () => expect(cityObjectsTotal(873)).toBe(873));
  it("null otherwise", () => expect(cityObjectsTotal(["x"])).toBeNull());
});

describe("validBbox2d", () => {
  it("accepts a WGS84 box", () =>
    expect(validBbox2d(4.3, 52.0, 4.4, 52.1)).toEqual([4.3, 52.0, 4.4, 52.1]));
  it("rejects projected metres (Zurich EPSG:2056)", () =>
    expect(validBbox2d(2677116, 1241839, 2689381, 1254306)).toBeNull());
  it("rejects NaN and inverted boxes", () => {
    expect(validBbox2d(Number.NaN, 0, 1, 1)).toBeNull();
    expect(validBbox2d(5, 5, 4, 4)).toBeNull();
  });
});

describe("collectionCardFromJson", () => {
  const base =
    "https://storage.googleapis.com/city3d-stac/netherlands-3d-bag/collection.json";
  const json = {
    type: "Collection",
    id: "netherlands-3d-bag",
    title: "Netherlands 3D BAG",
    description: "All buildings.",
    license: "CC-BY-4.0",
    extent: { spatial: { bbox: [[3.3, 50.7, -2147483.75, 7.2, 53.6, 331]] } },
    summaries: {
      "proj:code": ["EPSG:7415"],
      "city3d:version": ["2.0"],
      "city3d:lods": ["0", "1.2", "1.3", "2.2"],
      "city3d:co_types": ["Building", "BuildingPart"],
      "city3d:textures": [false],
      "city3d:materials": [false],
      "city3d:semantic_surfaces": [true],
      "city3d:city_objects": { min: 2, max: 10370, total: 21555522 },
    },
    assets: {
      "items-geoparquet": {
        href: "./items.parquet",
        type: "application/vnd.apache.parquet",
        roles: ["collection-mirror"],
      },
    },
  };
  it("builds a full card with resolved parquet href", () => {
    const card = collectionCardFromJson(json, base)!;
    expect(card.id).toBe("netherlands-3d-bag");
    expect(card.extent2d).toEqual([3.3, 50.7, 7.2, 53.6]); // z values of the 6-elem bbox ignored
    expect(card.itemsParquetHref).toBe(
      "https://storage.googleapis.com/city3d-stac/netherlands-3d-bag/items.parquet",
    );
    expect(card.semanticSurfaces).toBe(true);
    expect(card.textures).toBe(false);
    expect(card.cityObjectsTotal).toBe(21555522);
    expect(card.collectionHref).toBe(base);
  });
  it("finds the parquet by type+role even under a different asset key", () => {
    const alt = {
      ...json,
      assets: {
        mirror: {
          href: "./items.parquet",
          type: "application/vnd.apache.parquet",
          roles: ["collection-mirror"],
        },
      },
    };
    expect(collectionCardFromJson(alt, base)!.itemsParquetHref).toMatch(
      /items\.parquet$/,
    );
  });
  it("null parquet href and null flags for an empty-shell collection", () => {
    const shell = {
      type: "Collection",
      id: "berlin-3d",
      title: "Berlin",
      description: "",
      extent: {},
      summaries: { "city3d:lods": [2] },
    };
    const card = collectionCardFromJson(shell, base)!;
    expect(card.itemsParquetHref).toBeNull();
    expect(card.lods).toEqual(["2"]);
    expect(card.semanticSurfaces).toBeNull();
    expect(card.extent2d).toBeNull();
  });
  it("returns null for junk", () =>
    expect(collectionCardFromJson({ hello: 1 }, base)).toBeNull());
});
```

`stacAssets.test.ts`:

```ts
describe("classifyStacAsset", () => {
  it("city+json media type → loadable CityJSON", () =>
    expect(
      classifyStacAsset("https://x/y.city.json", "application/city+json"),
    ).toEqual({ kind: "cityjson", loadable: true, label: "CityJSON" }));
  it("gzipped cityjson by extension → loadable", () =>
    expect(
      classifyStacAsset(
        "https://data.3dbag.nl/t.city.json.gz",
        "application/city+json",
      ).loadable,
    ).toBe(true));
  it("gml → loadable CityGML", () =>
    expect(classifyStacAsset("https://x/a.gml", "application/gml+xml")).toEqual(
      { kind: "citygml", loadable: true, label: "CityGML" },
    ));
  it("zip → archive, NOT loadable", () =>
    expect(classifyStacAsset("https://x/a.zip", "application/zip")).toEqual({
      kind: "archive",
      loadable: false,
      label: "ZIP archive",
    }));
  it("fcb by extension → loadable FlatCityBuf", () =>
    expect(classifyStacAsset("https://x/a.fcb", null)).toEqual({
      kind: "flatcitybuf",
      loadable: true,
      label: "FlatCityBuf",
    }));
  it("jsonl → loadable CityJSONSeq", () =>
    expect(
      classifyStacAsset("https://x/a.city.jsonl", "application/x-cityjson-seq")
        .kind,
    ).toBe("cityjsonseq"));
  it("null href → unknown, not loadable", () =>
    expect(classifyStacAsset(null, null).loadable).toBe(false));
  it("query strings don't confuse extension sniffing", () =>
    expect(
      classifyStacAsset("https://x/t.city.json.gz?sig=abc", null).kind,
    ).toBe("cityjson"));
});
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run tests/unit/features/stac/` — modules don't exist.

- [ ] **Step 3: Implement**

`stacNormalize.ts` — pure functions exactly as specified. Key details:

- `flattenSummary`: recurse one level into arrays; keep `string`; convert finite `number`/`boolean` via `String()`; drop everything else; dedupe preserving order.
- `validBbox2d`: all four finite, `-180 ≤ lng ≤ 180`, `-90 ≤ lat ≤ 90`, `minLng < maxLng`, `minLat < maxLat` → tuple, else null.
- `extent2dFromCollection`: read `extent?.spatial?.bbox?.[0]`; if it has 6 numbers use indices `[0,1,3,4]`, if 4 use `[0,1,2,3]`, else null; pass through `validBbox2d`.
- `collectionCardFromJson`: guard `typeof json === "object" && json.id is string`; title falls back to id; description falls back to `""`; parquet asset = first entry of `assets` (object) whose `type === "application/vnd.apache.parquet"` **or** whose `roles` include `"collection-mirror"`; resolve its href with `new URL(href, collectionHref).href`. Summaries read via `flattenSummary`/`summaryBoolean`/`cityObjectsTotal` from `json.summaries?.["city3d:*"]` and `["proj:code"]`.

`stacAssets.ts` — **`loadable` must agree with what `detectEncoding` + `loadFromUrl` will actually do with the URL** (they route by extension; `detectEncoding` defaults anything unrecognized to `"cityjson"` and `loadFromUrl` would then `JSON.parse` it). So `loadable` is decided by extension ONLY, via `detectEncoding` itself as the single source of truth:

1. `href == null` → `{ kind: "unknown", loadable: false, label: "Unknown format" }`.
2. Compute `path = new URL(href, "https://x/").pathname.toLowerCase()`, strip one trailing `.gz`.
3. Archive extensions first: `.zip`/`.7z`/`.tar` → `{ kind: "archive", loadable: false, label: "ZIP archive" }`.
4. If `path` ends with a model extension the app routes — `.fcb`, `.jsonl`, `.city.jsonl`, `.json`, `.city.json`, `.gml`, `.citygml` — call `detectEncoding(path)` and map its result to the kind (`cityjson`/`cityjsonseq`/`flatcitybuf`/`citygml`), `loadable: true`. This delegation (not a parallel table) guarantees classification and routing can never disagree.
5. Otherwise fall back to media type for the **kind/label only, with `loadable: false`** (the URL would be mis-routed by extension, so it must not get an Add button — e.g. `application/gml+xml` behind a `?download=` URL, or `.xml` files, become Download links): `application/city+json`|`application/cityjson`|`application/json+cityjson`→cityjson; `application/x-cityjson-seq`→cityjsonseq; `application/x-flatcitybuf`→flatcitybuf; `application/gml+xml`|`application/citygml+xml`|`application/vnd.citygml+xml`→citygml; `application/zip`→archive; else unknown.
   Labels: CityJSON / CityJSONSeq / FlatCityBuf / CityGML / "ZIP archive" / "Unknown format". Adjust the Step 1 tests accordingly: the `.gml` extension case stays loadable, but add a case asserting `classifyStacAsset("https://x/download?id=3", "application/gml+xml")` is `kind: "citygml", loadable: false`, and drop any `.xml`-is-loadable expectation.

- [ ] **Step 4: Verify** — `npx vitest run tests/unit/features/stac/ && npx tsc -b --noEmit`.

- [ ] **Step 5: Commit** — `git commit -m "feat: STAC types + summary/asset normalization for the catalog browser"`

---

### Task 3: STAC catalog client (root + bounded-concurrency collection crawl)

**Files:**

- Create: `src/features/stac/stacClient.ts`
- Test: `tests/unit/features/stac/stacClient.test.ts`

**Interfaces:**

- Consumes: `collectionCardFromJson` (Task 2).
- Produces:

```ts
export const STAC_CATALOG_URL =
  "https://storage.googleapis.com/city3d-stac/catalog.json"; // hardcoded — no VITE_ env override (the dotenvx ciphertext footgun CLAUDE.md documents for the Maps key)
export const COLLECTION_FETCH_CONCURRENCY = 6;
/** Fetch the root catalog, crawl all rel:"child" collections with bounded
 *  concurrency, and return cards sorted by title. Individual collection
 *  failures are skipped (console.warn once each); a root failure throws
 *  a friendly Error. Uses global fetch (photon.ts convention). */
export async function fetchStacCollections(
  signal?: AbortSignal,
): Promise<StacCollectionCard[]>;
```

- [ ] **Step 1: Write failing tests** (photon.test.ts fetch-stub convention: `vi.stubGlobal("fetch", fn)` + `vi.unstubAllGlobals()` in `afterEach`)

```ts
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
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — plain `fetch` (pass `signal` through to every request). Root: `fetch(STAC_CATALOG_URL)`, non-ok → `throw new Error("Could not reach the 3D city catalog (HTTP <status>).")`. Filter `links` for `rel === "child"` with a string `href`. Worker-pool of `COLLECTION_FETCH_CONCURRENCY` consuming a shared index; each worker fetches, parses, `collectionCardFromJson(json, resolvedUrl)`, pushes non-null; on per-collection error `console.warn("STAC collection skipped:", url, err)` and continues. Sort by `title.localeCompare(other.title)`. Re-throw `AbortError` as-is (don't wrap) so callers can distinguish cancellation.

- [ ] **Step 4: Verify** — `npx vitest run tests/unit/features/stac/stacClient.test.ts && npx tsc -b --noEmit`.

- [ ] **Step 5: Commit** — `git commit -m "feat: STAC catalog client with bounded-concurrency collection crawl"`

---

### Task 4: stac-geoparquet item reader (DuckDB buffer registration)

Parquets are ≤ 2.24 MB — fetch the whole file and register it as a DuckDB buffer. No httpfs, no range reads, no WKB: `bbox` struct fields are the footprint (every geometry in the catalog is a bbox rectangle anyway).

**Files:**

- Modify: `src/analytics/duckdb.ts` (add `queryParquetBuffer`)
- Create: `src/features/stac/stacItems.ts`
- Test: `tests/unit/features/stac/stacItems.test.ts`

**Interfaces:**

- Consumes: `StacCollectionCard`, `StacItemRecord`, `validBbox2d` (Task 2); `initDuckDB`, new `queryParquetBuffer` from `src/analytics/duckdb.ts`.
- Produces:

```ts
// duckdb.ts
/** Register `buffer` under `fileName`, run `sql` against it, then drop the
 *  file. Null when DuckDB isn't ready or the query fails (same contract as
 *  queryDuckDB). Works without the cityjson extension — core parquet reader. */
export async function queryParquetBuffer(
  fileName: string,
  buffer: Uint8Array,
  sql: string,
): Promise<QueryResult | null>;

// stacItems.ts
export const ITEMS_SQL_COLUMNS: string; // exported for tests (photon.ts request-shape convention)
/** Fetch the collection's items.parquet and return item records sorted by id.
 *  Throws a friendly Error when the collection has no parquet, the fetch
 *  fails, or DuckDB can't read it. */
export async function fetchCollectionItems(
  card: StacCollectionCard,
): Promise<StacItemRecord[]>;
```

- [ ] **Step 1: Write failing tests** — mock the duckdb module (jsdom can't run wasm):

```ts
vi.mock("../../../../src/analytics/duckdb", () => ({
  initDuckDB: vi.fn(async () => {}),
  queryParquetBuffer: vi.fn(),
}));
import {
  initDuckDB,
  queryParquetBuffer,
} from "../../../../src/analytics/duckdb";
import { fetchCollectionItems } from "../../../../src/features/stac/stacItems";

const card = {
  id: "netherlands-3d-bag",
  title: "3D BAG",
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
  itemsParquetHref:
    "https://storage.googleapis.com/city3d-stac/netherlands-3d-bag/items.parquet",
  collectionHref:
    "https://storage.googleapis.com/city3d-stac/netherlands-3d-bag/collection.json",
} as const;

function stubParquetFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(8),
    })),
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("maps duckdb rows to StacItemRecords with validated bboxes", async () => {
  stubParquetFetch();
  vi.mocked(queryParquetBuffer).mockResolvedValue({
    columns: [],
    rows: [
      {
        id: "b",
        xmin: 4.3,
        ymin: 52.0,
        xmax: 4.4,
        ymax: 52.1,
        href: "https://data.3dbag.nl/b.city.json.gz",
        media_type: "application/city+json",
        lods: "0|1.2",
        co_types: "Building|BuildingPart",
        city_objects: 873,
        proj_code: "EPSG:7415",
      },
      {
        id: "a",
        xmin: 2677116,
        ymin: 1241839,
        xmax: 2689381,
        ymax: 1254306,
        href: "https://x/a.gml",
        media_type: "application/gml+xml",
        lods: "",
        co_types: "",
        city_objects: null,
        proj_code: null,
      },
    ],
  });
  const items = await fetchCollectionItems(card);
  expect(items.map((i) => i.id)).toEqual(["a", "b"]); // sorted by id
  expect(items[1]).toMatchObject({
    bbox2d: [4.3, 52.0, 4.4, 52.1],
    assetHref: "https://data.3dbag.nl/b.city.json.gz",
    lods: ["0", "1.2"],
    coTypes: ["Building", "BuildingPart"],
    cityObjects: 873,
    collectionId: "netherlands-3d-bag",
  });
  expect(items[0]!.bbox2d).toBeNull(); // projected metres rejected
  expect(items[0]!.lods).toEqual([]);
});

it("throws a friendly error when the collection has no parquet", async () => {
  await expect(
    fetchCollectionItems({ ...card, itemsParquetHref: null }),
  ).rejects.toThrow(/no item index/i);
});

it("throws when the parquet fetch fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: false,
      status: 404,
      arrayBuffer: async () => new ArrayBuffer(0),
    })),
  );
  await expect(fetchCollectionItems(card)).rejects.toThrow(/item index/i);
});

it("throws when duckdb can't read it (returns null)", async () => {
  stubParquetFetch();
  vi.mocked(queryParquetBuffer).mockResolvedValue(null);
  await expect(fetchCollectionItems(card)).rejects.toThrow(/item index/i);
  expect(initDuckDB).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**

`duckdb.ts` (after `queryDuckDB`):

```ts
export async function queryParquetBuffer(
  fileName: string,
  buffer: Uint8Array,
  sql: string,
): Promise<QueryResult | null> {
  if (!db || !conn || status.state !== "ready") return null;
  try {
    await db.registerFileBuffer(fileName, buffer);
  } catch {
    return null;
  }
  try {
    return await queryDuckDB(sql);
  } finally {
    // A dropFile failure must not discard a good result.
    await db.dropFile(fileName).catch(() => {});
  }
}
```

`stacItems.ts` — the SQL projects **scalars only** (list columns via `array_to_string`, struct fields via bracket paths) so `queryDuckDB`'s row extraction never sees an Arrow struct/list. Because the 31 parquets are independently generated and their schemas CANNOT be assumed identical, the projection is built **per file from a schema probe**, defaulting missing columns to NULL — one absent column must not take a whole collection from browsable to a generic error:

```ts
/** Exported for tests. Builds the SELECT list from the columns that actually
 *  exist in the probed schema (a Set of top-level column names). */
export function buildItemsSql(
  fileName: string,
  columns: ReadonlySet<string>,
): string {
  const has = (c: string) => columns.has(c);
  const parts = [
    has("id") ? "id" : "NULL AS id",
    has("bbox")
      ? "t.bbox['xmin'] AS xmin, t.bbox['ymin'] AS ymin, t.bbox['xmax'] AS xmax, t.bbox['ymax'] AS ymax"
      : "NULL AS xmin, NULL AS ymin, NULL AS xmax, NULL AS ymax",
    has("assets")
      ? "t.assets['data']['href'] AS href, t.assets['data']['type'] AS media_type"
      : "NULL AS href, NULL AS media_type",
    has("city3d:lods")
      ? `array_to_string("city3d:lods", '|') AS lods`
      : "NULL AS lods",
    has("city3d:co_types")
      ? `array_to_string("city3d:co_types", '|') AS co_types`
      : "NULL AS co_types",
    has("city3d:city_objects")
      ? `TRY_CAST("city3d:city_objects" AS BIGINT) AS city_objects`
      : "NULL AS city_objects",
    has("proj:code") ? `"proj:code" AS proj_code` : "NULL AS proj_code",
  ];
  return `SELECT ${parts.join(", ")} FROM read_parquet('${fileName}') AS t`;
}
```

`fetchCollectionItems`:

1. `if (!card.itemsParquetHref) throw new Error("This collection has no item index yet.")`
2. `await initDuckDB()`
3. `fetch(card.itemsParquetHref)`; non-ok/network error → `throw new Error("Could not download the item index for this collection.")`
4. `fileName = "stac-items-" + card.id.replace(/[^a-zA-Z0-9_-]/g, "_") + ".parquet"` (sanitized — never interpolate a raw id into SQL). Probe: `queryParquetBuffer(fileName, buffer, \`DESCRIBE SELECT \* FROM read_parquet('${fileName}')\`)`→ column names from the`column_name`field of each row →`buildItemsSql(fileName, names)`→`queryParquetBuffer(fileName, buffer, sql)`. Either call returning null → `throw new Error("Could not read the item index for this collection.")`(note: two registrations of the same buffer name are fine —`queryParquetBuffer` drops the file each time).
5. Map rows: numbers coerced with `Number(...)` guarded by `Number.isFinite`; `bbox2d = validBbox2d(xmin, ymin, xmax, ymax)`; `lods`/`coTypes` = split on `"|"` filtering empty strings; rows with a nullish `id` are dropped; nullish `href`/`media_type`/`proj_code` → null. Sort by `id.localeCompare`.

Add two Step 1 tests for the probe: (a) the DESCRIBE call happens first and the second SQL omits columns the probe didn't report (mock `queryParquetBuffer` to return `{ rows: [{ column_name: "id" }, { column_name: "bbox" }, { column_name: "assets" }] }` for the DESCRIBE, then assert the second call's SQL contains `NULL AS lods`); (b) `buildItemsSql` with the full column set contains `t.assets['data']['href']` and `array_to_string`.

- [ ] **Step 4: Verify** — `npx vitest run tests/unit/features/stac/ && npx tsc -b --noEmit`.

- [ ] **Step 5: Commit** — `git commit -m "feat: read STAC item index from stac-geoparquet via DuckDB buffer registration"`

---

### Task 5: stacStore (Zustand cache)

Collections are fetched once per session; items are cached per collection. Reopening the browser is instant.

**Files:**

- Create: `src/features/stac/stacStore.ts`
- Test: `tests/unit/features/stac/stacStore.test.ts`

**Interfaces:**

- Consumes: `fetchStacCollections` (Task 3), `fetchCollectionItems` (Task 4).
- Produces:

```ts
export type StacFetchStatus = "idle" | "loading" | "ready" | "error";
export interface StacItemsEntry {
  readonly status: StacFetchStatus;
  readonly error: string | null;
  readonly items: readonly StacItemRecord[];
}
interface StacState {
  readonly collectionsStatus: StacFetchStatus;
  readonly collectionsError: string | null;
  readonly collections: readonly StacCollectionCard[];
  readonly itemsByCollection: Readonly<Record<string, StacItemsEntry>>;
  loadCollections(): void; // no-op when loading/ready; a call while status is "error" refetches (retry)
  retryCollections(): void; // forces a re-fetch after error
  loadItems(card: StacCollectionCard): void; // no-op when that collection's entry is loading/ready; refetches when absent OR status "error" (this IS the items retry path — the UI's per-collection Retry button just calls loadItems(card) again)
}
export const useStacStore: UseBoundStore<StoreApi<StacState>>;
```

- [ ] **Step 1: Write failing tests** — mock both fetchers with `vi.mock`; reset store state in `afterEach` via `useStacStore.setState({ collectionsStatus: "idle", collectionsError: null, collections: [], itemsByCollection: {} })` (repo convention: real store, reset state, no store mocks). Cases: (a) `loadCollections` → status loading→ready with sorted cards; (b) second `loadCollections` while ready does not refetch (fetcher called once); (c) fetcher rejection → status error + message, then `retryCollections` refetches; (d) `loadItems(card)` caches per collection id and does not refetch when ready; (e) `loadItems` failure records the entry error but leaves other collections' entries alone. Use `await vi.waitFor(() => expect(useStacStore.getState().collectionsStatus).toBe("ready"))`.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — standard `create<StacState>()((set, get) => ...)`. `loadCollections`: guard `status === "loading" || status === "ready"`; set loading; `fetchStacCollections().then(cards => set({ collectionsStatus: "ready", collections: cards })).catch(err => set({ collectionsStatus: "error", collectionsError: message }))`. `retryCollections`: set idle then call `loadCollections`. `loadItems`: guard on the entry's status; write `{ status: "loading", error: null, items: [] }` into `itemsByCollection[card.id]` (spread-copy the record), then resolve/reject into the same key.

- [ ] **Step 4: Verify + Step 5: Commit** — `git commit -m "feat: stacStore caches catalog collections and per-collection items"`

---

### Task 6: maplibre-gl dependency + StacItemMap mini-map

**Files:**

- Modify: `package.json` (add `maplibre-gl`)
- Create: `src/ui/stac/StacItemMap.tsx`
- Test: none for the map component itself (needs real WebGL; the browser smoke in Task 9 covers it). The pure helper it uses is tested here.
- Create: `src/features/stac/stacGeo.ts` + Test: `tests/unit/features/stac/stacGeo.test.ts`

**Interfaces:**

- Consumes: `StacItemRecord`.
- Produces:

```ts
// stacGeo.ts
export interface FootprintFeature {
  readonly type: "Feature";
  readonly id: string; // promoted for feature-state
  readonly properties: { readonly itemId: string };
  readonly geometry: {
    readonly type: "Polygon";
    readonly coordinates: number[][][];
  };
}
/** One rectangle per item with a valid bbox2d; items with bbox2d null are skipped. */
export function footprintFeatureCollection(items: readonly StacItemRecord[]): {
  readonly type: "FeatureCollection";
  readonly features: readonly FootprintFeature[];
};
/** Combined bounds of the given items' bboxes as [[minLng,minLat],[maxLng,maxLat]], or null.
 *  Deliberately MUTABLE tuple types: maplibre's LngLatBoundsLike and the GeoJSON DOM
 *  types reject readonly tuples/arrays, so widen here at the boundary. */
export function combinedBounds(
  items: readonly StacItemRecord[],
): [[number, number], [number, number]] | null;
/** Bounds from a collection extent2d, or null. Used as the fitBounds fallback. */
export function extentToBounds(
  extent: readonly [number, number, number, number] | null,
): [[number, number], [number, number]] | null;

// StacItemMap.tsx
export interface StacItemMapProps {
  readonly items: readonly StacItemRecord[];
  readonly selectedId: string | null;
  readonly hoveredId: string | null;
  readonly onSelect: (id: string) => void;
  readonly onHover: (id: string | null) => void;
  /** Fallback fit when no item has a valid bbox (collection extent2d). */
  readonly fallbackExtent: readonly [number, number, number, number] | null;
}
export function StacItemMap(props: StacItemMapProps): ReactElement;
```

- [ ] **Step 1: Install** — `npm install maplibre-gl` then **immediately** `cd packages/cityjson-navara-plugins && pnpm install && cd ../..` (CLAUDE.md: npm install destroys the pnpm workspace links). Confirm `npx tsc -b --noEmit` still passes.

- [ ] **Step 2: Write failing tests for stacGeo** — rectangle ring is closed (5 positions, first == last, CCW: `[minLng,minLat] → [maxLng,minLat] → [maxLng,maxLat] → [minLng,maxLat] → [minLng,minLat]`); items with `bbox2d: null` are excluded; `combinedBounds` unions boxes and returns null for an empty/all-invalid list. Run, verify fail, implement, verify pass.

- [ ] **Step 3: Implement StacItemMap** — imperative maplibre in a `useEffect` (mirrors the repo's "no JSX scene graph" taste):

```tsx
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  footprintFeatureCollection,
  combinedBounds,
} from "../../features/stac/stacGeo";
```

- Raster style built inline from the app's own basemap catalogue conventions (`src/scene/basemaps.ts` uses CARTO): source `https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png` (or `dark_all` when `document.documentElement.dataset.theme` is not `"light"` — read once at mount), `tileSize: 256`, `attribution: "© CARTO © OpenStreetMap contributors"`, `attributionControl: { compact: true }`.
- One GeoJSON source `footprints` (`promoteId: "itemId"`), three layers: `fill` (paint `fill-color: "#e8973f"`, `fill-opacity` 0.45 when `["boolean", ["feature-state", "hover"], false]` or selected via feature-state, else 0.15), `line` (`line-color: "#e8973f"`, width 2 when selected feature-state else 1).
- `map.on("load")` → add source/layers (initial data from a ref holding the latest `items` — the items effect may fire before `load`, so it must no-op until a `loadedRef` flips true) → `const bounds = combinedBounds(itemsRef.current) ?? extentToBounds(fallbackExtent); if (bounds) map.fitBounds(bounds, { padding: 24, maxZoom: 14, duration: 0 });` (no bounds → leave the default world view; `fitBounds(null)` throws).
- `mousemove`/`mouseleave` on the fill layer → `onHover(feature.id or null)` + `canvas.style.cursor = "pointer"`; `click` → `onSelect(id)`. Guard every handler for a removed map.
- Separate `useEffect`s: one reacts to `items` (guarded by `loadedRef`; `setData` ONLY — **never refit here**: the parent recomputes the filtered `items` array on every hover-driven render, and a refit tied to array identity would snap the camera back under the user's cursor, making pan/zoom unusable); one refits ONLY when the item set's collection changes (key off `items[0]?.collectionId`); one reacts to `selectedId`/`hoveredId` (clear+set `setFeatureState`). Cleanup: `map.remove()`.
- The parent (Task 7) must `useMemo` the filtered items array it passes down (keyed on the raw items + filter text), so `setData` doesn't churn on unrelated re-renders.
- Container `<div className="stac-item-map" data-testid="stac-item-map" ref={containerRef} />`. Wrap map construction in try/catch → on failure render nothing but call nothing (jsdom-safety net; real guard is that Task 7 tests mock this component).

- [ ] **Step 4: Verify** — `npx tsc -b --noEmit && npx vitest run tests/unit/features/stac/`.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: StacItemMap mini-map (maplibre-gl) + footprint geometry helpers"`

---

### Task 7: StacBrowser UI (collection cards → item picker) + CSS

The core two-view component. View A: searchable collection card grid. View B (after clicking a browsable collection): item list + mini-map, per-item Add/Download.

**Files:**

- Create: `src/ui/stac/StacBrowser.tsx`, `src/ui/stac/CollectionCard.tsx`
- Modify: `src/app/app.css` (append a `.stac-*` block near the modal styles at ~L3167)
- Test: `tests/unit/ui/stac/StacBrowser.test.tsx`

**Interfaces:**

- Consumes: `useStacStore` (Task 5), `classifyStacAsset` (Task 2), `StacItemMap` (Task 6 — **mocked in tests**).
- Produces:

```ts
export interface StacBrowserProps {
  /** Funnel into the app's URL loading path (App.handleUrl / dialog onAddUrl). */
  readonly onAddUrl: (url: string) => void;
}
export function StacBrowser(props: StacBrowserProps): ReactElement;
export const ITEM_LIST_RENDER_CAP = 300;
```

Behaviour spec:

- On mount: `useStacStore((s) => s.loadCollections)` called in an effect.
- Collections view: `<input className="stac-search" placeholder="Filter collections…" aria-label="Filter collections">` filtering on title+description (case-insensitive); grid of `CollectionCard`s.
- `CollectionCard` (own file, props `{ card: StacCollectionCard; onOpen: (card: StacCollectionCard) => void }`): `<button className="stac-card" onClick={...}>` containing title, 3-line-clamped description, badge rows — LoD badges (`LoD {v}`), up to 5 co_type badges + `+N`, feature badges only when `true` (`Semantic surfaces`, `Textures`, `Materials`), proj codes, `cityObjectsTotal` formatted with `toLocaleString("en")` + " objects". Footer: `itemsParquetHref ? "Browse items →" : "No items indexed"`; when null the button is `disabled` with `aria-disabled`.
- Items view: header `<button className="stac-back" onClick>← Collections</button>` + collection title; `useStacStore` `loadItems(card)` effect; left column: filter input + list (`role="listbox"` is overkill — plain buttons) of at most `ITEM_LIST_RENDER_CAP` rows with a `"Showing first 300 of N items — refine the filter"` note when capped; right column: `<StacItemMap items={filtered} …/>`. Row content: item id, `classifyStacAsset(...).label`, LoD list, `cityObjects` count. Row click ↔ map select (shared `selectedId` state), row hover ↔ map hover.
- Selected item detail strip under the list: id + format label + either `<button className="stac-add-btn">Add to scene</button>` (loadable) or `<a className="stac-download-link" href={assetHref} target="_blank" rel="noopener noreferrer">Download ({label})</a>` (not loadable) or "No data asset" (null href). Every loadable row also gets an inline small Add button.
- Adding: `onAddUrl(item.assetHref)`; keep the browser open; track `addedHrefs` in local `useState<ReadonlySet<string>>` → button text flips to `"Added ✓"` and disables. (Multiple items can be added in one session — the user asked for exactly this.)
- Status plumbing: collections loading → `<p className="stac-status">Loading catalog…</p>`; error → message + `<button onClick={retryCollections}>Retry</button>`; same pattern per items entry.

- [ ] **Step 1: Write failing tests** — mock heavy edges only:

```tsx
vi.mock("../../../../src/ui/stac/StacItemMap", () => ({
  StacItemMap: (props: { items: readonly unknown[] }) => (
    <div data-testid="stac-item-map" data-count={props.items.length} />
  ),
}));
vi.mock("../../../../src/features/stac/stacClient", () => ({
  fetchStacCollections: vi.fn(),
}));
vi.mock("../../../../src/features/stac/stacItems", () => ({
  fetchCollectionItems: vi.fn(),
}));
```

Reset `useStacStore` state in `afterEach` (repo convention). Test cases:

1. renders loading state, then collection cards after the mocked fetch resolves (`findByRole("button", { name: /3D BAG/ })`);
2. search filters cards;
3. a card without `itemsParquetHref` shows "No items indexed" and is disabled;
4. clicking a browsable card loads items and shows the list + mocked map with `data-count`;
5. item filter narrows the list; cap note appears when > 300 (construct 301 fake items in the mocked fetcher);
6. clicking "Add to scene" on a loadable item calls `onAddUrl` with the asset href and flips to "Added ✓" (disabled, `onAddUrl` not called twice);
7. an `application/zip` item shows a Download link (`getByRole("link", { name: /download/i })` with correct href) and no Add button;
8. back button returns to the cards view.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** the two components plus CSS. CSS block appended to `app.css` after the modal styles, token-based (works in both themes):

```css
/* --- STAC catalog browser --------------------------------------------- */
.stac-browser {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-height: 24rem;
}
.stac-search {
  width: 100%;
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-input);
  color: var(--fg);
  font-size: 0.8rem;
}
.stac-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
  gap: 0.6rem;
  overflow-y: auto;
}
.stac-card {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.7rem;
  text-align: left;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-muted);
  color: var(--fg);
  cursor: pointer;
}
.stac-card:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--bg-panel-hover);
}
.stac-card:disabled {
  opacity: 0.55;
  cursor: default;
}
.stac-card-title {
  font-size: 0.8rem;
  font-weight: 600;
}
.stac-card-desc {
  font-size: 0.68rem;
  color: var(--fg-muted);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.stac-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}
.stac-badge {
  font-size: 0.6rem;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--fg-muted);
}
.stac-badge-lod {
  color: var(--accent);
  border-color: var(--accent-soft);
}
.stac-badge-feature {
  color: var(--teal);
  border-color: var(--teal-soft);
}
.stac-card-footer {
  margin-top: auto;
  font-size: 0.65rem;
  color: var(--fg-dim);
}
.stac-items {
  display: grid;
  grid-template-columns: minmax(16rem, 22rem) 1fr;
  gap: 0.75rem;
  min-height: 24rem;
}
.stac-item-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  overflow-y: auto;
  max-height: 26rem;
}
.stac-item-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.55rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-muted);
  color: var(--fg);
  font-size: 0.7rem;
  cursor: pointer;
  text-align: left;
}
.stac-item-row:hover,
.stac-item-row.is-hovered {
  border-color: var(--accent);
}
.stac-item-row.is-selected {
  border-color: var(--accent);
  background: var(--bg-panel-hover);
}
.stac-item-map {
  min-height: 24rem;
  border-radius: var(--radius);
  overflow: hidden;
  border: 1px solid var(--border);
}
.stac-add-btn {
  padding: 0.3rem 0.7rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--accent);
  background: var(--accent-soft);
  color: var(--accent-text);
  font-size: 0.7rem;
  cursor: pointer;
}
.stac-add-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.stac-download-link {
  font-size: 0.7rem;
  color: var(--teal);
}
.stac-status {
  font-size: 0.75rem;
  color: var(--fg-muted);
}
.stac-back {
  align-self: flex-start;
  background: none;
  border: none;
  color: var(--accent);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0.2rem 0;
}
.stac-cap-note {
  font-size: 0.65rem;
  color: var(--fg-dim);
}
```

(Exact variable names exist in `:root` at app.css L5-50; verify `--bg-muted`/`--accent-text` exist and substitute the closest existing token if not.)

- [ ] **Step 4: Verify** — `npx vitest run tests/unit/ui/stac/ && npx tsc -b --noEmit`.

- [ ] **Step 5: Commit** — `git commit -m "feat: StacBrowser — collection cards and item picker with mini-map"`

---

### Task 8: Modal chrome hook + StacBrowserDialog

`AddLayerDialog` owns the app's only modal behaviour (focus save/restore, body scroll lock, capture-phase Escape + Tab trap, backdrop mousedown dismiss). Extract it into a hook and reuse it for the new standalone dialog; the existing `AddLayerDialog.test.tsx` suite is the regression net for the extraction.

**Files:**

- Create: `src/ui/useModalChrome.ts`
- Modify: `src/ui/layers/AddLayerDialog.tsx` (replace its inline effects with the hook — behaviour identical)
- Create: `src/ui/stac/StacBrowserDialog.tsx`
- Modify: `src/app/app.css` (wide-modal variant)
- Test: `tests/unit/ui/stac/StacBrowserDialog.test.tsx`

**Interfaces:**

```ts
// useModalChrome.ts — extracted verbatim from AddLayerDialog.tsx L61-115
/** Focus capture/restore, body scroll lock, capture-phase Escape-to-close
 *  and Tab focus trap for a portal modal. `dialogRef` is focused on mount. */
export function useModalChrome(
  dialogRef: RefObject<HTMLDivElement | null>,
  onClose: () => void,
): void;

// StacBrowserDialog.tsx
export interface StacBrowserDialogProps {
  readonly onClose: () => void;
  readonly onAddUrl: (url: string) => void;
}
export function StacBrowserDialog(props: StacBrowserDialogProps): ReactElement;
```

- [ ] **Step 1: Write failing tests** for `StacBrowserDialog` (mock `StacBrowser` itself with a stub that renders a button calling `onAddUrl("https://x/a.city.json")` — the dialog's own contract is what's under test): renders `role="dialog"` with title "3D city model catalog"; Escape calls `onClose`; backdrop mousedown calls `onClose`; clicking the stub's add button forwards to `onAddUrl` and does **not** close; close button ("×", `aria-label="Close"`) calls `onClose`.

- [ ] **Step 2: Run new tests (fail) AND the existing dialog suite (green baseline)** — `npx vitest run tests/unit/ui/layers/AddLayerDialog.test.tsx tests/unit/ui/stac/`.

- [ ] **Step 3: Implement** — move AddLayerDialog's three effects (focus L61-69, scroll lock L74-80, keydown trap L82-115) plus the `FOCUSABLE` selector constant into `useModalChrome`; AddLayerDialog calls `useModalChrome(dialogRef, onClose)`. `StacBrowserDialog`: `createPortal` to `document.body`, `.modal-backdrop` (with the same `onMouseDown` backdrop-dismiss + drag-swallow pattern as AddLayerDialog L120-139) → `.modal.modal-wide.stac-dialog` with `role="dialog"`, `aria-modal`, `aria-labelledby`, header (title + × close), `.modal-body` → `<StacBrowser onAddUrl={onAddUrl} />`. CSS: `.modal-wide { width: min(100%, 58rem); }` next to `.modal` (~app.css L3204).

- [ ] **Step 4: Verify** — `npx vitest run tests/unit/ui/layers/ tests/unit/ui/stac/ && npx tsc -b --noEmit` (AddLayerDialog suite must stay green — that proves the extraction).

- [ ] **Step 5: Commit** — `git commit -m "feat: StacBrowserDialog + shared useModalChrome extracted from AddLayerDialog"`

---

### Task 9: Wire-up — "Catalog" tab in AddLayerDialog + "Browse catalog" on the landing page

**Files:**

- Modify: `src/ui/layers/AddLayerDialog.tsx` (third tab)
- Modify: `src/app/App.tsx` (landing button + dialog mount)
- Modify: `src/app/app.css` (landing button style reusing `.sample-data-btn`)
- Test: extend `tests/unit/ui/layers/AddLayerDialog.test.tsx`; extend `tests/unit/app/appEngineBoot.test.tsx` or a new focused `tests/unit/app/appCatalogEntry.test.tsx` following its mock recipe

**Interfaces:**

- Consumes: `StacBrowser` (Task 7), `StacBrowserDialog` (Task 8), existing `handlePickedUrl` (App.tsx:962-967), existing `SourceTab` union (AddLayerDialog.tsx:42).

- [ ] **Step 1: Write failing tests**

AddLayerDialog (mock `StacBrowser` with a stub exposing a button that calls its `onAddUrl` prop):

1. dialog shows three tabs: "City model", "Geospatial", "Catalog";
2. selecting Catalog renders the stub and adds the wide-modal class (`expect(screen.getByRole("dialog").className).toContain("modal-wide")`);
3. the stub's add forwards the URL to the dialog's `onAddUrl` prop **without closing** the dialog (dialog still in the document — multi-add).

App landing (per appEngineBoot.test.tsx recipe — mock NavaraViewport/duckdb/openStreamingLayer/loadFromUrl, then import App; additionally mock `src/ui/stac/StacBrowserDialog` with a stub that renders a marker div and an add button):

1. landing shows a "Browse catalog" button next to "Load Delft sample";
2. clicking it mounts the dialog stub; the stub's add triggers the same URL loading path (`loadFromUrl` mock called with the href).

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**

`AddLayerDialog.tsx`: `type SourceTab = "city" | "geo" | "stac"`; third `.modal-tab` labelled `Catalog`; third tabpanel rendering `<StacBrowser onAddUrl={onAddUrl} />` — **the raw prop**, not the closing `handleUrl` wrapper, so the dialog stays open for multi-add; dialog className gains `modal-wide` when `tab === "stac"`.

`App.tsx`: add `const [catalogOpen, setCatalogOpen] = useState(false);` near the landing state; in `.sample-data-section` (L1205-1225) add after the Delft button:

```tsx
<button
  type="button"
  className="sample-data-btn"
  onClick={() => setCatalogOpen(true)}
  disabled={loading}
>
  Browse catalog
</button>
```

and mount at the end of the landing `<main>`:

```tsx
{
  catalogOpen && (
    <StacBrowserDialog
      onClose={() => setCatalogOpen(false)}
      onAddUrl={handlePickedUrl}
    />
  );
}
```

No explicit close-on-add: when the first layer finishes loading, `hasLayers` flips and the landing branch (dialog included) unmounts naturally; meanwhile the user can queue several items. No explicit camera flight either — the viewport already auto-fits newly added layers.

- [ ] **Step 4: Verify** — `npx vitest run tests/unit/ui/layers/ tests/unit/app/ && npx tsc -b --noEmit`.

- [ ] **Step 5: Full suite + browser smoke** — `npx vitest run` (whole suite green). Then `npm run dev` + `agent-browser`: open the app, click "Browse catalog", snapshot — collection cards render from the live catalog; open "Netherlands 3D BAG Building Models", snapshot — item list renders (map presence is enough; SwiftShader fps is fine); click one 3D BAG item's "Add to scene"; wait; snapshot shows the viewer shell (layer added). Also smoke the Add Layer dialog's Catalog tab from the viewer. Fix what the smoke surfaces.

- [ ] **Step 6: Commit** — `git commit -m "feat: browse the Open3D City STAC catalog from the landing page and Add Layer dialog"`

---

### Task 10: Docs + final review

**Files:**

- Modify: `CLAUDE.md` (Project Structure: add `features/stac/` and `ui/stac/`; Tech Stack: note maplibre-gl for the catalog mini-map; mention the catalog root URL constant)
- Modify: `docs/roadmap.md` if it tracks feature additions (read it first; follow its format)

- [ ] **Step 1: Update docs** as above; keep edits minimal and factual (catalog root URL, the `rel:"item"` 404 gotcha, zip = download-only).
- [ ] **Step 2: Run the full gate** — `npx tsc -b --noEmit && npx vitest run` — everything green.
- [ ] **Step 3: Code review** — dispatch `feature-dev:code-reviewer` (high effort) over the whole diff before pushing; fix critical findings.
- [ ] **Step 4: Commit docs** — `git commit -m "docs: record the STAC catalog browser"` — then push `develop`.

## Review amendments (binding — from the plan review, apply on top of the tasks above)

1. **Task 7 CSS:** `.stac-card-grid` needs `max-height: 26rem;` (like `.stac-item-list`) or its `overflow-y: auto` is inert inside `.modal`'s own scroll and the whole modal scrolls instead.
2. **Task 7 item filtering:** the substring filter over opaque tile ids is not enough for 8,941-item collections where the list caps at 300. Add a checkbox `"Only items in map view"` (default **on**): the list is additionally filtered to items whose `bbox2d` intersects the map's current bounds. `StacItemMap` gains an optional `onViewBounds?: (b: [[number, number], [number, number]]) => void` prop fired on maplibre `moveend` (and once after the initial fit); `StacBrowser` stores the bounds in state and applies the intersection test (pure helper `bboxIntersectsBounds(bbox2d, bounds): boolean` in `stacGeo.ts`, with tests). The map itself always renders ALL valid footprints of the collection — only the list is narrowed. Add a StacBrowser test: with the checkbox on and a mocked map firing `onViewBounds`, only intersecting items are listed; unchecking restores the full (capped) list.
3. **Task 7 spec truth-telling:** on the landing page the dialog unmounts when the first layer finishes loading (the landing branch itself unmounts) — multi-add there only queues while the first load is in flight. That is accepted behaviour; the Add Layer dialog path is the real multi-add. Don't fight it.
4. **Task 9 tests:** any new test that `vi.mock`s `src/analytics/duckdb` with an explicit factory (the `appEngineBoot.test.tsx` recipe) must include `queryParquetBuffer: vi.fn()` in the factory now that the module exports it — and keep `StacBrowserDialog`/`StacBrowser` mocked in App-level tests so maplibre/DuckDB never load under jsdom.
5. **Task 10 docs:** note in CLAUDE.md that STAC-sourced `.city.json.gz` layers take the in-memory analytics path (`loadCityModelFromMemory`), not the DuckDB extension URL path — `read_cityjson` can't read a gzipped remote URL; the existing fallback already handles it.
6. **General:** every commit stages explicit paths (no `git add -A`); the plan document is committed separately as `docs:`; trailer is `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Decisions log (for the user's morning read)

1. Catalog root hardcoded to the GCS URL (`catalog.open3d.city` is a marketing page). Deliberately not configurable — see Global Constraints.
2. Items come exclusively from the `items-geoparquet` asset read by the already-shipped DuckDB-wasm (buffer registration, ≤2.24 MB files — no httpfs/range reads); collections without it (22/53) are shown but marked "No items indexed".
3. New dependency `maplibre-gl` for the mini-map (imperative, CARTO raster tiles keyed to app theme, attribution control on-map). The alternative — hand-rolling a slippy map — was rejected.
4. `application/zip` assets (5,624 items, CityGML archives) are download-only links; CityJSON/CityJSONSeq/CityGML/FlatCityBuf assets get "Add to scene" through the existing URL loader.
5. Added gzip support to remote loads (magic-byte sniffing) because 3D BAG — the biggest CORS-clean collection — serves `.city.json.gz`.
6. Footprints/bboxes failing WGS84 range validation (a known generator bug on ~4 collections) are excluded from the map but the items stay listed and addable.
7. Multi-add UX: the browser stays open after "Add to scene" ("Added ✓"); the landing modal disappears naturally when the first layer lands and the app switches to the viewer.
8. Assets on CORS-less hosts (e.g. `3d.bk.tudelft.nl`) will fail with the app's existing friendly network-error message; no proxy was added.
