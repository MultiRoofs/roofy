import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryBackend } from "../../../../src/persistence/storage/memoryBackend";
import { LocalStorageBackend } from "../../../../src/persistence/storage/localStorageBackend";
import {
  SNAPSHOT_NAMESPACE,
  SNAPSHOT_SUMMARY_NAMESPACE,
  SnapshotRepository,
} from "../../../../src/persistence/storage/snapshotRepository";
import {
  StorageQuotaError,
  StorageUnavailableError,
  type StorageBackend,
} from "../../../../src/persistence/storage/backend";
import { SNAPSHOT_VERSION } from "../../../../src/persistence/types";
import type { ProjectSnapshot } from "../../../../src/persistence/types";

function makeSnapshot(
  overrides: Partial<ProjectSnapshot> = {},
): ProjectSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    savedAt: "2025-06-21T12:00:00Z",
    label: "Test snapshot",
    layers: [
      {
        name: "delft",
        modelRef: { type: "url", url: "https://example.com/model.city.json" },
        rules: [],
        rulesEnabled: true,
        visible: true,
      },
    ],
    viewState: {
      camera: {
        lng: 4.3571,
        lat: 52.0116,
        height: 800,
        heading: 30,
        pitch: -45,
        roll: 0,
      },
      datetime: "2025-06-21T12:00:00Z",
    },
    pickMode: "object",
    ...overrides,
  };
}

describe("SnapshotRepository", () => {
  let backend: MemoryBackend;
  let store: SnapshotRepository;
  let next = 0;

  beforeEach(() => {
    backend = new MemoryBackend();
    next = 0;
    store = new SnapshotRepository(backend, { newId: () => `id-${++next}` });
  });

  it("saves under a new id and loads the same document back", async () => {
    const snapshot = makeSnapshot();
    const id = await store.save(snapshot);
    expect(id).toBe("id-1");
    expect(await store.load(id)).toEqual(snapshot);
  });

  it("lists every save oldest first, with its label and time", async () => {
    await store.save(
      makeSnapshot({ label: "B", savedAt: "2025-06-22T00:00:00Z" }),
    );
    await store.save(
      makeSnapshot({ label: "A", savedAt: "2025-06-21T00:00:00Z" }),
    );
    expect(await store.list()).toEqual([
      { id: "id-2", label: "A", savedAt: "2025-06-21T00:00:00Z" },
      { id: "id-1", label: "B", savedAt: "2025-06-22T00:00:00Z" },
    ]);
  });

  it("updates in place, without a second entry", async () => {
    const id = await store.save(makeSnapshot());
    await store.update(id, makeSnapshot({ label: "Renamed" }));
    expect((await store.list()).map((s) => s.label)).toEqual(["Renamed"]);
    expect((await store.load(id))?.label).toBe("Renamed");
  });

  it("refuses to update a workspace that was deleted", async () => {
    const id = await store.save(makeSnapshot());
    await store.remove(id);
    await expect(store.update(id, makeSnapshot())).rejects.toThrow(
      "Workspace no longer exists.",
    );
    expect(await store.list()).toEqual([]);
  });

  it("removes a save from the list and from storage", async () => {
    const id = await store.save(makeSnapshot());
    await store.remove(id);
    expect(await store.load(id)).toBeNull();
    expect(await backend.list(SNAPSHOT_NAMESPACE)).toEqual([]);
    expect(await backend.list(SNAPSHOT_SUMMARY_NAMESPACE)).toEqual([]);
  });

  it("lists from the summaries, without reading a workspace document", async () => {
    await store.save(makeSnapshot({ label: "A" }));
    await store.save(makeSnapshot({ label: "B" }));
    const get = vi.spyOn(backend, "get");
    expect((await store.list()).map((s) => s.label)).toEqual(["A", "B"]);
    expect(
      get.mock.calls.filter(([namespace]) => namespace === SNAPSHOT_NAMESPACE),
    ).toEqual([]);
  });

  it("lists a workspace saved without a summary, and writes the summary", async () => {
    const old = makeSnapshot({ label: "Saved last week" });
    await backend.put(SNAPSHOT_NAMESPACE, "old-id", JSON.stringify(old));
    expect(await store.list()).toEqual([
      { id: "old-id", savedAt: old.savedAt, label: "Saved last week" },
    ]);
    expect(await backend.list(SNAPSHOT_SUMMARY_NAMESPACE)).toEqual(["old-id"]);
  });

  it("leaves out a summary whose workspace is gone", async () => {
    const id = await store.save(makeSnapshot());
    await backend.delete(SNAPSHOT_NAMESPACE, id);
    expect(await store.list()).toEqual([]);
  });

  it("says storage is unavailable, not that the workspace is gone", async () => {
    const blocked: StorageBackend = {
      get: async () => {
        throw new StorageUnavailableError();
      },
      list: async () => {
        throw new StorageUnavailableError();
      },
      delete: async () => {
        throw new StorageUnavailableError();
      },
      put: async () => {
        throw new StorageUnavailableError();
      },
    };
    await expect(
      new SnapshotRepository(blocked).update("id", makeSnapshot()),
    ).rejects.toBeInstanceOf(StorageUnavailableError);
  });

  it("loads null for an unknown id", async () => {
    expect(await store.load("missing")).toBeNull();
  });

  it("leaves a stored value that is not a workspace out of the list", async () => {
    await backend.put(SNAPSHOT_NAMESPACE, "garbage", "{not json");
    await backend.put(SNAPSHOT_NAMESPACE, "array", "[1,2]");
    await store.save(makeSnapshot());
    expect((await store.list()).map((s) => s.id)).toEqual(["id-1"]);
    expect(await store.load("garbage")).toBeNull();
  });

  it("hands back an older version as stored, for the restore to migrate", async () => {
    const v4 = {
      ...makeSnapshot(),
      version: "4",
    } as unknown as ProjectSnapshot;
    const id = await store.save(v4);
    expect((await store.load(id))?.version).toBe("4");
  });

  it("explains a full store in the words the save dialog shows", async () => {
    const full: StorageBackend = {
      ...backend,
      get: backend.get.bind(backend),
      list: backend.list.bind(backend),
      delete: backend.delete.bind(backend),
      put: async () => {
        throw new StorageQuotaError();
      },
    };
    await expect(
      new SnapshotRepository(full).save(makeSnapshot()),
    ).rejects.toThrow("Could not save workspace: storage quota exceeded.");
  });
});

describe("SnapshotRepository over localStorage", () => {
  beforeEach(() => localStorage.clear());

  it("lists and loads a workspace saved before this layer existed", async () => {
    // What the old LocalStorageProjectStateStore wrote: the document under
    // roofy:snapshot:<id>, and an index beside it that is no longer read.
    const old = makeSnapshot({ label: "Saved last week" });
    localStorage.setItem("roofy:snapshot:old-id", JSON.stringify(old));
    localStorage.setItem(
      "roofy:snapshot-index",
      JSON.stringify([
        { id: "old-id", savedAt: old.savedAt, label: old.label },
      ]),
    );
    const store = new SnapshotRepository(new LocalStorageBackend());
    expect(await store.list()).toEqual([
      { id: "old-id", savedAt: old.savedAt, label: "Saved last week" },
    ]);
    expect(await store.load("old-id")).toEqual(old);
  });
});
