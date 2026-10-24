# Phase 4 step 1: re-bake streamed cells from data the worker holds

Status: the store answering a cell from its own entry is built (plugins
58f62af). Answering from an ancestor or from four children is the next
stage. Measured on PLATEAU Chuo-ku
(`https://cityparquet.open3d.city/data/plateau/chuo-ku/building.parquet`, 72 MB,
51,604 rows, LoD 0 to 3, EPSG:6697), streamed, camera at 1.2 km nadir.

## The problem, in numbers

A streamed layer refetches every cell of the cover on each swap. A swap is any
change of level, LoD or appearance (`commitPlanner.ts`, `planCommit`). On
Chuo-ku, switching between LoD 1 and LoD 2 by hand takes 4.7 to 5.0 s (LoD 1)
and 8.7 to 9.3 s (LoD 2) to reach the screen. That holds when the cells were
built at that LoD a few seconds earlier, too. The worker profile of one LoD 2
switch (`chuo6s`, 7.5 s busy):

| Worker cost                                             | ms    |
| ------------------------------------------------------- | ----- |
| Re-reading and decompressing Parquet pages (ZSTD 1,700) | 2,780 |
| Garbage collection                                      | 1,550 |
| Decoding rows into objects (WKB 570)                    | 910   |
| Building meshes (triangulation 610)                     | 935   |
| Geographic to cell ENU                                  | 290   |
| Object records for the main thread                      | 280   |

Everything above the mesh row is spent re-creating objects the worker already
built. Most of the garbage-collection time goes to the same objects.

## What changes

The worker keeps the decoded features it has read, in a **feature store**, and
bakes cells from the store. It reads from the source only for the part of a
request the store cannot answer. The main thread, the commit planner and the
worker protocol do not change: a swap still asks for the whole new cover and
commits it in one step. It becomes fast because the worker no longer reads.

### The store

- Keyed by the cell keys the worker was asked to fetch (`level/col/row`), at
  whatever level they were fetched.
- Each entry holds the feature `CityModel`s the adapter returned **whose owner
  cell, at that level, is the entry's key**. The models are the bare ones
  (source or bucket coordinates), not the per-cell ENU copies. It also records
  the **LoD ceiling** the read was made at, and its retained bytes.
- The store has its own byte budget, LRU. Entries backing a resident cell are
  evicted last. A store miss costs a read, never a wrong answer.
- `close` and a new `open` clear it, as they clear the cell cache today.

### Which LoDs a read holds

What a read at LoD `L` brings back depends on the source:

- CityParquet reads every geometry column at or below `L`
  (`streamReader.ts`, `lodAllowed`). A LoD 2 read holds LoD 0, 1 and 2.
- FlatCityBuf ignores `lod` in `select` and filters at bake time. Every read
  holds every LoD.
- `lod: null` holds every LoD, for both.

The adapter states this through one new method on `StreamSourceAdapter`:

```ts
/** The LoD ceiling a `select(…, { lod })` read holds: `null` for every LoD. */
heldCeiling(lod: string | null): string | null;
```

CityParquet returns `lod`. FlatCityBuf returns `null`. An entry with ceiling
`c` answers a request at LoD `L` when `c` is `null`, or both are numeric and
`L <= c`, or `L === c`.

### Answering a request from the store

Ownership is the feature's bbox centre (`ownerKey`), so it nests: a feature
owned by cell `C` at level `l` is owned by `C`'s parent at `l - 1`. For each
requested cell `C`, the worker looks for, in order:

1. `C` itself, with a ceiling that covers the LoD. Built.
2. An ancestor of `C` that covers it. `C`'s features are the ancestor's
   features whose owner at `C`'s level is `C`. Next stage.
3. All four children of `C`, each answered by this rule, at most two levels
   down. `C`'s features are the union of theirs. Next stage.

Only rule 1 is built, so a level change still reads. Rules 2 and 3 need the
ownership test to give the same cell from the stored model as from a fresh
read at the new level, which the next stage tests first.

A cell that is answered is baked from those features. The others are read as
today: one `select` over the union of their bounds, then filed into the store
under the cells that were read. A cell that is half answered (some children
held, some not) is read whole, which keeps the rule simple and costs at most
one read.

This makes three things free of reads once the data is held:

- a LoD switch to a LoD at or below the held ceiling. On Chuo-ku the first
  automatic read has an empty LoD ladder, so it reads `lod: null` and holds
  every LoD;
