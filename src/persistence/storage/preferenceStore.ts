/**
 * Small per-browser settings (theme, shadow quality, the walkthrough's
 * progress) over any {@link StorageBackend}.
 *
 * Reads are synchronous because the stores that use them build their first
 * state synchronously, the theme before the first paint. So the store reads a
 * cache that `hydrate()` fills once at start-up (`main.tsx` awaits it before
 * the app is imported), and a write updates the cache at once and the backend
 * behind it. A write that fails is logged and otherwise ignored: a preference
 * that does not persist is not worth an error in the user's face.
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
  const report = (error: unknown) =>
    console.warn("A preference could not be saved.", error);
  return {
    get: (key) => cache.get(key) ?? null,
    set: (key, value) => {
      if (value === null) {
        cache.delete(key);
        backend.delete(PREFERENCE_NAMESPACE, key).catch(report);
      } else {
        cache.set(key, value);
        backend.put(PREFERENCE_NAMESPACE, key, value).catch(report);
      }
    },
    hydrate: async () => {
      const keys = await backend.list(PREFERENCE_NAMESPACE);
      const values = await Promise.all(
        keys.map((key) => backend.get(PREFERENCE_NAMESPACE, key)),
      );
      keys.forEach((key, i) => {
        const value = values[i];
        if (value !== null && value !== undefined) cache.set(key, value);
      });
    },
  };
}
