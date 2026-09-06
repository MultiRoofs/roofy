import { afterEach, describe, expect, it, vi } from "vitest";
import {
  encodeRowsAsJson,
  flatRowsFromModel,
  flatRowsFromRecords,
} from "../../../src/insights/layerRows";
import type { CityModel } from "../../../src/domain/citymodel/types";
import type { ResidentObjectRecord } from "@cityjson/navara-flatcitybuf";

function model(): CityModel {
  return {
    sourceEncoding: "citygml",
    metadata: {},
    bbox: null,
    vertexCount: 0,
    objects: {
      B1: {
        id: "B1",
        objectType: "Building",
        attributes: { bouwjaar: 1920, tags: { a: 1 } },
        surfaces: [],
        bbox: [0, 0, 0, 1, 1, 1],
        parents: [],
        children: ["B1-0"],
        lod: null,
      },
      "B1-0": {
        id: "B1-0",
        objectType: "BuildingPart",
        attributes: {},
        surfaces: [],
        bbox: [0, 0, 0, 1, 1, 1],
        parents: ["B1"],
        children: [],
        lod: "2",
      },
    },
  } as unknown as CityModel;
}

function record(over: Partial<ResidentObjectRecord>): ResidentObjectRecord {
  return {
    id: "R1",
    objectType: "Building",
    attributes: {},
    bbox: [0, 0, 0, 1, 1, 1],
    lod: "2.2",
    surfaceCount: 3,
    roofMetrics: [],
    footprintAreaSqM: 1,
    volumeCuM: 1,
    parents: [],
    children: [],
    ...over,
  } as ResidentObjectRecord;
}

describe("flatRowsFromModel", () => {
  const rows = flatRowsFromModel(model());

  it("emits one row per object, in model order", () => {
    expect(rows.map((r) => r.id)).toEqual(["B1", "B1-0"]);
  });

  it("names the columns the way the reader does", () => {
    expect(rows[0]).toMatchObject({
      id: "B1",
      feature_id: "B1",
      object_type: "Building",
    });
  });

  it("gives a part its root's feature_id", () => {
    expect(rows[1]!.feature_id).toBe("B1");
  });

  it("writes NULL, not [], for absent parents and children", () => {
    expect(rows[0]!.parents).toBeNull();
    expect(rows[0]!.children).toEqual(["B1-0"]);
    expect(rows[1]!.parents).toEqual(["B1"]);
    expect(rows[1]!.children).toBeNull();
  });

  it("carries scalar attributes through and JSON-stringifies object ones", () => {
    expect(rows[0]!.bouwjaar).toBe(1920);
    expect(rows[0]!.tags).toBe('{"a":1}');
  });

  it("drops the old app-side derivations", () => {
    expect(rows[0]!.lod).toBeUndefined();
    expect(rows[0]!.surface_count).toBeUndefined();
  });

  it("never lets an attribute shadow a prefix column", () => {
    const m = model();
    (m.objects.B1 as { attributes: Record<string, unknown> }).attributes = {
      id: "SPOOF",
      object_type: "SPOOF",
      ok: 1,
    };
    const [row] = flatRowsFromModel(m);
    expect(row!.id).toBe("B1");
    expect(row!.object_type).toBe("Building");
    expect(row!.ok).toBe(1);
  });
});

describe("a dropped reserved attribute name", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is reported ONCE per table, naming every key it dropped", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = model();
    (m.objects.B1 as { attributes: Record<string, unknown> }).attributes = {
      id: "SPOOF",
      parents: "SPOOF",
      ok: 1,
    };
    flatRowsFromModel(m);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "Flat table: source attributes named id, parents were dropped because they collide with the fixed columns.",
    );
  });

  it("catches a collision in ANY CASE — DuckDB identifiers are not case-sensitive", () => {
    // `ID` passing the check is not a cosmetic miss: `read_json_auto` infers
    // BOTH an `ID` and an `id` column, DuckDB renames the second to `id_1`,
    // and `"id"` then resolves to the SOURCE ATTRIBUTE. Selection, map
    // filtering and every export lose the real object id.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = model();
    (m.objects.B1 as { attributes: Record<string, unknown> }).attributes = {
      ID: "SPOOF",
      Parents: "SPOOF",
      ok: 1,
    };
    const [row] = flatRowsFromModel(m);
    expect(row!.ID).toBeUndefined();
    expect(row!.Parents).toBeUndefined();
    expect(row!.id).toBe("B1");
    expect(row!.ok).toBe(1);
    // The OFFENDING SPELLING is named, not the fixed column it collided with:
    // "an attribute named id was dropped" sends someone looking for a key
    // their file does not contain.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "Flat table: source attributes named ID, Parents were dropped because they collide with the fixed columns.",
    );
  });

  it("says nothing when no attribute collides", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    flatRowsFromModel(model());
    flatRowsFromRecords([record({ attributes: { ok: 1 } })]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("reports the streaming path the same way", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    flatRowsFromRecords([record({ attributes: { children: [], ok: 1 } })]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "Flat table: source attributes named children were dropped because they collide with the fixed columns.",
    );
  });
});

describe("flatRowsFromRecords", () => {
  it("produces the same column vocabulary from resident records", () => {
    const rows = flatRowsFromRecords([
      record({ id: "R1", children: ["R1-0"] }),
      record({ id: "R1-0", objectType: "BuildingPart", parents: ["R1"] }),
    ]);
    expect(rows).toEqual([
      {
        id: "R1",
        feature_id: "R1",
        object_type: "Building",
        parents: null,
        children: ["R1-0"],
      },
      {
        id: "R1-0",
        feature_id: "R1",
        object_type: "BuildingPart",
        parents: ["R1"],
        children: null,
      },
    ]);
  });

  it("is empty for no residents", () => {
    expect(flatRowsFromRecords([])).toEqual([]);
  });
});

describe("encodeRowsAsJson", () => {
  it("encodes an array read_json_auto can read back", () => {
    const bytes = encodeRowsAsJson(flatRowsFromRecords([record({})]));
    const text = new TextDecoder().decode(bytes);
    expect(JSON.parse(text)).toEqual([
      {
        id: "R1",
        feature_id: "R1",
        object_type: "Building",
        parents: null,
        children: null,
      },
    ]);
  });

  it("survives a BigInt attribute rather than throwing", () => {
    const rows = flatRowsFromRecords([
      record({ attributes: { big: BigInt("9007199254740993") } }),
    ]);
    const text = new TextDecoder().decode(encodeRowsAsJson(rows));
    expect(JSON.parse(text)[0].big).toBe("9007199254740993");
  });
});

describe("a BigInt NESTED in an object attribute", () => {
  // hyparquet decodes an INT64 to a BigInt, and CityParquet attributes are
  // routinely objects — so the nested case is the common one, not the exotic
  // one, and a bare JSON.stringify there throws and loses the whole layer.
  const nested = { attributes: { ref: { bag: BigInt("9007199254740993") } } };

  it("serialises to its decimal string rather than throwing", () => {
    const rows = flatRowsFromRecords([record(nested)]);
    expect(rows[0]!.ref).toBe('{"bag":"9007199254740993"}');
  });

  it("survives the JSON encoding too", () => {
    const rows = flatRowsFromRecords([record(nested)]);
    const text = new TextDecoder().decode(encodeRowsAsJson(rows));
    expect(JSON.parse(text)[0].ref).toBe('{"bag":"9007199254740993"}');
  });
});
