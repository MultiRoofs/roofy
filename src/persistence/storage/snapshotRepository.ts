/**
 * Saved workspaces over any {@link StorageBackend}: the app's
 * `ProjectStateStore`.
 *
 * One document per workspace, under its id in the `snapshot` namespace, and no
 * separate index: the list is read from the documents themselves, so a list
 * and the documents it names cannot disagree, and a backend needs nothing but
 * get, put, delete and list. A backend for which reading every document to
 * list them is too slow (a remote one with many saves) can implement
 * `ProjectStateStore` itself instead.
 */
import { StorageQuotaError, type StorageBackend } from "./backend";
import { jsonSnapshotCodec, type SnapshotCodec } from "./snapshotCodec";
import type {
  ProjectSnapshot,
  ProjectStateStore,
  SnapshotSummary,
} from "../types";

export const SNAPSHOT_NAMESPACE = "snapshot";

export interface SnapshotRepositoryOptions {
  readonly codec?: SnapshotCodec;
  /** A new workspace's id; `crypto.randomUUID` unless a test pins it. */
  readonly newId?: () => string;
}

export class SnapshotRepository implements ProjectStateStore {
  private readonly codec: SnapshotCodec;
  private readonly newId: () => string;

  constructor(
    private readonly backend: StorageBackend,
    options: SnapshotRepositoryOptions = {},
  ) {
    this.codec = options.codec ?? jsonSnapshotCodec;
    this.newId = options.newId ?? (() => crypto.randomUUID());
  }

  async save(snapshot: ProjectSnapshot): Promise<string> {
    const id = this.newId();
    await this.write(id, snapshot);
    return id;
  }

  async update(id: string, snapshot: ProjectSnapshot): Promise<void> {
    if ((await this.backend.get(SNAPSHOT_NAMESPACE, id)) === null) {
      throw new Error("Workspace no longer exists.");
    }
    await this.write(id, snapshot);
  }

  async load(id: string): Promise<ProjectSnapshot | null> {
    const raw = await this.backend.get(SNAPSHOT_NAMESPACE, id);
    return raw === null ? null : this.codec.decode(raw);
  }

  /** Oldest first. A stored value that is not a workspace is left out. */
  async list(): Promise<SnapshotSummary[]> {
    const ids = await this.backend.list(SNAPSHOT_NAMESPACE);
    const summaries: SnapshotSummary[] = [];
    for (const id of ids) {
      const snapshot = await this.load(id);
      if (snapshot) {
        summaries.push({
          id,
          savedAt: snapshot.savedAt,
          label: snapshot.label,
        });
      }
    }
    return summaries.sort((a, b) => a.savedAt.localeCompare(b.savedAt));
  }

  async remove(id: string): Promise<void> {
    await this.backend.delete(SNAPSHOT_NAMESPACE, id);
  }

  private async write(id: string, snapshot: ProjectSnapshot): Promise<void> {
    try {
      await this.backend.put(
        SNAPSHOT_NAMESPACE,
        id,
        this.codec.encode(snapshot),
      );
    } catch (error) {
      if (error instanceof StorageQuotaError) {
        throw new Error("Could not save workspace: storage quota exceeded.", {
          cause: error,
        });
      }
      throw error;
    }
  }
}
