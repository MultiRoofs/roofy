/**
 * The LoD choice that applies to EVERY streaming layer, and the pure maths
 * behind the control that offers it.
 *
 * Why global rather than per-layer, when a static layer's LoD is per-layer: a
 * streaming layer's available LoDs are not known when the layer is created.
 * They are DISCOVERED — `buildLadder` (the plugin's levelPolicy) folds the
 * labels each commit actually observed into a growing ladder, published
 * through `handle.onLadder`. A per-layer dropdown populated at load time can
 * therefore only ever be empty, and one populated later would change its
 * options under the user's cursor as cells arrive. A single control fed by the
 * union of every stream's discovered ladder has the same information and one
 * place to show it.
 *
 * Kept out of `layerStore` on purpose. `Layer.selectedLod`/`Layer.lodMode` are
 * still the truth for a STATIC layer (`handleSync.syncLayers` pushes
 * `selectedLod` into `CityModelHandle.setLod`); a streaming layer's LoD now
 * comes from here, is pushed by `syncStreamState`, and so is automatically
 * adopted by a layer opened after the choice was made — which a "write the
 * choice into every streaming layer" design could not do without a global
 * value to copy from anyway.
 */
import { create } from "zustand";
import {
  cellSize,
  lodForCellSize,
  type Grid,
  type LodSelection,
} from "@cityjson/navara-flatcitybuf";

export interface StreamLodSelection {
  /** "auto": the streaming driver re-derives the LoD from the current cell
   *  size on every commit (`lodForCellSize`). "manual": `lod` is pinned
   *  everywhere, and `null` there means "all LoDs". */
  readonly mode: "auto" | "manual";
  readonly lod: string | null;
}

export interface StreamLodStore {
  /** One object, replaced as a whole: it is passed straight into
   *  `syncStreamState`, and a stable identity is what lets the viewport's
   *  streaming effect list it as a dependency without re-running per render. */
  readonly selection: StreamLodSelection;
  setMode: (mode: "auto" | "manual") => void;
  setLod: (lod: string | null) => void;
}

export const AUTO_SELECTION: StreamLodSelection = { mode: "auto", lod: null };

export const useStreamLodStore = create<StreamLodStore>((set) => ({
  selection: AUTO_SELECTION,

  setMode: (mode) =>
    set((s) =>
      s.selection.mode === mode
        ? s
        : // Switching to auto drops the pinned rung as well: the driver
          // ignores `lod` in auto mode, and keeping a stale one would make the
          // control offer to "return" to a LoD the ladder may no longer have.
          {
            selection:
              mode === "auto" ? AUTO_SELECTION : { mode, lod: s.selection.lod },
          },
    ),

  setLod: (lod) =>
    set((s) =>
      s.selection.mode === "manual" && s.selection.lod === lod
        ? s
        : // Choosing a rung IS choosing manual — a dropdown that needed a
          // separate mode click to take effect would look broken.
          { selection: { mode: "manual", lod } },
    ),
}));

/** The per-stream fields this module reads. Structural, so the helpers can be
 *  tested with plain objects and never need a real handle. */
export interface LadderLike {
  readonly ladder: ReadonlyArray<string>;
}

/**
 * Every LoD any open stream has actually seen, deduplicated.
 *
 * Sorted highest-detail FIRST, matching `computeAvailableLods` (the static
 * layers' dropdown) rather than the plugin's ascending ladder, so the two
 * dropdowns in the same panel do not read in opposite directions. Numeric
 * labels sort numerically; anything non-numeric keeps a stable lexicographic
 * order after them rather than being dropped (`buildLadder` admits them).
 */
export function unionLadder(
  streams: Readonly<Record<string, LadderLike>>,
): string[] {
  const set = new Set<string>();
  for (const s of Object.values(streams))
    for (const lod of s.ladder) set.add(lod);
  return [...set].sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    const aNum = a.trim() !== "" && !Number.isNaN(na);
    const bNum = b.trim() !== "" && !Number.isNaN(nb);
    if (aNum && bNum) return nb - na;
    if (aNum) return -1;
    if (bNum) return 1;
    return a.localeCompare(b);
  });
}

/** What `autoLodDescription` needs from one stream: the ladder it has
 *  discovered, the tile level its last commit settled on, and the grid that
 *  turns that level into metres. */
export interface AutoLodSource extends LadderLike {
  readonly level: number | null;
  readonly grid: Grid;
}

/**
 * A one-line read-out of what "auto" is currently resolving to, or `null` when
 * nothing can honestly be said yet.
 *
 * This is what made the old per-layer auto selector worth having: it answers
 * "why am I seeing this level of detail?" by naming the rung the driver picked
 * from the current cell size — the same `lodForCellSize` call the driver makes,
 * not a re-derivation that could disagree with it.
 *
 * `null` — never a guess — when no stream has committed yet (no level, so no
 * cell size), when no ladder has been discovered, or when the open streams
 * DISAGREE. Disagreement is real rather than theoretical: each layer chooses
 * its own level from its own grid, so two files of different extents can sit on
 * different rungs, and one "LoD 2.2" read-out would then be wrong for one of
 * them.
 */
export function autoLodDescription(
  streams: Readonly<Record<string, AutoLodSource>>,
): string | null {
  let agreed: string | null = null;
  for (const s of Object.values(streams)) {
    if (s.level === null || s.ladder.length === 0) return null;
    const described = describeLodSelection(
      lodForCellSize(s.ladder, cellSize(s.grid, s.level)),
    );
    if (agreed === null) agreed = described;
    else if (agreed !== described) return null;
  }
  return agreed;
}

export function describeLodSelection(sel: LodSelection): string {
  if (sel.kind === "exact") return `LoD ${sel.lod}`;
  // `{kind:"unlabelled"}` is unreachable from `lodForCellSize` today (see the
  // plugin's `lodToWireLabel` — a ladder of length 0 already maps to "all")
  // but handled here rather than silently mismatching `LodSelection`'s type.
  if (sel.kind === "unlabelled") return "Unlabelled";
  return "All LoDs";
}
