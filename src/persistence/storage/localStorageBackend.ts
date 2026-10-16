/**
 * The browser's `localStorage` as a {@link StorageBackend}, and the only module
 * in the app that touches `localStorage`.
 *
 * Keys are `<prefix>:<namespace>:<key>`. With the default prefix a saved
 * workspace sits at `roofy:snapshot:<id>`, where workspaces have always been
 * saved, so saves made before this layer existed still list and load.
 *
 * A browser that blocks storage (a private window, a hardened profile) throws
 * on access; reads then answer "nothing stored" and writes reject, so a caller
 * can tell the user rather than lose the write silently.
 */
import {
  assertNamespace,
  StorageQuotaError,
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
    private readonly storage: () => Storage = () => localStorage,
    private readonly prefix = "roofy",
  ) {}

  private key(namespace: string, key: string): string {
    assertNamespace(namespace);
    return `${this.prefix}:${namespace}:${key}`;
  }

  async get(namespace: string, key: string): Promise<string | null> {
    const full = this.key(namespace, key);
    try {
      return this.storage().getItem(full);
    } catch {
      return null;
    }
  }

  async put(namespace: string, key: string, value: string): Promise<void> {
    const full = this.key(namespace, key);
    try {
      this.storage().setItem(full, value);
    } catch (error) {
      if (isQuotaError(error)) throw new StorageQuotaError({ cause: error });
      throw error;
    }
  }

  async delete(namespace: string, key: string): Promise<void> {
    const full = this.key(namespace, key);
    try {
      this.storage().removeItem(full);
    } catch {
      // Nothing can have been stored where nothing can be read.
    }
  }

  async list(namespace: string): Promise<string[]> {
    const head = this.key(namespace, "");
    const keys: string[] = [];
    try {
      const storage = this.storage();
      for (let i = 0; i < storage.length; i++) {
        const full = storage.key(i);
        if (full?.startsWith(head)) keys.push(full.slice(head.length));
      }
    } catch {
      return [];
    }
    return keys;
  }
}
