# Fixtures

Use this directory for local sample data and small fixture files.

Current canonical remote sample:

- Delft CityJSONSeq: `https://storage.googleapis.com/cityjson/delft.city.jsonl`

Format priority for local fixtures:

1. CityJSON
2. CityJSONSeq
3. FlatCityBuf

Guidelines:

- Prefer small, representative fixtures over one large catch-all file.
- Document provenance for every checked-in fixture.
- Keep large datasets remote unless they are essential for automated tests.

## Checked-in fixtures

- `delft.fcb` (7.6 MB): FlatCityBuf encoding of the same Delft dataset as
  `delft.city.jsonl` above (1115 features, EPSG:7415, Amersfoort / RD New +
  NAP height). Vendored from
  `flatcitybuf/examples/data/delft.fcb` (the `@cityjson/flatcitybuf` repo's
  own conformance fixture) for
  `tests/integration/fcbStreaming.test.ts`, which needs a real R-tree index
  and real feature bodies to prove the viewport-streaming design's request
  economy — a synthetic fixture with a handful of features has no
  meaningful index to traverse. Larger than the "keep large datasets
  remote" guideline above prefers, but essential here: it is read once per
  test run and shared across all tests in that file.
- `invalid-solid.city.json` (1.8 KB): one CityJSON 2.0 Building,
  `NL.IMBAG.Pand.0001`, with NO parts, whose LoD 2.2 geometry is a Solid that is
  NOT closed (a gabled shell with two open edges). Authored in this repo for the
  M13.3 processing-toolbox work — no third-party source: the object is a copy of
  `two-buildings.city.json`'s `NL.IMBAG.Pand.0001` root (identical boundaries,
  semantics, vertices, transform and EPSG:7415 reference system) with the
  building's parts dropped. FOR every "invalid solid" expectation — the real-engine
  solids probes (`tests/integration/duckdb/solids.test.ts`), Measure solids' and
  Validate solids' unit tests
  (`tests/unit/features/processing/measureSolids.test.ts`) and scenario 2 of the
  browser smoke. It exists because `two-buildings.city.json` cannot serve: its
  `NL.IMBAG.Pand.0001` has a MultiSurface PART at LoD 2.2, so by spec §7's
  contributor rule the PART is the contributor and the whole FEATURE is skipped
  "not a solid" — the root's invalid Solid is never measured.
- `composite-solid.city.json` (1.3 KB): a minimal CityJSON 2.0 Building,
  `NL.TEST.Composite.0001`, whose LoD 2.2 geometry is a CompositeSolid of two
  unit cubes sharing a face (volume 2, 2 shells, 12 faces), in EPSG:7415 with an
  identity scale. Authored in this repo for the M13.3 work — no third-party
  source. FOR the `three_d` CompositeSolid probe, which pins that a
  CompositeSolid's WKB type name is `GeometryCollection Z` and that
  `ST_3DTryFromWKB` parses it, and for Measure solids' roll-up test over a
  CompositeSolid.
