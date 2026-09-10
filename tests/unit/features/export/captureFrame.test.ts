import { describe, it, expect, vi } from "vitest";
import { captureFrame } from "../../../../src/features/export/captureFrame";

describe("captureFrame", () => {
  it("copies the buffer synchronously after rendering and unsubscribes", async () => {
    let listener = () => {};
    const unsubscribe = vi.fn();
    const copy = vi.fn(() => "image");
    const result = captureFrame({
      subscribe: (callback) => {
        listener = callback;
        return unsubscribe;
      },
      requestRender: vi.fn(),
      copy,
    });
    expect(copy).not.toHaveBeenCalled();
    listener();
    expect(copy).toHaveBeenCalledOnce();
    expect(await result).toBe("image");
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it("surfaces capture errors and detaches the listener", async () => {
    let listener = () => {};
    const unsubscribe = vi.fn();
    const result = captureFrame({
      subscribe: (cb) => {
        listener = cb;
        return unsubscribe;
      },
      requestRender: vi.fn(),
      copy: () => {
        throw new Error("Blocked image");
      },
    });
    listener();
    await expect(result).rejects.toThrow("Blocked image");
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it("times out if the view stops rendering", async () => {
    vi.useFakeTimers();
    const unsubscribe = vi.fn();
    const result = captureFrame({
      subscribe: () => unsubscribe,
      requestRender: vi.fn(),
      copy: vi.fn(),
    });
    const assertion = expect(result).rejects.toThrow(
      "The scene did not render",
    );
    await vi.runAllTimersAsync();
    await assertion;
    expect(unsubscribe).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
