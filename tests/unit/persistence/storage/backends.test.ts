import { afterEach, describe, expect, it } from "vitest";
import { MemoryBackend } from "../../../../src/persistence/storage/memoryBackend";
import { LocalStorageBackend } from "../../../../src/persistence/storage/localStorageBackend";
import {
  StorageQuotaError,
  StorageUnavailableError,
} from "../../../../src/persistence/storage/backend";
import { storageBackendContract } from "./backendContract";

storageBackendContract("MemoryBackend", () => new MemoryBackend());
storageBackendContract("LocalStorageBackend", () => {
  localStorage.clear();
  return new LocalStorageBackend();
});

describe("LocalStorageBackend", () => {
  afterEach(() => localStorage.clear());

  it("stores under roofy:<namespace>:<key>, where workspaces have always lived", async () => {
    await new LocalStorageBackend().put("snapshot", "abc", "{}");
    expect(localStorage.getItem("roofy:snapshot:abc")).toBe("{}");
  });

  it("ignores keys outside its prefix", async () => {
    localStorage.setItem("roofy-theme-preference", "dark");
    localStorage.setItem("other:snapshot:x", "{}");
    expect(await new LocalStorageBackend().list("snapshot")).toEqual([]);
  });

  it("rejects every call with StorageUnavailableError when the browser blocks storage", async () => {
    const blocked = new LocalStorageBackend(() => {
      throw new DOMException("denied", "SecurityError");
    });
    for (const call of [
      blocked.get("ns", "k"),
      blocked.list("ns"),
      blocked.delete("ns", "k"),
      blocked.put("ns", "k", "v"),
    ]) {
      await expect(call).rejects.toBeInstanceOf(StorageUnavailableError);
    }
  });

  it("reports a full store as StorageQuotaError", async () => {
    const full = {
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
    } as unknown as Storage;
    await expect(
      new LocalStorageBackend(() => full).put("ns", "k", "v"),
    ).rejects.toBeInstanceOf(StorageQuotaError);
  });
});
