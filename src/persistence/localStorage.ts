/**
 * LocalStorage-backed implementation of ProjectStateStore.
 *
 * Stores each snapshot as a JSON string under a namespaced key.
 * A separate index key tracks all snapshot IDs for listing.
 */

import type { ProjectSnapshot, ProjectStateStore, SnapshotSummary } from "./types";

const STORAGE_PREFIX = "multiroof:snapshot:";
const INDEX_KEY = "multiroof:snapshot-index";

/** Snapshot ID + summary stored in the index. */
interface IndexEntry {
  id: string;
  savedAt: string;
  label: string;
}

function readIndex(): IndexEntry[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as IndexEntry[];
  } catch {
    return [];
  }
}

function writeIndex(entries: IndexEntry[]): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(entries));
}

export class LocalStorageProjectStateStore implements ProjectStateStore {
  async save(snapshot: ProjectSnapshot): Promise<string> {
    const id = crypto.randomUUID();
    const key = STORAGE_PREFIX + id;

    try {
      localStorage.setItem(key, JSON.stringify(snapshot));
    } catch (e) {
      throw new Error("Could not save workspace: storage quota exceeded.", { cause: e });
    }

    try {
      const index = readIndex();
      index.push({ id, savedAt: snapshot.savedAt, label: snapshot.label });
      writeIndex(index);
    } catch (e) {
      localStorage.removeItem(key); // rollback orphan
      throw new Error("Could not update workspace index.", { cause: e });
    }

    return id;
  }

  async load(id: string): Promise<ProjectSnapshot | null> {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + id);
      if (!raw) return null;
      return JSON.parse(raw) as ProjectSnapshot;
    } catch {
      return null;
    }
  }

  async list(): Promise<SnapshotSummary[]> {
    return readIndex().map(({ id, savedAt, label }) => ({ id, savedAt, label }));
  }

  async remove(id: string): Promise<void> {
    localStorage.removeItem(STORAGE_PREFIX + id);
    const index = readIndex().filter((e) => e.id !== id);
    writeIndex(index);
  }
}
