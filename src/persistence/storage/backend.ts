/**
 * Where the app keeps what it persists: saved workspaces and preferences.
 *
 * A key-value store of strings, grouped into namespaces, and asynchronous, so
 * that the same interface fits the browser's `localStorage` today and a server
 * (or IndexedDB, or a desktop file) later. Nothing above this layer knows
 * which one it talks to: `appStorage.ts` is the one place that picks.
 *
 * Values are opaque strings. What they mean, and how they are versioned, is
 * the caller's business (`snapshotCodec.ts` for workspaces), so a backend never
 * parses anything.
 */
export interface StorageBackend {
  /** The value under `key`, or null when there is none. */
  get(namespace: string, key: string): Promise<string | null>;
  /** Store `value` under `key`, replacing any value already there. Rejects
   *  with {@link StorageQuotaError} when the backend is full. */
  put(namespace: string, key: string, value: string): Promise<void>;
  /** Remove `key`; removing a key that is not there is not an error. */
  delete(namespace: string, key: string): Promise<void>;
  /** Every key in `namespace`, in no particular order. */
  list(namespace: string): Promise<string[]>;
}

/** The backend has no room for the value. */
export class StorageQuotaError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("The browser's storage is full.", options);
    this.name = "StorageQuotaError";
  }
}

/** Namespaces and keys are joined with `:`, so neither may contain one. */
export function assertNamespace(namespace: string): void {
  if (namespace === "" || namespace.includes(":")) {
    throw new Error(`Invalid storage namespace "${namespace}".`);
  }
}
