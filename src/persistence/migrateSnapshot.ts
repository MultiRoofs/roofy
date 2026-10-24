/**
 * The version steps a saved workspace can take: v3 or v4 -> v5.
 *
 * Kept out of `restoreSnapshot` so the decision "can this document be read at
 * all?" is a pure function of the document — testable without touching a
 * store, and reusable by anything else that has to answer the question before
 * committing to a restore.
 *
 * Every step is a version bump and nothing else, because every version since v3
 * has added optional fields whose absence already means the right thing: v4's
 * `activeLayer` absent means "the first layer in unified order", and v5's
 * per-layer `families` absent means the R-D default (Building alone). v1/v2 are a
 * different matter and stay unsupported — see
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

/** v5 passes through; v4 and v3 become v5 with the additive fields absent (the
 *  first layer, and the default families); anything else is unsupported. */
export function migrateSnapshot(raw: ProjectSnapshot): MigrationOutcome {
  const version = raw?.version;
  if (version === SNAPSHOT_VERSION) {
    // The same object, not a copy: nothing had to change, and handing back an
    // identical value keeps the "was this migrated?" question answerable by
    // `migratedFrom` alone.
    return { ok: true, snapshot: raw, migratedFrom: null };
  }
  if (version === "3" || version === "4") {
    // Copied rather than mutated — the caller's document may be the one the
    // snapshot list is still rendering from.
    return {
      ok: true,
      snapshot: { ...raw, version: SNAPSHOT_VERSION },
      migratedFrom: version,
    };
  }
  return {
    ok: false,
    error: new UnsupportedSnapshotVersionError(version ?? "unknown"),
  };
}
