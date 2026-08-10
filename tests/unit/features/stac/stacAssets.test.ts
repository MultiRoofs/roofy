/**
 * Asset classification for the catalog browser.
 *
 * The load-bearing invariant is that `loadable` agrees with what
 * `addLayerFromUrl` will ACTUALLY do with the href. That routing is decided by
 * extension alone (`detectEncoding`, which defaults anything unrecognised to
 * `"cityjson"` and would then `JSON.parse` a GML body), so a promising media
 * type on an extensionless URL must NOT earn an Add button — it becomes a
 * plain download link instead.
 */
import { describe, expect, it } from "vitest";
import { classifyStacAsset } from "../../../../src/features/stac/stacAssets";

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
      {
        kind: "citygml",
        loadable: true,
        label: "CityGML",
      },
    ));
  it("zip → archive, loadable (unzipped to CityGML by the loader)", () =>
    expect(classifyStacAsset("https://x/a.zip", "application/zip")).toEqual({
      kind: "archive",
      loadable: true,
      label: "CityGML archive (ZIP)",
    }));

  it("a zip is loadable however its media type is spelled", () => {
    // The container decides, and `loadFromUrl` sniffs magic bytes — so a zip
    // advertised as CityJSON is still an unzip-and-parse-CityGML.
    expect(
      classifyStacAsset("https://x/a.zip", "application/city+json").loadable,
    ).toBe(true);
    expect(classifyStacAsset("https://x/a.zip", null).loadable).toBe(true);
  });

  it("7z stays a download link — only ZIP can be unpacked", () =>
    expect(classifyStacAsset("https://x/a.7z", "application/zip")).toEqual({
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

  // The extension is the ONLY thing that decides loadability: an extensionless
  // download endpoint would be routed to the CityJSON parser by
  // `detectEncoding`'s default, which would fail on a GML body.
  it("a promising media type on an extensionless URL is NOT loadable", () =>
    expect(
      classifyStacAsset("https://x/download?id=3", "application/gml+xml"),
    ).toEqual({ kind: "citygml", loadable: false, label: "CityGML" }));
  it("an .xml CityGML file is a download, not an Add", () => {
    const info = classifyStacAsset("https://x/a.xml", "application/gml+xml");
    expect(info.kind).toBe("citygml");
    expect(info.loadable).toBe(false);
  });
  it("archives beat every media type", () =>
    expect(
      classifyStacAsset("https://x/a.tar.gz", "application/city+json"),
    ).toEqual({ kind: "archive", loadable: false, label: "ZIP archive" }));
  it("an unknown href with an unknown type is unknown", () =>
    expect(classifyStacAsset("https://x/notes.txt", "text/plain")).toEqual({
      kind: "unknown",
      loadable: false,
      label: "Unknown format",
    }));
  it("ignores media type parameters and case", () =>
    expect(
      classifyStacAsset(
        "https://x/download",
        "Application/City+JSON; charset=utf-8",
      ).kind,
    ).toBe("cityjson"));
  it("survives an unparseable href", () =>
    expect(classifyStacAsset("not a url at all", null).loadable).toBe(false));

  it("offers a data-role .parquet asset as loadable (cityparquet)", () =>
    expect(
      classifyStacAsset(
        "https://x/delft/building.parquet",
        "application/vnd.apache.parquet",
        { key: "data", roles: ["data"] },
      ),
    ).toEqual({ kind: "cityparquet", loadable: true, label: "CityParquet" }));

  // The mirror is the collection's own item INDEX, not a city model: loading it
  // would hand the CityParquet reader a table with no city geometry in it. The
  // DEFAULT call — the one every current caller makes — must already refuse it;
  // the key/role signals are an extra, not the guard.
  it("does not offer the items-geoparquet mirror as a loadable layer", () => {
    const byName = classifyStacAsset(
      "https://storage.googleapis.com/city3d-stac/netherlands-3d-bag/items.parquet",
      "application/vnd.apache.parquet",
    );
    expect(byName).toEqual({
      kind: "cityparquet",
      loadable: false,
      label: "CityParquet",
    });
    const byKey = classifyStacAsset(
      "https://x/c/collection-items.parquet",
      "application/vnd.apache.parquet",
      { key: "items-geoparquet", roles: [] },
    );
    expect(byKey.loadable).toBe(false);
    const byRole = classifyStacAsset(
      "https://x/c/collection-items.parquet",
      "application/vnd.apache.parquet",
      { key: "mirror", roles: ["collection-mirror"] },
    );
    expect(byRole.loadable).toBe(false);
  });

  it("labels an extensionless mirror by its media type, not the default", () => {
    const info = classifyStacAsset(
      "https://x/c/mirror?download=1",
      "application/vnd.apache.parquet",
      { roles: ["collection-mirror"] },
    );
    expect(info).toEqual({
      kind: "cityparquet",
      loadable: false,
      label: "CityParquet",
    });
  });
});
