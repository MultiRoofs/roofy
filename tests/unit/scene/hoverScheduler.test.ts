import { describe, expect, it, vi } from "vitest";
import { createHoverScheduler } from "../../../src/scene/hoverScheduler";

function manualFrames() {
  const queue: (() => void)[] = [];
  return {
    schedule: vi.fn((cb: () => void) => {
      queue.push(cb);
    }),
    flush: () => {
      const callbacks = queue.splice(0);
      for (const cb of callbacks) cb();
    },
  };
}

describe("createHoverScheduler", () => {
  it("resolves a burst of moves once per frame, at the last position", () => {
    const frames = manualFrames();
    const resolve = vi.fn();
    const hover = createHoverScheduler({ schedule: frames.schedule, resolve });
    hover.move({ x: 1, y: 1 }, 0);
    hover.move({ x: 2, y: 2 }, 0);
    hover.move({ x: 3, y: 3 }, 0);
    expect(resolve).not.toHaveBeenCalled();
    expect(frames.schedule).toHaveBeenCalledTimes(1);
    frames.flush();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith({ x: 3, y: 3 });
  });

  it("resolves nothing while a button is held", () => {
    const frames = manualFrames();
    const resolve = vi.fn();
    const hover = createHoverScheduler({ schedule: frames.schedule, resolve });
    hover.move({ x: 1, y: 1 }, 1);
    hover.move({ x: 2, y: 2 }, 2);
    frames.flush();
    expect(resolve).not.toHaveBeenCalled();
    expect(frames.schedule).not.toHaveBeenCalled();
  });

  it("drops a move queued before the button went down", () => {
    const frames = manualFrames();
    const resolve = vi.fn();
    const hover = createHoverScheduler({ schedule: frames.schedule, resolve });
    hover.move({ x: 1, y: 1 }, 0);
    hover.move({ x: 2, y: 2 }, 1);
    frames.flush();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("schedules again after a frame has run", () => {
    const frames = manualFrames();
    const resolve = vi.fn();
    const hover = createHoverScheduler({ schedule: frames.schedule, resolve });
    hover.move({ x: 1, y: 1 }, 0);
    frames.flush();
    hover.move({ x: 2, y: 2 }, 0);
    frames.flush();
    expect(resolve.mock.calls).toEqual([[{ x: 1, y: 1 }], [{ x: 2, y: 2 }]]);
  });

  it("cancel drops the pending move", () => {
    const frames = manualFrames();
    const resolve = vi.fn();
    const hover = createHoverScheduler({ schedule: frames.schedule, resolve });
    hover.move({ x: 1, y: 1 }, 0);
    hover.cancel();
    frames.flush();
    expect(resolve).not.toHaveBeenCalled();
  });
});
