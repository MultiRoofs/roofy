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
