### Task 14: The building proxy

**Files:**

- Create: `src/features/processing/buildingProxy.ts`
- Modify: `src/ui/processing/runFormat.ts`, `src/ui/processing/LogView.tsx` (§6.4's real "Building geometry" row)
- Test: `tests/unit/features/processing/buildingProxy.test.ts`, additions to `tests/unit/ui/processing/LogView.test.tsx` and to `tests/integration/duckdb/crossLayer.test.ts`

**Interfaces:**

- Consumes: `LayerTable` (`layerTables.ts:166-182`, for `lods` and `reader`), `LodColumn { label, suffix }` (`columnKind.ts:90-95`), `readSource`/`ReadSourceHandle` (Task 5 — the CALLER's, see below), `quoteIdent`/`quoteLiteral` (`sql.ts:28-48`).
- Produces:

```ts
export type BuildingProxy = "footprint" | "rectangle" | "centre";
export interface ProxyOption {
  readonly key: BuildingProxy;
  readonly label: string;
  readonly available: boolean;
  readonly note: string | null;
}
export function proxyOptions(table: LayerTable): ReadonlyArray<ProxyOption>;
export function defaultProxy(table: LayerTable): BuildingProxy;
export function proxyLogLabel(proxy: BuildingProxy): string;
export function buildProxySql(input: {
  readonly proxy: BuildingProxy;
  readonly table: string;
  readonly from: string | null; // the reader FROM, footprint only
  readonly geometryColumn: string | null; // the LoD 0 column, footprint only
  readonly ids: ReadonlyArray<string> | null;
}): string; // → rows of (id, f, g GEOMETRY)
/** The same proxies, ONE row per FEATURE — see the deviation below. */
export function buildFeatureProxySql(input: {
  readonly proxy: BuildingProxy;
  readonly table: string;
  readonly from: string | null;
  readonly geometryColumn: string | null;
  readonly ids: ReadonlyArray<string> | null;
}): string; // → rows of (f, g GEOMETRY), g NULL where the feature has none
/** The LoD 0 LABEL to hand `readSource`, or null. Never a suffix. */
export function lodZeroLabel(table: LayerTable): string | null;
/** §7.7's log sentence for the proxy in use. */
export function proxyDistanceNote(proxy: BuildingProxy): string;
```

- Tasks 15, 16, 17 and 19 consume it; §6.4's log header stops saying `—`.

**Two deviations from the ledger, both named.**

1. **`buildFeatureProxySql` is added beside `buildProxySql`.** The ledger's builder returns `(id, f, g)` — one row per TABLE ROW — but §7 is explicit that the joined fields, the nearest id and the distance are "evaluated ONCE on the feature's proxy geometry (the union of its parts' footprints, or the feature's combined extent), then copied to root and parts alike", and Task 16's reviewer rejects "a per-row join". The ledger's shape stays as the inner relation; the per-feature roll-up is one `GROUP BY f` on top of it, and the three executors read THAT. Making `buildProxySql` itself per-feature would have contradicted its stated `(id, f, g)` signature.
2. **`lodZeroLabel` and `proxyDistanceNote` are added.** The first is the only honest way to reach LoD 0 — the hard rule is that `"0"` and `"0.0"` are DIFFERENT columns and only the file knows which it has, so the label comes out of `table.lods` and goes into `readSource`, and nothing ever re-spells a suffix. The second is §7.7's own copy, `2D distance to the building footprint / extent / centre`, collapsed to the one the run used; the copy table assigns that string to Tasks 14 and 17 jointly, so its single producer is here.

**§7's contributor rule applies to the FOOTPRINT proxy, and not to the two extent proxies — because §7 words them differently.** §7 says the proxy is "the union of its PARTS' footprints, or the feature's COMBINED extent". The footprint half is the contributor rule verbatim: where any part has an LoD 0 footprint the parts are the contributors and the root's own footprint is ignored, exactly as everywhere else in §7. Unioning the root in as well is only harmless when the root's footprint IS its parts' (3D BAG's duplication, which the rule exists for); a file whose root carries a different LoD 0 polygon from its parts — a courtyard block whose root is the whole site — would join against a shape no part has. The extent half is deliberately NOT contributor-filtered: "combined extent" is the whole feature's, which is also how §7.4's own `extent_height_m` reads it (`MIN`/`MAX` over the root AND its parts), and a bbox that is a strict superset of its parts' is the same rectangle rather than a double count. So `buildFeatureProxySql` selects contributors on the footprint path and aggregates every row on the bbox paths, and each half says which sentence of §7 it is.

**Footprint is offered ONLY with an LoD 0 column AND a reader.** `ST_GeomFromWKB` RAISES "Unsupported geometry type in WKB" on the PolyhedralSurface Z every solid LoD produces (probed), and one such row fails the whole statement — so a footprint from LoD 2.2 is not a worse answer, it is a failed run. The browsing table has no geometry columns at all (`isDroppedColumn`, `columnKind.ts:74-80`), which is why footprint reads from the READER and the other two read the table's `bbox` struct — a struct every layer kind has, because `layerTables.ts:642-653` forces the type on the flat path too.

**Where `readSource` is called.** Not here: this module is pure SQL. The EXECUTOR opens the handle when its proxy is `"footprint"`, passes `handle.from` and `handle.geometryColumn` in, and releases it in a `finally` (Tasks 16, 17, 19). `lodZeroLabel(table)` is what it hands `readSource` as the LoD.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/features/processing/buildingProxy.test.ts`:

```ts
/**
 * §7.5's "Building geometry" radio: which proxies a table can offer, which one
 * it defaults to, and the exact SQL each produces.
 *
 * Exact strings, because the statement lands verbatim in §6.4's log and a
 * planner reruns it by hand — and because the guards (the NULL branch, the
 * FILTER, the GROUP BY) are the whole correctness argument.
 */
import { describe, expect, it } from "vitest";
import {
  buildFeatureProxySql,
  buildProxySql,
  defaultProxy,
  lodZeroLabel,
  proxyDistanceNote,
  proxyLogLabel,
  proxyOptions,
} from "../../../../src/features/processing/buildingProxy";
import type { LayerTable } from "../../../../src/insights/layerTables";

function table(over: Partial<LayerTable> = {}): LayerTable {
  return {
    table: "layer_1",
    sourceName: "layer_1.city.json",
    source: async () => new Uint8Array(),
    reader: "read_cityjson",
    columns: [],
    lods: [
      { label: "0", suffix: "0" },
      { label: "2.2", suffix: "2_2" },
    ],
    rowCount: 3,
    ...over,
  } as LayerTable;
}

describe("proxyOptions", () => {
  it("offers all three on a reader-backed layer with an LoD 0 column", () => {
    expect(proxyOptions(table())).toEqual([
      {
        key: "footprint",
        label: "Footprint (LoD 0)",
        available: true,
        note: null,
      },
      {
        key: "rectangle",
        label: "Extent rectangle",
        available: true,
        note: null,
      },
      { key: "centre", label: "Extent centre", available: true, note: null },
    ]);
  });

  it("disables the footprint with §7.5's own sentence when there is no LoD 0", () => {
    const [footprint] = proxyOptions(
      table({ lods: [{ label: "2.2", suffix: "2_2" }] }),
    );
    expect(footprint).toEqual({
      key: "footprint",
      label: "Footprint (LoD 0)",
      available: false,
      note: "LoD 0 footprints are not in this layer; the bounding-box centre is used.",
    });
  });

  it("disables the footprint on a layer with no reader, LoD 0 or not", () => {
    // CityGML, CityParquet and a streaming layer: the LoD 0 geometry exists in
    // the model but nothing can re-read it as WKB.
    expect(proxyOptions(table({ reader: null }))[0]?.available).toBe(false);
  });

  it("always offers the two bbox proxies — every layer kind has the struct", () => {
    const options = proxyOptions(table({ reader: null, lods: [] }));
    expect(options.filter((o) => o.available).map((o) => o.key)).toEqual([
      "rectangle",
      "centre",
    ]);
  });
});

describe("defaultProxy", () => {
  it("is the footprint when it is available (§7.5)", () => {
    expect(defaultProxy(table())).toBe("footprint");
  });

  it("falls back to the CENTRE, not the rectangle", () => {
    expect(defaultProxy(table({ reader: null }))).toBe("centre");
  });
});

describe("lodZeroLabel", () => {
  it("returns the file's OWN spelling of LoD 0", () => {
    expect(
      lodZeroLabel(table({ lods: [{ label: "0.0", suffix: "0_0" }] })),
    ).toBe("0.0");
    expect(lodZeroLabel(table({ lods: [{ label: "0", suffix: "0" }] }))).toBe(
      "0",
    );
  });

  it("is null when the file has no LoD 0 rung", () => {
    expect(
      lodZeroLabel(table({ lods: [{ label: "1.2", suffix: "1_2" }] })),
    ).toBeNull();
  });
});

describe("buildProxySql — one row per TABLE ROW", () => {
  it("reads the footprint WKB from the reader, guarded against NULL", () => {
    expect(
      buildProxySql({
        proxy: "footprint",
        table: "layer_1",
        from: "read_cityjson('layer_1_run_7.city.json', lod => '0')",
        geometryColumn: "geometry_lod0",
        ids: null,
      }),
    ).toBe(
      'SELECT "id", COALESCE("feature_id", "id") AS f, ' +
        'CASE WHEN "geometry_lod0" IS NULL THEN NULL ELSE ST_GeomFromWKB("geometry_lod0") END AS g ' +
        "FROM read_cityjson('layer_1_run_7.city.json', lod => '0')",
    );
  });

  it("restricts the READER relation to the frozen ids, like the table one", () => {
    // Without this a Selected run reads every building in the file and the
    // cross-layer counts silently include buildings outside the scope.
    expect(
      buildProxySql({
        proxy: "footprint",
        table: "layer_1",
        from: "read_cityjson('layer_1_run_7.city.json', lod => '0')",
        geometryColumn: "geometry_lod0",
        ids: ["b1", "b1p"],
      }),
    ).toContain(
      "FROM read_cityjson('layer_1_run_7.city.json', lod => '0') " +
        "WHERE \"id\" IN ('b1', 'b1p')",
    );
  });

  it("builds the rectangle and the centre from the table's bbox struct", () => {
    expect(
      buildProxySql({
        proxy: "rectangle",
        table: "layer_1",
        from: null,
        geometryColumn: null,
        ids: ["b1"],
      }),
    ).toBe(
      'SELECT "id", COALESCE("feature_id", "id") AS f, ' +
        'CASE WHEN "bbox"."xmin" IS NULL THEN NULL ELSE ' +
        'ST_MakeEnvelope("bbox"."xmin", "bbox"."ymin", "bbox"."xmax", "bbox"."ymax") END AS g ' +
        'FROM "layer_1" WHERE "id" IN (\'b1\')',
    );
    expect(
      buildProxySql({
        proxy: "centre",
        table: "layer_1",
        from: null,
        geometryColumn: null,
        ids: null,
      }),
    ).toBe(
      'SELECT "id", COALESCE("feature_id", "id") AS f, ' +
        'CASE WHEN "bbox"."xmin" IS NULL THEN NULL ELSE ' +
        'ST_Point(("bbox"."xmin" + "bbox"."xmax") / 2, ("bbox"."ymin" + "bbox"."ymax") / 2) END AS g ' +
        'FROM "layer_1"',
    );
  });

  it("quotes an id with a quote in it", () => {
    expect(
      buildProxySql({
        proxy: "centre",
        table: "layer_1",
        from: null,
        geometryColumn: null,
        ids: ["o'x"],
      }),
    ).toContain("WHERE \"id\" IN ('o''x')");
  });
});

describe("buildFeatureProxySql — one row per FEATURE", () => {
  it("unions the PART rows' footprints, falling back to the root's (§7)", () => {
    // §7's contributor rule, in SQL: where any part has an LoD 0 footprint the
    // parts ARE the contributors and the root's own polygon is ignored.
    expect(
      buildFeatureProxySql({
        proxy: "footprint",
        table: "layer_1",
        from: "read_cityjson('x.city.json', lod => '0')",
        geometryColumn: "geometry_lod0",
        ids: null,
      }),
    ).toBe(
      'SELECT "f", ST_Union_Agg("g") FILTER (WHERE "g" IS NOT NULL AND ("id" <> "f") = "parts") AS g ' +
        'FROM (SELECT *, COALESCE(BOOL_OR("g" IS NOT NULL AND "id" <> "f") ' +
        'OVER (PARTITION BY "f"), FALSE) AS "parts" FROM (' +
        buildProxySql({
          proxy: "footprint",
          table: "layer_1",
          from: "read_cityjson('x.city.json', lod => '0')",
          geometryColumn: "geometry_lod0",
          ids: null,
        }) +
        ')) GROUP BY "f"',
    );
  });

  it("aggregates the BBOX NUMBERS for the two extent proxies, not the shapes", () => {
    // The union of two rectangles is not a rectangle. §7's combined extent is
    // the combined bbox, so the MIN/MAX happen before the geometry is built.
    expect(
      buildFeatureProxySql({
        proxy: "rectangle",
        table: "layer_1",
        from: null,
        geometryColumn: null,
        ids: null,
      }),
    ).toBe(
      'SELECT COALESCE("feature_id", "id") AS f, ' +
        'CASE WHEN MIN("bbox"."xmin") IS NULL THEN NULL ELSE ' +
        'ST_MakeEnvelope(MIN("bbox"."xmin"), MIN("bbox"."ymin"), MAX("bbox"."xmax"), MAX("bbox"."ymax")) END AS g ' +
        'FROM "layer_1" GROUP BY 1',
    );
    expect(
      buildFeatureProxySql({
        proxy: "centre",
        table: "layer_1",
        from: null,
        geometryColumn: null,
        ids: ["b1", "b1p"],
      }),
    ).toBe(
      'SELECT COALESCE("feature_id", "id") AS f, ' +
        'CASE WHEN MIN("bbox"."xmin") IS NULL THEN NULL ELSE ' +
        'ST_Point((MIN("bbox"."xmin") + MAX("bbox"."xmax")) / 2, ' +
        '(MIN("bbox"."ymin") + MAX("bbox"."ymax")) / 2) END AS g ' +
        "FROM \"layer_1\" WHERE \"id\" IN ('b1', 'b1p') GROUP BY 1",
    );
  });
});

describe("the log's words", () => {
  it("has ONE producer for the proxy's name (§6.4)", () => {
    expect(proxyLogLabel("footprint")).toBe("Footprint (LoD 0)");
    expect(proxyLogLabel("rectangle")).toBe("Extent rectangle");
    expect(proxyLogLabel("centre")).toBe("Extent centre");
  });

  it("collapses §7.7's slash list to the proxy that was used", () => {
    expect(proxyDistanceNote("footprint")).toBe(
      "2D distance to the building footprint",
    );
    expect(proxyDistanceNote("rectangle")).toBe(
      "2D distance to the building extent",
    );
    expect(proxyDistanceNote("centre")).toBe(
      "2D distance to the building centre",
    );
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing/buildingProxy.test.ts
```

Expected: FAIL — `src/features/processing/buildingProxy.ts` does not exist.

- [ ] **Step 3: Write the module**

Create `src/features/processing/buildingProxy.ts`:

```ts
/**
 * What geometry stands for a building in 2D (spec §7.5's "Building geometry").
 *
 * ONE answer, for four readers: the form's radio, §6.4's log row, the three
 * cross-layer executors' SQL, and `defaultProxy`. Three proxies and no fourth —
 * a fourth would be a fourth thing the log, the form and the executors have to
 * agree about.
 *
 * WHY FOOTPRINT NEEDS BOTH AN LoD 0 COLUMN AND A READER. `ST_GeomFromWKB`
 * parses the LoD 0 MultiPolygon Z and RAISES "Unsupported geometry type in
 * WKB" on the PolyhedralSurface Z every solid LoD produces — and one such row
 * fails the whole statement, so a footprint taken from a solid LoD is not a
 * rougher answer, it is a failed run. The browsing table holds no geometry at
 * all (`isDroppedColumn`, `columnKind.ts:74-80`), so the WKB comes from the
 * READER, which a CityGML, CityParquet or streaming layer does not have.
 *
 * WHY THE OTHER TWO ALWAYS WORK. Every layer kind's table carries `bbox
 * STRUCT(xmin, ymin, zmin, xmax, ymax, zmax)` — the reader writes it and
 * `layerTables.ts:642-653` forces the same type on the flat fallback, for
 * exactly this reason.
 *
 * Everything here is PURE: the executors open the reader handle and release it,
 * and hand `from` and `geometryColumn` in.
 */
import type { LayerTable } from "../../insights/layerTables";
import { quoteIdent, quoteLiteral } from "../../insights/sql";

export type BuildingProxy = "footprint" | "rectangle" | "centre";

export interface ProxyOption {
  readonly key: BuildingProxy;
  readonly label: string;
  readonly available: boolean;
  /** Why it is not available, as §7.5 words it. Null when it is. */
  readonly note: string | null;
}

/** §7.5's three labels, verbatim, in the order the radio shows them. */
const LABELS: Readonly<Record<BuildingProxy, string>> = {
  footprint: "Footprint (LoD 0)",
  rectangle: "Extent rectangle",
  centre: "Extent centre",
};

/** §7.5's muted line, on the option it explains. */
const NO_FOOTPRINT =
  "LoD 0 footprints are not in this layer; the bounding-box centre is used.";

/**
 * The LoD 0 rung's OWN label, or null.
 *
 * The label, never a re-spelled suffix: `"0"` and `"0.0"` are DIFFERENT columns
 * and only the file knows which it has (`columnKind.ts:104-120`). The caller
 * hands this to `readSource`, which looks the suffix up in the same `lods`
 * list.
 */
export function lodZeroLabel(table: LayerTable): string | null {
  return (
    table.lods.find((lod) => Number.parseFloat(lod.label) === 0)?.label ?? null
  );
}

export function proxyOptions(table: LayerTable): ReadonlyArray<ProxyOption> {
  const footprint = lodZeroLabel(table) !== null && table.reader !== null;
  return [
    {
      key: "footprint",
      label: LABELS.footprint,
      available: footprint,
      note: footprint ? null : NO_FOOTPRINT,
    },
    { key: "rectangle", label: LABELS.rectangle, available: true, note: null },
    { key: "centre", label: LABELS.centre, available: true, note: null },
  ];
}

/** §7.5: "footprint when available, otherwise extent centre." */
export function defaultProxy(table: LayerTable): BuildingProxy {
  return lodZeroLabel(table) !== null && table.reader !== null
    ? "footprint"
    : "centre";
}

/** §6.4's "building geometry proxy actually used". */
export function proxyLogLabel(proxy: BuildingProxy): string {
  return LABELS[proxy];
}

/** §7.7: "2D distance to the building footprint / extent / centre" — the one
 *  of the three the run actually used. */
export function proxyDistanceNote(proxy: BuildingProxy): string {
  const noun =
    proxy === "footprint"
      ? "footprint"
      : proxy === "rectangle"
        ? "extent"
        : "centre";
  return `2D distance to the building ${noun}`;
}

export interface ProxySqlInput {
  readonly proxy: BuildingProxy;
  readonly table: string;
  /** The reader FROM clause (`ReadSourceHandle.from`), footprint only. */
  readonly from: string | null;
  /** The LoD 0 geometry column (`ReadSourceHandle.geometryColumn`), footprint
   *  only. */
  readonly geometryColumn: string | null;
  /** ROW ids, already expanded to whole features by `resolveScope`; null for
   *  every row. */
  readonly ids: ReadonlyArray<string> | null;
}

function whereIds(ids: ReadonlyArray<string> | null): string {
  return ids === null
    ? ""
    : ` WHERE "id" IN (${ids.map((id) => quoteLiteral(id)).join(", ")})`;
}

/**
 * One row per TABLE ROW: `(id, f, g)`.
 *
 * The NULL branch is not defensiveness: `ST_GeomFromWKB` is the function that
 * RAISES on geometry it cannot read, and a row with no LoD 0 geometry has a
 * NULL column — untested, and one raise fails the whole statement. The same
 * guard on the bbox path keeps a row with no extent from becoming an envelope
 * of NULLs.
 */
export function buildProxySql(input: ProxySqlInput): string {
  const head = `SELECT "id", COALESCE("feature_id", "id") AS f, `;
  if (input.proxy === "footprint") {
    if (input.from === null || input.geometryColumn === null) {
      throw new Error("The footprint proxy needs a reader and an LoD 0 column");
    }
    const col = quoteIdent(input.geometryColumn);
    // The SCOPE applies to the reader relation too. Without this a Selected or
    // Matching run reads every building in the file: the join then counts
    // buildings outside the scope, and §7.6's per-area counts are wrong in a
    // way no output column shows. The reader's own `id` column is the same id
    // the table's rows carry, which is what makes one `whereIds` serve both.
    return (
      `${head}CASE WHEN ${col} IS NULL THEN NULL ELSE ST_GeomFromWKB(${col}) END AS g ` +
      `FROM ${input.from}${whereIds(input.ids)}`
    );
  }
  const geometry =
    input.proxy === "rectangle"
      ? `ST_MakeEnvelope("bbox"."xmin", "bbox"."ymin", "bbox"."xmax", "bbox"."ymax")`
      : `ST_Point(("bbox"."xmin" + "bbox"."xmax") / 2, ("bbox"."ymin" + "bbox"."ymax") / 2)`;
  return (
    `${head}CASE WHEN "bbox"."xmin" IS NULL THEN NULL ELSE ${geometry} END AS g ` +
    `FROM ${quoteIdent(input.table)}${whereIds(input.ids)}`
  );
}

/**
 * One row per FEATURE: `(f, g)`, with `g` NULL where the feature has no
 * geometry at all.
 *
 * §7 evaluates the join, the nearest id and the distance ONCE per feature, "on
 * the feature's proxy geometry (the union of its parts' footprints, or the
 * feature's combined extent), then copied to root and parts alike". A per-ROW
 * join would count a three-part building three times in §7.6 and would give
 * §7.5's tie rule a different answer per part.
 *
 * §7's CONTRIBUTOR rule applies to the FOOTPRINT and not to the two extent
 * proxies, because §7 words them differently: "the union of its PARTS'
 * footprints, or the feature's COMBINED extent". So the footprint path selects
 * the part rows wherever any part has a footprint and the root's own row
 * otherwise — the rule verbatim — while the bbox paths aggregate every row of
 * the feature, which is also how §7.4's `extent_height_m` reads "combined".
 * Unioning the root's footprint in as well is harmless only when it IS its
 * parts' (3D BAG's duplication); a root carrying the whole site's polygon
 * would otherwise be joined against a shape no part has.
 *
 * A feature whose rows all have NULL geometry keeps its row with `g` NULL,
 * because the executors LEFT JOIN from this relation and §6.2's value rule
 * needs the difference between "no proxy" (NULL) and "no match" (0).
 */
export function buildFeatureProxySql(input: ProxySqlInput): string {
  if (input.proxy === "footprint") {
    // `parts` is "some PART of this feature has a footprint", answered as a
    // window over the feature rather than in a second pass; `("id" <> "f") =
    // "parts"` then keeps the PART rows when there are any and the root's row
    // when there are none. FILTER rather than a WHERE inside: a feature with no
    // footprint at all must keep its row, and an aggregate over an empty
    // filtered set is NULL.
    return (
      `SELECT "f", ST_Union_Agg("g") FILTER (WHERE "g" IS NOT NULL AND ("id" <> "f") = "parts") AS g ` +
      `FROM (SELECT *, COALESCE(BOOL_OR("g" IS NOT NULL AND "id" <> "f") ` +
      `OVER (PARTITION BY "f"), FALSE) AS "parts" FROM (${buildProxySql(input)})) ` +
      `GROUP BY "f"`
    );
  }
  const geometry =
    input.proxy === "rectangle"
      ? `ST_MakeEnvelope(MIN("bbox"."xmin"), MIN("bbox"."ymin"), MAX("bbox"."xmax"), MAX("bbox"."ymax"))`
      : `ST_Point((MIN("bbox"."xmin") + MAX("bbox"."xmax")) / 2, ` +
        `(MIN("bbox"."ymin") + MAX("bbox"."ymax")) / 2)`;
  return (
    `SELECT COALESCE("feature_id", "id") AS f, ` +
    `CASE WHEN MIN("bbox"."xmin") IS NULL THEN NULL ELSE ${geometry} END AS g ` +
    `FROM ${quoteIdent(input.table)}${whereIds(input.ids)} GROUP BY 1`
  );
}
```

- [ ] **Step 4: §6.4's log stops saying `—`**

In `src/ui/processing/runFormat.ts`, add the import and the one formatter:

```ts
import {
  proxyLogLabel,
  type BuildingProxy,
} from "../../features/processing/buildingProxy";
```

```ts
/**
 * Spec §6.4's "building geometry proxy actually used".
 *
 * Read off the FROZEN parameters, which are exactly what was used: the form
 * resolves the target's own default into the draft before Run (Task 15), and
 * the executor reads the same bag. A tool with no proxy — every one-layer tool
 * — keeps the em dash.
 */
export function buildingGeometryLine(run: RunRecord): string {
  const proxy = run.params["proxy"];
  const known: ReadonlyArray<BuildingProxy> = [
    "footprint",
    "rectangle",
    "centre",
  ];
  return known.includes(proxy as BuildingProxy)
    ? proxyLogLabel(proxy as BuildingProxy)
    : "—";
}
```

and in `formatRunLog`, replace `lines.push("Building geometry: —");` with

```ts
lines.push(`Building geometry: ${buildingGeometryLine(run)}`);
```

§6.4 also needs the PARAMETERS row to stay readable now that a parameter can be
a list (Aggregate's rows, Join's fields): `String(v)` prints
`[object Object]` for those, which is not something a planner can rerun by hand.
Add the one formatter beside `buildingGeometryLine`:

```ts
/** One frozen parameter's value, as §6.4's record. A primitive as itself, a
 *  list or an object as JSON — `String([{op:"count"}])` is `[object Object]`,
 *  which records nothing. */
export function paramValue(value: unknown): string {
  return value !== null && typeof value === "object"
    ? JSON.stringify(value)
    : String(value);
}
```

and use it in BOTH places the pair is rendered — `formatRunLog`'s
`params.map(([k, v]) => `${k} = ${String(v)}`)` and `LogView.tsx:53-56`'s
identical expression — so the Copy text and the screen cannot drift.

In `src/ui/processing/LogView.tsx`, replace `["Building geometry", "—"],` with

```ts
    ["Building geometry", buildingGeometryLine(run)],
```

adding `buildingGeometryLine` to the existing `./runFormat` import list.

- [ ] **Step 5: Extend the log test**

Append to `tests/unit/ui/processing/LogView.test.tsx`:

```tsx
it("names the building-geometry proxy the run used (§6.4)", () => {
  useProcessingStore.setState({
    runs: [
      runFixture({
        toolId: "join-by-location",
        params: { proxy: "rectangle" },
      }),
    ],
  });
  render(<LogView runId="r1" />);
  expect(screen.getByText("Extent rectangle")).toBeInTheDocument();
  expect(formatRunLog(runFixture({ params: { proxy: "centre" } }))).toContain(
    "Building geometry: Extent centre",
  );
});

it("keeps the em dash for a tool that has no proxy", () => {
  useProcessingStore.setState({ runs: [runFixture({ params: {} })] });
  render(<LogView runId="r1" />);
  expect(
    screen.getByText("Building geometry").closest("div"),
  ).toHaveTextContent("—");
});

it("prints a structured parameter as JSON, not as [object Object] (§6.4)", () => {
  // §6.4 is "the reproducible record of the run: a planner can read it back and
  // rerun by hand" — and Aggregate's parameters are a list of rows.
  expect(
    formatRunLog(
      runFixture({ params: { rows: [{ op: "count", column: null }] } }),
    ),
  ).toContain('rows = [{"op":"count","column":null}]');
});
```

(`runFixture(patch)` and the `"r1"` id are that file's own, `LogView.test.tsx:17`.)

- [ ] **Step 6: Pin the two aggregate shapes against the real engine**

Append to `tests/integration/duckdb/crossLayer.test.ts` — `ST_Union_Agg` with a `FILTER`, and `ST_MakeEnvelope`/`ST_Point` over `MIN`/`MAX`, are the two shapes nothing else probes:

```ts
it("aggregates a feature's proxy the way buildFeatureProxySql does", () => {
  db.query(
    `CREATE OR REPLACE TABLE probe_rows AS SELECT * FROM (VALUES
       ('b1', 'b1', {'xmin': 0.0, 'ymin': 0.0, 'zmin': 0.0, 'xmax': 10.0, 'ymax': 10.0, 'zmax': 3.0}),
       ('b1p', 'b1', {'xmin': 10.0, 'ymin': 0.0, 'zmin': 0.0, 'xmax': 20.0, 'ymax': 10.0, 'zmax': 3.0}),
       ('b2', 'b2', NULL)
     ) AS t("id", "feature_id", "bbox")`,
  );
  const rect = db.query(
    `SELECT f, ST_Area(g) AS a FROM (${buildFeatureProxySql({
      proxy: "rectangle",
      table: "probe_rows",
      from: null,
      geometryColumn: null,
      ids: null,
    })}) ORDER BY f`,
  );
  // The COMBINED extent of the two rows, and NULL for the feature with none —
  // which is what `ST_MakeEnvelope` under the CASE guard has to produce.
  expect(rect).toEqual([
    { f: "b1", a: 200 },
    { f: "b2", a: null },
  ]);
  const centre = db.query(
    `SELECT f, ST_X(g) AS x, ST_Y(g) AS y FROM (${buildFeatureProxySql({
      proxy: "centre",
      table: "probe_rows",
      from: null,
      geometryColumn: null,
      ids: null,
    })}) WHERE f = 'b1'`,
  );
  expect(centre).toEqual([{ f: "b1", x: 10, y: 5 }]);
  db.query(`DROP TABLE IF EXISTS probe_rows`);
});

it("picks the PART footprints and honours the scope, on the real engine", () => {
  // The footprint path is the one that reads the READER rather than the table,
  // so it is probed against a relation shaped like the reader's: `id`,
  // `feature_id` and an LoD 0 WKB column. `BOOL_OR(…) OVER (PARTITION BY …)`,
  // `ST_Union_Agg` with a FILTER and `ST_GeomFromWKB` all have to hold at once.
  const reader = `(SELECT * FROM (VALUES
       ('b1', 'b1', ST_AsWKB(ST_GeomFromText('POLYGON ((0 0, 10 0, 10 10, 0 10, 0 0))'))),
       ('b1p', 'b1', ST_AsWKB(ST_GeomFromText('POLYGON ((0 0, 4 0, 4 4, 0 4, 0 0))'))),
       ('b2', 'b2', NULL),
       ('b3', 'b3', ST_AsWKB(ST_GeomFromText('POLYGON ((20 0, 30 0, 30 10, 20 0))')))
     ) AS t("id", "feature_id", "geometry_lod0"))`;
  const rows = db.query(
    `SELECT f, ST_Area(g) AS a FROM (${buildFeatureProxySql({
      proxy: "footprint",
      table: "unused",
      from: reader,
      geometryColumn: "geometry_lod0",
      ids: ["b1", "b1p", "b2"],
    })}) ORDER BY f`,
  );
  expect(rows).toEqual([
    // §7's contributor rule: the PART's 16 m², never the root's 100 and never
    // their union.
    { f: "b1", a: 16 },
    // No footprint at all: the row survives with a NULL proxy (§6.2).
    { f: "b2", a: null },
    // `b3` is outside the frozen scope, so it is not here at all.
  ]);
});
```

`db` is Task 1's `Harness` (`query`/`registerBytes`/`dropFile`, `harness.ts:41-52`), with `spatial` loaded by that suite's `installExtension(db, "spatial")`.

- [ ] **Step 7: Run to pass**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
npx vitest run tests/unit/features/processing tests/unit/ui/processing
npx tsc -b --noEmit
DUCKDB_INTEGRATION=1 npx vitest run tests/integration/duckdb/crossLayer.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/features/processing/buildingProxy.ts src/ui/processing/runFormat.ts \
  src/ui/processing/LogView.tsx \
  tests/unit/features/processing/buildingProxy.test.ts \
  tests/unit/ui/processing/LogView.test.tsx \
  tests/integration/duckdb/crossLayer.test.ts
git commit -m "feat: one building-geometry proxy for every cross-layer tool"
```

---
