# CityParquet loading — completion report

**Date**: 2026-08-08 (overnight autonomous run)
**Spec**: `docs/superpowers/specs/2026-08-07-cityparquet-loading-design.md` (decisions D1–D12 recorded there for review)
**Plan**: `docs/superpowers/plans/2026-08-07-cityparquet-loading.md` (externally reviewed before execution; 10 findings addressed)
**Branch state**: parent `develop` `bb016c0..ecaa93e` (**unpushed**, 16 commits incl. spec/plan docs); submodule `203b25e..2b37294` (**pushed** to `origin/main` per the submodule-first protocol — required so the parent pointer bump is coherent).

## What shipped

CityParquet datasets now load as first-class static layers, through every requested entry point:

- **Remote**: a single `.parquet` table URL; a package directory (via its STAC `metadata.json` manifest); `gs://` and `s3://` wildcards (`*`, `**`, `?`) and directory prefixes, listed through the GCS JSON API / S3 ListObjectsV2 with pagination; the `https://storage.googleapis.com/…` spelling of gs. Plain-https wildcards are rejected with an instruction to use gs/s3 or point at `metadata.json`.
- **Local**: single `.parquet` file (browse or drop), and a **folder picker** (`webkitdirectory`) that assembles the package; multi-file drops group into one package. A dropped _directory_ is refused with an inline hint pointing at "Choose folder" (traversal loses `webkitRelativePath`, which names the layer).
- **STAC**: genuine `.parquet` data assets in the catalog browser get Add buttons; the `items.parquet` collection mirrors are default-denied.
- Everything downstream came free via the static-layer path: ENU georeferencing + geoid offset, LoD selector (`0` / `2.2` on the fixture), per-layer rules, picking, inherited-attribute display (Building→BuildingPart), persistence v3 and share links, DuckDB analytics via the in-memory path. Both App restore sites (snapshot + share link) classify with the same predicate as add-time.

Whole-load caps: 64 object tables per load, enforced on globs, listings, **and manifest-declared tables** (final-review fix). Any per-file failure fails the whole layer (D6 — no silently partial cities).

## Architecture (implemented as designed)

- `@cityjson/navara-cityparquet` (engine-free, Node-tested): vendored **hyparquet 1.28.1** (+3-line `DELTA_BYTE_ARRAY` V1 patch, documented in `VENDORED.md` with un-vendor condition) → LE ISO-WKB decoder (1001–1007 + **1015 PolyhedralSurfaceZ**) → footer `city` metadata parser (PROJJSON→EPSG, attributes list, encoding gate) → row decode (semantics via `face_semantics`/`surfaces`, CityGML↔CityJSON type renames, null-prototype maps against hostile ids) → package assembly (manifest roles, EPSG consensus, id dedupe) → `CityModel`.
- `src/features/cityparquet/`: `sourceClassify` (one predicate for add/restore), `objectStorage` (listing + glob), `loadCityParquet` (fetch orchestration, concurrency 6, fail-fast pool).

## Notable catches from the review loops (32 subagents: 11 implement, 11 review, 10 fix/re-review)

- **hyparquet's GeoParquet auto-conversion** silently turned the `geo`-declared LoD0 column into GeoJSON objects — the browser twin of DuckDB's `enable_geoparquet_conversion=false` trap. Fixed via a full parsers override (a partial override is destroyed by an upstream options-spread bug; both quirks recorded in `VENDORED.md`).
- Prototype-pollution defenses for untrusted ids/attributes (`__proto__`, `constructor`) across decode and assembly.
- The round-trip **oracle** (CityParquet parse vs `parseCityJSON` of the same source) was strengthened to two-way vertex-set equality + per-surface ring-shape multisets + attribute equality, with a six-mutation tripwire proving it bites; an interior-ring (hole) fixture round-trips end-to-end.
- Fetch pool halts on first failure; picked folders key files by relative path (a tiled package from disk no longer collapses to one file).

## Verification

- Submodule: `pnpm typecheck`, `pnpm build`, 80 package tests (719-suite green) — includes real-fixture and delft (2231-row, 4-LoD) scale tests.
- App: `npx tsc -b --noEmit`, 1302 tests green, `vp check` clean.
- **Browser smoke (real Chrome, dev server)**: package-dir URL ✅, single-table URL ✅, pick→inherited attributes ✅, LoD selector ✅, bad-URL toast ✅, save/reload restore ✅. `gs://cityparquet/3dbag_tiled/...` is blocked **by the bucket** (GCS serves no `Access-Control-Allow-Origin`) — the app's CORS-aware error is correct; the tutorial flow needs a bucket-side CORS policy.

## Out of scope (deliberate, spec §Goal)

Materials/textures/templates, the experimental `CityParquetArrowNative-v1` encoding, streaming/partial reads, authenticated buckets. Decode runs sequentially on the UI thread (documented in CLAUDE.md) — streaming/worker decode is the natural next milestone if full 1000-tile 3DBAG is wanted.

## Known follow-ups (triaged ACCEPT at final review; full backlog in the review history)

- `gs://cityparquet` demo bucket needs a CORS policy (external).
- Pre-existing, format-independent: `computeVolume` is wrong on gabled roofs (reproduced identically via plain CityJSON — deserves its own ticket); inspector "Surfaces" counts all LoDs (+1 with synthesized LoD0 footprints).
- Folder re-link through the unavailable-layers banner re-links a single file only (spec-documented limitation).
- Cosmetic: fixtures README says "4×6 m" roof opening; the ring is 4×4 m.
