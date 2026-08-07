# CityParquet Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load CityParquet packages (single `.parquet`, package directory, `gs://`/`s3://` wildcard, local folder) into the viewer as static city-model layers.

**Architecture:** An engine-free parser in `@cityjson/navara-cityparquet` (vendored patched hyparquet → WKB decode → `CityModel`); an app-side `src/features/cityparquet/` module for URL classification, object-storage listing/glob and fetch orchestration; small integrations into the existing static-layer chain (detectEncoding, useLayerFileLoader, SourcePicker, App restore). Spec: `docs/superpowers/specs/2026-08-07-cityparquet-loading-design.md`.

**Tech Stack:** TypeScript, hyparquet 1.28.1 (vendored, patched), hyparquet-compressors, vitest, existing `@cityjson/navara-core` domain types.

## Global Constraints

- Reference implementation is ground truth: `/data2/hideba/cityparquet-paper/cityparquet-rs` (read the cited files before implementing a behavior).
- Real sample data: `/data2/hideba/cityparquet-paper/benchmarking/data/cityparquet/{delft,lod3_railway,...}` — never commit these (2.4 MB+).
- Submodule work happens in `packages/cityjson-navara-plugins` with **pnpm, always `cd` into the submodule** (Corepack refuses pnpm from the app root). App work uses npm from the repo root.
- After ANY app-side `npm install`, re-run `pnpm install` inside the submodule.
- Type check: `npx tsc -b --noEmit` (app root) and `pnpm typecheck` (submodule). Tests: `npx vitest run <path>` (app), `pnpm vitest run packages/navara-cityparquet` (submodule root, by path, never `--project`).
- Commit convention: `feat:`/`fix:`/`test:`/`docs:` prefix + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. **Submodule-first protocol**: commit + push submodule (`git -C packages/cityjson-navara-plugins push origin main`), then the parent pointer bump + app files.
- Engine-free rule: nothing in `navara-cityparquet` or `src/features/cityparquet/` may import `@navaramap/*`. Tests run under Node (no jsdom unless stated).
- No `"vite-plus/test"` imports in test files — import from `"vitest"`.
- Errors are user-facing sentences (match the tone of `loadCityModel.ts`: "The file could not be…").
- The four CityGML↔CityJSON type renames: `Storey↔BuildingStorey`, `HollowSpace↔TunnelHollowSpace`, `Square↔TransportSquare`, `GenericOccupiedSpace↔GenericCityObject`. Reader accepts both spellings, emits CityJSON spelling.

---

### Task 1: Package scaffolding — vendor hyparquet, fixture, encoding union

**Files:**

- Create: `packages/cityjson-navara-plugins/packages/navara-cityparquet/src/vendor/hyparquet/` (vendored JS + `index.d.ts` + `VENDORED.md`)
- Create: `packages/cityjson-navara-plugins/packages/navara-cityparquet/tests/fixtures/two-buildings-cityparquet/` (generated package)
- Create: `packages/cityjson-navara-plugins/packages/navara-cityparquet/tests/fixtures/two-buildings-cityparquet-28992/` (generated package, different EPSG — for the CRS-disagreement test)
- Create: `packages/cityjson-navara-plugins/packages/navara-cityparquet/tests/fixtures/two-buildings.city.json` (copy of the app fixture — the submodule is pushed as a standalone repo, so no absolute paths into the parent)
- Create: `packages/cityjson-navara-plugins/packages/navara-cityparquet/tests/vendorHyparquet.test.ts`
- Modify: `packages/cityjson-navara-plugins/packages/navara-cityparquet/package.json` (add `hyparquet-compressors` dependency)
- Modify: `packages/cityjson-navara-plugins/packages/navara-core/src/citymodel/supportedEncodings.ts` (+ its existing test if any)
- Modify (app, compile-fix fallout of the union widening — verified to break `npx tsc -b --noEmit` otherwise): `src/app/App.tsx` DuckDB effect (~L505: skip `"cityparquet"` exactly like `"citygml"`, so the in-memory fallback runs) and `src/features/stac/stacTypes.ts` (`StacAssetKind` gains `"cityparquet"`, `LABELS` gains `cityparquet: "CityParquet"`). Do NOT touch `MODEL_EXTENSIONS` here — STAC loadability is Task 8's job.

**Interfaces:**

- Produces: importable vendored module `../src/vendor/hyparquet/index.js` exporting `parquetMetadataAsync`, `parquetReadObjects`, `parquetSchema` (typed via hand-written `index.d.ts`); `CityModelEncoding` union now includes `"cityparquet"` (appended LAST in `CITYMODEL_ENCODING_PRIORITY` so STAC preference order is unchanged); fixture package paths used by every later submodule test.

- [ ] **Step 1: Vendor hyparquet.** In a temp dir: `npm pack hyparquet@1.28.1 && tar xf hyparquet-1.28.1.tgz`. Copy `package/src/*.js` into `src/vendor/hyparquet/`. Apply this exact patch to `src/vendor/hyparquet/datapage.js` (DELTA_BYTE_ARRAY exists only in the V2 page reader upstream; arrow-rs writes V1 pages):

```diff
   } else if (daph.encoding === 'DELTA_LENGTH_BYTE_ARRAY') {
     dataPage = new Array(nValues)
     deltaLengthByteArray(reader, nValues, dataPage)
+  } else if (daph.encoding === 'DELTA_BYTE_ARRAY') {
+    dataPage = new Array(nValues)
+    deltaByteArray(reader, nValues, dataPage)
   } else {
```

(`deltaByteArray` is already imported at the top of `datapage.js` in 1.28.1 — the V2 reader uses it; only this V1 branch is new.)

Write `src/vendor/hyparquet/VENDORED.md`: version 1.28.1, MIT, why vendored (single patched copy across the npm/pnpm split), the patch above verbatim, un-vendor condition (upstream V1 DELTA_BYTE_ARRAY support). Write `src/vendor/hyparquet/index.d.ts`:

```ts
export interface AsyncBuffer {
  byteLength: number;
  slice(start: number, end?: number): ArrayBuffer | Promise<ArrayBuffer>;
}
export interface KeyValue {
  key?: string | null;
  value?: string | null;
}
export interface FileMetaData {
  num_rows: bigint;
  key_value_metadata?: KeyValue[];
}
export interface SchemaTree {
  children: SchemaTree[];
  element: { name: string };
}
export function parquetMetadataAsync(file: AsyncBuffer): Promise<FileMetaData>;
export function parquetSchema(metadata: FileMetaData): SchemaTree;
export function parquetReadObjects(options: {
  file: AsyncBuffer;
  metadata?: FileMetaData;
  columns?: string[];
  rowStart?: number;
  rowEnd?: number;
  utf8?: boolean;
  compressors?: Record<string, unknown>;
}): Promise<Record<string, unknown>[]>;
```

- [ ] **Step 2: Generate the fixtures** (from the app repo root; `FIXDIR` = `packages/cityjson-navara-plugins/packages/navara-cityparquet/tests/fixtures`):

```bash
CLI=/data2/hideba/cityparquet-paper/cityparquet-rs/target/release/cityparquet
FIXDIR=packages/cityjson-navara-plugins/packages/navara-cityparquet/tests/fixtures
cp fixtures/two-buildings.city.json "$FIXDIR/two-buildings.city.json"
"$CLI" convert -o "$FIXDIR/two-buildings-cityparquet" --overwrite "$FIXDIR/two-buildings.city.json"
# EPSG-28992 variant for the CRS-disagreement test (same geometry, different declared CRS):
python3 - <<'EOF'
import json
m = json.load(open("fixtures/two-buildings.city.json"))
m["metadata"]["referenceSystem"] = "https://www.opengis.net/def/crs/EPSG/0/28992"
json.dump(m, open("/tmp/two-buildings-28992.city.json", "w"))
EOF
"$CLI" convert -o "$FIXDIR/two-buildings-cityparquet-28992" --overwrite /tmp/two-buildings-28992.city.json
```

Expect each package = `building.parquet` (~23 KB) + `metadata.json`. 3 objects, LoDs `0.0` + `2.2`. (If the referenceSystem key differs in the fixture, read the file and adapt the edit — the goal is only a package whose footer EPSG ≠ 7415.)

- [ ] **Step 3: Add `"cityparquet"` to the encoding union + fix the two app call sites it breaks.** In `supportedEncodings.ts` append `"cityparquet"` as the LAST entry of `CITYMODEL_ENCODING_PRIORITY`. Run the core tests to confirm nothing keys off array length. Then fix the verified compile fallout in the app: (a) `src/app/App.tsx` DuckDB effect (~L505-509) — the encoding narrowing must skip `"cityparquet"` the same way it skips `"citygml"` (falls back to `loadCityModelFromMemory`); (b) `src/features/stac/stacTypes.ts` — add `"cityparquet"` to `StacAssetKind` and a `cityparquet: "CityParquet"` entry to `LABELS`. Run `npx tsc -b --noEmit` at the app root — it must be green at the end of this task.

