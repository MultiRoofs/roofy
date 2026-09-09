import { useCallback, useEffect, useState } from "react";
import type {
  ProjectStateStore,
  SnapshotSummary,
} from "../../persistence/types";
import { captureSnapshot } from "../../persistence/captureSnapshot";
import "./workspaces.css";
export function WorkspacesPage({
  store,
  onOpen,
  onBack,
  onRename,
}: {
  store: ProjectStateStore;
  onOpen: (id: string) => void;
  onBack: () => void;
  onRename?: (id: string, name: string) => void;
}) {
  const [items, setItems] = useState<SnapshotSummary[]>([]);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setItems(
      (await store.list()).sort((a, b) => b.savedAt.localeCompare(a.savedAt)),
    );
  }, [store]);
  useEffect(() => {
    void refresh().catch((e) => setError(String(e)));
  }, [refresh]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="workspaces-page">
      <header>
        <div>
          <h1>Workspaces</h1>
          <p>Saved in this browser</p>
        </div>
        <button onClick={onBack}>Back to viewer</button>
      </header>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void run(async () => {
            await store.save(
              captureSnapshot({
                label: name.trim(),
                layers: [],
                camera: {
                  lng: 4.3571,
                  lat: 52.0116,
                  height: 800,
                  heading: 0,
                  pitch: -45,
                  roll: 0,
                },
                datetime: new Date(),
                pickMode: "object",
              }),
            );
            setName("");
          });
        }}
      >
        <label>
          Workspace name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New workspace"
          />
        </label>
        <button disabled={busy || !name.trim()}>Create workspace</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {!items.length ? (
        <p>
          No saved workspaces yet. Create one above or save your current view.
        </p>
      ) : (
        <ul className="workspaces-list">
          {items.map((item) => (
            <li key={item.id}>
              <div>
                {editing === item.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(async () => {
                        const snapshot = await store.load(item.id);
                        if (!snapshot)
                          throw new Error("Workspace no longer exists.");
                        await store.update!(item.id, {
                          ...snapshot,
                          label: draft.trim(),
                        });
                        onRename?.(item.id, draft.trim());
                        setEditing(null);
                      });
                    }}
                  >
                    <input
                      aria-label="Rename workspace"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      autoFocus
                    />
                    <button disabled={busy || !draft.trim()}>Save name</button>
                    <button type="button" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    <strong>{item.label}</strong>
                    <time dateTime={item.savedAt}>
                      {new Date(item.savedAt).toLocaleString()}
                    </time>
                  </>
                )}
              </div>
              <nav aria-label={`Actions for ${item.label}`}>
                <button disabled={busy} onClick={() => onOpen(item.id)}>
                  Open
                </button>
                <button
                  disabled={busy || !store.update}
                  onClick={() => {
                    setEditing(item.id);
                    setDraft(item.label);
                  }}
                >
                  Rename
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const snapshot = await store.load(item.id);
                      if (!snapshot)
                        throw new Error("Workspace no longer exists.");
                      await store.save({
                        ...snapshot,
                        label: `${snapshot.label} copy`,
                        savedAt: new Date().toISOString(),
                      });
                    })
                  }
                >
                  Duplicate
                </button>
                <button
                  disabled={busy}
                  className="menu-item-danger"
                  onClick={() => {
                    if (window.confirm(`Delete “${item.label}”?`))
                      void run(() => store.remove(item.id));
                  }}
                >
                  Delete
                </button>
              </nav>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
