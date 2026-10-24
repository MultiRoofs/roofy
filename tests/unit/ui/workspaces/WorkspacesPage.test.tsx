import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { WorkspacesPage } from "../../../../src/ui/workspaces/WorkspacesPage";
import { MemoryBackend } from "../../../../src/persistence/storage/memoryBackend";
import { SnapshotRepository } from "../../../../src/persistence/storage/snapshotRepository";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("creates, renames, duplicates, opens and deletes local workspaces", async () => {
  const store = new SnapshotRepository(new MemoryBackend());
  const open = vi.fn();
  render(<WorkspacesPage store={store} onOpen={open} onBack={() => {}} />);
  fireEvent.change(screen.getByLabelText("Workspace name"), {
    target: { value: "City study" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));
  await screen.findByText("City study");
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  fireEvent.change(screen.getByLabelText("Rename workspace"), {
    target: { value: "Roof study" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save name" }));
  await screen.findByText("Roof study");
  expect(await store.list()).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(open).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
  await screen.findByText("Roof study copy");
  vi.spyOn(window, "confirm").mockReturnValue(true);
  fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]!);
  await waitFor(async () => expect(await store.list()).toHaveLength(1));
});
