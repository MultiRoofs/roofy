/**
 * The browser's `localStorage` as a {@link StorageBackend}, and the only module
 * in the app that touches `localStorage`.
 *
 * Keys are `<prefix>:<namespace>:<key>`. With the default prefix a saved
 * workspace sits at `roofy:snapshot:<id>`, where workspaces have always been
 * saved, so saves made before this layer existed still list and load.
 *
 * A browser that blocks storage (a private window, a hardened profile) throws
 * on access; every call then rejects with `StorageUnavailableError`, so a
 * caller can tell the user rather than show an empty list or lose a write.
 */
import {
  assertNamespace,
  StorageQuotaError,
  StorageUnavailableError,
  type StorageBackend,
} from "./backend";

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" ||
      error.name === "NS_ERROR_DOM_QUOTA_REACHED")
  );
}

export class LocalStorageBackend implements StorageBackend {
  constructor(
    private readonly access: () => Storage = () => localStorage,
    private readonly prefix = "roofy",
  ) {}

  private storage(): Storage {
    try {
      return this.access();
    } catch (error) {
      throw new StorageUnavailableError({ cause: error });
    }
  }

  private key(namespace: string, key: string): string {
    assertNamespace(namespace);
    return `${this.prefix}:${namespace}:${key}`;
  }

  async get(namespace: string, key: string): Promise<string | null> {
    const full = this.key(namespace, key);
    const storage = this.storage();
    try {
      return storage.getItem(full);
    } catch (error) {
      throw new StorageUnavailableError({ cause: error });
    }
  }

  async put(namespace: string, key: string, value: string): Promise<void> {
    const full = this.key(namespace, key);
    const storage = this.storage();
    try {
      storage.setItem(full, value);
    } catch (error) {
      if (isQuotaError(error)) throw new StorageQuotaError({ cause: error });
      throw new StorageUnavailableError({ cause: error });
    }
  }

  async delete(namespace: string, key: string): Promise<void> {
    const full = this.key(namespace, key);
    const storage = this.storage();
    try {
      storage.removeItem(full);
    } catch (error) {
      throw new StorageUnavailableError({ cause: error });
    }
  }

  async list(namespace: string): Promise<string[]> {
    const head = this.key(namespace, "");
    const keys: string[] = [];
    const storage = this.storage();
    try {
      for (let i = 0; i < storage.length; i++) {
        const full = storage.key(i);
        if (full?.startsWith(head)) keys.push(full.slice(head.length));
      }
    } catch (error) {
      throw new StorageUnavailableError({ cause: error });
    }
    return keys;
  }
}
