/**
 * §8: "A derived layer … is not saved either: the snapshot omits it entirely
 * (it is skipped when the active-layer index and the layer order are written,
 * so nothing refers to it), Save shows the existing toast plus '1 derived
 * layer is not saved; export it to keep it'."
 *
 * The INDEX is the whole reason this file exists. `App` writes `activeLayer` as
 * a per-kind index into the arrays it is writing, so filtering the arrays
 * without recomputing the index silently activates the wrong layer on restore.
 *
 * Pure: `snapshotLayers` takes two lists and an id and answers what to write,
 * so nothing here mounts the shell. The same decision reaching BOTH the save
 * and the share link is pinned against the real `App` in
 * `appDerivedLayers.test.tsx`.
 */
import { describe, expect, it } from "vitest";
import type { DerivedFrom } from "../../../src/features/layers/layerStore";
import {
  derivedNotSavedNote,
  snapshotLayers,
} from "../../../src/app/snapshotLayers";

/**
 * `snapshotLayers` is STRUCTURALLY typed over `{ id, derivedFrom }`, so the
 * fixture is a real record of that shape and not a cast: `as never` would make
 * `L` infer as `never`, and every `out.layers.map((l) => l.name)` below would
 * then be reading a property off it.
 */
interface Row {
  readonly id: string;
  readonly name: string;
  readonly derivedFrom: DerivedFrom | null;
}

const city = (name: string, derived: boolean): Row => ({
  id: name,
  name,
  derivedFrom: derived
    ? { layerId: "p", layerName: "Delft", runId: "run_1" }
    : null,
});

describe("snapshotLayers", () => {
  it("omits every derived layer from both arrays", () => {
    const out = snapshotLayers({
      layers: [city("Delft", false), city("Delft · solids", true)],
      geoLayers: [city("Zones", false), city("Zones · buildings", true)],
      activeLayerId: "Delft",
    });
    expect(out.layers.map((l) => l.name)).toEqual(["Delft"]);
    expect(out.geoLayers.map((l) => l.name)).toEqual(["Zones"]);
    expect(out.derivedCount).toBe(2);
  });

  it("repoints the active index at the FILTERED array", () => {
    // Rotterdam is index 2 of three layers and index 1 of the two that are
    // saved. An index taken before the filter would restore Delft.
    const out = snapshotLayers({
      layers: [
        city("Delft", false),
        city("Delft · solids", true),
        city("Rotterdam", false),
      ],
      geoLayers: [],
      activeLayerId: "Rotterdam",
    });
    expect(out.activeLayer).toEqual({ kind: "city", index: 1 });
  });

  it("repoints a GEO active index the same way", () => {
    const out = snapshotLayers({
      layers: [city("Delft", false)],
      geoLayers: [
        city("Zones", false),
        city("Zones · buildings", true),
        city("Districts", false),
      ],
      activeLayerId: "Districts",
    });
    expect(out.activeLayer).toEqual({ kind: "geo", index: 1 });
  });

  it("omits the active reference entirely when the active layer is derived", () => {
    // "nothing refers to it" (§8). An absent `activeLayer` restores the first
    // layer, which is the existing fallback.
    const out = snapshotLayers({
      layers: [city("Delft", false), city("Delft · solids", true)],
      geoLayers: [],
      activeLayerId: "Delft · solids",
    });
    expect(out.activeLayer).toBeUndefined();
  });

  it("counts nothing when no layer is derived", () => {
    const out = snapshotLayers({
      layers: [city("Delft", false)],
      geoLayers: [],
      activeLayerId: "Delft",
    });
    expect(out.derivedCount).toBe(0);
    expect(out.activeLayer).toEqual({ kind: "city", index: 0 });
  });

  it("omits the reference when NOTHING is active", () => {
    // `activeLayerId: null` is not "the first layer": the snapshot simply
    // carries no reference, which restores the existing first-layer fallback.
    // This is the shape the implementation returns, and the assertion is here
    // so a future `?? 0` cannot slip in unnoticed.
    const out = snapshotLayers({
      layers: [city("Delft", false)],
      geoLayers: [],
      activeLayerId: null,
    });
    expect(out.activeLayer).toBeUndefined();
  });

  it("hands the caller the SAME records it was given", () => {
    // The filter is the only thing this function does to a row: `App` maps
    // each one into its own snapshot shape afterwards, and a copy made here
    // would be a second place a field could be dropped.
    const delft = city("Delft", false);
    const out = snapshotLayers({
      layers: [delft, city("Delft · solids", true)],
      geoLayers: [],
      activeLayerId: null,
    });
    expect(out.layers[0]).toBe(delft);
  });
});

describe("the Save toast's extra sentence", () => {
  it("is §8's, verbatim, for one derived layer", () => {
    expect(derivedNotSavedNote(1)).toBe(
      "1 derived layer is not saved; export it to keep it",
    );
  });

  it("is null when nothing was skipped", () => {
    expect(derivedNotSavedNote(0)).toBeNull();
  });

  it("pluralises for more than one [adapted copy A16]", () => {
    expect(derivedNotSavedNote(2)).toBe(
      "2 derived layers are not saved; export them to keep them",
    );
  });
});
