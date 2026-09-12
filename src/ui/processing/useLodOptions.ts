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
 * AN UNIMPLEMENTED TOOL GETS NOTHING. Measure solids and Validate solids need
 * "does this object have a SOLID at this LoD", which nothing in M2 can answer;
 * printing "No solid geometry in this layer" for them would be a verdict on the
 * user's data that the app never reached. Their rows already say the true
 * thing — "Not available yet" — and their forms show no LoD control at all.
 */
import { useMemo } from "react";
import type { Layer } from "../../features/layers/layerStore";
import type { ToolDefinition } from "../../features/processing/types";
import {
  roofLodOptions,
  type LodOption,
} from "../../features/processing/roofGeometrySource";
import { useStreamStore } from "../../features/streaming/streamStore";

export interface LodChoices {
  readonly options: ReadonlyArray<LodOption>;
  /** The tail of an option's label: "2.2 (1,115 buildings <noun>)". */
  readonly noun: string;
  /** Spec §6: the empty select's text, and Run's reason. Null when it fits. */
  readonly emptyReason: string | null;
}

const NO_LOD: LodChoices = { options: [], noun: "", emptyReason: null };

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
    if (tool.id !== "roof-metrics") return NO_LOD;
    const options = roofLodOptions(target);
    return {
      options,
      noun: "with roof surfaces",
      emptyReason:
        options.length === 0 ? "No roof surfaces in this layer" : null,
    };
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
