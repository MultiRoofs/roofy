/**
 * Snapshot v5: which object families a streamed CityParquet layer had open, and
 * which one its table panel was showing (ruling S4).
 *
 * v5 adds one optional field per layer, so v3 and v4 both migrate rather than
 * being rejected: a document without it restores at the R-D default (Building
 * alone, or every family when the package has no building table), which is
 * exactly what those builds did.
 *
 * What is NOT trusted here: the saved keys. A package can be repackaged between
 * the save and the restore, so a key that no longer exists is dropped, and a
 * choice that survives as nothing at all falls back to the default rather than
 * opening a layer with no geometry.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureSnapshot } from "../../../src/persistence/captureSnapshot";
import { migrateSnapshot } from "../../../src/persistence/migrateSnapshot";
import {
  normalizeLayers,
  SNAPSHOT_VERSION,
  type GeographicCamera,
  type LayerSnapshot,
  type ProjectSnapshot,
} from "../../../src/persistence/types";
import { useSolarStore } from "../../../src/features/solar/solarStore";

vi.mock("../../../src/insights/familyViews", () => ({
  ensureFamilyView: vi.fn(async () => ({ ok: true }) as const),
  dropFamilyView: vi.fn(async () => {}),
  dropFamilyViews: vi.fn(async () => {}),
}));
vi.mock("../../../src/features/cityparquet/familySourceCrs", () => ({
  familySourceCrs: vi.fn(async () => "EPSG:6697"),
}));

const {
  buildLayerFamilies,
  restoredFamilyChoice,
  useFamilyStore,
  familiesSnapshotOf,
} = await import("../../../src/features/layers/familyStore");

const CAM: GeographicCamera = {
  lng: 4.3571,
  lat: 52.0116,
  height: 800,
  heading: 30,
  pitch: -45,
  roll: 0,
};

function snapshot(layers: ReadonlyArray<LayerSnapshot> = []): ProjectSnapshot {
  return captureSnapshot({
    label: "yokohama",
    layers,
    camera: CAM,
    datetime: new Date("2025-06-21T12:00:00Z"),
    pickMode: "object",
  });
}

function families() {
  return buildLayerFamilies([
    {
      key: "building",
      href: "building.parquet",
      size: null,
      source: { url: "https://x/building.parquet" },
    },
    {
      key: "bridge",
      href: "bridge.parquet",
      size: null,
      source: { url: "https://x/bridge.parquet" },
    },
  ]);
}

beforeEach(() => {
  useSolarStore.setState({
    datetime: new Date(Date.UTC(2025, 5, 21, 12, 0, 0)),
    latLon: null,
    sunPosition: null,
  });
  useFamilyStore.setState({ layers: {} });
});

describe("SNAPSHOT_VERSION", () => {
  it("is 5", () => {
    expect(SNAPSHOT_VERSION).toBe("5");
    expect(snapshot().version).toBe("5");
  });
});

describe("migrateSnapshot", () => {
  it("carries a v4 document forward — its layers simply had no family choice", () => {
    const outcome = migrateSnapshot({ ...snapshot(), version: "4" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.migratedFrom).toBe("4");
    expect(outcome.snapshot.version).toBe("5");
  });

  it("still carries a v3 document forward", () => {
    const outcome = migrateSnapshot({ ...snapshot(), version: "3" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.migratedFrom).toBe("3");
    expect(outcome.snapshot.version).toBe("5");
  });

  it("passes a v5 document through untouched", () => {
    const document = snapshot();
    const outcome = migrateSnapshot(document);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.snapshot).toBe(document);
  });
});

describe("the saved family choice", () => {
  it("round-trips through a layer snapshot", () => {
    const [restored] = normalizeLayers({
      layers: [
        {
          name: "yokohama",
          modelRef: { type: "url", url: "https://x/" },
          rules: [],
          rulesEnabled: false,
          visible: true,
          families: { enabled: ["building", "bridge"], active: "bridge" },
        },
      ],
    });
    expect(restored!.families).toEqual({
      enabled: ["building", "bridge"],
      active: "bridge",
    });
  });

  it("drops a hand-edited or truncated choice rather than restoring nonsense", () => {
    const [restored] = normalizeLayers({
      layers: [{ families: { enabled: [1, "", null], active: 7 } as never }],
    });
    expect(restored!.families).toBeUndefined();
  });

  it("is absent for a layer that never had families", () => {
    const [restored] = normalizeLayers({ layers: [{ name: "delft" }] });
    expect(restored!.families).toBeUndefined();
  });

  it("reads a live layer's own choice for capture", () => {
    useFamilyStore.getState().setFamilies("L", families());
    useFamilyStore.getState().setActiveFamily("L", "bridge");
    expect(familiesSnapshotOf("L")).toEqual({
      enabled: ["building"],
      active: "bridge",
    });
    expect(familiesSnapshotOf("nope")).toBeUndefined();
  });
});

describe("restoredFamilyChoice", () => {
  it("reopens exactly the families the user had, and returns to their family", () => {
    expect(
      restoredFamilyChoice(families(), {
        enabled: ["bridge", "building"],
        active: "bridge",
      }),
    ).toEqual({ enabled: ["bridge", "building"], active: "bridge" });
  });

  it("drops keys the package no longer has", () => {
    expect(
      restoredFamilyChoice(families(), {
        enabled: ["building", "tunnel"],
        active: "tunnel",
      }),
    ).toEqual({ enabled: ["building"], active: null });
  });

  it("falls back to the R-D default when nothing saved survives", () => {
    // A repackaged source: opening nothing would leave a layer with no
    // geometry and no stream at all.
    expect(
      restoredFamilyChoice(families(), {
        enabled: ["tunnel"],
        active: "tunnel",
      }),
    ).toEqual({ enabled: undefined, active: null });
  });

  it("has no opinion when nothing was saved", () => {
    expect(restoredFamilyChoice(families(), undefined)).toEqual({
      enabled: undefined,
      active: null,
    });
  });
});
