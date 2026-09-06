/**
 * Snapshot v4 and its ONE migration.
 *
 * v4 adds a single field — `activeLayer`, the index of the layer the
 * workspace was looking at — and adds nothing else, which is exactly why v3
 * migrates rather than being rejected: a v3 document is a v4 document with
 * that field absent, and absent already means "the first layer in unified
 * order". v1/v2 stay unsupported for the reason they always were, and the
 * reason no migration can help them: their cameras are scene-space tuples
 * measured from a mesh frame that no longer exists.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { captureSnapshot } from "../../../src/persistence/captureSnapshot";
import { migrateSnapshot } from "../../../src/persistence/migrateSnapshot";
import { restoreSnapshot } from "../../../src/persistence/restoreSnapshot";
import {
  SNAPSHOT_VERSION,
  UnsupportedSnapshotVersionError,
  type GeographicCamera,
  type ProjectSnapshot,
} from "../../../src/persistence/types";
import { useSolarStore } from "../../../src/features/solar/solarStore";

const CAM: GeographicCamera = {
  lng: 4.3571,
  lat: 52.0116,
  height: 800,
  heading: 30,
  pitch: -45,
  roll: 0,
};

/** A complete, current-version document, written the way the app writes one. */
function v4(activeLayer?: ProjectSnapshot["activeLayer"]): ProjectSnapshot {
  return captureSnapshot({
    label: "delft",
    layers: [],
    camera: CAM,
    datetime: new Date("2025-06-21T12:00:00Z"),
    pickMode: "object",
    activeLayer,
  });
}

/** The same document as a v3 build would have written it: no `activeLayer`,
 *  and the older version string. */
function v3(): ProjectSnapshot {
  return { ...v4(), version: "3" };
}

beforeEach(() => {
  useSolarStore.setState({
    datetime: new Date(Date.UTC(2025, 5, 21, 12, 0, 0)),
    latLon: null,
    sunPosition: null,
  });
});

describe("SNAPSHOT_VERSION", () => {
  it("is 4", () => {
    expect(SNAPSHOT_VERSION).toBe("4");
    expect(v4().version).toBe("4");
  });
});

describe("captureSnapshot / restoreSnapshot round trip of the active layer", () => {
  it("writes a city active layer and hands it back on restore", () => {
    const snapshot = v4({ kind: "city", index: 1 });
    expect(snapshot.activeLayer).toEqual({ kind: "city", index: 1 });
    expect(restoreSnapshot(snapshot).activeLayer).toEqual({
      kind: "city",
      index: 1,
    });
  });

  it("writes a geo active layer just as faithfully — the index is per-kind", () => {
    const snapshot = v4({ kind: "geo", index: 0 });
    expect(snapshot.activeLayer).toEqual({ kind: "geo", index: 0 });
    expect(restoreSnapshot(snapshot).activeLayer).toEqual({
      kind: "geo",
      index: 0,
    });
  });

  it("omits the field entirely when no layer is active, rather than writing a placeholder index", () => {
    const snapshot = v4();
    expect("activeLayer" in snapshot).toBe(false);
    expect(restoreSnapshot(snapshot).activeLayer).toBeUndefined();
  });

  it("survives the JSON round trip localStorage actually performs", () => {
    const snapshot = v4({ kind: "city", index: 2 });
    const parsed = JSON.parse(JSON.stringify(snapshot)) as ProjectSnapshot;
    const { viewState, activeLayer } = restoreSnapshot(parsed);
    expect(activeLayer).toEqual({ kind: "city", index: 2 });
    expect(viewState.camera).toEqual(CAM);
  });
});

describe("migrateSnapshot", () => {
  it("passes a v4 document through untouched", () => {
    const snapshot = v4({ kind: "city", index: 1 });
    const outcome = migrateSnapshot(snapshot);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.migratedFrom).toBeNull();
    expect(outcome.snapshot).toBe(snapshot);
  });

  it("migrates a v3 document, saying where it came from", () => {
    const outcome = migrateSnapshot(v3());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.migratedFrom).toBe("3");
    expect(outcome.snapshot.version).toBe("4");
  });

  it("leaves `activeLayer` absent on a migrated v3 document — absent means the first layer", () => {
    const outcome = migrateSnapshot(v3());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.snapshot.activeLayer).toBeUndefined();
  });

  it("does not mutate the document it was handed", () => {
    const original = v3();
    migrateSnapshot(original);
    expect(original.version).toBe("3");
  });

  it("rejects v2 with the unsupported-version error, naming the version it found", () => {
    const outcome = migrateSnapshot({ ...v3(), version: "2" });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toBeInstanceOf(UnsupportedSnapshotVersionError);
    expect(outcome.error.found).toBe("2");
  });

  it("rejects v1 and a document with no version at all", () => {
    const v1 = migrateSnapshot({ ...v3(), version: "1" });
    expect(v1.ok).toBe(false);
    const none = migrateSnapshot({
      ...v3(),
      version: undefined,
    } as unknown as ProjectSnapshot);
    expect(none.ok).toBe(false);
    if (none.ok) return;
    expect(none.error.found).toBe("unknown");
  });
});

describe("restoreSnapshot's version gate, through the migration", () => {
  it("accepts a v3 document now that it migrates", () => {
    expect(() => restoreSnapshot(v3())).not.toThrow();
    expect(restoreSnapshot(v3()).activeLayer).toBeUndefined();
  });

  it("still rejects a v2 document with UnsupportedSnapshotVersionError", () => {
    expect(() => restoreSnapshot({ ...v3(), version: "2" })).toThrow(
      UnsupportedSnapshotVersionError,
    );
  });

  it("writes nothing to the stores when it rejects", () => {
    const before = useSolarStore.getState().datetime;
    expect(() => restoreSnapshot({ ...v3(), version: "2" })).toThrow();
    expect(useSolarStore.getState().datetime).toBe(before);
  });
});
