import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadBlob, downloadText } from "../../../src/platform/download";

// The revoke is on a `setTimeout(…, 0)`, so the timer has to be driven — and
// the two `downloadText` cases would otherwise leave a real timer pending on a
// stubbed `URL` global that has already been unstubbed.
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function stubObjectUrl() {
  // TYPED parameter: an argument-less `vi.fn` gives `mock.calls[0]` the type
  // `[]`, and the assertions below read the blob that was passed.
  const createObjectURL = vi.fn((_object: Blob | MediaSource) => "blob:fake");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL,
    revokeObjectURL,
  });
  return { createObjectURL, revokeObjectURL };
}

describe("downloadBlob", () => {
  it("clicks an anchor carrying the blob URL and the file name", () => {
    const { createObjectURL, revokeObjectURL } = stubObjectUrl();
    const click = vi.fn();
    const anchor = {
      href: "",
      download: "",
      click,
    } as unknown as HTMLAnchorElement;
    const create = vi
      .spyOn(document, "createElement")
      .mockReturnValue(anchor as never);

    const blob = new Blob(["x"], { type: "text/plain" });
    downloadBlob(blob, "rules.json");

    expect(create).toHaveBeenCalledWith("a");
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(anchor.href).toBe("blob:fake");
    expect(anchor.download).toBe("rules.json");
    expect(click).toHaveBeenCalledTimes(1);
    // DEFERRED, not synchronous: the click dispatches at once, but the browser
    // does not necessarily have the blob's bytes by the time the handler
    // returns, and revoking in the same turn can hand back a zero-byte
    // download — likelier the larger the blob.
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");
    vi.unstubAllGlobals();
  });
});

describe("downloadText", () => {
  it("wraps the text in a blob of the given type", () => {
    const { createObjectURL } = stubObjectUrl();
    vi.spyOn(document, "createElement").mockReturnValue({
      href: "",
      download: "",
      click: vi.fn(),
    } as never);

    downloadText('{"a":1}', "rules.json", "application/json");

    const blob = createObjectURL.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe("application/json");
    vi.unstubAllGlobals();
  });

  it("defaults to application/json", () => {
    const { createObjectURL } = stubObjectUrl();
    vi.spyOn(document, "createElement").mockReturnValue({
      href: "",
      download: "",
      click: vi.fn(),
    } as never);

    downloadText("{}", "x.json");
    expect((createObjectURL.mock.calls[0]![0] as Blob).type).toBe(
      "application/json",
    );
    vi.unstubAllGlobals();
  });
});
