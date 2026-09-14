import { create } from "zustand";
export type SceneSheet = "sun" | "settings" | null;
export const useSceneSheetStore = create<{
  sheet: SceneSheet;
  setSheet: (sheet: SceneSheet) => void;
}>((set) => ({ sheet: null, setSheet: (sheet) => set({ sheet }) }));
