# Geo-Layer Zoom-to-Layer + Inspector-Hosted Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give geospatial layers a "Zoom to layer" button (GeoJSON + 3D Tiles) and move their style/opacity config into the selection-driven right InspectorPanel, matching the city-layer mental model.

**Architecture:** Extent resolution is a new engine-free module (`geoLayerBounds.ts`) that computes `GeodeticBounds` from GeoJSON coordinates or a 3D Tiles root bounding volume; the viewport gains one generic `fitBounds(bounds)` handle method. Selection gains `activeGeoLayerId` in `geoLayerStore`; a new `GeoLayerInspector` renders in the InspectorPanel when a geo layer is active, and `GeoLayerRow` slims down to visibility/rename/zoom/remove.

**Tech Stack:** React 19 + TypeScript, Zustand, Vitest + @testing-library/react (jsdom), Navara `@navaramap/three@0.0.5` (mocked in tests).

**Spec:** `docs/superpowers/specs/2026-08-11-geo-layer-fit-and-inspector-design.md`

## Global Constraints

- App root uses **npm**; all commands run from `/data2/hideba/multiroof-viewer`. The plugin submodule is NOT touched by this plan.
- Type check: `npx tsc -b --noEmit` (plain `tsc --noEmit` is a no-op — root tsconfig has no files).
- Tests: `npx vitest run <path>` for a file, `npx vitest run` for all. Import from `"vitest"`, NEVER `"vite-plus/test"`.
- `@navaramap/*` may be imported ONLY in existing engine-binding modules (`src/scene/NavaraViewport.tsx` etc.). New modules under `src/features/` and `src/scene/geographicCamera.ts`-style helpers must stay engine-free (Node-importable).
- Commit prefix `feat:`/`fix:`/`refactor:`/`test:`/`docs:`; every commit includes `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. The pre-commit hook runs `vp check --fix` (lint+format) automatically.
- Zustand test hygiene: `afterEach` must reset every store field the suite touches (partial `setState` merges — a field you added but don't reset leaks across tests).
- TDD: every task writes the failing test FIRST, watches it fail, then implements.

---

### Task 1: `geoJsonBounds` — extent of a GeoJSON document

**Files:**

- Create: `src/features/geoLayers/geoLayerBounds.ts`
- Create: `tests/unit/features/geoLayers/geoLayerBounds.test.ts`

**Interfaces:**

- Consumes: `GeodeticBounds` type from `@cityjson/navara-cityjson` (engine-free barrel; same import `src/scene/geographicCamera.ts` already uses — copy its exact import specifier).
- Produces: `geoJsonBounds(data: unknown): GeodeticBounds | null` — `{west, south, east, north, minHeight, maxHeight}` in degrees/metres, heights always 0. Tasks 2–3 add to this file.

- [ ] **Step 1: Write the failing test**

```ts
/**
 * Extent of a geospatial layer, for "Zoom to layer".
 *
 * Engine-free: bounds are lng/lat degrees (GeodeticBounds), computed from the
 * layer's own data — Navara 0.0.5 exposes no bounds API on Layer/Source.
 */
import { describe, expect, it } from "vitest";
import { geoJsonBounds } from "../../../../src/features/geoLayers/geoLayerBounds";

