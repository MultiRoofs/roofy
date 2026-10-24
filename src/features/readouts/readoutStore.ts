/**
 * The status bar's live readouts: the cursor's WGS84 position and the time the
 * last frame took.
 *
 * A store of their own so that writing them re-renders the status bar and
 * nothing else. The cursor changes at pointer rate; held in `App` state it
 * re-rendered the whole shell, and the viewport with it, on every move.
 */
import { create } from "zustand";

export type CursorPosition = readonly [
  lng: number,
  lat: number,
  height: number,
];

interface ReadoutState {
  /** Under the pointer, or null over the sky and off the canvas. */
  readonly cursor: CursorPosition | null;
  /** CPU time of the last rendered frame, in milliseconds; null before one. */
  readonly frameMs: number | null;
  readonly setCursor: (cursor: CursorPosition | null) => void;
  readonly setFrameMs: (ms: number | null) => void;
  readonly reset: () => void;
}

export const useReadoutStore = create<ReadoutState>((set) => ({
  cursor: null,
  frameMs: null,
  setCursor: (cursor) => set({ cursor }),
  setFrameMs: (frameMs) => set({ frameMs }),
  reset: () => set({ cursor: null, frameMs: null }),
}));
