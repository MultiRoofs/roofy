import { describe, expect, it } from "vitest";
import {
  createWalkthroughStore,
  type WalkthroughPersistence,
} from "../../../../src/features/walkthrough/walkthroughStore";

function setup(seen = false) {
  const persistence: WalkthroughPersistence = {
    hasSeen: () => seen,
    markSeen: () => {
      seen = true;
    },
  };
  return createWalkthroughStore(persistence);
}
describe("walkthrough lifecycle", () => {
  it("offers a first visit once and respects dismissal", () => {
    const store = setup();
    store.getState().offer();
    expect(store.getState().phase).toBe("welcome");
    store.getState().dismiss();
    store.getState().offer();
    expect(store.getState().phase).toBe("idle");
  });
  it("does not interrupt returning visitors but can replay", () => {
    const store = setup(true);
    store.getState().offer();
    expect(store.getState().phase).toBe("idle");
    store.getState().start();
    expect(store.getState()).toMatchObject({ phase: "active", index: 0 });
  });
  it("supports back, skip and restart without going out of range", () => {
    const store = setup();
    store.getState().start();
    store.getState().back();
    expect(store.getState().index).toBe(0);
    store.getState().next();
    expect(store.getState().index).toBe(1);
    store.getState().back();
    expect(store.getState().index).toBe(0);
    for (let i = 0; i < 30; i++) store.getState().next();
    expect(store.getState().phase).toBe("finished");
    store.getState().start();
    expect(store.getState().index).toBe(0);
  });
  it("still works when persistence is unavailable", () => {
    const store = createWalkthroughStore({
      hasSeen: () => {
        throw Error();
      },
      markSeen: () => {
        throw Error();
      },
    });
    expect(() => store.getState().offer()).not.toThrow();
    expect(() => store.getState().start()).not.toThrow();
    expect(store.getState().phase).toBe("active");
  });
});