- an appearance change, which re-bakes the same features under another theme;
- a level change over an area already held, in either direction (rules 2
  and 3, next stage);
- a cell evicted from the cell cache and fetched again.

A LoD above the ceiling is still a read. Reading only that LoD's geometry
columns and not the attributes again is step 2, in the readers' own repos.

### What the worker no longer holds twice

Today a cached cell holds the model it was baked from (`CachedCell.model`). For
a geographic source that is the ENU copy (`toCellEnu`). For a projected source
it is the bare model itself. Recolor and the surfaces request read it. With the
store, a bucket-source cell would hold its features twice: bare in the store,
ENU in the cell.

The first version keeps `CachedCell.model` as it is and counts it in the
retained bytes, so memory stays bounded by the sum of the two budgets
(`WORKER_FEATURE_BYTE_BUDGET` says so). Where the cell is baked from the bare
model, the two budgets count the same objects. It may double the
worker's retained bytes for bucket sources. If the measurement shows that
matters, the follow-up is to drop the ENU copy after baking: recolor reads only
attributes and surface types, which the bare model has in the same order, and
the surfaces request can convert one object's rings on demand.

## What does not change

- The commit planner, the main-thread cell cache, and the swap's
  all-or-nothing commit.
- The probe and the 20,000-feature budget. Chuo-ku at 2.5 km still says "Zoom
  in". Raising the budget for low LoDs belongs with step 3, the national
  overview.
- Restyles (2.4 to 5.4 s on Chuo-ku streamed, no reads). They go through
  `recolor`, not `fetch`, so this step does not touch them. They are the next
  thing to profile.

## Per-cell LoD tiers

The Phase 4 plan named per-cell LoD tiers with hysteresis: near cells at a
higher LoD than far ones, within one level. They are left out of this step:

- The footprint carries no camera position, so the planner cannot tell near
  from far without a protocol change.
- On the nadir views Hidemichi tests with, every cell is about the same
  distance from the camera, so tiers would change nothing there.
- With the store, a per-cell LoD change re-bakes rather than reads, so tiers
  become cheap to add later. The store is the prerequisite either way.

## Measured

Streamed Chuo-ku, 1.2 km nadir, the same gate run with and without the store
(`chuo11b`: plugins db121b7; `chuo10s`: plugins 58f62af). Time to the
screen, in seconds:

| Operation      | Without the store | With the store |
| -------------- | ----------------- | -------------- |
| LoD 1          | 4.94              | 3.44           |
| LoD 2          | 8.39              | 2.96           |
| LoD 1 again    | 4.34              | 3.32           |
| LoD 2 again    | 7.91              | 2.52           |
| Restyles (six) | 2.4 to 5.3        | 2.5 to 5.2     |

Neither run fetched bytes on a LoD switch: without the store the browser's
cache answers the repeated ranges, so what the store saves is the re-read
and decode, not the network. On a cold cache, or a source without one, it
also saves the transfer. Page heap stayed at 264 to 294 MB in both. Restyles
are unchanged, as expected: they never read. One earlier run with the
profiler attached (`chuo9s`) hit a three.js `createBuffer` exception and drew
no frames; it did not recur in either run without the profiler.

## How it is measured

The gate harness, Chuo-ku streamed (threshold lowered for the run), camera at
1.2 km nadir. The operations are LoD 1, LoD 2, LoD 1 again, LoD 2 again, then
six restyles. Compared with `chuo6s`:

- the time to the screen for each LoD switch, expected to fall from 4.7 to 9.3 s
  to about the mesh build and upload (1.5 to 2.5 s);
- bytes fetched per switch, expected to be 0 after the first load;
- worker heap, against the store's budget;
- a zoom-out and zoom-in pair over the same area: bytes fetched, expected 0
  on the way back in.

## Tests

Unit tests in `navara-stream`:

- the answering rule: self, ancestor, four children, half-held children read
  whole, ceiling comparisons (numeric, non-numeric, `null`);
- a worker `fetch` for a held LoD makes no `select` call and posts the same
  cell geometry as a fresh read of the same LoD;
- a LoD above the ceiling calls `select` once, for the missing cells only;
- a level change over held cells makes no `select` call, and every feature
  lands in the same cell as a fresh read at the new level would put it;
- the store's budget evicts and a later request reads again;
- `close` clears the store.
