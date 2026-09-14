import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { WALKTHROUGH_STEPS } from "./steps";

export interface WalkthroughPersistence {
  hasSeen: () => boolean;
  markSeen: () => void;
}
export interface WalkthroughState {
  phase: "idle" | "welcome" | "active" | "finished";
  index: number;
  offer: () => void;
  start: () => void;
  next: () => void;
  back: () => void;
  dismiss: () => void;
}
export function createWalkthroughStore(persistence: WalkthroughPersistence) {
  let offered = false;
  const remember = () => {
    try {
      persistence.markSeen();
    } catch {
      /* Storage may be blocked. */
    }
  };
  return createStore<WalkthroughState>((set, get) => ({
    phase: "idle",
    index: 0,
    offer: () => {
      if (offered || get().phase !== "idle") return;
      offered = true;
      try {
        if (persistence.hasSeen()) return;
      } catch {
        /* Offer once in this session. */
      }
      set({ phase: "welcome" });
    },
    start: () => {
      remember();
      set({ phase: "active", index: 0 });
    },
    next: () => {
      if (get().phase !== "active") return;
      if (get().index === WALKTHROUGH_STEPS.length - 1) {
        remember();
        set({ phase: "finished" });
      } else set({ index: get().index + 1 });
    },
    back: () => {
      if (get().phase === "active")
        set({ index: Math.max(0, get().index - 1) });
    },
    dismiss: () => {
      remember();
      set({ phase: "idle" });
    },
  }));
}
const KEY = "roofy.walkthrough.seen.v1";
export const walkthroughStore = createWalkthroughStore({
  hasSeen: () => window.localStorage.getItem(KEY) === "1",
  markSeen: () => window.localStorage.setItem(KEY, "1"),
});
export const useWalkthroughStore = <T>(
  selector: (state: WalkthroughState) => T,
): T => useStore(walkthroughStore, selector);