describe("geoJsonBounds", () => {
  it("frames a FeatureCollection across all geometry types", () => {
    const bounds = geoJsonBounds({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [4.3, 52.0] },
        },
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "MultiLineString",
            coordinates: [
              [
                [4.5, 52.2],
                [4.6, 52.3],
              ],
            ],
          },
        },
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [4.1, 51.9],
                [4.2, 51.9],
                [4.2, 52.1],
                [4.1, 51.9],
              ],
            ],
          },
        },
      ],
    });
    expect(bounds).toEqual({
      west: 4.1,
      south: 51.9,
      east: 4.6,
      north: 52.3,
      minHeight: 0,
      maxHeight: 0,
    });
  });

  it("frames a bare Feature and a bare geometry", () => {
    const feature = geoJsonBounds({
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: [10, 20] },
    });
    expect(feature?.west).toBe(10);
    expect(feature?.north).toBe(20);

    const geometry = geoJsonBounds({
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [1, 2],
            [3, 4],
            [1, 2],
          ],
        ],
      ],
    });
    expect(geometry).toMatchObject({ west: 1, south: 2, east: 3, north: 4 });
  });

  it("descends into a GeometryCollection", () => {
    const bounds = geoJsonBounds({
      type: "GeometryCollection",
      geometries: [
        { type: "Point", coordinates: [0, 0] },
        { type: "Point", coordinates: [2, 3] },
      ],
    });
    expect(bounds).toMatchObject({ west: 0, south: 0, east: 2, north: 3 });
  });

  it("ignores a coordinate z — heights stay zero", () => {
    const bounds = geoJsonBounds({
      type: "Point",
      coordinates: [4.3, 52.0, 87.5],
    });
    expect(bounds?.minHeight).toBe(0);
    expect(bounds?.maxHeight).toBe(0);
  });

  it("skips positions outside lng/lat range instead of framing them", () => {
    // A projected-CRS file (metres masquerading as degrees) must not produce
    // a "valid" box in the middle of the ocean at lat 84 000.
    const bounds = geoJsonBounds({
      type: "Point",
      coordinates: [85000, 447000],
    });
    expect(bounds).toBeNull();
  });

  it("answers null for junk, empties and non-GeoJSON", () => {
    expect(geoJsonBounds(null)).toBeNull();
    expect(geoJsonBounds("not geojson")).toBeNull();
    expect(
      geoJsonBounds({ type: "FeatureCollection", features: [] }),
    ).toBeNull();
    expect(
      geoJsonBounds({ type: "Feature", properties: {}, geometry: null }),
    ).toBeNull();
    expect(
      geoJsonBounds({ type: "Point", coordinates: [Number.NaN, 1] }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/features/geoLayers/geoLayerBounds.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/features/geoLayers/geoLayerBounds.ts`. Check how `src/scene/geographicCamera.ts` imports `GeodeticBounds` and use the identical specifier.

```ts
/**
 * Extent of a geospatial layer, for "Zoom to layer".
 *
 * ENGINE-FREE and computed from the layer's OWN data, because Navara 0.0.5
 * exposes no bounds/fit API on Layer or Source — the engine draws a geo layer
 * but cannot say where it is. GeoJSON is walked coordinate by coordinate; a
 * 3D Tiles tileset answers from its root bounding volume; an XYZ raster
 * template names no extent at all, so a raster layer has none (null).
 *
 * Antimeridian-crossing data produces a naive min/max box — a documented
 * limitation, matching the spec.
 */
import type { GeodeticBounds } from "@cityjson/navara-cityjson";

interface MutableBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Positions are [lng, lat, z?]; anything nested deeper is recursed. A
 *  position outside the lng/lat value space is SKIPPED, not clamped — a
 *  projected-CRS file must read as "no extent", not as a wrong one. */
function extendFromCoordinates(value: unknown, box: MutableBox): void {
  if (!Array.isArray(value)) return;
  if (typeof value[0] === "number" && typeof value[1] === "number") {
    const lng = value[0];
    const lat = value[1];
    if (
      Number.isFinite(lng) &&
      Number.isFinite(lat) &&
      lng >= -180 &&
      lng <= 180 &&
      lat >= -90 &&
      lat <= 90
    ) {
      if (lng < box.west) box.west = lng;
      if (lng > box.east) box.east = lng;
      if (lat < box.south) box.south = lat;
      if (lat > box.north) box.north = lat;
    }
    return;
  }
  for (const item of value) extendFromCoordinates(item, box);
}

function walkGeoJson(node: unknown, box: MutableBox): void {
  if (!isRecord(node)) return;
  if (node.type === "FeatureCollection" && Array.isArray(node.features)) {
    for (const feature of node.features) walkGeoJson(feature, box);
    return;
  }
  if (node.type === "Feature") {
    walkGeoJson(node.geometry, box);
    return;
  }
  if (node.type === "GeometryCollection" && Array.isArray(node.geometries)) {
    for (const geometry of node.geometries) walkGeoJson(geometry, box);
    return;
  }
  if ("coordinates" in node) extendFromCoordinates(node.coordinates, box);
}

/**
 * The lng/lat box around every position in a GeoJSON document, or null when
 * it contains none. Heights are 0 — `cameraForBounds` frames a flat box fine,
 * and a coordinate z is elevation of unknown datum, not worth trusting.
 */
export function geoJsonBounds(data: unknown): GeodeticBounds | null {
  const box: MutableBox = {
    west: Number.POSITIVE_INFINITY,
    south: Number.POSITIVE_INFINITY,
    east: Number.NEGATIVE_INFINITY,
    north: Number.NEGATIVE_INFINITY,
  };
  walkGeoJson(data, box);
  if (box.west > box.east || box.south > box.north) return null;
  return { ...box, minHeight: 0, maxHeight: 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/features/geoLayers/geoLayerBounds.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/geoLayers/geoLayerBounds.ts tests/unit/features/geoLayers/geoLayerBounds.test.ts
git commit -m "feat: compute a GeoJSON layer's geodetic extent

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `tilesetBounds` — extent of a 3D Tiles tileset

**Files:**

- Modify: `src/features/geoLayers/geoLayerBounds.ts` (append)
- Modify: `tests/unit/features/geoLayers/geoLayerBounds.test.ts` (append)

**Interfaces:**

- Produces: `tilesetBounds(tileset: unknown): GeodeticBounds | null` — reads `tileset.root.boundingVolume` (`region` | `sphere` | `box`).

- [ ] **Step 1: Write the failing test** (append to the test file)

```ts
import { tilesetBounds } from "../../../../src/features/geoLayers/geoLayerBounds";

describe("tilesetBounds", () => {
  it("converts a region volume from radians to degrees, keeping heights", () => {
    // ~lng 4.29–4.44, lat 51.98–52.03 (Delft-ish), heights 0–120 m.
    const bounds = tilesetBounds({
      asset: { version: "1.0" },
      root: {
        boundingVolume: {
          region: [0.074875, 0.907275, 0.077493, 0.908147, 0, 120],
        },
      },
    });
    expect(bounds).not.toBeNull();
    expect(bounds!.west).toBeCloseTo((0.074875 * 180) / Math.PI, 6);
    expect(bounds!.east).toBeCloseTo((0.077493 * 180) / Math.PI, 6);
    expect(bounds!.south).toBeCloseTo((0.907275 * 180) / Math.PI, 6);
    expect(bounds!.north).toBeCloseTo((0.908147 * 180) / Math.PI, 6);
    expect(bounds!.minHeight).toBe(0);
    expect(bounds!.maxHeight).toBe(120);
  });

  it("frames a sphere volume around its ECEF centre", () => {
    // ECEF (6378137, 0, 0) is lng 0, lat 0, height 0 on the WGS84 ellipsoid.
    const bounds = tilesetBounds({
      root: { boundingVolume: { sphere: [6378137, 0, 0, 1000] } },
    });
    expect(bounds).not.toBeNull();
    expect(bounds!.west).toBeLessThan(0);
    expect(bounds!.east).toBeGreaterThan(0);
    expect((bounds!.west + bounds!.east) / 2).toBeCloseTo(0, 4);
    expect((bounds!.south + bounds!.north) / 2).toBeCloseTo(0, 4);
    // 1000 m ≈ 0.009° of latitude.
    expect(bounds!.north - bounds!.south).toBeCloseTo((2 * 1000) / 111_320, 3);
    expect(bounds!.maxHeight).toBeCloseTo(1000, 0);
  });

  it("frames a box volume by its half-diagonal", () => {
    const bounds = tilesetBounds({
      root: {
        boundingVolume: {
          box: [6378137, 0, 0, 300, 0, 0, 0, 400, 0, 0, 0, 0],
        },
      },
    });
    expect(bounds).not.toBeNull();
    // hypot(300, 400) = 500 m radius.
    expect(bounds!.north - bounds!.south).toBeCloseTo((2 * 500) / 111_320, 3);
  });

  it("answers null for junk and absent volumes", () => {
    expect(tilesetBounds(null)).toBeNull();
    expect(tilesetBounds({})).toBeNull();
    expect(tilesetBounds({ root: {} })).toBeNull();
    expect(tilesetBounds({ root: { boundingVolume: {} } })).toBeNull();
    expect(
      tilesetBounds({ root: { boundingVolume: { region: [0, 1] } } }),
    ).toBeNull();
    expect(
      tilesetBounds({
        root: { boundingVolume: { sphere: [Number.NaN, 0, 0, 1] } },
      }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/features/geoLayers/geoLayerBounds.test.ts`
Expected: FAIL — `tilesetBounds` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `geoLayerBounds.ts`)

```ts
const WGS84_A = 6378137;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const METRES_PER_DEGREE_LAT = 111_320;
const RAD_TO_DEG = 180 / Math.PI;

/** Bowring's single-pass approximation — metre-level accuracy, ample for
 *  framing a camera flight. Self-contained on purpose: proj4 has no ECEF
 *  pipeline registered here, and this module must stay dependency-light. */
function ecefToGeodetic(
  x: number,
  y: number,
  z: number,
): { lng: number; lat: number; height: number } {
  const lng = Math.atan2(y, x);
  const p = Math.hypot(x, y);
  const b = WGS84_A * (1 - WGS84_F);
  const theta = Math.atan2(z * WGS84_A, p * b);
  const ePrime2 = (WGS84_A * WGS84_A - b * b) / (b * b);
  const lat = Math.atan2(
    z + ePrime2 * b * Math.sin(theta) ** 3,
    p - WGS84_E2 * WGS84_A * Math.cos(theta) ** 3,
  );
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(lat) ** 2);
  const height = p / Math.cos(lat) - n;
  return { lng: lng * RAD_TO_DEG, lat: lat * RAD_TO_DEG, height };
}

function boundsAroundEcef(
  x: number,
  y: number,
  z: number,
  radiusM: number,
): GeodeticBounds | null {
  if (![x, y, z, radiusM].every(Number.isFinite) || radiusM < 0) return null;
  const centre = ecefToGeodetic(x, y, z);
  if (!Number.isFinite(centre.lng) || !Number.isFinite(centre.lat)) return null;
  const dLat = radiusM / METRES_PER_DEGREE_LAT;
  const cosLat = Math.cos((centre.lat * Math.PI) / 180);
  const dLng = cosLat > 1e-6 ? radiusM / (METRES_PER_DEGREE_LAT * cosLat) : 180;
  return {
    west: centre.lng - dLng,
    south: Math.max(-90, centre.lat - dLat),
    east: centre.lng + dLng,
    north: Math.min(90, centre.lat + dLat),
    minHeight: centre.height - radiusM,
    maxHeight: centre.height + radiusM,
  };
}

/**
 * The extent of a 3D Tiles tileset, from its root bounding volume. A `region`
 * is already geodetic (radians); `sphere` and `box` are ECEF and become a box
 * around their centre — conservative (a box's half-diagonal), which for a
 * camera fit errs the right way: slightly too far out, never cropping.
 */
export function tilesetBounds(tileset: unknown): GeodeticBounds | null {
  if (!isRecord(tileset)) return null;
  const root = tileset.root;
  if (!isRecord(root)) return null;
  const volume = root.boundingVolume;
  if (!isRecord(volume)) return null;

  if (Array.isArray(volume.region) && volume.region.length >= 6) {
    const region = volume.region as number[];
    if (!region.slice(0, 6).every((v) => Number.isFinite(v))) return null;
    const [west, south, east, north, minHeight, maxHeight] = region;
    return {
      west: west! * RAD_TO_DEG,
      south: south! * RAD_TO_DEG,
      east: east! * RAD_TO_DEG,
      north: north! * RAD_TO_DEG,
      minHeight: minHeight!,
      maxHeight: maxHeight!,
    };
  }
  if (Array.isArray(volume.sphere) && volume.sphere.length >= 4) {
    const [cx, cy, cz, r] = volume.sphere as number[];
    return boundsAroundEcef(cx!, cy!, cz!, r!);
  }
  if (Array.isArray(volume.box) && volume.box.length >= 12) {
    const b = volume.box as number[];
    if (!b.slice(0, 12).every((v) => Number.isFinite(v))) return null;
    const radius = Math.hypot(
      Math.hypot(b[3]!, b[4]!, b[5]!),
      Math.hypot(b[6]!, b[7]!, b[8]!),
      Math.hypot(b[9]!, b[10]!, b[11]!),
    );
    return boundsAroundEcef(b[0]!, b[1]!, b[2]!, radius);
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/features/geoLayers/geoLayerBounds.test.ts`
Expected: PASS (all describes).

- [ ] **Step 5: Commit**

```bash
git add src/features/geoLayers/geoLayerBounds.ts tests/unit/features/geoLayers/geoLayerBounds.test.ts
git commit -m "feat: read a 3D Tiles tileset's extent from its root bounding volume

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `resolveGeoLayerBounds` — per-kind routing, fetch and cache

**Files:**

- Modify: `src/features/geoLayers/geoLayerBounds.ts` (append)
- Modify: `tests/unit/features/geoLayers/geoLayerBounds.test.ts` (append)

**Interfaces:**

- Consumes: `GeoLayer` from `./geoLayerStore`; `geoJsonBounds`/`tilesetBounds` from Tasks 1–2.
- Produces:
  - `resolveGeoLayerBounds(layer: GeoLayer, fetchFn?: typeof fetch): Promise<GeodeticBounds | null>`
  - `resetGeoLayerBoundsCache(): void` (test seam — call in `afterEach`)

- [ ] **Step 1: Write the failing test** (append; add `afterEach` import from vitest and `vi`)

```ts
import { afterEach, vi } from "vitest";
import {
  resetGeoLayerBoundsCache,
  resolveGeoLayerBounds,
} from "../../../../src/features/geoLayers/geoLayerBounds";
import type { GeoLayer } from "../../../../src/features/geoLayers/geoLayerStore";
import { DEFAULT_GEO_LAYER_STYLE } from "../../../../src/features/geoLayers/geoLayerStyle";

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as unknown as Response;
}

function geoJsonLayer(config: { data?: unknown; url?: string }): GeoLayer {
  return {
    id: "g1",
    name: "roads",
    kind: "geojson",
    visible: true,
    opacity: 1,
    style: DEFAULT_GEO_LAYER_STYLE,
    config,
  };
}

describe("resolveGeoLayerBounds", () => {
  afterEach(() => {
    resetGeoLayerBoundsCache();
  });

  it("answers inline GeoJSON without touching the network", async () => {
    const fetchFn = vi.fn();
    const bounds = await resolveGeoLayerBounds(
      geoJsonLayer({ data: { type: "Point", coordinates: [4, 52] } }),
      fetchFn as unknown as typeof fetch,
    );
    expect(bounds).toMatchObject({ west: 4, north: 52 });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("fetches a URL-backed GeoJSON layer, and caches by URL", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ type: "Point", coordinates: [5, 50] }),
    );
    const layer = geoJsonLayer({ url: "https://x/roads.geojson" });

    const first = await resolveGeoLayerBounds(
      layer,
      fetchFn as unknown as typeof fetch,
    );
    const second = await resolveGeoLayerBounds(
      layer,
      fetchFn as unknown as typeof fetch,
    );

    expect(first).toMatchObject({ west: 5, south: 50 });
    expect(second).toEqual(first);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("fetches a tileset.json for a 3d-tiles layer", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        root: { boundingVolume: { sphere: [6378137, 0, 0, 500] } },
      }),
    );
    const layer: GeoLayer = {
      id: "t1",
      name: "tiles",
      kind: "3d-tiles",
      visible: true,
      opacity: 1,
      style: DEFAULT_GEO_LAYER_STYLE,
      config: { url: "https://x/tileset.json" },
    };
    const bounds = await resolveGeoLayerBounds(
      layer,
      fetchFn as unknown as typeof fetch,
    );
    expect(bounds).not.toBeNull();
    expect(fetchFn).toHaveBeenCalledWith("https://x/tileset.json");
  });

  it("resolves null for raster-xyz by contract, without fetching", async () => {
    const fetchFn = vi.fn();
    const layer: GeoLayer = {
      id: "r1",
      name: "osm",
      kind: "raster-xyz",
      visible: true,
      opacity: 1,
      style: DEFAULT_GEO_LAYER_STYLE,
      config: { urlTemplate: "https://tile/{z}/{x}/{y}.png" },
    };
    expect(
      await resolveGeoLayerBounds(layer, fetchFn as unknown as typeof fetch),
    ).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("does NOT cache a failure — the next click retries", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(
        jsonResponse({ type: "Point", coordinates: [1, 2] }),
      );
    const layer = geoJsonLayer({ url: "https://x/flaky.geojson" });

    await expect(
      resolveGeoLayerBounds(layer, fetchFn as unknown as typeof fetch),
    ).rejects.toThrow("offline");
    const retry = await resolveGeoLayerBounds(
      layer,
      fetchFn as unknown as typeof fetch,
    );
    expect(retry).toMatchObject({ west: 1, south: 2 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("rejects on an HTTP error status", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, false));
    const layer = geoJsonLayer({ url: "https://x/404.geojson" });
    await expect(
      resolveGeoLayerBounds(layer, fetchFn as unknown as typeof fetch),
    ).rejects.toThrow();
  });

  it("resolves null for a geojson layer with neither data nor url", async () => {
    expect(
      await resolveGeoLayerBounds(geoJsonLayer({}), vi.fn() as never),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/features/geoLayers/geoLayerBounds.test.ts`
Expected: FAIL — `resolveGeoLayerBounds` not exported.

- [ ] **Step 3: Write minimal implementation** (append; add `import type { GeoLayer } from "./geoLayerStore";` at top)

```ts
/** URL → in-flight-or-done bounds, so a second click on the same layer (or a
 *  second layer over the same file) costs nothing. Successes only: a null or
 *  a rejection is evicted, so the next click retries a flaky host. */
const boundsByUrl = new Map<string, Promise<GeodeticBounds | null>>();

/** Test seam. */
export function resetGeoLayerBoundsCache(): void {
  boundsByUrl.clear();
}

function cachedBounds(
  url: string,
  fetchFn: typeof fetch,
  toBounds: (body: unknown) => GeodeticBounds | null,
): Promise<GeodeticBounds | null> {
  const cached = boundsByUrl.get(url);
  if (cached) return cached;
  const promise = (async () => {
    const response = await fetchFn(url);
    if (!response.ok) {
      throw new Error(`Fetching ${url} failed with HTTP ${response.status}`);
    }
    return toBounds(await response.json());
  })();
  boundsByUrl.set(url, promise);
  promise.then(
    (bounds) => {
      if (bounds === null) boundsByUrl.delete(url);
    },
    () => boundsByUrl.delete(url),
  );
  return promise;
}

/**
 * The extent of a geo layer, fetching the layer's source when it lives behind
 * a URL. Resolves null when the layer HAS no extent (raster, an unlinked
 * GeoJSON row, a document with no positions); REJECTS when the network does —
 * the caller tells those apart to word its message.
 */
export function resolveGeoLayerBounds(
  layer: GeoLayer,
  fetchFn: typeof fetch = fetch,
): Promise<GeodeticBounds | null> {
  switch (layer.kind) {
    case "geojson": {
      if (layer.config.data !== undefined) {
        return Promise.resolve(geoJsonBounds(layer.config.data));
      }
      if (layer.config.url !== undefined && layer.config.url !== "") {
        return cachedBounds(layer.config.url, fetchFn, geoJsonBounds);
      }
      return Promise.resolve(null);
    }
    case "3d-tiles":
      return cachedBounds(layer.config.url, fetchFn, tilesetBounds);
    case "raster-xyz":
      return Promise.resolve(null);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/features/geoLayers/geoLayerBounds.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/geoLayers/geoLayerBounds.ts tests/unit/features/geoLayers/geoLayerBounds.test.ts
git commit -m "feat: resolve a geo layer's extent per kind, with a URL cache

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `CitySceneHandle.fitBounds`

**Files:**

- Modify: `src/scene/NavaraViewport.tsx` — the `CitySceneHandle` interface (~line 185), the fit callbacks block (~line 2103), the `useImperativeHandle` (~line 3320)
- Modify: `tests/unit/scene/navaraViewport.test.tsx`
- Modify: `tests/unit/app/appEngineBoot.test.tsx`, `tests/unit/app/appCityParquetLayers.test.tsx`, `tests/unit/app/appRestoreShare.test.tsx` (scene-handle stubs)

**Interfaces:**

- Consumes: existing `framedForMode`, `withSettleSuppressed`, `viewRef` in `NavaraViewport.tsx`; `GeodeticBounds`.
- Produces: `fitBounds: (bounds: GeodeticBounds) => void` on `CitySceneHandle`.

- [ ] **Step 1: Write the failing test**

`tests/unit/scene/navaraViewport.test.tsx` uses a MODULE-LEVEL `flyTo` mock (declared ~line 17, cleared in the suite's reset ~line 524) and `createRef<CitySceneHandle>()` — there is no `handle` variable or per-test `flyToMock`. Mirror the test `"moves no camera while there are no layers to fit"` (~lines 706–716) exactly: render the viewport with a ref, `await waitFor(() => expect(ref.current).not.toBeNull())`, then `await ref.current!.ready` (this matters: `viewRef` is only set inside `init()`, so calling before ready hits the `!view` guard and proves nothing). No city layers are needed — `fitBounds` consults no registry. Two tests:

```ts
it("fitBounds flies to caller-supplied bounds without consulting any layer", async () => {
  // Setup copied from "moves no camera while there are no layers to fit":
  // render, waitFor ref, await ref.current!.ready.
  ref.current!.fitBounds({
    west: 4.1,
    south: 51.9,
    east: 4.6,
    north: 52.3,
    minHeight: 0,
    maxHeight: 0,
  });

  expect(flyTo).toHaveBeenCalledTimes(1);
  const target = flyTo.mock.calls[0]![0];
  expect(target.lng).toBeGreaterThan(4.1);
  expect(target.lng).toBeLessThan(4.6);
  expect(target.lat).toBeGreaterThan(51.9);
  expect(target.lat).toBeLessThan(52.3);
});

it("fitBounds refuses a box that frames to a non-finite camera", async () => {
  // Same setup. A no-view call cannot be tested deterministically (init is
  // async and may already have run), so the guard under test is the finite
  // check — the deterministic half of "bad input moves no camera".
  ref.current!.fitBounds({
    west: Number.NaN,
    south: Number.NaN,
    east: Number.NaN,
    north: Number.NaN,
    minHeight: 0,
    maxHeight: 0,
  });

  expect(flyTo).not.toHaveBeenCalled();
});
```

(`flyTo` here is the suite's existing module-level mock name — read its declaration first and use the real identifier.) Do NOT extend `navaraViewportStreaming.test.tsx` — the plain no-streaming path here is enough.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/scene/navaraViewport.test.tsx`
Expected: FAIL — `handle.fitBounds is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `NavaraViewport.tsx`:

1. Add to the `CitySceneHandle` interface, after `fitLayer`:

```ts
/** Fly to frame caller-supplied bounds — the geo-layer fit, whose extents
 *  the app computes itself (`geoLayerBounds.ts`); the engine has no bounds
 *  API for its own geo layers. Same framing and settle suppression as
 *  `fitLayer`. */
fitBounds: (bounds: GeodeticBounds) => void;
```

(`GeodeticBounds` is already imported in this file for `boundsOf` — verify, add the type import if not.)

2. Add the callback next to `fitLayer` (~line 2118):

```ts
const fitBounds = useCallback(
  (bounds: GeodeticBounds) => {
    const view = viewRef.current;
    if (!view) return;
    const framed = framedForMode(bounds);
    // Bounds arrive from outside the engine's own registries, so a bad box
    // must die here, not as a NaN camera the engine cannot recover from.
    if (
      !Number.isFinite(framed.lng) ||
      !Number.isFinite(framed.lat) ||
      !Number.isFinite(framed.height)
    ) {
      return;
    }
    withSettleSuppressed(() => view.flyTo(framed));
  },
  [framedForMode, withSettleSuppressed],
);
```

3. Add `fitBounds` to the `useImperativeHandle` object AND its dependency array (~lines 3322–3352).

4. In each of the three app test files, find the scene-handle stub carrying `fitLayer: () => {}` and add `fitBounds: () => {}` beside it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/scene/navaraViewport.test.tsx tests/unit/app`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scene/NavaraViewport.tsx tests/unit/scene/navaraViewport.test.tsx tests/unit/app
git commit -m "feat: CitySceneHandle.fitBounds — fly to caller-supplied bounds

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Shared `ZoomToLayerIcon` + shared geo-layer meta module (pure refactor)

**Files:**

- Create: `src/ui/layers/ZoomToLayerIcon.tsx`
- Create: `src/ui/layers/geoLayerMeta.ts`
- Modify: `src/ui/layers/LayerPanel.tsx` (use the icon), `src/ui/layers/GeoLayerRow.tsx` (import meta from the new module)

**Interfaces:**

- Produces:
  - `ZoomToLayerIcon(): JSX.Element` — the 12×12 crosshair SVG currently inlined at `LayerPanel.tsx:211-233`, moved verbatim.
  - From `geoLayerMeta.ts`: `KIND_BADGE: Record<GeoLayer["kind"], string>`, `KIND_LABEL: Record<GeoLayer["kind"], string>`, `sourceOf(layer: GeoLayer): string`, `colorInputValue(hex: string): string` — all moved verbatim from `GeoLayerRow.tsx` (lines 36–75) with their doc comments; `GeoLayerRow` imports them.

No behaviour change, so no new test — the existing suites are the net.

- [ ] **Step 1: Create `ZoomToLayerIcon.tsx`**

```tsx
/** Locate/crosshair, shared by the city row's and the geo row's "Zoom to
 *  layer" buttons — not the old circle-plus-four-lines: that glyph read as a
 *  compass rose (a bearing, not a target). */
export function ZoomToLayerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <line x1="12" y1="2" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="2" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="22" y2="12" />
    </svg>
  );
}
```

Replace the inline SVG in `LayerPanel.tsx`'s city-row zoom button with `<ZoomToLayerIcon />` (keep the button and its comment; the glyph comment moves to the icon).

- [ ] **Step 2: Create `geoLayerMeta.ts`**

Move `KIND_BADGE`, `KIND_LABEL`, `sourceOf`, `colorInputValue` (with their doc comments and the `hexColorToNumber`/`DEFAULT_GEO_LAYER_STYLE` imports they need) out of `GeoLayerRow.tsx` into `src/ui/layers/geoLayerMeta.ts`, exporting all four. Add a module doc comment:

```ts
/**
 * Presentation vocabulary for a geospatial layer, shared by the layer-panel
 * row and the inspector's geo view: what a kind is called, where the layer
 * came from, and the 6-digit colour `<input type="color">` needs.
 */
```

Update `GeoLayerRow.tsx` to import them from `./geoLayerMeta` — and REMOVE the imports the move orphans there (`hexColorToNumber` and `DEFAULT_GEO_LAYER_STYLE` travel with `colorInputValue` to the new module), so Step 3's typecheck comes back green.

- [ ] **Step 3: Verify nothing changed**

Run: `npx vitest run tests/unit/ui/layers && npx tsc -b --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/ui/layers/ZoomToLayerIcon.tsx src/ui/layers/geoLayerMeta.ts src/ui/layers/LayerPanel.tsx src/ui/layers/GeoLayerRow.tsx
git commit -m "refactor: share the zoom icon and the geo-layer meta vocabulary

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Zoom button on the geo row, wired through to `fitBounds`

**Files:**

- Modify: `src/ui/layers/GeoLayerRow.tsx`, `src/ui/layers/LayerPanel.tsx`, `src/ui/sidebar/LeftSidebar.tsx`, `src/app/App.tsx`
- Test: `tests/unit/ui/layers/LayerPanelSections.test.tsx`

**Interfaces:**

- Consumes: `resolveGeoLayerBounds` (Task 3), `CitySceneHandle.fitBounds` (Task 4), `ZoomToLayerIcon` (Task 5).
- Produces: prop `onFlyToGeoLayer?: (geoLayerId: string) => void` on `LayerPanel`, `LeftSidebar` and `GeoLayerRow` (same optional-prop pattern as `onFlyToLayer`).

- [ ] **Step 1: Write the failing tests**

In `LayerPanelSections.test.tsx`: extend `renderPanel()` to accept and forward an optional `onFlyToGeoLayer`:

```tsx
function renderPanel(onFlyToGeoLayer?: (id: string) => void) {
  return render(
    <LayerPanel
      onAddFile={noop}
      onAddFiles={noop}
      onAddUrl={noopUrl}
      loading={false}
      onFlyToGeoLayer={onFlyToGeoLayer}
    />,
  );
}
```

Add a `describe`:

```tsx
describe("LayerPanel — zoom to a geospatial layer", () => {
  it("offers the zoom button on vector and tileset rows, not raster", () => {
    addGeoJson();
    renderPanel(noop);
    expect(
      within(geoRows()[0]!).getByRole("button", { name: "Zoom to layer" }),
    ).toBeTruthy();

    cleanup();
    useGeoLayerStore.setState({ layers: [] });

    geoStore().addGeoLayer({
      name: "tiles",
      kind: "3d-tiles",
      config: { url: "https://x/tileset.json" },
    });
    renderPanel(noop);
    expect(
      within(geoRows()[0]!).getByRole("button", { name: "Zoom to layer" }),
    ).toBeTruthy();

    cleanup();
    useGeoLayerStore.setState({ layers: [] });

    addRaster();
    renderPanel(noop);
    expect(
      within(geoRows()[0]!).queryByRole("button", { name: "Zoom to layer" }),
    ).toBeNull();
  });

  it("reports the layer's id when clicked", () => {
    const id = addGeoJson();
    const spy = vi.fn();
    renderPanel(spy);

    fireEvent.click(
      within(geoRows()[0]!).getByRole("button", { name: "Zoom to layer" }),
    );

    expect(spy).toHaveBeenCalledWith(id);
  });

  // REGRESSION GUARD, not a red step: this one passes even before the
  // implementation exists (there is no zoom button at all yet). The red
  // signal for this task comes from the two tests above.
  it("renders no zoom button when the callback is absent", () => {
    addGeoJson();
    renderPanel();
    expect(
      within(geoRows()[0]!).queryByRole("button", { name: "Zoom to layer" }),
    ).toBeNull();
  });
});
```

(Add `vi` to the vitest import.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/ui/layers/LayerPanelSections.test.tsx`
Expected: FAIL — unknown prop / button not found.

- [ ] **Step 3: Implement**

1. `GeoLayerRow.tsx` — accept the prop and render the button in `.layer-actions`, BEFORE the remove button (matching the city row's order):

```tsx
export function GeoLayerRow({
  layer,
  onFlyToGeoLayer,
}: {
  readonly layer: GeoLayer;
  readonly onFlyToGeoLayer?: (geoLayerId: string) => void;
}) {
```

```tsx
{
  /* Only the kinds whose extent the app can actually compute: GeoJSON is
    walked, a tileset names its root volume, but an XYZ template names no
    extent at all — a button that always toasted would teach users to
    ignore it. */
}
{
  onFlyToGeoLayer && layer.kind !== "raster-xyz" && (
    <button
      className="rule-action-btn"
      aria-label="Zoom to layer"
      data-tooltip="Zoom to layer"
      data-tooltip-pos="top"
      data-tooltip-align="end"
      onClick={(e) => {
        e.stopPropagation();
        onFlyToGeoLayer(layer.id);
      }}
    >
      <ZoomToLayerIcon />
    </button>
  );
}
```

2. `LayerPanel.tsx` — add `readonly onFlyToGeoLayer?: (geoLayerId: string) => void;` to props, destructure it, pass to every `<GeoLayerRow … onFlyToGeoLayer={onFlyToGeoLayer} />`.

3. `LeftSidebar.tsx` — same prop, forwarded to `LayerPanel` (mirror `onFlyToLayer` at lines 27/101).

4. `App.tsx` — next to `handleFitAll` (~line 1216):

```tsx
/** Zoom to a GEO layer: its extent is the app's to compute (the engine has
 *  no bounds API for these), and may live behind a URL — hence async, with
 *  the failure worded for the user rather than swallowed. */
const handleFlyToGeoLayer = useCallback(
  (geoLayerId: string) => {
    const layer = useGeoLayerStore
      .getState()
      .layers.find((l) => l.id === geoLayerId);
    if (!layer) return;
    void (async () => {
      try {
        const bounds = await resolveGeoLayerBounds(layer);
        if (bounds) {
          sceneRef.current?.fitBounds(bounds);
          return;
        }
        showToast(
          "Could not determine the layer's extent.",
          EXPLANATION_TOAST_MS,
        );
      } catch {
        showToast(
          "Could not determine the layer's extent — its source did not load.",
          EXPLANATION_TOAST_MS,
        );
      }
    })();
  },
  [showToast],
);
```

Import `resolveGeoLayerBounds` from `../features/geoLayers/geoLayerBounds` (adjust the relative path to App.tsx's convention) and pass `onFlyToGeoLayer={handleFlyToGeoLayer}` to `<LeftSidebar>` (line ~1318). Verify `useGeoLayerStore` and `EXPLANATION_TOAST_MS` are already imported in App.tsx (both are used there today); import if not.

The two toast branches (null extent vs rejected fetch) are deliberately covered by the post-plan browser smoke only — the routing beneath them is pinned by the Task 3 resolver tests, and an app-level test would have to stand up the whole shell for two string assertions.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/ui/layers/LayerPanelSections.test.tsx tests/unit/app && npx tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/layers/GeoLayerRow.tsx src/ui/layers/LayerPanel.tsx src/ui/sidebar/LeftSidebar.tsx src/app/App.tsx tests/unit/ui/layers/LayerPanelSections.test.tsx
git commit -m "feat: zoom-to-layer button for GeoJSON and 3D Tiles layers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: `activeGeoLayerId` in the geo layer store

**Files:**

- Modify: `src/features/geoLayers/geoLayerStore.ts`
- Test: `tests/unit/features/geoLayers/geoLayerStore.test.ts`

**Interfaces:**

- Produces: `activeGeoLayerId: string | null` on `GeoLayerState`; `setActiveGeoLayer(id: string | null): void` on `GeoLayerActions`. `removeGeoLayer`/`removeAllGeoLayers` clear it when it pointed at a removed layer. `addGeoLayer` does NOT auto-activate.

- [ ] **Step 1: Write the failing tests** (append to `geoLayerStore.test.ts`, following its existing `store()`/`addRaster()` helpers; extend its `afterEach` reset to include `activeGeoLayerId: null`)

```ts
describe("activeGeoLayerId", () => {
  it("starts null and never auto-activates on add", () => {
    expect(store().activeGeoLayerId).toBeNull();
    addRaster();
    expect(store().activeGeoLayerId).toBeNull();
  });

  it("sets and clears through setActiveGeoLayer", () => {
    const id = addRaster();
    store().setActiveGeoLayer(id);
    expect(store().activeGeoLayerId).toBe(id);
    store().setActiveGeoLayer(null);
    expect(store().activeGeoLayerId).toBeNull();
  });

  it("clears when the active layer is removed, and only then", () => {
    const a = addRaster();
    const b = addRaster();
    store().setActiveGeoLayer(a);

    store().removeGeoLayer(b);
    expect(store().activeGeoLayerId).toBe(a);

    store().removeGeoLayer(a);
    expect(store().activeGeoLayerId).toBeNull();
  });

  it("clears on removeAllGeoLayers", () => {
    const id = addRaster();
    store().setActiveGeoLayer(id);
    store().removeAllGeoLayers();
    expect(store().activeGeoLayerId).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/features/geoLayers/geoLayerStore.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** in `geoLayerStore.ts`

Add to `GeoLayerState`:

```ts
/** The layer whose config the inspector shows — the geo mirror of
 *  `layerStore.activeLayerId`, in its own store like everything else geo.
 *  Null is a real state (nothing selected → the inspector shows the city
 *  view); NOT persisted, matching the city side. */
readonly activeGeoLayerId: string | null;
```

Add to `GeoLayerActions`: `setActiveGeoLayer: (id: string | null) => void;`

In the store creator: initial `activeGeoLayerId: null`; the action `setActiveGeoLayer: (id) => set({ activeGeoLayerId: id })`; and amend:

```ts
removeGeoLayer: (id) =>
  set((state) =>
    state.layers.some((l) => l.id === id)
      ? {
          layers: state.layers.filter((l) => l.id !== id),
          activeGeoLayerId:
            state.activeGeoLayerId === id ? null : state.activeGeoLayerId,
        }
      : state,
  ),

removeAllGeoLayers: () =>
  set((state) =>
    state.layers.length === 0 && state.activeGeoLayerId === null
      ? state
      : { layers: [], activeGeoLayerId: null },
  ),
```

Also extend the `afterEach` resets to `{ layers: [], activeGeoLayerId: null }` in EXACTLY two other files: `tests/unit/features/geoLayers/geoLayerStore.test.ts` (~line 21) and `tests/unit/ui/layers/LayerPanelSections.test.tsx` (line 28). The other `useGeoLayerStore.setState` resets (`AddLayerDialogGeospatial.test.tsx:28`, `navaraViewport.test.tsx:2366,2378`) never read the active id — leave them alone.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/features/geoLayers tests/unit/ui/layers`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/geoLayers/geoLayerStore.ts tests/unit/features/geoLayers/geoLayerStore.test.ts tests/unit/ui/layers/LayerPanelSections.test.tsx
git commit -m "feat: active geo layer selection in geoLayerStore

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: `GeoLayerInspector` component

**Files:**

- Create: `src/ui/inspector/GeoLayerInspector.tsx`
- Create: `tests/unit/ui/inspector/GeoLayerInspector.test.tsx`

**Interfaces:**

- Consumes: `GeoLayer`, `useGeoLayerStore` (`updateGeoLayer`), `GeoLayerStyle`; `KIND_BADGE`, `KIND_LABEL`, `sourceOf`, `colorInputValue` from `../layers/geoLayerMeta` (Task 5).
- Produces: `GeoLayerInspector({ layer }: { readonly layer: GeoLayer })` — the inspector body Task 9 mounts.

- [ ] **Step 1: Write the failing tests**

The style-control assertions are the SAME behaviours today pinned in `LayerPanelSections.test.tsx:225-325` — they move here (Task 10 deletes them from the row suite). New file:

```tsx
/**
 * The inspector's geo view: a selected geospatial layer's info, opacity and
 * (for a vector layer) style — the controls that used to live inline in the
 * layer row, now in the same selection-driven panel a city layer's config
 * uses.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GeoLayerInspector } from "../../../../src/ui/inspector/GeoLayerInspector";
import { useGeoLayerStore } from "../../../../src/features/geoLayers/geoLayerStore";
import type { GeoLayer } from "../../../../src/features/geoLayers/geoLayerStore";

afterEach(() => {
  cleanup();
  useGeoLayerStore.setState({ layers: [], activeGeoLayerId: null });
});

const geoStore = () => useGeoLayerStore.getState();

function addGeoJson(name = "roads"): string {
  return geoStore().addGeoLayer({
    name,
    kind: "geojson",
    config: { url: "https://x/roads.geojson" },
  });
}

function layerById(id: string): GeoLayer {
  return geoStore().layers.find((l) => l.id === id)!;
}

/** The panel hands `GeoLayerInspector` a LIVE record (InspectorPanel
 *  subscribes to the store — Task 9). A detached snapshot would go stale
 *  after the first edit, and the second edit's whole-style spread would
 *  resurrect old values — so the harness must mirror the live contract. */
function Host({ id }: { readonly id: string }) {
  const layer = useGeoLayerStore((s) => s.layers.find((l) => l.id === id));
  return layer ? <GeoLayerInspector layer={layer} /> : null;
}

function renderInspector(id: string) {
  return render(<Host id={id} />);
}

describe("GeoLayerInspector — info", () => {
  it("names the layer, its kind and its source", () => {
    const id = addGeoJson();
    renderInspector(id);

    expect(screen.getByText("roads")).toBeTruthy();
    expect(screen.getByText("GeoJSON")).toBeTruthy();
    expect(screen.getByText("https://x/roads.geojson")).toBeTruthy();
  });

  it("shows a tileset info-only — no opacity, no style", () => {
    const id = geoStore().addGeoLayer({
      name: "tiles",
      kind: "3d-tiles",
      config: { url: "https://x/tileset.json" },
    });
    renderInspector(id);

    expect(screen.getByText("3D Tiles tileset")).toBeTruthy();
    expect(screen.queryByLabelText("Opacity")).toBeNull();
    expect(screen.queryByLabelText("Layer color")).toBeNull();
  });
});

describe("GeoLayerInspector — opacity", () => {
  it("offers the opacity slider for raster and pushes it to the store", () => {
    const id = geoStore().addGeoLayer({
      name: "OSM",
      kind: "raster-xyz",
      config: { urlTemplate: "https://tile.example/{z}/{x}/{y}.png" },
    });
    renderInspector(id);

    expect(screen.queryByLabelText("Layer color")).toBeNull();
    fireEvent.change(screen.getByLabelText("Opacity"), {
      target: { value: "0.4" },
    });
    expect(layerById(id).opacity).toBeCloseTo(0.4);
  });

  it("fades a vector layer through the same slider", () => {
    const id = addGeoJson();
    renderInspector(id);

    fireEvent.change(screen.getByLabelText("Opacity"), {
      target: { value: "0.3" },
    });
    expect(layerById(id).opacity).toBeCloseTo(0.3);
  });
});

describe("GeoLayerInspector — a vector layer's style", () => {
  it("offers colour, point size, line width and fill opacity", () => {
    const id = addGeoJson();
    renderInspector(id);

    const color = screen.getByLabelText("Layer color") as HTMLInputElement;
    expect(color.type).toBe("color");
    expect(screen.getByLabelText("Point size")).toBeTruthy();
    expect(screen.getByLabelText("Line width")).toBeTruthy();
    expect(screen.getByLabelText("Fill opacity")).toBeTruthy();
  });

  it("writes a colour edit through as a FRESH style object", () => {
    const id = addGeoJson();
    renderInspector(id);

    const before = layerById(id).style;
    fireEvent.change(screen.getByLabelText("Layer color"), {
      target: { value: "#00ff00" },
    });

    const after = layerById(id).style;
    expect(after.color).toBe("#00ff00");
    expect(after).not.toBe(before);
    expect(after.pointSizePx).toBe(before.pointSizePx);
    expect(after.lineWidthPx).toBe(before.lineWidthPx);
  });

  it("commits point size and line width as numbers", () => {
    const id = addGeoJson();
    renderInspector(id);

    fireEvent.change(screen.getByLabelText("Point size"), {
      target: { value: "8" },
    });
    fireEvent.change(screen.getByLabelText("Line width"), {
      target: { value: "5" },
    });

    expect(layerById(id).style.pointSizePx).toBe(8);
    expect(layerById(id).style.lineWidthPx).toBe(5);
  });

  it("leaves the size alone while its box is empty mid-edit", () => {
    const id = addGeoJson();
    renderInspector(id);

    fireEvent.change(screen.getByLabelText("Point size"), {
      target: { value: "8" },
    });
    fireEvent.change(screen.getByLabelText("Point size"), {
      target: { value: "" },
    });

    expect(layerById(id).style.pointSizePx).toBe(8);
  });

  it("commits fill opacity from its own slider, leaving layer opacity alone", () => {
    const id = addGeoJson();
    renderInspector(id);

    fireEvent.change(screen.getByLabelText("Fill opacity"), {
      target: { value: "0.25" },
    });

    expect(layerById(id).style.fillOpacity).toBeCloseTo(0.25);
    expect(layerById(id).opacity).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/ui/inspector/GeoLayerInspector.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `GeoLayerInspector.tsx`**

The style/opacity control JSX moves from `GeoLayerRow.tsx` largely verbatim (same aria-labels, same `editStyle` whole-object spread, same empty-string mid-edit guards, same `colorInputValue`), no `<details>` wrapper — in a panel there is room, so the controls render flat under headings:

```tsx
/**
 * The inspector's view of a SELECTED geospatial layer — the geo mirror of the
 * city tabs, one panel instead of five: a geo layer has no objects, surfaces
 * or rules, so what remains is what it is (name, kind, source) and how it is
 * drawn (opacity; for a vector layer the flat per-layer style). The controls
 * moved here from the layer row so both kinds of layer share one mental
 * model: click a row on the left, configure it on the right.
 */
import {
  useGeoLayerStore,
  type GeoLayer,
} from "../../features/geoLayers/geoLayerStore";
import type { GeoLayerStyle } from "../../features/geoLayers/geoLayerStyle";
import {
  KIND_BADGE,
  KIND_LABEL,
  colorInputValue,
  sourceOf,
} from "../layers/geoLayerMeta";

export function GeoLayerInspector({ layer }: { readonly layer: GeoLayer }) {
  const updateGeoLayer = useGeoLayerStore((s) => s.updateGeoLayer);

  /** One edited field at a time, but the store takes the WHOLE style — see
   *  `GeoLayerPatch.style`. */
  const editStyle = (patch: Partial<GeoLayerStyle>) =>
    updateGeoLayer(layer.id, { style: { ...layer.style, ...patch } });

  return (
    <div className="geo-inspector">
      <div className="attr-section">
        <div className="attr-section-title">
          <span>Layer</span>
          <span className="layer-badge-geo" title={KIND_LABEL[layer.kind]}>
            {KIND_BADGE[layer.kind]}
          </span>
        </div>
        <div className="attr-row">
          <span className="attr-key">Name</span>
          <span className="attr-value">{layer.name}</span>
        </div>
        <div className="attr-row">
          <span className="attr-key">Kind</span>
          <span className="attr-value">{KIND_LABEL[layer.kind]}</span>
        </div>
        <div className="attr-row">
          <span className="attr-key">Source</span>
          <span className="attr-value geo-inspector-source">
            {sourceOf(layer)}
          </span>
        </div>
      </div>

      {/* A tileset's appearance comes from the tiles' own materials — no
          opacity, no style (same reasoning as the old row controls). */}
      {(layer.kind === "raster-xyz" || layer.kind === "geojson") && (
        <div className="attr-section">
          <div className="attr-section-title">
            <span>Opacity</span>
          </div>
          <input
            className="geo-opacity-slider"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={layer.opacity}
            aria-label="Opacity"
            title={`Opacity — ${Math.round(layer.opacity * 100)}%`}
            onChange={(e) =>
              updateGeoLayer(layer.id, { opacity: Number(e.target.value) })
            }
          />
        </div>
      )}

      {layer.kind === "geojson" && (
        <div className="attr-section">
          <div className="attr-section-title">
            <span>Style</span>
          </div>
          <div className="geo-style-fields">
            {/* …the four labelled controls exactly as they exist in
                GeoLayerRow.tsx lines 213-275 today: Color, Point size,
                Line width, Fill opacity — same aria-labels, same guards,
                copied verbatim… */}
          </div>
        </div>
      )}
    </div>
  );
}
```

Copy the four style `<label>` blocks from `GeoLayerRow.tsx:213-275` verbatim into the Style section (they are not shown again here to avoid divergence — the row file is the source).

Then in `src/app/app.css`: the reused classes (`geo-style-fields/-field/-color/-number/-slider`, `geo-opacity-slider`, `layer-badge-geo`) are flat selectors and survive the move as-is — but their WIDTHS are sized for a 240 px row (`.geo-opacity-slider`/`.geo-style-number`/`.geo-style-slider` are ~3.5rem, app.css ~2562-2570). Add inspector-scoped overrides rather than reusing row widths:

```css
.geo-inspector .geo-opacity-slider,
.geo-inspector .geo-style-slider {
  width: 100%;
}
.geo-inspector .geo-style-number {
  width: 4.5rem;
}
.geo-inspector-source {
  word-break: break-all;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/ui/inspector/GeoLayerInspector.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/inspector/GeoLayerInspector.tsx tests/unit/ui/inspector/GeoLayerInspector.test.tsx src/app/app.css
git commit -m "feat: GeoLayerInspector — a selected geo layer's info, opacity and style

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Selection wiring — clickable geo rows, inspector switch, pick-follow

**Files:**

- Modify: `src/ui/layers/GeoLayerRow.tsx` (clickable + active class), `src/ui/layers/LayerPanel.tsx` (city click clears geo active), `src/ui/inspector/InspectorPanel.tsx` (geo mode), `src/app/App.tsx` (pick-follow effects), `src/app/app.css` (cursor + comment)
- Test: `tests/unit/ui/layers/LayerPanelSections.test.tsx`, `tests/unit/ui/inspector/InspectorPanel.test.tsx`

**Interfaces:**

- Consumes: `activeGeoLayerId`/`setActiveGeoLayer` (Task 7), `GeoLayerInspector` (Task 8), `selectionStore.geoSelection` (existing).
- Produces: no new exported API — behaviour only.

- [ ] **Step 1: Write the failing tests**

In `LayerPanelSections.test.tsx`, new describe:

```tsx
describe("LayerPanel — selecting a geospatial layer", () => {
  it("activates the layer on row click and marks the row", () => {
    const id = addGeoJson();
    renderPanel();

    fireEvent.click(geoRows()[0]!);

    expect(geoStore().activeGeoLayerId).toBe(id);
    expect(geoRows()[0]!.className).toContain("layer-active");
  });

  it("clicking a city row hands the selection back to the city side", () => {
    addCityLayer("Delft");
    const id = addGeoJson();
    renderPanel();

    fireEvent.click(geoRows()[0]!);
    expect(geoStore().activeGeoLayerId).toBe(id);

    fireEvent.click(screen.getByText("Delft"));
    expect(geoStore().activeGeoLayerId).toBeNull();
  });
});
```

In `tests/unit/ui/inspector/InspectorPanel.test.tsx` — there is NO shared render helper: every existing test calls `render(<InspectorPanel selections={[]} onClose={() => {}} />)` inline, so do the same (replace `renderInspectorPanel()` below with that inline call). Extend the file's existing `afterEach` (~line 60, which resets `useLayerStore`/`useStreamStore`) with `useGeoLayerStore.setState({ layers: [], activeGeoLayerId: null })`; `act` is already imported in that file. Add:

```tsx
describe("InspectorPanel — geo layer mode", () => {
  it("shows the geo layer view instead of the city tabs while a geo layer is active", () => {
    const id = useGeoLayerStore.getState().addGeoLayer({
      name: "roads",
      kind: "geojson",
      config: { url: "https://x/roads.geojson" },
    });
    useGeoLayerStore.getState().setActiveGeoLayer(id);

    renderInspectorPanel(); // the suite's existing helper, selections: []

    expect(screen.getByText("roads")).toBeTruthy();
    expect(screen.getByLabelText("Layer color")).toBeTruthy();
    // The city tab strip is not offered for a geo layer.
    expect(screen.queryByRole("button", { name: "Rules" })).toBeNull();
  });

  it("returns to the city view when the geo selection clears", () => {
    const id = useGeoLayerStore.getState().addGeoLayer({
      name: "roads",
      kind: "geojson",
      config: { url: "https://x/roads.geojson" },
    });
    useGeoLayerStore.getState().setActiveGeoLayer(id);
    renderInspectorPanel();

    act(() => {
      useGeoLayerStore.getState().setActiveGeoLayer(null);
    });

    expect(screen.queryByLabelText("Layer color")).toBeNull();
    expect(screen.getByRole("button", { name: "Rules" })).toBeTruthy();
  });
});
```

Adapt tab-button queries to how the suite already asserts tabs (they are plain `<button className="inspector-tab">Rules</button>` — `getByRole("button", { name: "Rules" })` works).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/ui/layers/LayerPanelSections.test.tsx tests/unit/ui/inspector/InspectorPanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

1. `GeoLayerRow.tsx`: subscribe and activate —

```tsx
const activeGeoLayerId = useGeoLayerStore((s) => s.activeGeoLayerId);
const setActiveGeoLayer = useGeoLayerStore((s) => s.setActiveGeoLayer);
const isActive = layer.id === activeGeoLayerId;
```

Root div gains the click and the class (visibility/remove/zoom buttons already `stopPropagation` or should now — add `e.stopPropagation()` to the visibility and remove handlers, matching the city row):

```tsx
<div
  className={`layer-item geo-layer-item ${isActive ? "layer-active" : ""} ${layer.visible ? "" : "layer-hidden"}`}
  data-testid="geo-layer-row"
  onClick={() => setActiveGeoLayer(layer.id)}
>
```

Also stop propagation in the rename input/span like the city row does (`onClick={(e) => e.stopPropagation()}` on the input; the double-click span handler adds `e.stopPropagation()`). The opacity slider and the `<details className="geo-style">` survive in the row until Task 10 — give the slider and the `<summary>` an `onClick={(e) => e.stopPropagation()}` too, so dragging or toggling them doesn't double as layer selection in this intermediate commit (Task 10 deletes both anyway).

2. `LayerPanel.tsx`: in the CITY row's `onClick` (line ~111), clear the geo side:

```tsx
const setActiveGeoLayer = useGeoLayerStore((s) => s.setActiveGeoLayer);
…
onClick={() => {
  setActiveLayer(layer.id);
  // One selection across both sections: a city pick hands the inspector
  // back to the city view.
  setActiveGeoLayer(null);
}}
```

3. `InspectorPanel.tsx`: subscribe near the other store reads (BEFORE any conditional return — hook order):

```tsx
const geoLayers = useGeoLayerStore((s) => s.layers);
const activeGeoLayerId = useGeoLayerStore((s) => s.activeGeoLayerId);
const activeGeoLayer = geoLayers.find((l) => l.id === activeGeoLayerId) ?? null;
```

In the returned JSX, keep the `inspector-header` as is and branch under it:

```tsx
{
  activeGeoLayer ? (
    <div className="inspector-body">
      <ErrorBoundary fallback="inline" key={activeGeoLayer.id}>
        <GeoLayerInspector layer={activeGeoLayer} />
      </ErrorBoundary>
    </div>
  ) : (
    <>{/* existing tab strip + inspector-body, unchanged */}</>
  );
}
```

(All existing hooks keep running unconditionally; only the render branches.)

4. `App.tsx`: follow viewport picks — place near the other selection-derived code:

```tsx
const setActiveGeoLayer = useGeoLayerStore((s) => s.setActiveGeoLayer);

// The inspector follows viewport picks on both sides: a picked geo feature
// selects its layer; a picked city object hands the panel back.
useEffect(() => {
  if (geoSelection) setActiveGeoLayer(geoSelection.geoLayerId);
}, [geoSelection, setActiveGeoLayer]);
useEffect(() => {
  if (selections.length > 0) setActiveGeoLayer(null);
}, [selections, setActiveGeoLayer]);
```

(Verify `geoSelection` and `selections` are the names already in scope in App.tsx — they are, per lines 1239/1255.)

5. `app.css` (~line 2544): replace

```css
/* Not clickable as a whole, unlike a city-model row: there is no "active"
   geospatial layer for the inspector to follow. */
.geo-layer-item {
  cursor: default;
}
```

with

```css
/* Clickable like a city-model row: the inspector follows the active
   geospatial layer (geoLayerStore.activeGeoLayerId). */
.geo-layer-item {
  cursor: pointer;
}
```

(Adapt to the file's exact current text.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/ui tests/unit/features && npx tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/layers/GeoLayerRow.tsx src/ui/layers/LayerPanel.tsx src/ui/inspector/InspectorPanel.tsx src/app/App.tsx src/app/app.css tests/unit/ui/layers/LayerPanelSections.test.tsx tests/unit/ui/inspector/InspectorPanel.test.tsx
git commit -m "feat: geo layers join the selection model — click a row, configure in the inspector

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Slim the geo row — style and opacity leave for the inspector

**Files:**

- Modify: `src/ui/layers/GeoLayerRow.tsx`
- Test: `tests/unit/ui/layers/LayerPanelSections.test.tsx`

**Interfaces:**

- Consumes: nothing new. The row keeps: visibility, rename, kind badge, zoom, remove, re-link.

- [ ] **Step 1: Update the tests to the new contract (failing first)**

In `LayerPanelSections.test.tsx`:

- DELETE the describe `"LayerPanel — a vector row's style controls"` entirely (those behaviours are pinned in `GeoLayerInspector.test.tsx` since Task 8).
- DELETE the raster-row test `"offers an opacity slider for a raster layer and pushes it to the store"`.
- ADD to the `"LayerPanel — a geospatial row"` describe:

```tsx
it("keeps the row lean — no style or opacity controls inline", () => {
  addGeoJson();
  renderPanel();

  const row = within(geoRows()[0]!);
  expect(row.queryByLabelText("Opacity")).toBeNull();
  expect(row.queryByLabelText("Layer color")).toBeNull();
  expect(row.queryByLabelText("Point size")).toBeNull();
  expect(row.queryByLabelText("Line width")).toBeNull();
  expect(row.queryByLabelText("Fill opacity")).toBeNull();
  expect(row.queryByText("Style")).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify the new one fails**

Run: `npx vitest run tests/unit/ui/layers/LayerPanelSections.test.tsx`
Expected: the new test FAILS (controls still present); deleted tests gone.

- [ ] **Step 3: Implement**

In `GeoLayerRow.tsx`, delete: the opacity `<input className="geo-opacity-slider">` block (lines ~166-180), the whole `<details className="geo-style">` block (lines ~209-278), the now-unused `editStyle` helper and the now-unused imports (`colorInputValue` usage, `GeoLayerStyle` type, etc. — let `tsc` and lint report exactly which). Update the component doc comment: the row is now identity + visibility + zoom + remove; drawing config lives in the inspector (`GeoLayerInspector`).

In `src/app/app.css`, delete the two rules the `<details>` removal orphans: `.geo-style` (~line 2575) and `.geo-style-summary` (~lines 2580, 2588). Do NOT touch `.geo-style-fields` and friends — the inspector still uses them (Task 8).

- [ ] **Step 4: Run tests + typecheck to verify**

Run: `npx vitest run tests/unit/ui && npx tsc -b --noEmit`
Expected: PASS, no unused-import errors.

- [ ] **Step 5: Commit**

```bash
git add src/ui/layers/GeoLayerRow.tsx src/app/app.css tests/unit/ui/layers/LayerPanelSections.test.tsx
git commit -m "refactor: geo row slims to identity and actions; config lives in the inspector

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Docs + full verification

**Files:**

- Modify: `CLAUDE.md`, `docs/roadmap.md` (if it tracks M10 follow-ups)

- [ ] **Step 1: Update CLAUDE.md**

1. The `CitySceneHandle` bullet: add `fitBounds` to the listed surface (`fitAll`, `fitLayer`, `fitBounds`, `alignView`, …) with a clause: "`fitBounds` takes caller-supplied `GeodeticBounds` — the geo-layer zoom, whose extents `features/geoLayers/geoLayerBounds.ts` computes (GeoJSON walk / tileset root volume; raster has none)".
2. The "Geospatial layers are the MIRROR IMAGE" paragraph — update the **Styling** and **UI** sentences: styling is still per-layer through `geoLayerStyle.ts`, but the CONTROLS live in the right InspectorPanel's geo view (`GeoLayerInspector`), driven by `geoLayerStore.activeGeoLayerId` (geo rows are clickable now); the row keeps visibility/rename/zoom/remove; GeoJSON + 3D Tiles rows have "Zoom to layer", raster does not (no intrinsic extent).
3. `src/features/geoLayers/` structure comment: add `geoLayerBounds` to the listed modules.

- [ ] **Step 2: Update roadmap if applicable**

Read `docs/roadmap.md`; if Milestone 10 has a follow-ups/state section, note the two shipped improvements. If not, skip.

- [ ] **Step 3: Full verification**

Run: `npx tsc -b --noEmit && npx vitest run`
Expected: 0 type errors, 0 failed test files. If anything fails, fix before committing.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/roadmap.md
git commit -m "docs: record geo-layer zoom and inspector-hosted geo config

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Known precondition (documented, not fixed here)

Both features live inside the viewer shell, which `App.tsx:1273` gates on `hasLayers || engineBooting` — and `hasLayers` counts CITY layers only. A workspace holding only geospatial layers still shows the landing page, so neither the zoom button nor the geo inspector is reachable there. This is the pre-existing "geo-only session" gap (tracked as a Milestone-10 follow-up), deliberately out of scope for this plan.

## Post-plan checks (for the orchestrator, not a task)

- Browser smoke (optional, needs the dev server + agent-browser): **load a city layer first** (the shell gate above), then add a GeoJSON URL layer, click its zoom button, confirm the flight; click the row, confirm the inspector swaps to the geo view and a colour edit recolours the drape; click a city row, confirm the inspector returns.
- The pre-existing `LayerPanel.test.tsx` (streaming badge suite) passes untouched.