- [ ] **Step 4: Write the failing vendor test** `tests/vendorHyparquet.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parquetMetadataAsync,
  parquetReadObjects,
} from "../src/vendor/hyparquet/index.js";
import { compressors } from "hyparquet-compressors";

const FIXTURE = fileURLToPath(
  new URL(
    "./fixtures/two-buildings-cityparquet/building.parquet",
    import.meta.url,
  ),
);

function asyncBufferOf(bytes: Uint8Array) {
  const buf = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
  return {
    byteLength: buf.byteLength,
    slice: (s: number, e?: number) => buf.slice(s, e),
  };
}

describe("vendored hyparquet", () => {
  it("reads footer kv metadata and DELTA_BYTE_ARRAY ids from a real package", async () => {
    const file = asyncBufferOf(await readFile(FIXTURE));
    const metadata = await parquetMetadataAsync(file);
    const kv = metadata.key_value_metadata ?? [];
    expect(kv.map((e) => e.key)).toContain("city");
    const rows = await parquetReadObjects({
      file,
      metadata,
      compressors,
      utf8: false,
      columns: ["id", "object_type", "geometry_lod2_2"],
    });
    expect(rows.length).toBe(3);
    expect(typeof rows[0].id).toBe("string");
    const wkbRow = rows.find((r) => r.geometry_lod2_2 != null)!;
    expect(wkbRow.geometry_lod2_2).toBeInstanceOf(Uint8Array);
  });
});
```

- [ ] **Step 5: Make it pass.** Add `"hyparquet-compressors": "1.1.1"` to the package's `dependencies`. `cd packages/cityjson-navara-plugins && pnpm install && pnpm vitest run packages/navara-cityparquet`. Expected: PASS. Also `pnpm typecheck`.

