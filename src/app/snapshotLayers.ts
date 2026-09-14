/**
 * WHICH layers a snapshot holds, and what its active-layer reference points at
 * (spec §8).
 *
 * Extracted from `App`'s save callback because the two answers are ONE
 * decision: `ProjectSnapshot.activeLayer` is a per-kind INDEX into the very
 * arrays written beside it, so filtering the arrays and computing the index are
 * a single step — done in two places they drift, and the symptom is a restore
 * that silently opens the wrong layer.
 *
 * It is also the ONE place the derived-layer filter is decided, for BOTH doors
 * out of the workspace: the saved snapshot and the share link. A share hash
 * carries no active reference and no geo layers (it is a lightweight subset —
 * `ShareableViewState`), so that caller reads `layers` only; the filter it
 * reads is the same one.
 *
 * Pure: it takes the two lists and the active id and returns what to write.
 * STRUCTURALLY typed over `{ id, derivedFrom }` rather than over `Layer` and
 * `GeoLayer`, so `App` keeps handing it the records it already holds and the
 * test can hand it two fields.
 */

export interface SnapshotLayerSelection<L, G> {
  readonly layers: ReadonlyArray<L>;
  readonly geoLayers: ReadonlyArray<G>;
  /** `undefined` when nothing is active OR the active layer is derived. */
  readonly activeLayer:
    | { readonly kind: "city" | "geo"; readonly index: number }
    | undefined;
  /** How many layers were skipped, for the Save toast. */
  readonly derivedCount: number;
}

export function snapshotLayers<
  L extends { id: string; derivedFrom: unknown },
  G extends { id: string; derivedFrom: unknown },
>(input: {
  readonly layers: ReadonlyArray<L>;
  readonly geoLayers: ReadonlyArray<G>;
  readonly activeLayerId: string | null;
}): SnapshotLayerSelection<L, G> {
  const layers = input.layers.filter((l) => l.derivedFrom == null);
  const geoLayers = input.geoLayers.filter((l) => l.derivedFrom == null);
  const derivedCount =
    input.layers.length -
    layers.length +
    (input.geoLayers.length - geoLayers.length);
  const id = input.activeLayerId;
  // Searched in the FILTERED arrays, so a derived active layer simply is not
  // found and the reference is omitted — §8's "nothing refers to it".
  const cityIndex = id === null ? -1 : layers.findIndex((l) => l.id === id);
  const geoIndex = id === null ? -1 : geoLayers.findIndex((l) => l.id === id);
  const activeLayer =
    cityIndex >= 0
      ? ({ kind: "city", index: cityIndex } as const)
      : geoIndex >= 0
        ? ({ kind: "geo", index: geoIndex } as const)
        : undefined;
  return { layers, geoLayers, activeLayer, derivedCount };
}

/**
 * §8's extra Save sentence, or null when nothing was skipped.
 *
 * The singular is §8's own words; the plural is [adapted copy A16].
 */
export function derivedNotSavedNote(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? "1 derived layer is not saved; export it to keep it"
    : `${count} derived layers are not saved; export them to keep them`;
}
