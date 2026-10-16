/**
 * What every `StorageBackend` must do, as one suite each backend runs. A new
 * backend (a server, IndexedDB) is done when it passes this.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { StorageBackend } from "../../../../src/persistence/storage/backend";

export function storageBackendContract(
  name: string,
  make: () => StorageBackend | Promise<StorageBackend>,
): void {
  describe(`${name} (StorageBackend contract)`, () => {
    let backend: StorageBackend;
    beforeEach(async () => {
      backend = await make();
    });

    it("answers null for a key never written", async () => {
      expect(await backend.get("ns", "missing")).toBeNull();
    });

    it("reads back what it stored, and a put replaces", async () => {
      await backend.put("ns", "k", "one");
      expect(await backend.get("ns", "k")).toBe("one");
      await backend.put("ns", "k", "two");
      expect(await backend.get("ns", "k")).toBe("two");
    });

    it("keeps any string intact, the empty one included", async () => {
      const awkward = '{"a":"ü\\n\\u0000"}\n🏠';
      await backend.put("ns", "awkward", awkward);
      await backend.put("ns", "empty", "");
      expect(await backend.get("ns", "awkward")).toBe(awkward);
      expect(await backend.get("ns", "empty")).toBe("");
    });

    it("deletes, and deleting a missing key is not an error", async () => {
      await backend.put("ns", "k", "v");
      await backend.delete("ns", "k");
      expect(await backend.get("ns", "k")).toBeNull();
      await expect(backend.delete("ns", "k")).resolves.toBeUndefined();
    });

    it("lists the keys of one namespace only", async () => {
      await backend.put("a", "1", "x");
      await backend.put("a", "2", "y");
      await backend.put("b", "3", "z");
      expect((await backend.list("a")).sort()).toEqual(["1", "2"]);
      expect(await backend.list("b")).toEqual(["3"]);
      expect(await backend.list("c")).toEqual([]);
    });

    it("keeps namespaces apart when a key is shared", async () => {
      await backend.put("a", "k", "in a");
      await backend.put("b", "k", "in b");
      expect(await backend.get("a", "k")).toBe("in a");
      expect(await backend.get("b", "k")).toBe("in b");
    });

    it("keeps a namespace apart from one it prefixes", async () => {
      await backend.put("snapshot", "k", "doc");
      await backend.put("snapshot-index", "k", "other");
      expect(await backend.list("snapshot")).toEqual(["k"]);
    });

    it("refuses a namespace that would collide with the key separator", async () => {
      await expect(backend.put("a:b", "k", "v")).rejects.toThrow();
    });
  });
}
