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
