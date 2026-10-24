import { assertNamespace, type StorageBackend } from "./backend";

/** A backend that keeps everything in memory: tests, and a session whose
 *  browser refuses storage. */
export class MemoryBackend implements StorageBackend {
  private readonly namespaces = new Map<string, Map<string, string>>();

  private space(namespace: string): Map<string, string> {
    assertNamespace(namespace);
    let space = this.namespaces.get(namespace);
    if (!space) {
      space = new Map();
      this.namespaces.set(namespace, space);
    }
    return space;
  }

  async get(namespace: string, key: string): Promise<string | null> {
    return this.space(namespace).get(key) ?? null;
  }

  async put(namespace: string, key: string, value: string): Promise<void> {
    this.space(namespace).set(key, value);
  }

  async delete(namespace: string, key: string): Promise<void> {
    this.space(namespace).delete(key);
  }

  async list(namespace: string): Promise<string[]> {
    return [...this.space(namespace).keys()];
  }
}
