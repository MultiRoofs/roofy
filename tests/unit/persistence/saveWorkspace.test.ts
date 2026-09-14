import { expect, it, vi } from "vitest";
import { saveWorkspace } from "../../../src/persistence/saveWorkspace";
import type { ProjectSnapshot } from "../../../src/persistence/types";
it("creates a new save if the current saved record was deleted", async () => {
  const store = {
    load: vi.fn(async () => null),
    save: vi.fn(async () => "new-id"),
    update: vi.fn(async () => {}),
    remove: vi.fn(),
    list: vi.fn(),
  };
  const snapshot = {} as ProjectSnapshot;
  expect(await saveWorkspace(store, "deleted-id", snapshot)).toBe("new-id");
  expect(store.update).not.toHaveBeenCalled();
});
it("updates an existing record", async () => {
  const snapshot = {} as ProjectSnapshot;
  const store = {
    load: vi.fn(async () => snapshot),
    save: vi.fn(async () => "new-id"),
    update: vi.fn(async () => {}),
    remove: vi.fn(),
    list: vi.fn(),
  };
  expect(await saveWorkspace(store, "existing", snapshot)).toBe("existing");
  expect(store.update).toHaveBeenCalledWith("existing", snapshot);
  expect(store.save).not.toHaveBeenCalled();
});