- [ ] **Step 6: Commit.** Submodule commit: `feat: vendor patched hyparquet + cityparquet fixtures + encoding union entry`. Parent commit (App.tsx + stacTypes.ts compile fixes — no pointer bump yet, the submodule isn't pushed): `fix: widen encoding handling for upcoming cityparquet support`. Do not push the submodule yet — push happens when the parent integrates (Task 9).

---

### Task 2: WKB decoder

**Files:**

- Create: `packages/cityjson-navara-plugins/packages/navara-cityparquet/src/wkb.ts`
- Create: `packages/cityjson-navara-plugins/packages/navara-cityparquet/tests/wkb.test.ts`

**Interfaces:**

- Produces:

```ts
import type { Vec3 } from "@cityjson/navara-core";
export type WkbRing = Vec3[];
export type WkbFace = WkbRing[]; // rings[0] = exterior, rest holes; closing vertex STRIPPED
export type DecodedWkb =
  | { kind: "points"; points: Vec3[] }
  | { kind: "lines"; lines: Vec3[][] }
  | { kind: "faces"; faces: WkbFace[]; memberFaceCounts: number[] };
// MultiPolygonZ/PolyhedralSurfaceZ → memberFaceCounts = [faces.length]
// GeometryCollectionZ → one count per member (faces concatenated in member order)
export class WkbError extends Error {}
export function decodeWkb(bytes: Uint8Array): DecodedWkb;
```

Behavior mirror: `cityparquet-rs/crates/cityparquet/src/wkb_read.rs`. Little-endian only (byte-order marker `0x01`; `0x00` → `WkbError`). Type codes: 1001 PointZ, 1002 LineStringZ, 1003 PolygonZ, 1004 MultiPointZ, 1005 MultiLineStringZ, 1006 MultiPolygonZ, 1007 GeometryCollectionZ, 1015 PolyhedralSurfaceZ. Rings arrive closed; validate first==last (exact f64 bit equality not required — compare numerically) and strip the closing vertex; a ring with < 4 raw points → `WkbError`. Recursion/member depth cap 16. Truncated buffer → `WkbError` with offset in the message. A GeometryCollection member that is not PolyhedralSurfaceZ → `WkbError` (mirrors the writer, which only emits collections of solids).

- [ ] **Step 1: Write the failing tests** with a small byte-builder helper inside the test file:

```ts
import { describe, expect, it } from "vitest";
import { decodeWkb, WkbError } from "../src/wkb";

class W {
  bytes: number[] = [];
  u8(v: number) {
    this.bytes.push(v);
    return this;
  }
  u32(v: number) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v, true);
    this.bytes.push(...b);
    return this;
  }
  f64(v: number) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, v, true);
    this.bytes.push(...b);
    return this;
  }
  pt(x: number, y: number, z: number) {
    return this.f64(x).f64(y).f64(z);
  }
  out() {
    return new Uint8Array(this.bytes);
  }
}
// closed unit-square PolygonZ at height z
function polygonZ(w: W, z: number) {
  w.u8(1)
    .u32(1003)
    .u32(1) // 1 ring
    .u32(5)
    .pt(0, 0, z)
    .pt(1, 0, z)
    .pt(1, 1, z)
    .pt(0, 1, z)
    .pt(0, 0, z);
}

describe("decodeWkb", () => {
  it("decodes PolyhedralSurfaceZ into faces with closing vertex stripped", () => {
    const w = new W();
    w.u8(1).u32(1015).u32(2);
    polygonZ(w, 0);
    polygonZ(w, 3);
    const d = decodeWkb(w.out());
    if (d.kind !== "faces") throw new Error("wrong kind");
    expect(d.faces.length).toBe(2);
    expect(d.memberFaceCounts).toEqual([2]);
    expect(d.faces[0][0].length).toBe(4); // closing vertex stripped
    expect(d.faces[1][0][0]).toEqual([0, 0, 3]);
  });
  it("decodes MultiPolygonZ (footprints) and polygon holes", () => {
    const w = new W();
    w.u8(1)
      .u32(1006)
      .u32(1)
      .u8(1)
      .u32(1003)
      .u32(2)
      .u32(5)
      .pt(0, 0, 0)
      .pt(4, 0, 0)
      .pt(4, 4, 0)
      .pt(0, 4, 0)
      .pt(0, 0, 0)
      .u32(5)
      .pt(1, 1, 0)
      .pt(2, 1, 0)
      .pt(2, 2, 0)
      .pt(1, 2, 0)
      .pt(1, 1, 0);
    const d = decodeWkb(w.out());
    if (d.kind !== "faces") throw new Error("wrong kind");
    expect(d.faces[0].length).toBe(2); // exterior + hole
  });
  it("decodes GeometryCollectionZ of two solids with per-member counts", () => {
    const w = new W();
    w.u8(1).u32(1007).u32(2);
    w.u8(1).u32(1015).u32(1);
    polygonZ(w, 0);
    w.u8(1).u32(1015).u32(2);
    polygonZ(w, 1);
    polygonZ(w, 2);
    const d = decodeWkb(w.out());
    if (d.kind !== "faces") throw new Error("wrong kind");
    expect(d.faces.length).toBe(3);
    expect(d.memberFaceCounts).toEqual([1, 2]);
  });
  it("decodes MultiPointZ into points", () => {
    const w = new W();
    w.u8(1)
      .u32(1004)
      .u32(2)
      .u8(1)
      .u32(1001)
      .pt(1, 2, 3)
      .u8(1)
      .u32(1001)
      .pt(4, 5, 6);
    const d = decodeWkb(w.out());
    if (d.kind !== "points") throw new Error("wrong kind");
    expect(d.points).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });
  it("rejects big-endian, unknown type codes, truncation, open rings", () => {
    expect(() => decodeWkb(new W().u8(0).u32(1015).out())).toThrow(WkbError);
    expect(() => decodeWkb(new W().u8(1).u32(999).out())).toThrow(WkbError);
    const t = new W();
    t.u8(1).u32(1015).u32(1);
    polygonZ(t, 0);
    expect(() => decodeWkb(t.out().slice(0, 20))).toThrow(WkbError);
    const open = new W();
    open
      .u8(1)
      .u32(1015)
      .u32(1)
      .u8(1)
      .u32(1003)
      .u32(1)
      .u32(4)
      .pt(0, 0, 0)
      .pt(1, 0, 0)
      .pt(1, 1, 0)
      .pt(0, 1, 0);
    expect(() => decodeWkb(open.out())).toThrow(WkbError);
  });
});
```

- [ ] **Step 2: Run to verify failure.** `cd packages/cityjson-navara-plugins && pnpm vitest run packages/navara-cityparquet/tests/wkb.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `src/wkb.ts`** with a `DataView` cursor. Structure: `readHeader(expectKinds?)` → `(typeCode)`; dispatch: 1001/1004 → points; 1002/1005 → lines; 1003 alone at top level → treat as one-face `faces` (defensive); 1006/1015 → loop polygons; 1007 → loop members (each must be 1015), concatenate faces, record counts. Ring reader validates count ≥ 4, closure (|first-last| all three coords < 1e-9 → strip; else throw).

- [ ] **Step 4: Run tests** → PASS. `pnpm typecheck`.

- [ ] **Step 5: Add one real-data test** in the same file: read `geometry_lod2_2` of the first BuildingPart row from the fixture (reuse the Task 1 read pattern), decode, expect `kind === "faces"`, `faces.length === 6` (a box), every face with 1 ring of 4+ vertices, coordinates in EPSG:7415 range (x between 80000–90000). Run → PASS.

- [ ] **Step 6: Commit (submodule).** `feat: little-endian ISO-WKB decoder incl. PolyhedralSurfaceZ`

---

### Task 3: Footer metadata parser

**Files:**

- Create: `packages/cityjson-navara-plugins/packages/navara-cityparquet/src/footer.ts`
- Create: `packages/cityjson-navara-plugins/packages/navara-cityparquet/tests/footer.test.ts`

**Interfaces:**

- Produces:

```ts
export interface CityGeometryColumnMeta {
  name: string;
  encoding: string;
  geometryTypes: string[];
  orientation3d: string | null;
}
export interface CityFooter {
  version: string;
  epsg: number | null; // from city.crs PROJJSON id {authority:"EPSG", code}
  primaryColumn: string | null;
  geometryColumns: CityGeometryColumnMeta[]; // from city.columns
  attributes: string[]; // from city.attributes ([] if absent)
  sourceFormat: string | null;
}
export class CityParquetError extends Error {}
export function parseCityFooter(
  kv: ReadonlyArray<{ key?: string | null; value?: string | null }>,
): CityFooter;
export function lodFromColumnName(name: string): { lod: string | null } | null;
export function propsColumnFor(geometryColumn: string): string;
```

`lodFromColumnName`: `"geometry_lod2_2"` → `{lod: "2.2"}`; legacy bare `"geometry"` → `{lod: null}`; anything else (including `"geometry_vertices_lod2_2"`, attribute names) → `null`. `propsColumnFor("geometry_lod2_2")` → `"geometry_properties_lod2_2"`; `propsColumnFor("geometry")` → `"geometry_properties"`. Mirror: `cityparquet-rs/crates/cityparquet-schema/src/types.rs` (`Lod::from_column_suffix`) and `metadata.rs` (`CityMetadata`).

- [ ] **Step 1: Failing tests** — feed literal kv arrays:

```ts
import { describe, expect, it } from "vitest";
import {
  CityParquetError,
  lodFromColumnName,
  parseCityFooter,
  propsColumnFor,
} from "../src/footer";

const CITY = {
  version: "0.1.0-draft",
  source_format: "CityJSONSeq",
  crs: { type: "CompoundCRS", id: { authority: "EPSG", code: 7415 } },
  primary_column: "geometry_lod2_2",
  columns: [
    {
      name: "geometry_lod2_2",
      encoding: "WKB",
      geometry_types: ["PolyhedralSurface Z"],
      orientation_3d: "right-handed",
    },
  ],
  attributes: ["b3_h_maaiveld"],
};

describe("parseCityFooter", () => {
  it("parses the city key", () => {
    const f = parseCityFooter([
      { key: "city", value: JSON.stringify(CITY) },
      { key: "geo", value: "{}" },
    ]);
    expect(f.version).toBe("0.1.0-draft");
    expect(f.epsg).toBe(7415);
    expect(f.primaryColumn).toBe("geometry_lod2_2");
    expect(f.geometryColumns[0]).toEqual({
      name: "geometry_lod2_2",
      encoding: "WKB",
      geometryTypes: ["PolyhedralSurface Z"],
      orientation3d: "right-handed",
    });
    expect(f.attributes).toEqual(["b3_h_maaiveld"]);
  });
  it("throws a friendly error when the city key is missing", () => {
    expect(() => parseCityFooter([{ key: "geo", value: "{}" }])).toThrow(
      CityParquetError,
    );
    expect(() => parseCityFooter([])).toThrow(/not a CityParquet file/i);
  });
  it("returns epsg null for a non-EPSG or absent crs", () => {
    expect(
      parseCityFooter([
        { key: "city", value: JSON.stringify({ ...CITY, crs: undefined }) },
      ]).epsg,
    ).toBeNull();
    expect(
      parseCityFooter([
        {
          key: "city",
          value: JSON.stringify({
            ...CITY,
            crs: { id: { authority: "ESRI", code: 1 } },
          }),
        },
      ]).epsg,
    ).toBeNull();
  });
  it("tolerates absent optional fields", () => {
    const f = parseCityFooter([
      { key: "city", value: JSON.stringify({ version: "0.1.0-draft" }) },
    ]);
    expect(f.attributes).toEqual([]);
    expect(f.geometryColumns).toEqual([]);
    expect(f.primaryColumn).toBeNull();
  });
});

describe("lodFromColumnName / propsColumnFor", () => {
  it("parses LoD suffixes", () => {
    expect(lodFromColumnName("geometry_lod2_2")).toEqual({ lod: "2.2" });
    expect(lodFromColumnName("geometry_lod0_0")).toEqual({ lod: "0" });
    expect(lodFromColumnName("geometry")).toEqual({ lod: null });
    expect(lodFromColumnName("geometry_vertices_lod2_2")).toBeNull();
    expect(lodFromColumnName("b3_volume_lod2")).toBeNull();
  });
  it("maps props columns", () => {
    expect(propsColumnFor("geometry_lod2_2")).toBe(
      "geometry_properties_lod2_2",
    );
    expect(propsColumnFor("geometry")).toBe("geometry_properties");
  });
});
```

LoD display strings must match what `parseCityJSON` produces for the same source (`"0"`, `"1.2"`, `"2.2"`): check how core renders CityJSON `lod` values (`packages/navara-core/src/citymodel/cityjson/`) and normalize `lod0_0` → `"0"`, `lod2_2` → `"2.2"` — i.e. strip a trailing `.0`, because CityJSON files write `"lod": 0` or `"0"` while the column grammar always carries a minor. This keeps `availableLods` consistent between a CityJSON layer and the same data as CityParquet.

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (plain JSON parsing + narrow validation; every thrown error is `CityParquetError` with a sentence). **Step 4: Run** → PASS; `pnpm typecheck`.

- [ ] **Step 5: Commit (submodule).** `feat: cityparquet footer metadata parser`

---

### Task 4: Table reader (hyparquet orchestration)

**Files:**

- Create: `packages/cityjson-navara-plugins/packages/navara-cityparquet/src/tableReader.ts`
- Create: `packages/cityjson-navara-plugins/packages/navara-cityparquet/tests/tableReader.test.ts`

**Interfaces:**

- Consumes: `parseCityFooter`, `lodFromColumnName`, `propsColumnFor` (Task 3), vendored hyparquet (Task 1).
- Produces:

```ts
export interface GeometryColumnRef {
  name: string;
  lod: string | null;
  propsName: string | null;
}
export interface CityParquetTableData {
  footer: CityFooter;
  rows: ReadonlyArray<Record<string, unknown>>;
  geometryColumns: ReadonlyArray<GeometryColumnRef>;
}
export async function readCityParquetTable(
  bytes: Uint8Array,
): Promise<CityParquetTableData>;
```

Behavior:

1. Wrap bytes into an AsyncBuffer (normalize `byteOffset` via `bytes.buffer.slice(...)`).
2. `parquetMetadataAsync` → `parseCityFooter(metadata.key_value_metadata ?? [])`.
3. Reject non-WKB: if any `footer.geometryColumns[].encoding !== "WKB"` → `CityParquetError` `` `This file uses the experimental "${encoding}" geometry encoding, which is not supported.` ``
4. Discover geometry columns from the **schema top-level column names** (not just the footer, so the legacy bare `geometry` column works): a name where `lodFromColumnName(name) !== null` AND the name is not in `footer.attributes`. `propsName` = `propsColumnFor(name)` if that column exists in the schema, else null.
5. Read all rows with column projection `["id","feature_id","object_type","parents","children","bbox", ...geometryColumnNames, ...propsNames, ...footer.attributes.filter(present), "other_attributes"(if present)]` and `utf8: false`, `compressors`. Skip `address`, `template`, `material_*`, `texture_*`, `other`, `children_roles`.

- [ ] **Step 1: Failing test** against the fixture:

```ts
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readCityParquetTable } from "../src/tableReader";

const FIXTURE = fileURLToPath(
  new URL(
    "./fixtures/two-buildings-cityparquet/building.parquet",
    import.meta.url,
  ),
);

