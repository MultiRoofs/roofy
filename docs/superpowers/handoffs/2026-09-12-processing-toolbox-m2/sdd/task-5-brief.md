### Task 5: The pure roof roll-up

**Files:**

- Create: `src/domain/roofMetrics/roofRollUp.ts`
- Test: `tests/unit/domain/roofRollUp.test.ts`

**Interfaces:**

- Consumes: nothing (pure; no imports at all).
- Produces:
  - `export interface RoofSurfaceMetric { readonly lod: string | null; readonly areaSqM: number; readonly inclinationDeg: number; readonly azimuthDeg: number }`
  - `export interface RoofRollUp { readonly areaM2: number; readonly flatM2: number; readonly flatShare: number | null; readonly slopeDeg: number | null; readonly azimuthDeg: number | null; readonly surfaces: number }`
  - `export function rollUpRoofSurfaces(surfaces: ReadonlyArray<RoofSurfaceMetric>, flatThresholdDeg: number): RoofRollUp | null`
- Task 7 produces `RoofSurfaceMetric[]`; Task 9 consumes `rollUpRoofSurfaces`.

**Do not touch `src/domain/roofMetrics/aggregate.ts`.** Its `computeAverageAzimuth` is a circular area-weighted mean over a hard-coded 1° threshold (`aggregate.ts:8,12-35`) and `aggregateRoofMetrics` returns `0` for an empty set — neither is §7's rule, and `src/ui/details/subject.ts:228` still depends on the old behaviour.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/domain/roofRollUp.test.ts`:

```ts
/**
 * Spec §7's roll-ups, for ONE set of roof surfaces (a contributor set, or one
 * part's own surfaces). Pure, so every rule is asserted here rather than
 * through a run.
 */
import { describe, expect, it } from "vitest";
import {
  rollUpRoofSurfaces,
  type RoofSurfaceMetric,
} from "../../../src/domain/roofMetrics/roofRollUp";

const s = (
  areaSqM: number,
  inclinationDeg: number,
  azimuthDeg: number,
  lod: string | null = "2.2",
): RoofSurfaceMetric => ({ lod, areaSqM, inclinationDeg, azimuthDeg });

describe("rollUpRoofSurfaces", () => {
  it("is null for no surfaces at all — the caller counts that as skipped", () => {
    expect(rollUpRoofSurfaces([], 5)).toBeNull();
  });

  it("sums areas and counts surfaces", () => {
    const out = rollUpRoofSurfaces([s(10, 30, 180), s(6, 0, 0)], 5)!;
    expect(out.areaM2).toBe(16);
    expect(out.surfaces).toBe(2);
  });

  it("counts a surface under the threshold as flat, and one AT it as not", () => {
    const out = rollUpRoofSurfaces([s(10, 4.9, 0), s(6, 5, 90)], 5)!;
    expect(out.flatM2).toBe(10);
    expect(out.flatShare).toBeCloseTo(10 / 16, 10);
  });

  it("weights the mean slope by area, over ALL surfaces", () => {
    // The threshold must not touch this: §7 says "area-weighted over all roof
    // surfaces of the feature".
    const out = rollUpRoofSurfaces([s(30, 40, 180), s(10, 0, 0)], 5)!;
    expect(out.slopeDeg).toBeCloseTo((30 * 40) / 40, 10);
    expect(
      rollUpRoofSurfaces([s(30, 40, 180), s(10, 0, 0)], 0)!.slopeDeg,
    ).toBeCloseTo(30, 10);
  });

  it("takes the azimuth of the LARGEST NON-FLAT surface, not a mean", () => {
    const out = rollUpRoofSurfaces(
      [s(5, 35, 10), s(20, 30, 200), s(100, 1, 999)],
      5,
    )!;
    expect(out.azimuthDeg).toBe(200);
  });

  it("breaks an azimuth tie on the first surface in order", () => {
    const out = rollUpRoofSurfaces([s(9, 20, 45), s(9, 20, 315)], 5)!;
    expect(out.azimuthDeg).toBe(45);
  });

  it("has no azimuth when every surface is flat", () => {
    const out = rollUpRoofSurfaces([s(10, 0, 0), s(4, 2, 90)], 5)!;
    expect(out.azimuthDeg).toBeNull();
    expect(out.flatShare).toBe(1);
    expect(out.slopeDeg).toBeCloseTo((10 * 0 + 4 * 2) / 14, 10);
  });

  it("has no share and no slope when the surfaces are all zero-area", () => {
    // `computeRoofMetrics` returns all-zeros for a degenerate ring, so this is
    // real data, not a hypothetical. A 0/0 would be NaN in the column.
    const out = rollUpRoofSurfaces([s(0, 0, 0), s(0, 0, 0)], 5)!;
    expect(out.areaM2).toBe(0);
    expect(out.flatM2).toBe(0);
    expect(out.flatShare).toBeNull();
    expect(out.slopeDeg).toBeNull();
    expect(out.surfaces).toBe(2);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run tests/unit/domain/roofRollUp.test.ts
```

