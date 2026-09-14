import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { WALKTHROUGH_STEPS } from "./steps";

export interface WalkthroughPersistence {
  hasSeen: () => boolean;
  markSeen: () => void;
  readProgress?: () => number | null;
  writeProgress?: (index: number | null) => void;
}
export interface WalkthroughState {
  phase: "idle" | "welcome" | "active" | "finished";
  index: number;
  seen: boolean;
  canResume: boolean;
  resume: () => void;
  offer: () => void;
  start: () => void;
  next: () => void;
  back: () => void;
  dismiss: () => void;
}
export function createWalkthroughStore(persistence: WalkthroughPersistence) {
  let offered = false;
  let seen = false;
  let progress: number | null = null;
  try {
    seen = persistence.hasSeen();
    progress = persistence.readProgress?.() ?? null;
  } catch {
    /* Storage may be blocked. */
  }
  if (
    !Number.isInteger(progress) ||
    progress === null ||
    progress < 0 ||
    progress >= WALKTHROUGH_STEPS.length
  )
    progress = null;
  const saveProgress = (index: number | null) => {
    try {
      persistence.writeProgress?.(index);
    } catch {
      /* Keep session progress. */
    }
  };

  const remember = () => {
    try {
      persistence.markSeen();
    } catch {
      /* Storage may be blocked. */
    }
  };
  return createStore<WalkthroughState>((set, get) => ({
    phase: "idle",
    index: progress ?? 0,
    seen,
    canResume: progress !== null,
    resume: () => {
      if (get().canResume) set({ phase: "active" });
      else get().start();
    },
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
      saveProgress(0);
      set({ phase: "active", index: 0, seen: true, canResume: true });
    },
    next: () => {
      if (get().phase !== "active") return;
      if (get().index === WALKTHROUGH_STEPS.length - 1) {
        remember();
        saveProgress(null);
        set({ phase: "finished", seen: true, canResume: false });
      } else {
        saveProgress(get().index + 1);
        set({ index: get().index + 1 });
      }
    },
    back: () => {
      if (get().phase === "active") {
        const index = Math.max(0, get().index - 1);
        saveProgress(index);
        set({ index });
      }
    },
    dismiss: () => {
      remember();
      set({ phase: "idle", seen: true });
    },
  }));
}
const KEY = "roofy.walkthrough.seen.v1";
export const walkthroughStore = createWalkthroughStore({
  hasSeen: () => window.localStorage.getItem(KEY) === "1",
  markSeen: () => window.localStorage.setItem(KEY, "1"),
  readProgress: () => {
    const raw = window.localStorage.getItem(`${KEY}.progress`);
    return raw === null ? null : Number(raw);
  },
  writeProgress: (index) => {
    if (index === null) window.localStorage.removeItem(`${KEY}.progress`);
    else window.localStorage.setItem(`${KEY}.progress`, String(index));
  },
});
export const useWalkthroughStore = <T>(
  selector: (state: WalkthroughState) => T,
): T => useStore(walkthroughStore, selector);