describe("readCityParquetTable", () => {
  it("reads the fixture package table", async () => {
    const t = await readCityParquetTable(await readFile(FIXTURE));
    expect(t.footer.epsg).toBe(7415);
    expect(t.rows.length).toBe(3);
    const names = t.geometryColumns.map((g) => g.name).sort();
    expect(names).toEqual(["geometry_lod0_0", "geometry_lod2_2"]);
    expect(
      t.geometryColumns.every((g) =>
        g.propsName?.startsWith("geometry_properties_"),
      ),
    ).toBe(true);
    const part = t.rows.find((r) => r.object_type === "BuildingPart")!;
    expect(part.geometry_lod2_2).toBeInstanceOf(Uint8Array);
    expect(typeof part.id).toBe("string");
  });
  it("rejects a non-parquet buffer with a friendly error", async () => {
    await expect(
      readCityParquetTable(new Uint8Array([1, 2, 3, 4])),
    ).rejects.toThrow(/parquet/i);
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** Wrap any hyparquet internal error (`try/catch`) into `CityParquetError("The file could not be read as Parquet…")` preserving `cause`. **Step 4: Run** → PASS; `pnpm typecheck`.
- [ ] **Step 5: Commit (submodule).** `feat: cityparquet table reader with column projection`

---

### Task 5: Row decode → CityObjects

**Files:**

- Create: `packages/cityjson-navara-plugins/packages/navara-cityparquet/src/decodeTable.ts`
- Create: `packages/cityjson-navara-plugins/packages/navara-cityparquet/tests/decodeTable.test.ts`

**Interfaces:**

- Consumes: `CityParquetTableData` (Task 4), `decodeWkb` (Task 2), core types `CityObject`, `Surface`, `BuildingSurfaceType`, `Vec3`, `BBox3`.
- Produces:

```ts
export function decodeTableObjects(
  table: CityParquetTableData,
): Record<string, CityObject>;
export function cityJsonTypeForObjectType(objectType: string): string; // Storey→BuildingStorey etc., else identity
```

Decode rules (mirror `cityparquet-rs/crates/cityparquet/src/decode.rs` + `export.rs::reconstruct_boundaries`/`rebuild_semantics`; read them first):

- Per row: `id` (string, required), `objectType = cityJsonTypeForObjectType(object_type)`, `parents`/`children` (**nullish** → `[]` — an absent column yields `undefined`, not `null`), `bbox` struct → `BBox3 | null` (`[xmin,ymin,zmin,xmax,ymax,zmax]`, null if struct nullish).
- Attributes: for each `footer.attributes` column present, non-null value → attribute. Conversions: `bigint` → `Number` (values beyond `Number.MAX_SAFE_INTEGER` stay `bigint`? No — convert with `Number()`; city attributes never need > 2^53), `Date` → ISO string, arrays stay arrays, `Uint8Array` (a non-utf8 read of a string column under `utf8:false` never happens for STRING logical type — but guard: decode via `TextDecoder`). Column name starting `ex_` → attribute key `+` + rest. `other_attributes` JSON string → parse, merge keys (row value wins nothing — these are non-colliding by construction).
- Surfaces: for each `geometryColumns` entry with a non-null cell:
  - `decodeWkb(cell)`; `kind !== "faces"` → skip the cell (points/lines are not renderable surfaces; keep a counter, no throw).
  - props cell (may be null): `surfaces` JSON string → array (each `{type?, ...attrs}`); `face_semantics` → number/null array. For WKB face `i`: semantic index `si = face_semantics?.[i]`, surface def `sd = si != null ? surfacesArr[si] : undefined`.
  - Surface type: `sd?.type` if it is one of core's `BuildingSurfaceType` values, else `"unknown"`. Surface attributes: `sd` minus `type`/`parent`/`children` keys, else `{}`.
  - Emit `Surface { type, rings: face, attributes, lod: geometryColumn.lod }`. (`rings` = the WkbFace: exterior + holes, already unclosed, absolute EPSG coordinates — exactly what `buildCityMeshArrays` triangulates.)
- `CityObject.lod`: highest numeric LoD among the row's non-null geometry cells (string compare via parseFloat), else `null` — check what `parseCityJSON` sets and mirror it exactly (read `packages/navara-core/src/citymodel/cityjson/parseCityJSON.ts` first; consistency matters more than this plan's wording).
- Objects with no geometry at all (typical root `Building`) still get an entry with `surfaces: []` — the inherited-attributes display depends on them existing.

- [ ] **Step 1: Failing tests** — fixture-driven plus a synthetic-row test:

```ts
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readCityParquetTable } from "../src/tableReader";
import {
  decodeTableObjects,
  cityJsonTypeForObjectType,
} from "../src/decodeTable";

const FIXTURE = fileURLToPath(
  new URL(
    "./fixtures/two-buildings-cityparquet/building.parquet",
    import.meta.url,
  ),
);

describe("decodeTableObjects (fixture)", () => {
  // Fixture ground truth (read fixtures/two-buildings.city.json to confirm): Pand.0001 is a
  // Building WITH its own Solid lod2.2 geometry and one child part; Pand.0001-part1 is a
  // BuildingPart (MultiSurface lod2.2); Pand.0002 is a Building (Solid lod2.2, no children).
  it("reconstructs objects, hierarchy, semantics and LoDs", async () => {
    const objects = decodeTableObjects(
      await readCityParquetTable(await readFile(FIXTURE)),
    );
    const ids = Object.keys(objects);
    expect(ids.length).toBe(3);
    const part = ids
      .map((id) => objects[id])
      .find((o) => o.objectType === "BuildingPart")!;
    expect(part.parents.length).toBe(1);
    expect(objects[part.parents[0]]).toBeDefined();
    expect(objects[part.parents[0]].children).toContain(part.id);
    for (const o of ids.map((id) => objects[id])) {
      expect(o.surfaces.length).toBeGreaterThan(0); // all three carry geometry in this fixture
      const lods = new Set(o.surfaces.map((s) => s.lod));
      expect(lods.has("2.2")).toBe(true);
      expect(lods.has("0")).toBe(true); // writer-synthesized LoD0 footprint
      for (const s of o.surfaces)
        for (const ring of s.rings) {
          expect(ring.length).toBeGreaterThanOrEqual(3);
          for (const [x, y, z] of ring) {
            expect(Number.isFinite(x + y + z)).toBe(true);
          }
        }
      expect(o.bbox).not.toBeNull();
    }
    const solidBearer = ids
      .map((id) => objects[id])
      .find((o) => o.objectType === "Building")!;
    const types = new Set(
      solidBearer.surfaces.filter((s) => s.lod === "2.2").map((s) => s.type),
    );
    expect(types.has("RoofSurface")).toBe(true);
    expect(types.has("WallSurface")).toBe(true);
    expect(types.has("GroundSurface")).toBe(true);
    expect(Object.keys(solidBearer.attributes).length).toBeGreaterThan(0);
  });
  it("keeps a geometry-less row as an object with empty surfaces (synthetic)", async () => {
    const real = await readCityParquetTable(await readFile(FIXTURE));
    const table = {
      ...real,
      rows: [
        {
          id: "ghost",
          feature_id: "ghost",
          object_type: "Building",
          parents: undefined,
          children: undefined,
          bbox: null,
        },
      ],
    };
    const objects = decodeTableObjects(table);
    expect(objects.ghost).toBeDefined();
    expect(objects.ghost.surfaces).toEqual([]);
    expect(objects.ghost.parents).toEqual([]); // undefined (absent column) → [], nullish not ===null
    expect(objects.ghost.children).toEqual([]);
    expect(objects.ghost.bbox).toBeNull();
  });
});

describe("cityJsonTypeForObjectType", () => {
  it("reverse-maps the four CityGML renames and passes others through", () => {
    expect(cityJsonTypeForObjectType("Storey")).toBe("BuildingStorey");
    expect(cityJsonTypeForObjectType("HollowSpace")).toBe("TunnelHollowSpace");
    expect(cityJsonTypeForObjectType("Square")).toBe("TransportSquare");
    expect(cityJsonTypeForObjectType("GenericOccupiedSpace")).toBe(
      "GenericCityObject",
    );
    expect(cityJsonTypeForObjectType("Building")).toBe("Building");
    expect(cityJsonTypeForObjectType("TransportSquare")).toBe(
      "TransportSquare",
    ); // duckdb-ext spelling tolerated
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `pnpm typecheck`.
- [ ] **Step 5: Commit (submodule).** `feat: decode cityparquet rows into CityObjects with per-LoD semantic surfaces`

---

### Task 6: Manifest parsing + package assembly → CityModel, round-trip test

**Files:**

- Create: `packages/cityjson-navara-plugins/packages/navara-cityparquet/src/packageAssembly.ts`
- Create: `packages/cityjson-navara-plugins/packages/navara-cityparquet/tests/packageAssembly.test.ts`
- Create: `packages/cityjson-navara-plugins/packages/navara-cityparquet/tests/roundTrip.test.ts`
- Modify: `packages/cityjson-navara-plugins/packages/navara-cityparquet/src/index.ts` (real barrel; KEEP `CITYPARQUET_PLUGIN_PLACEHOLDER` for now — the parent wiring test still asserts it; it is removed in Task 9)

**Interfaces:**

- Consumes: Tasks 3–5.
- Produces:

```ts
export interface CityParquetManifest {
  objectTables: string[];
} // hrefs relative to the package dir, "./" stripped
export function parseCityParquetManifest(
  metadataJson: unknown,
): CityParquetManifest; // throws CityParquetError if not a STAC Item or zero object tables
export const CITYPARQUET_SIDECAR_NAMES: ReadonlySet<string>; // materials.parquet, textures.parquet, geometry_templates.parquet
export interface CityParquetPackageFile {
  name: string;
  bytes: Uint8Array;
}
export async function assembleCityParquetModel(
  files: ReadonlyArray<CityParquetPackageFile>,
): Promise<CityModel>;
```

Manifest rules (mirror `cityparquet-rs/crates/cityparquet/src/stac/properties.rs::table_names_from_manifest_bytes`): assets with role `cityparquet-objects` are object tables; assets with role `cityparquet-sidecar` are excluded; if NO asset carries `cityparquet-objects`, fall back to assets whose media type is `application/vnd.apache.parquet` or whose href ends `.parquet`, minus `CITYPARQUET_SIDECAR_NAMES` basenames; dedupe hrefs (the real writer lists `building.parquet` twice under `data` and its own name).

Assembly: for each file `readCityParquetTable` → EPSG consensus (all non-null and equal, else `CityParquetError` naming the files / "has no EPSG-resolvable CRS"); `decodeTableObjects`; merge objects (duplicate id → first wins, single `console.warn` with total count); model bbox = union of object bboxes (fallback: min/max over rings); `vertexCount` = total ring vertices; `metadata.referenceSystem = "https://www.opengis.net/def/crs/EPSG/0/" + epsg`; `sourceEncoding: "cityparquet"`.

- [ ] **Step 1: Failing tests.** `packageAssembly.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assembleCityParquetModel,
  parseCityParquetManifest,
  CITYPARQUET_SIDECAR_NAMES,
} from "../src/packageAssembly";

const DIR = new URL("./fixtures/two-buildings-cityparquet/", import.meta.url);

describe("parseCityParquetManifest", () => {
  it("reads object tables from the fixture STAC Item by role", async () => {
    const meta = JSON.parse(
      await readFile(fileURLToPath(new URL("metadata.json", DIR)), "utf8"),
    );
    expect(parseCityParquetManifest(meta).objectTables).toEqual([
      "building.parquet",
    ]);
  });
  it("falls back to parquet assets minus sidecars when roles are absent", () => {
    const item = {
      type: "Feature",
      assets: {
        a: {
          href: "./building.parquet",
          type: "application/vnd.apache.parquet",
        },
        b: {
          href: "./materials.parquet",
          type: "application/vnd.apache.parquet",
        },
      },
    };
    expect(parseCityParquetManifest(item).objectTables).toEqual([
      "building.parquet",
    ]);
  });
  it("rejects a manifest with no object tables", () => {
    expect(() =>
      parseCityParquetManifest({ type: "Feature", assets: {} }),
    ).toThrow(/no object tables/i);
  });
});

describe("assembleCityParquetModel", () => {
  it("assembles the fixture package into a CityModel", async () => {
    const bytes = await readFile(
      fileURLToPath(new URL("building.parquet", DIR)),
    );
    const model = await assembleCityParquetModel([
      { name: "building.parquet", bytes },
    ]);
    expect(model.sourceEncoding).toBe("cityparquet");
    expect(model.metadata.referenceSystem).toBe(
      "https://www.opengis.net/def/crs/EPSG/0/7415",
    );
    expect(Object.keys(model.objects).length).toBe(3);
    expect(model.bbox).not.toBeNull();
    expect(model.vertexCount).toBeGreaterThan(0);
  });
  it("merges duplicate ids first-wins with a warning", async () => {
    const bytes = await readFile(
      fileURLToPath(new URL("building.parquet", DIR)),
    );
    const model = await assembleCityParquetModel([
      { name: "a.parquet", bytes },
      { name: "b.parquet", bytes },
    ]);
    expect(Object.keys(model.objects).length).toBe(3);
  });
  it("rejects CRS disagreement across files", async () => {
    const bytes7415 = await readFile(
      fileURLToPath(new URL("building.parquet", DIR)),
    );
    const bytes28992 = await readFile(
      fileURLToPath(
        new URL("../two-buildings-cityparquet-28992/building.parquet", DIR),
      ),
    );
    await expect(
      assembleCityParquetModel([
        { name: "a.parquet", bytes: bytes7415 },
        { name: "b.parquet", bytes: bytes28992 },
      ]),
    ).rejects.toThrow(/CRS|EPSG/i);
  });
});
```

`roundTrip.test.ts` — the correctness oracle:

```ts
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCityJSON } from "@cityjson/navara-core";
import { assembleCityParquetModel } from "../src/packageAssembly";

const PARQUET = fileURLToPath(
  new URL(
    "./fixtures/two-buildings-cityparquet/building.parquet",
    import.meta.url,
  ),
);
const SOURCE = fileURLToPath(
  new URL("./fixtures/two-buildings.city.json", import.meta.url),
); // committed copy — no absolute parent-repo paths in the standalone submodule

describe("cityparquet round-trip vs the CityJSON parser", () => {
  it("agrees on objects, hierarchy, surfaces and coordinates", async () => {
    const cj = parseCityJSON(JSON.parse(await readFile(SOURCE, "utf8")));
    const cp = await assembleCityParquetModel([
      { name: "building.parquet", bytes: await readFile(PARQUET) },
    ]);
    expect(Object.keys(cp.objects).sort()).toEqual(
      Object.keys(cj.objects).sort(),
    );
    for (const id of Object.keys(cj.objects)) {
      const a = cj.objects[id],
        b = cp.objects[id];
      expect(b.objectType).toBe(a.objectType);
      expect([...b.parents].sort()).toEqual([...a.parents].sort());
      expect([...b.children].sort()).toEqual([...a.children].sort());
      const bySig = (s: { type: string; lod: string | null }) =>
        `${s.lod}:${s.type}`;
      // parquet adds a synthesized LoD0 footprint the source may not have; compare only LoDs present in BOTH
      const sharedLods = new Set(
        [...new Set(a.surfaces.map((s) => s.lod))].filter((l) =>
          b.surfaces.some((s) => s.lod === l),
        ),
      );
      const aS = a.surfaces
        .filter((s) => sharedLods.has(s.lod))
        .map(bySig)
        .sort();
      const bS = b.surfaces
        .filter((s) => sharedLods.has(s.lod))
        .map(bySig)
        .sort();
      expect(bS).toEqual(aS);
      // coordinate agreement: every cityparquet ring vertex exists in the cityjson surfaces (±1e-6)
      const cjVerts = new Set(
        a.surfaces
          .flatMap((s) => s.rings.flat())
          .map((v) => v.map((c) => c.toFixed(5)).join(",")),
      );
      for (const s of b.surfaces.filter((s) => sharedLods.has(s.lod)))
        for (const v of s.rings.flat())
          expect(cjVerts.has(v.map((c) => c.toFixed(5)).join(","))).toBe(true);
    }
  });
});
```

If `parseCityJSON` is exported differently (check `packages/navara-core/src/index.ts` for the exact name/signature — it may take a parsed root object or text), adapt the call; the assertions stand. Check whether the fixture source actually contains a LoD `0` geometry (if the writer synthesized it, `other.cityparquet:lod0_0_source` is set) — the shared-LoD filter makes the test correct either way.

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `packageAssembly.ts` + barrel exports.** **Step 4: Run all package tests** (`pnpm vitest run packages/navara-cityparquet`) → PASS; `pnpm typecheck`; `pnpm build` (tsup must succeed with the vendored JS).
- [ ] **Step 5: Optional scale check (do not commit data):** a test in `roundTrip.test.ts` guarded by `existsSync("/data2/hideba/cityparquet-paper/benchmarking/data/cityparquet/delft/building.parquet")` (`it.skipIf`): 2231 rows decode, 4 LoDs present, EPSG 7415, > 2000 objects with RoofSurface at LoD 2.2. Run → PASS.
- [ ] **Step 6: Commit (submodule).** `feat: cityparquet package assembly to CityModel with round-trip oracle test`

---

### Task 7: App — source classification, glob, object-storage listing

**Files:**

- Create: `src/features/cityparquet/sourceClassify.ts`
- Create: `src/features/cityparquet/objectStorage.ts`
- Create: `tests/unit/features/cityparquet/sourceClassify.test.ts`
- Create: `tests/unit/features/cityparquet/objectStorage.test.ts`

**Interfaces:**

- Produces:

```ts
// sourceClassify.ts
export interface StorageRef {
  provider: "gcs" | "s3";
  bucket: string;
}
export type CityParquetSource =
  | { kind: "table"; url: string } // https url ending .parquet
  | { kind: "package-dir"; baseUrl: string } // https dir; baseUrl normalized to end with "/"
  | { kind: "storage-glob"; store: StorageRef; pattern: string } // object-name pattern containing a wildcard
  | { kind: "storage-table"; store: StorageRef; objectName: string }
  | { kind: "storage-dir"; store: StorageRef; prefix: string }; // prefix normalized to end with "/" (or "")
export function classifyCityParquetUrl(raw: string): CityParquetSource | null; // throws UnlistableUrlError for an https wildcard outside storage.googleapis.com
export function isCityParquetUrl(raw: string): boolean;
// NON-THROWING total predicate: try { return classifyCityParquetUrl(raw) !== null } catch (e) { return e instanceof UnlistableUrlError }
// (returns TRUE for an unlistable https wildcard so the loader enters the cityparquet arm and
//  classify's throw inside loadCityParquetFromUrl surfaces the friendly message)
export class UnlistableUrlError extends Error {}

// objectStorage.ts
export const MAX_CITYPARQUET_FILES = 64;
export function globToRegExp(pattern: string): RegExp; // * = any run not containing "/", ** = any run, ? = one non-"/" char; everything else escaped; anchored
export function globLiteralPrefix(pattern: string): string; // chars before the first wildcard
export function storageObjectUrl(store: StorageRef, objectName: string): string;
export async function listStorageObjects(
  store: StorageRef,
  prefix: string,
  http: HttpClient,
): Promise<string[]>; // paginated, full object names
```

Classification rules (in order; return null = not cityparquet):

1. `gs://bucket/rest` → wildcard in rest → `storage-glob`; ends `.parquet` → `storage-table`; else → `storage-dir` (prefix = rest, `/`-suffixed unless empty; strip a trailing `metadata.json`).
2. `s3://bucket/rest` → same with provider `"s3"`.
3. `https://storage.googleapis.com/bucket/rest` → recurse as `gs://bucket/rest` (only when rest contains a wildcard, ends `.parquet`, ends `/`, or ends `/metadata.json` — a bare object URL of another format must stay non-cityparquet).
4. Other `http(s)`: contains `*` or `?` wildcard → **throw `UnlistableUrlError`** ("Plain https URLs cannot be listed — use gs:// or s3://, or point at the package's metadata.json."); ends `.parquet` → `table`; ends `/metadata.json` → `package-dir` (baseUrl = up to and including the dir slash); ends `/` → `package-dir`; else → null.
5. Anything else (ftp:, relative) → null.

Careful: `?` appears in query strings — classify on `new URL(raw)` pathname for http(s) (a query string is preserved on `table` fetches but ignored for wildcard detection), and on the raw remainder for gs/s3.

Listing:

- GCS: GET `https://storage.googleapis.com/storage/v1/b/${bucket}/o?prefix=${encodeURIComponent(prefix)}&maxResults=1000&fields=${encodeURIComponent("items/name,nextPageToken")}` (+`&pageToken=`); JSON `{items?: [{name}], nextPageToken?}` via `http.fetchText` + `JSON.parse`. Non-ok → error naming the bucket and status.
- S3: GET `https://${bucket}.s3.amazonaws.com/?list-type=2&prefix=${encodeURIComponent(prefix)}&max-keys=1000` (+`&continuation-token=`); parse `<Key>` and `<NextContinuationToken>`/`<IsTruncated>` from the XML **with a regex over `<Key>([^<]+)</Key>`** (no DOMParser — keeps the module Node-test-clean and the XML here is machine-generated, entity-escaped keys are rare; decode `&amp;` etc. with a tiny unescape helper).
- `storageObjectUrl`: gcs → `https://storage.googleapis.com/${bucket}/${encodedName}` where `encodedName` encodes each path segment with `encodeURIComponent` and keeps the `/` separators; s3 → `https://${bucket}.s3.amazonaws.com/${encodedName}` the same way.

- [ ] **Step 1: Failing tests.** `sourceClassify.test.ts` (representative cases — cover every rule above):

```ts
import { describe, expect, it } from "vitest";
import {
  classifyCityParquetUrl,
  isCityParquetUrl,
  UnlistableUrlError,
} from "../../../../src/features/cityparquet/sourceClassify";

describe("classifyCityParquetUrl", () => {
  it("classifies gs:// forms", () => {
    expect(
      classifyCityParquetUrl("gs://cityparquet/3dbag_tiled/*/building.parquet"),
    ).toEqual({
      kind: "storage-glob",
      store: { provider: "gcs", bucket: "cityparquet" },
      pattern: "3dbag_tiled/*/building.parquet",
    });
    expect(classifyCityParquetUrl("gs://b/delft/building.parquet")).toEqual({
      kind: "storage-table",
      store: { provider: "gcs", bucket: "b" },
      objectName: "delft/building.parquet",
    });
    expect(classifyCityParquetUrl("gs://b/delft/")).toEqual({
      kind: "storage-dir",
      store: { provider: "gcs", bucket: "b" },
      prefix: "delft/",
    });
    expect(classifyCityParquetUrl("gs://b/delft/metadata.json")).toEqual({
      kind: "storage-dir",
      store: { provider: "gcs", bucket: "b" },
      prefix: "delft/",
    });
  });
  it("classifies s3:// and the https GCS spelling", () => {
    expect(classifyCityParquetUrl("s3://bkt/x/*.parquet")!.kind).toBe(
      "storage-glob",
    );
    expect(
      classifyCityParquetUrl(
        "https://storage.googleapis.com/bkt/tiles/*/building.parquet",
      ),
    ).toEqual({
      kind: "storage-glob",
      store: { provider: "gcs", bucket: "bkt" },
      pattern: "tiles/*/building.parquet",
    });
  });
  it("classifies plain https", () => {
    expect(classifyCityParquetUrl("https://x.org/d/building.parquet")).toEqual({
      kind: "table",
      url: "https://x.org/d/building.parquet",
    });
    expect(classifyCityParquetUrl("https://x.org/pkg/")).toEqual({
      kind: "package-dir",
      baseUrl: "https://x.org/pkg/",
    });
    expect(classifyCityParquetUrl("https://x.org/pkg/metadata.json")).toEqual({
      kind: "package-dir",
      baseUrl: "https://x.org/pkg/",
    });
    expect(classifyCityParquetUrl("https://x.org/model.city.json")).toBeNull();
    expect(
      classifyCityParquetUrl("https://x.org/file.parquet?sig=a?b"),
    ).toEqual({ kind: "table", url: "https://x.org/file.parquet?sig=a?b" });
  });
  it("throws on unlistable https wildcards, while the predicate stays total and true", () => {
    expect(() =>
      classifyCityParquetUrl("https://x.org/tiles/*/building.parquet"),
    ).toThrow(UnlistableUrlError);
    expect(isCityParquetUrl("https://x.org/tiles/*/building.parquet")).toBe(
      true,
    ); // enters the arm; the load surfaces the message
    expect(isCityParquetUrl("https://x.org/model.city.json")).toBe(false);
  });
});
```

`objectStorage.test.ts` — glob semantics and paginated listing with a fake `HttpClient`:

```ts
import { describe, expect, it } from "vitest";
import {
  globToRegExp,
  globLiteralPrefix,
  listStorageObjects,
  storageObjectUrl,
  MAX_CITYPARQUET_FILES,
} from "../../../../src/features/cityparquet/objectStorage";
import type { HttpClient } from "../../../../src/platform/types";

describe("globToRegExp", () => {
  it("* stays inside a path segment, ** crosses", () => {
    const r = globToRegExp("tiles/*/building.parquet");
    expect(r.test("tiles/10-640-324/building.parquet")).toBe(true);
    expect(r.test("tiles/a/b/building.parquet")).toBe(false);
    expect(
      globToRegExp("tiles/**/building.parquet").test(
        "tiles/a/b/building.parquet",
      ),
    ).toBe(true);
    expect(globToRegExp("a.parquet").test("aXparquet")).toBe(false); // dot escaped
  });
  it("extracts the literal prefix", () => {
    expect(globLiteralPrefix("tiles/*/building.parquet")).toBe("tiles/");
    expect(globLiteralPrefix("no-wildcard/building.parquet")).toBe(
      "no-wildcard/building.parquet",
    );
  });
});

function fakeHttp(pages: Record<string, unknown>): HttpClient {
  return {
    async fetchText(url: string) {
      for (const [match, body] of Object.entries(pages))
        if (url.includes(match))
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: typeof body === "string" ? body : JSON.stringify(body),
          };
      return { ok: false, status: 404, statusText: "Not Found", text: "" };
    },
    async fetchBytes() {
      throw new Error("unused");
    },
  };
}

describe("listStorageObjects", () => {
  it("paginates the GCS JSON API", async () => {
    const http = fakeHttp({
      "pageToken=tok2": { items: [{ name: "t/2/building.parquet" }] },
      "storage/v1/b/bkt/o": {
        items: [{ name: "t/1/building.parquet" }],
        nextPageToken: "tok2",
      },
    });
    const names = await listStorageObjects(
      { provider: "gcs", bucket: "bkt" },
      "t/",
      http,
    );
    expect(names).toEqual(["t/1/building.parquet", "t/2/building.parquet"]);
  });
  it("parses S3 ListObjectsV2 XML with continuation", async () => {
    const http = fakeHttp({
      "continuation-token=abc":
        "<ListBucketResult><Contents><Key>t/2.parquet</Key></Contents><IsTruncated>false</IsTruncated></ListBucketResult>",
      "list-type=2":
        "<ListBucketResult><Contents><Key>t/1.parquet</Key></Contents><IsTruncated>true</IsTruncated><NextContinuationToken>abc</NextContinuationToken></ListBucketResult>",
    });
    const names = await listStorageObjects(
      { provider: "s3", bucket: "bkt" },
      "t/",
      http,
    );
    expect(names).toEqual(["t/1.parquet", "t/2.parquet"]);
  });
  it("builds encoded object urls", () => {
    expect(
      storageObjectUrl({ provider: "gcs", bucket: "b" }, "a b/c.parquet"),
    ).toBe("https://storage.googleapis.com/b/a%20b/c.parquet");
  });
});
```

Note the fake-http ordering trick: `Object.entries` iterates insertion order, so put the MORE specific match first.

- [ ] **Step 2: Run** (`npx vitest run tests/unit/features/cityparquet`) → FAIL. **Step 3: Implement both modules.** **Step 4: Run** → PASS; `npx tsc -b --noEmit`.
- [ ] **Step 5: Commit (parent repo, app files only — no submodule pointer yet).** `feat: cityparquet source classification and object-storage listing`

---

### Task 8: App — fetch orchestration `loadCityParquet`

**Files:**

- Create: `src/features/cityparquet/loadCityParquet.ts`
- Create: `tests/unit/features/cityparquet/loadCityParquet.test.ts`
- Modify: `src/domain/citymodel/detectEncoding.ts` (`.parquet` → `"cityparquet"`)
- Modify: `tests/unit/domain/citymodel/detectEncoding.test.ts` (add cases; find the existing test file path with glob first)
- Check/Modify: `src/features/stac/stacAssets.ts` — items-geoparquet mirrors must NOT become loadable layers

**Interfaces:**

- Consumes: Task 6 exports from `@cityjson/navara-cityparquet`; Task 7 modules; `HttpClient` from `src/platform/types`; `browserPlatform` from `src/platform/browser`.
- Produces:

```ts
export async function loadCityParquetFromUrl(
  rawUrl: string,
  http?: HttpClient,
): Promise<CityModel>;
export async function loadCityParquetFromFiles(
  files: ReadonlyArray<File>,
): Promise<CityModel>;
export function cityParquetLayerNameFromUrl(rawUrl: string): string; // "delft" from …/delft/, "building" from …/building.parquet, bucket+pattern tail for globs
```

Behavior:

- `table` → `http.fetchBytes(url)`; non-ok → the same friendly branches as `loadFromUrl` (404 message, generic status, network/CORS hint — copy the wording from `src/domain/citymodel/loadCityModel.ts`); assemble single file.
- `package-dir` → `http.fetchText(baseUrl + "metadata.json")` → `parseCityParquetManifest` → fetch each object table at `baseUrl + href` → assemble.
- `storage-table` → fetch `storageObjectUrl(...)` → single file.
- `storage-dir` → `listStorageObjects(store, prefix, http)`; if `${prefix}metadata.json` listed → fetch it and use the manifest (hrefs resolved against the prefix); else take names matching `^${prefix}[^/]+\.parquet$` minus sidecar basenames; empty → error "No .parquet object tables found under …".
- `storage-glob` → list with `globLiteralPrefix(pattern)`, filter by `globToRegExp(pattern)`, drop sidecar basenames (`console.warn` count), empty → error; over `MAX_CITYPARQUET_FILES` → error `` `The wildcard matches ${n} files; the viewer loads at most ${MAX_CITYPARQUET_FILES} at once — narrow the pattern.` ``; fetch all (concurrency 6, `Promise.all` over a worker-pool helper — copy the tiny `mapWithConcurrency` pattern from `src/features/stac/stacClient.ts` if one exists, else write it here), assemble.
- Any single fetch failure rejects the whole load (spec D6).
- `loadCityParquetFromFiles`: filter to `.parquet` + `metadata.json` by basename; if a `metadata.json` is present use the manifest to pick object tables (basename match), else all `.parquet` minus sidecar names; read bytes via `file.arrayBuffer()`; assemble. Error if zero object tables ("The folder contains no CityParquet object tables (\*.parquet).").

- [ ] **Step 1: Failing tests** — fake `HttpClient` serving the fixture bytes from disk (Node fs), plus error cases:

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  loadCityParquetFromUrl,
  loadCityParquetFromFiles,
  cityParquetLayerNameFromUrl,
} from "../../../../src/features/cityparquet/loadCityParquet";
import type { HttpClient } from "../../../../src/platform/types";

