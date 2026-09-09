import type { ProjectSnapshot, ProjectStateStore } from "./types";
/** A deleted current save becomes a new record on the next explicit Save. */
export async function saveWorkspace(
  store: ProjectStateStore,
  id: string | null,
  snapshot: ProjectSnapshot,
): Promise<string> {
  if (id && store.update && (await store.load(id))) {
    await store.update(id, snapshot);
    return id;
  }
  return store.save(snapshot);
}
