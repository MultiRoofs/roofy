import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { WALKTHROUGH_STEPS } from "./steps";
import { appPreferences } from "../../persistence/storage/appStorage";

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
const SEEN_KEY = "walkthrough-seen";
const PROGRESS_KEY = "walkthrough-progress";
export const walkthroughStore = createWalkthroughStore({
  hasSeen: () => appPreferences.get(SEEN_KEY) === "1",
  markSeen: () => appPreferences.set(SEEN_KEY, "1"),
  readProgress: () => {
    const raw = appPreferences.get(PROGRESS_KEY);
    return raw === null ? null : Number(raw);
  },
  writeProgress: (index) =>
    appPreferences.set(PROGRESS_KEY, index === null ? null : String(index)),
});
export const useWalkthroughStore = <T>(
  selector: (state: WalkthroughState) => T,
): T => useStore(walkthroughStore, selector);