const FIX =
  "/data2/hideba/multiroof-viewer/packages/cityjson-navara-plugins/packages/navara-cityparquet/tests/fixtures/two-buildings-cityparquet";

async function packageHttp(): Promise<HttpClient> {
  const parquet = await readFile(`${FIX}/building.parquet`);
  const meta = await readFile(`${FIX}/metadata.json`, "utf8");
  return {
    async fetchText(url) {
      if (url.endsWith("metadata.json"))
        return { ok: true, status: 200, statusText: "OK", text: meta };
      return { ok: false, status: 404, statusText: "Not Found", text: "" };
    },
    async fetchBytes(url) {
      if (url.endsWith("building.parquet"))
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          bytes: new Uint8Array(parquet),
        };
      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
        bytes: new Uint8Array(),
      };
    },
  };
}

describe("loadCityParquetFromUrl", () => {
  it("loads a single table url", async () => {
    const model = await loadCityParquetFromUrl(
      "https://x.org/p/building.parquet",
      await packageHttp(),
    );
    expect(Object.keys(model.objects).length).toBe(3);
    expect(model.sourceEncoding).toBe("cityparquet");
  });
  it("loads a package directory via metadata.json", async () => {
    const model = await loadCityParquetFromUrl(
      "https://x.org/p/",
      await packageHttp(),
    );
    expect(Object.keys(model.objects).length).toBe(3);
  });
  it("surfaces a friendly 404", async () => {
    await expect(
      loadCityParquetFromUrl("https://x.org/missing.parquet", {
        async fetchText() {
          return { ok: false, status: 404, statusText: "Not Found", text: "" };
        },
        async fetchBytes() {
          return {
            ok: false,
            status: 404,
            statusText: "Not Found",
            bytes: new Uint8Array(),
          };
        },
      }),
    ).rejects.toThrow(/404|not found/i);
  });
});

