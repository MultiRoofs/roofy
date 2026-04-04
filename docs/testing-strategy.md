# Testing Strategy

Status: Draft v0.1

## Core Rule

Development should follow a red-green-refactor loop:

1. Write a failing unit test.
2. Confirm it fails for the intended reason.
3. Implement the smallest change that makes it pass.
4. Refactor while preserving passing tests.

This cycle is the default way to build logic in this repository.

## What Should Be Unit Tested First

- city-model ingestion helpers
- roof metric calculations
- suitability rules
- color-rule evaluation
- persistence adapters
- share-state codecs
- DuckDB query-building and table-shaping logic

## Test Shape

- Prefer small, focused, behavior-oriented unit tests.
- Keep tests near domain behavior and adapter behavior, not UI incidental details.
- Add regression tests for bug fixes before changing implementation.
- Use integration tests selectively for ingestion and viewer flows after core units are stable.

## Data and Fixture Strategy

Use city-model fixtures that reflect the initial encoding priority:

1. CityJSON
2. CityJSONSeq
3. FlatCityBuf

Early canonical sample:

- Delft CityJSONSeq sample: `https://storage.googleapis.com/cityjson/delft.city.jsonl`

When possible:

- keep fixtures small
- keep fixtures representative of rooftop semantics
- document fixture provenance
- avoid coupling many tests to one giant fixture

## Analytics Strategy

For analytics-oriented tests, the preferred direction is to validate flows built around DuckDB-wasm and the DuckDB `cityjson` extension, using the extension readers for:

- `read_cityjson`
- `read_cityjsonseq`
- `read_flatcitybuf`

Because browser runtime compatibility for extensions can vary, add an early technical spike to validate extension loading in the target runtime and keep a fallback plan documented if needed.
