import { describe, it, expect, vi, afterEach } from "vitest";
import { exportScene } from "../../../../src/features/export/browserSceneExport";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
});
describe("browser scene export", () => {
  const image = {
    dataUrl: "data:image/png;base64,AAAA",
    width: 100,
    height: 80,
  };
  it("downloads the captured PNG with a file name", async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toMatch(/^roofy-scene-.*\.png$/);
        expect(this.href).toBe(image.dataUrl);
      });
    await exportScene("png", async () => image);
    expect(click).toHaveBeenCalledOnce();
  });
  it("shows the captured print preview in the current page and cleans it up on close", async () => {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: vi.fn(),
    });
    await exportScene("print", async () => image);
    const dialog = document.querySelector("dialog")!;
    expect(dialog).not.toBeNull();
    expect(dialog.querySelector("img")?.src).toBe(image.dataUrl);
    expect(dialog.textContent).toContain("Print / Save as PDF");
    dialog.dispatchEvent(new Event("close"));
    expect(document.querySelector("dialog")).toBeNull();
  });
  it("does not leave a preview when capture fails", async () => {
    await expect(
      exportScene("print", async () => {
        throw new Error("Capture failed");
      }),
    ).rejects.toThrow("Capture failed");
    expect(document.querySelector("dialog")).toBeNull();
  });
});