describe("loadCityParquetFromFiles", () => {
  it("assembles a picked folder", async () => {
    const parquet = await readFile(`${FIX}/building.parquet`);
    const meta = await readFile(`${FIX}/metadata.json`);
    const files = [
      new File([parquet], "building.parquet"),
      new File([meta], "metadata.json"),
    ];
    const model = await loadCityParquetFromFiles(files);
    expect(Object.keys(model.objects).length).toBe(3);
  });
  it("rejects a folder with no tables", async () => {
    await expect(
      loadCityParquetFromFiles([new File(["x"], "readme.txt")]),
    ).rejects.toThrow(/no CityParquet object tables/i);
  });
});

describe("cityParquetLayerNameFromUrl", () => {
  it("names layers sensibly", () => {
    expect(
      cityParquetLayerNameFromUrl("https://x.org/delft/building.parquet"),
    ).toBe("building");
    expect(cityParquetLayerNameFromUrl("https://x.org/delft/")).toBe("delft");
    expect(
      cityParquetLayerNameFromUrl(
        "gs://cityparquet/3dbag_tiled/*/building.parquet",
      ),
    ).toBe("3dbag_tiled");
  });
});
```

Also extend the existing `detectEncoding` test file: `detectEncoding("https://x/y/building.parquet") === "cityparquet"`, `detectEncoding("model.parquet") === "cityparquet"`, `.parquet.gz` also → `"cityparquet"` (the `.gz` strip already exists; gz parquet is then rejected at parse with the parquet-magic error — acceptable).

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement + the one-line `detectEncoding` change** (insert the `.parquet` test before the cityjson fallback). **Step 4: STAC loadability (verified state: `stacAssets.ts` gates loadability on a fixed `MODEL_EXTENSIONS` list, so nothing changes by itself).** Make genuine CityParquet assets offerable, and only then guard the mirror: add `.parquet` to `MODEL_EXTENSIONS`, and exclude any asset whose key is `items-geoparquet` or whose roles include `collection-mirror` from loadable classification (they are the item-index mirrors, not city models). Tests in the existing stacAssets test file:

```ts
it("offers a data-role .parquet asset as loadable (cityparquet)", () => {
  /* asset {href: ".../building.parquet", roles:["data"]} → loadable, kind "cityparquet" */
});
it("does not offer the items-geoparquet mirror as a loadable layer", () => {
  /* asset key "items-geoparquet" / roles ["collection-mirror"] → download-only */
});
```

- [ ] **Step 5: Run the full app test suite** (`npx vitest run`) → all green; `npx tsc -b --noEmit`.
- [ ] **Step 6: Commit (parent).** `feat: cityparquet fetch orchestration + .parquet encoding detection`

---

### Task 9: App — loader hook arms, App restore, DuckDB path, wiring test

**Files:**

- Modify: `src/features/layers/useLayerFileLoader.ts` (cityparquet arms + `addLayerFromFiles`)
- Modify: `src/app/App.tsx` (restore branch mirror; `handleFiles`; DuckDB effect exclusion)
- Modify: `tests/unit/features/layers/useLayerFileLoader.test.ts` (find exact path first)
- Modify: `tests/unit/platform/navaraPackageWiring.test.ts` (assert a real export instead of the placeholder)
- Modify: `packages/cityjson-navara-plugins/packages/navara-cityparquet/src/index.ts` (remove `CITYPARQUET_PLUGIN_PLACEHOLDER`)

**Interfaces:**

- Consumes: Tasks 6–8.
- Produces: `LayerFileLoader.addLayerFromFiles: (files: ReadonlyArray<File>, overrides?: LayerOverrides) => Promise<string | null>`; App-level `handleFiles(files: File[])` passed to the dialog/picker (Task 10 consumes it).

Loader logic (`useLayerFileLoader.ts`):

- `addLayerFromUrl`: after the existing fcb branch, add `else if (isCityParquetUrl(url))` (note: `classifyCityParquetUrl` may throw `UnlistableUrlError` — let its message become the hook error) → `const model = await loadCityParquetFromUrl(url); addLayer({ name: cityParquetLayerNameFromUrl(url), model, modelRef: { type: "url", url }, visible: true, rules: [], rulesEnabled: true })` — copy the exact `addLayer` argument shape from the existing static branch (read it; it includes rules/rulesEnabled defaults and returns the id for `applyPostCreateOverrides`).
- `addLayerFromFile`: `detectEncoding(file.name) === "cityparquet"` → `loadCityParquetFromFiles([file])` → same `addLayer` with `modelRef: { type: "file", fileName: file.name }`.
- New `addLayerFromFiles(files, overrides?)`: derive `name` from the first file's `webkitRelativePath` top segment (fallback: first file name); `loadCityParquetFromFiles(files)`; `modelRef: { type: "file", fileName: name }`; same error-to-string handling as the other arms.
- App restore — **BOTH URL-restore sites** (they mirror `useLayerFileLoader` and must stay in lockstep): (a) the snapshot restore branch (`detectEncoding(...) === "flatcitybuf"` site, `App.tsx` ~L727) and (b) the **share-link** restore (~L918, `detectEncoding(sl.modelUrl) === "flatcitybuf"` … else `loadFromUrl` — without the new arm a shared cityparquet layer hands parquet bytes to `JSON.parse`). In each, add the cityparquet arm using `isCityParquetUrl` (never bare `detectEncoding` — gs:// and wildcard URLs have no extension), with the classification/`UnlistableUrlError` throw inside that site's existing per-layer try/catch.
- DuckDB effect (App.tsx ~L462–530): ensure a `"cityparquet"` encoding never reaches `loadModelIntoDuckDB` (its union type won't accept it — add it to the same explicit skip the `citygml` branch uses, so the in-memory `loadCityModelFromMemory(activeLayer.model)` fallback runs).
- Wiring test: replace the placeholder assertion with `expect(typeof assembleCityParquetModel).toBe("function")` (import from `@cityjson/navara-cityparquet`); delete the placeholder const from the submodule barrel.

- [ ] **Step 1: Write failing tests.** Extend the loader hook test file (it already mocks stores/plugins — follow its patterns) with: a `.parquet` file routes to the cityparquet arm and produces a layer whose `model.sourceEncoding === "cityparquet"`; a `building.parquet` URL ditto (mock `loadCityParquetFromUrl` via `vi.mock` of the module); `addLayerFromFiles` groups a folder; an `UnlistableUrlError` message lands in `error`. Update `navaraPackageWiring.test.ts`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement all modifications.** **Step 4: Run full suites** — app `npx vitest run` AND submodule `pnpm vitest run packages/navara-cityparquet` → green; both typechecks.
- [ ] **Step 5: Commit — submodule first** (`refactor: replace cityparquet placeholder with real barrel`), push submodule, then parent commit including the pointer bump + app files (`feat: load cityparquet layers from files, folders and urls`).

---

### Task 10: UI — SourcePicker folder picking + multi-file drop + dialog wiring

**Files:**

- Modify: `src/ui/layers/SourcePicker.tsx`
- Modify: `src/ui/layers/AddLayerDialog.tsx`
- Modify: `src/app/App.tsx` (pass `onFiles` down; hero + dialog)
- Test: `tests/unit/ui/layers/SourcePicker.test.tsx` (create or extend; jsdom + @testing-library/react per existing UI tests)

**Interfaces:**

- Consumes: `addLayerFromFiles` via App's `handleFiles` (Task 9).
- Produces: `SourcePickerProps` gains **optional** `onFiles?: (files: File[]) => void` (SourcePicker renders in the hero AND the dialog; existing tests construct props without it — guard all uses, fall back to `onFile(files[0])` when absent); `AddLayerDialogProps` gains `onAddFiles: (files: File[]) => void`.

Changes:

- `ACCEPT` += `,.parquet`; `SUPPORTED_FORMATS` = `".city.json · .city.jsonl · .fcb · .gml · .parquet"`; drop-zone copy mentions CityParquet ("…or a CityParquet folder").
- Add a second hidden input: `<input type="file" webkitdirectory="" hidden ref={folderInputRef} onChange={handleFolderChange} />` — TypeScript needs `webkitdirectory=""` as a string attribute (add `// @ts-expect-error` only if the JSX type rejects it; prefer `{...{ webkitdirectory: "" }}` spread which type-checks). A "Choose folder" button next to Browse clicks it. `handleFolderChange`: `const files = Array.from(e.target.files ?? [])`; if empty return; call `onFiles(files)`; reset input value.
- Drop handler: when `e.dataTransfer.files.length > 1` → `onFiles(Array.from(files))`; single file keeps the existing `onFile` path. (Directory-entry traversal via `webkitGetAsEntry` is a stretch goal — implement ONLY if trivial; otherwise the multi-file and folder-button paths suffice.)
- `AddLayerDialog`: pass through `onAddFiles` (closes the dialog like `onAddFile`); App wires `handleFiles = files => withEngineBooting(name, () => addLayerFromFiles(files))` mirroring `handleFile`.

