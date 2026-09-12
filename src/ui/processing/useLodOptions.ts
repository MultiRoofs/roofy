/**
 * Spec §6's LoD select, for one tool on one target.
 *
 * A hook rather than a pure function because a STREAMING target's options come
 * from the resident set, which changes on every camera settle — the
 * `useStreamStore` selector below is what subscribes the form to that
 * (`residentModel.ts` documents the version parameter as exactly this
 * subscription marker). A static layer's options never move, and the hook
 * memoises on the model's identity.
 *
 * AN UNIMPLEMENTED TOOL GETS NOTHING. A tool whose executor has not shipped has
 * no source of truthful counts, and printing "No solid geometry in this layer"
 * for it would be a verdict on the user's data that the app never reached. Its
 * row already says the true thing — "Not available yet" — and its form shows no
 * LoD control at all.
 */
import { useMemo } from "react";
import type { Layer } from "../../features/layers/layerStore";
import type { ToolDefinition } from "../../features/processing/types";
import {
  roofLodOptions,
  type LodOption,
} from "../../features/processing/roofGeometrySource";
import { solidLodOptions } from "../../features/processing/solidGeometrySource";
import { useStreamStore } from "../../features/streaming/streamStore";

export interface LodChoices {
  readonly options: ReadonlyArray<LodOption>;
  /** The tail of an option's label: "2.2 (1,115 buildings <noun>)". */
  readonly noun: string;
  /** Spec §6: the empty select's text, and Run's reason. Null when it fits. */
  readonly emptyReason: string | null;
}

/**
 * No answer at all — not "no LoD qualifies", which is a verdict.
 *
 * Exported because `useToolForm` substitutes it for a target the tool is
 * REFUSED on (§5's reasons): the hook cannot see eligibility, and a form that
 * cannot run here has nothing true to say about the layer's geometry.
 */
export const NO_LOD: LodChoices = { options: [], noun: "", emptyReason: null };

export function useLodOptions(
  tool: ToolDefinition,
  target: Layer | null,
): LodChoices {
  // Subscribes the form to the stream's commits; 0 for a static layer.
  const version = useStreamStore((s) =>
    target === null ? 0 : (s.streams[target.id]?.version ?? 0),
  );
  const model = target?.model ?? null;
  const isStreaming = target?.isStreaming ?? false;
  return useMemo(() => {
    if (!tool.needsLod || !tool.implemented || target === null) return NO_LOD;
    if (tool.id === "roof-metrics") {
      const options = roofLodOptions(target);
      return {
        options,
        noun: "with roof surfaces",
        emptyReason:
          options.length === 0 ? "No roof surfaces in this layer" : null,
      };
    }
    if (tool.id === "measure-solids") {
      // §6, verbatim: the option reads "2.2 (1,115 buildings with a solid)" and
      // the empty select reads "No solid geometry in this layer". TAGS ONLY
      // (`solidLodOptions`) — opening a dropdown measures nothing.
      const options = solidLodOptions(target);
      return {
        options,
        noun: "with a solid",
        emptyReason:
          options.length === 0 ? "No solid geometry in this layer" : null,
      };
    }
    return NO_LOD;
    // `version` and `model` are the two things that can change the answer: a
    // streaming commit, or a layer whose model was replaced (`mergeAttributes`
    // mints a new one). `target` itself changes identity on every layer patch,
    // so it is deliberately not a dependency of its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tool.needsLod,
    tool.implemented,
    tool.id,
    target?.id,
    isStreaming,
    model,
    version,
  ]);
}
