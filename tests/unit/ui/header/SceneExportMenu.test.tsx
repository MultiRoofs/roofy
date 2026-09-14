import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { SceneExportMenu } from "../../../../src/ui/header/SceneExportMenu";

afterEach(cleanup);

describe("SceneExportMenu", () => {
  it("exports PNG and prevents duplicate requests while capturing", async () => {
    let finish!: () => void;
    const onExport = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<SceneExportMenu onExport={onExport} />);
    fireEvent.click(screen.getByRole("button", { name: "Export scene" }));
    fireEvent.click(screen.getByRole("button", { name: "Save PNG" }));
    expect(onExport).toHaveBeenCalledWith("png");
    expect(screen.getByRole("button", { name: "Save PNG" })).toBeDisabled();
    finish();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save PNG" }),
      ).not.toBeDisabled(),
    );
  });
  it("offers print and reports capture failures", async () => {
    const onExport = vi.fn().mockRejectedValue(new Error("Scene unavailable"));
    render(<SceneExportMenu onExport={onExport} />);
    fireEvent.click(screen.getByRole("button", { name: "Export scene" }));
    fireEvent.click(screen.getByRole("button", { name: "Print / PDF" }));
    expect(onExport).toHaveBeenCalledWith("print");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Scene unavailable",
    );
  });
});
