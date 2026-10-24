/**
 * Saved workspaces over any {@link StorageBackend}: the app's
 * `ProjectStateStore`.
 *
 * One document per workspace, under its id in the `snapshot` namespace, and
 * beside it a small summary (its label and time) under the same id in
 * `snapshot-summary`, so listing workspaces reads the summaries and never a
 * whole document: on a remote backend a document is the full scene.
 *
 * The documents are the truth. A summary is written after its document and
 * deleted before it, a summary whose document is gone is left out of the
 * list, and a document without a summary (saved before summaries existed, or
 * a write cut short) is listed from the document, which writes its summary.
 */
import { StorageQuotaError, type StorageBackend } from "./backend";
import { jsonSnapshotCodec, type SnapshotCodec } from "./snapshotCodec";
import type {
  ProjectSnapshot,
  ProjectStateStore,
  SnapshotSummary,
} from "../types";

export const SNAPSHOT_NAMESPACE = "snapshot";
export const SNAPSHOT_SUMMARY_NAMESPACE = "snapshot-summary";

type Summary = Omit<SnapshotSummary, "id">;

function encodeSummary(snapshot: ProjectSnapshot): string {
  const summary: Summary = { savedAt: snapshot.savedAt, label: snapshot.label };
  return JSON.stringify(summary);
}

function decodeSummary(raw: string): Summary | null {
  try {
    const value = JSON.parse(raw) as Partial<Summary> | null;
    return typeof value?.savedAt === "string" && typeof value.label === "string"
      ? { savedAt: value.savedAt, label: value.label }
      : null;
  } catch {
    return null;
  }
}

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
    const [ids, summarised] = await Promise.all([
      this.backend.list(SNAPSHOT_NAMESPACE),
      this.backend.list(SNAPSHOT_SUMMARY_NAMESPACE),
    ]);
    const withSummary = new Set(summarised);
    const summaries = await Promise.all(
      ids.map(async (id): Promise<SnapshotSummary | null> => {
        if (withSummary.has(id)) {
          const raw = await this.backend.get(SNAPSHOT_SUMMARY_NAMESPACE, id);
          const summary = raw === null ? null : decodeSummary(raw);
          if (summary) return { id, ...summary };
        }
        const snapshot = await this.load(id);
        if (!snapshot) return null;
        await this.backend
          .put(SNAPSHOT_SUMMARY_NAMESPACE, id, encodeSummary(snapshot))
          .catch(() => {
            // Listed from the document this time, and the next time too.
          });
        return { id, savedAt: snapshot.savedAt, label: snapshot.label };
      }),
    );
    return summaries
      .filter((s): s is SnapshotSummary => s !== null)
      .sort((a, b) => a.savedAt.localeCompare(b.savedAt));
  }

  async remove(id: string): Promise<void> {
    await this.backend.delete(SNAPSHOT_SUMMARY_NAMESPACE, id);
    await this.backend.delete(SNAPSHOT_NAMESPACE, id);
  }

  private async write(id: string, snapshot: ProjectSnapshot): Promise<void> {
    try {
      await this.backend.put(
        SNAPSHOT_NAMESPACE,
        id,
        this.codec.encode(snapshot),
      );
      await this.backend.put(
        SNAPSHOT_SUMMARY_NAMESPACE,
        id,
        encodeSummary(snapshot),
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
