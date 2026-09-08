import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ResizeHandle } from "../../../../src/ui/shell/ResizeHandle";

afterEach(cleanup);

describe("ResizeHandle", () => {
  it("keeps pointer movement relative to pointerdown through overshoot", () => {
    let size = 340;
    const onResize = vi.fn((next: number) => {
      size = Math.max(280, Math.min(480, next));
    });
    render(
      <ResizeHandle
        axis="x"
        current={size}
        min={280}
        max={480}
        direction={-1}
        label="Resize"
        onResize={onResize}
      />,
    );
    const handle = screen.getByRole("separator");
    fireEvent.pointerDown(handle, { clientX: 900, pointerId: 1 });
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 600 }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 860 }));

    expect(onResize).toHaveBeenLastCalledWith(380);
  });

  it("cleans up an active pointer drag when unmounted", () => {
    const onResize = vi.fn();
    const { unmount } = render(
      <ResizeHandle
        axis="x"
        current={300}
        min={240}
        max={420}
        direction={1}
        label="Resize"
        onResize={onResize}
      />,
    );
    fireEvent.pointerDown(screen.getByRole("separator"), {
      clientX: 300,
      pointerId: 1,
    });
    unmount();
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 380 }));

    expect(onResize).not.toHaveBeenCalled();
  });
});
