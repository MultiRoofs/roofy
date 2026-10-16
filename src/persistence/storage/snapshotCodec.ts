/**
 * How a saved workspace becomes a stored string and back, kept apart from where
 * it is stored. The codec writes the document as it is; carrying an older
 * version forward is `migrateSnapshot`'s job on restore, so a backend change
 * and a format change never have to happen together.
 */
import type { ProjectSnapshot } from "../types";

export interface SnapshotCodec {
  encode(snapshot: ProjectSnapshot): string;
  /** The document, or null when the string is not one (not JSON, or not an
   *  object carrying a version). Never throws. */
  decode(raw: string): ProjectSnapshot | null;
}

export const jsonSnapshotCodec: SnapshotCodec = {
  encode: (snapshot) => JSON.stringify(snapshot),
  decode: (raw) => {
    try {
      const value: unknown = JSON.parse(raw);
      if (
        value === null ||
        typeof value !== "object" ||
        typeof (value as { version?: unknown }).version !== "string"
      ) {
        return null;
      }
      return value as ProjectSnapshot;
    } catch {
      return null;
    }
  },
};
