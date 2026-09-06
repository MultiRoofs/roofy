/**
 * The one version step a saved workspace can take: v3 -> v4.
 *
 * Kept out of `restoreSnapshot` so the decision "can this document be read at
 * all?" is a pure function of the document — testable without touching a
 * store, and reusable by anything else that has to answer the question before
 * committing to a restore.
 *
 * There is exactly one step because v4 is exactly one additive field
 * ({@link ProjectSnapshot.activeLayer}): a v3 document already IS a v4
 * document with that field absent, and absent already means "the first layer
 * in unified order". v1/v2 are a different matter and stay unsupported — see
 * {@link UnsupportedSnapshotVersionError}.
 */

import type { ProjectSnapshot } from "./types";
import { SNAPSHOT_VERSION, UnsupportedSnapshotVersionError } from "./types";

export type MigrationOutcome =
  | {
      readonly ok: true;
      readonly snapshot: ProjectSnapshot;
      /** The version the document arrived as, when it needed carrying
       *  forward; `null` when it was already current. */
      readonly migratedFrom: string | null;
    }
  | { readonly ok: false; readonly error: UnsupportedSnapshotVersionError };

/** v4 passes through; v3 becomes v4 with `activeLayer` omitted (the first
 *  layer); anything else is unsupported. */
export function migrateSnapshot(raw: ProjectSnapshot): MigrationOutcome {
  const version = raw?.version;
  if (version === SNAPSHOT_VERSION) {
    // The same object, not a copy: nothing had to change, and handing back an
    // identical value keeps the "was this migrated?" question answerable by
    // `migratedFrom` alone.
    return { ok: true, snapshot: raw, migratedFrom: null };
  }
  if (version === "3") {
    // Copied rather than mutated — the caller's document may be the one the
    // snapshot list is still rendering from.
    return {
      ok: true,
      snapshot: { ...raw, version: SNAPSHOT_VERSION },
      migratedFrom: "3",
    };
  }
  return {
    ok: false,
    error: new UnsupportedSnapshotVersionError(version ?? "unknown"),
  };
}