Expected: FAIL — `Failed to resolve import ".../roofRollUp"`.

- [ ] **Step 3: Write it**

Create `src/domain/roofMetrics/roofRollUp.ts`:

```ts
/**
 * Spec §7's roll-ups for one set of roof surfaces.
 *
 * "One set" is deliberately vague about WHOSE: the caller decides whether these
 * are a feature's contributor surfaces or one part's own (spec §8, "a Building
 * shows the aggregated value, a part its own"), and the maths is identical.
 *
 * NOT `src/domain/roofMetrics/aggregate.ts`. That module's azimuth is an
 * area-weighted CIRCULAR MEAN with a hard-coded 1° flat threshold, which is
 * what the Details panel has always shown. §7 asks for something different and
 * simpler — "the azimuth of the largest non-flat roof surface" — at the
 * threshold the user chose. Two answers to one question is the bug here; two
 * functions with different questions is not.
 *
 * Pure: no imports, no engine, no store.
 */

/** One roof surface, already measured, tagged with the LoD it came from. */
export interface RoofSurfaceMetric {
  readonly lod: string | null;
  readonly areaSqM: number;
  readonly inclinationDeg: number;
  readonly azimuthDeg: number;
}

/** The six measures of spec §7.1, before they are named and filtered. */
export interface RoofRollUp {
  readonly areaM2: number;
  readonly flatM2: number;
  /** `null` when there is no area to take a share OF. */
  readonly flatShare: number | null;
  /** Area-weighted over ALL surfaces; `null` when the total area is 0. */
  readonly slopeDeg: number | null;
  /** Of the largest non-flat surface; `null` when every surface is flat. */
  readonly azimuthDeg: number | null;
  readonly surfaces: number;
}

/**
 * `null` means "nothing to measure" — the caller writes NULL in every column
 * and counts the feature as skipped (§7.1's "no roof surfaces at LoD 1.2").
 *
 * The threshold is STRICT (`inclinationDeg < flatThresholdDeg`), matching
 * §7.1's word "under". A surface at exactly the threshold is therefore NOT
 * flat, and is a candidate for the dominant azimuth. The visible consequence is
 * at the slider's bottom stop: at 0 a perfectly horizontal roof counts as not
 * flat and the flat area is 0, which is what "slope under 0 degrees" means and
 * is why the default is 5. The non-strict reading (`<=`) would make 0 mean
 * "exactly horizontal counts", a different and unasked-for rule.
 */
export function rollUpRoofSurfaces(
  surfaces: ReadonlyArray<RoofSurfaceMetric>,
  flatThresholdDeg: number,
): RoofRollUp | null {
  if (surfaces.length === 0) return null;

  let areaM2 = 0;
  let flatM2 = 0;
  let weightedSlope = 0;
  let dominant: RoofSurfaceMetric | null = null;

  for (const surface of surfaces) {
    areaM2 += surface.areaSqM;
    weightedSlope += surface.inclinationDeg * surface.areaSqM;
    if (surface.inclinationDeg < flatThresholdDeg) {
      flatM2 += surface.areaSqM;
      continue;
    }
    // Strictly greater, so a tie keeps the FIRST surface in source order —
    // the tie rule this spec uses everywhere.
    if (dominant === null || surface.areaSqM > dominant.areaSqM) {
      dominant = surface;
    }
  }

  return {
    areaM2,
    flatM2,
    flatShare: areaM2 > 0 ? flatM2 / areaM2 : null,
    slopeDeg: areaM2 > 0 ? weightedSlope / areaM2 : null,
    azimuthDeg: dominant === null ? null : dominant.azimuthDeg,
    surfaces: surfaces.length,
  };
}
```

- [ ] **Step 4: Run the test**

```bash
npx vitest run tests/unit/domain/roofRollUp.test.ts
```

Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/roofMetrics/roofRollUp.ts tests/unit/domain/roofRollUp.test.ts
git commit -m "feat(domain): the spec's roof roll-ups as one pure function"
```

---