- [ ] **Step 1: Failing tests** (follow the file's existing test setup — look at a sibling UI test for render helpers):

```tsx
it("offers a folder picker that reports all selected files", () => {
  const onFiles = vi.fn();
  render(
    <SourcePicker
      onFile={vi.fn()}
      onFiles={onFiles}
      onUrl={vi.fn()}
      loading={false}
    />,
  );
  const folderInput = document.querySelector(
    "input[webkitdirectory]",
  ) as HTMLInputElement;
  expect(folderInput).not.toBeNull();
  const f1 = new File(["a"], "building.parquet");
  const f2 = new File(["b"], "metadata.json");
  Object.defineProperty(folderInput, "files", { value: [f1, f2] });
  fireEvent.change(folderInput);
  expect(onFiles).toHaveBeenCalledWith([f1, f2]);
});
it("routes a multi-file drop to onFiles and a single file to onFile", () => {
  /* fireEvent.drop with dataTransfer.files of 2 then 1 */
});
it("accepts .parquet in the browse input", () => {
  /* assert ACCEPT string on the file input */
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npx tsc -b --noEmit`; full `npx vitest run` green.
- [ ] **Step 5: Commit (parent).** `feat: folder picking and multi-file drop for CityParquet packages`

---

### Task 11: Browser smoke, docs, final review

**Files:**

- Modify: `CLAUDE.md` (Project Structure: `features/cityparquet/`, packages entry no longer "placeholder"; a Key Architecture Decision bullet for CityParquet; Known Issues if any found)
- Modify: `docs/roadmap.md` (CityParquet milestone entry)

- [ ] **Step 1: Browser smoke.** `npm run dev`; use agent-browser (connect on 9333 per memory — managed Chrome dies; snapshot with `-i`). Serve the fixture package over http (`python3 -m http.server` in a dir containing it — CORS: use `npx serve --cors` or add a tiny header-enabled server) and: (a) add-by-URL `http://localhost:PORT/two-buildings-cityparquet/` → layer appears, buildings render, attributes panel shows inherited attributes on click; (b) add the single `building.parquet` URL; (c) if reachable, `gs://cityparquet/3dbag_tiled/10-640-324/building.parquet` (real public bucket from the tutorial — network may be blocked; skip gracefully and note it). Verify the LoD selector shows `0` and `2.2`, rules colorize, save/restore round-trips the URL layer.
- [ ] **Step 2: Full verification.** App: `npx tsc -b --noEmit && npx vitest run`. Submodule: `cd packages/cityjson-navara-plugins && pnpm typecheck && pnpm vitest run && pnpm build`.
- [ ] **Step 3: Docs.** Update CLAUDE.md + roadmap per the spec's decisions (concise — mirror the existing style; include the vendored-hyparquet note and the 64-file wildcard cap).
- [ ] **Step 4: Code review.** Run `feature-dev:code-reviewer` (high effort) over the full diff (both repos); fix critical findings; rerun suites.
- [ ] **Step 5: Final commits** (submodule-first if the review touched the submodule), `docs:` commit for CLAUDE.md/roadmap.
