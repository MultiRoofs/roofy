/**
 * The app's storage, wired once. Swapping where Roofy keeps its data (a server,
 * IndexedDB, a desktop file) means another `StorageBackend` here, or another
 * `ProjectStateStore` for workspaces, and nothing else.
 */
import { LocalStorageBackend } from "./localStorageBackend";
import { createPreferenceStore } from "./preferenceStore";
import { SnapshotRepository } from "./snapshotRepository";
import type { StorageBackend } from "./backend";
import type { ProjectStateStore } from "../types";

export const appStorageBackend: StorageBackend = new LocalStorageBackend();
export const appWorkspaces: ProjectStateStore = new SnapshotRepository(
  appStorageBackend,
);
export const appPreferences = createPreferenceStore(appStorageBackend);
