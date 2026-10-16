/**
 * Small per-browser settings (theme, shadow quality, the walkthrough's
 * progress) over any {@link StorageBackend}.
 *
 * Reads are synchronous because the stores that use them build their first
 * state synchronously, the theme before the first paint. So the store reads a
 * cache that `hydrate()` fills once at start-up (`main.tsx` waits for it
 * before the app is imported), and a write updates the cache at once and the
 * backend behind it. Writes to one key reach the backend one after another,
 * in the order they were made, so a slow first request cannot land after a
 * later one; and a value set while `hydrate` is still reading is not
 * replaced by the older stored one. A write that fails is logged and
 * otherwise ignored: a preference that does not persist is not worth an
 * error in the user's face.
 */
import type { StorageBackend } from "./backend";

export const PREFERENCE_NAMESPACE = "preference";

export interface PreferenceStore {
  /** The value from the hydrated cache; null before `hydrate` or when unset. */
  get(key: string): string | null;
  /** Set (or with null, clear) a value: the cache now, the backend after. */
  set(key: string, value: string | null): void;
  /** Read every preference from the backend into the cache. */
  hydrate(): Promise<void>;
}

export function createPreferenceStore(
  backend: StorageBackend,
): PreferenceStore {
  const cache = new Map<string, string>();
  /** Keys set in this session: the backend's copy of them is older. */
  const written = new Set<string>();
  /** Per key, the last write on its way to the backend. */
  const pending = new Map<string, Promise<void>>();
  const report = (error: unknown) =>
    console.warn("A preference could not be saved.", error);
  return {
    get: (key) => cache.get(key) ?? null,
    set: (key, value) => {
      written.add(key);
      if (value === null) cache.delete(key);
      else cache.set(key, value);
      const write = (pending.get(key) ?? Promise.resolve())
        .then(() =>
          value === null
            ? backend.delete(PREFERENCE_NAMESPACE, key)
            : backend.put(PREFERENCE_NAMESPACE, key, value),
        )
        .catch(report);
      pending.set(key, write);
      void write.then(() => {
        if (pending.get(key) === write) pending.delete(key);
      });
    },
    hydrate: async () => {
      const keys = await backend.list(PREFERENCE_NAMESPACE);
      const values = await Promise.all(
        keys.map((key) => backend.get(PREFERENCE_NAMESPACE, key)),
      );
      keys.forEach((key, i) => {
        const value = values[i];
        if (written.has(key)) return;
        if (value !== null && value !== undefined) cache.set(key, value);
      });
    },
  };
}
