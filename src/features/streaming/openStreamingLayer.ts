/**
 * Opens a `.fcb` source (URL or local `File`/`Blob`) for viewport streaming
 * and registers everything a streaming layer needs to exist:
 *
 *  1. Spin up a dedicated `WorkerClient` and send it `{type:"open", ...}`.
 *  2. If the worker refuses admission (`fcbSource.ts`'s `checkAdmission`) or
 *     the open otherwise fails, terminate the worker and throw a clear
 *     message — the same "throws, caller catches and shows it" contract
 *     `loadFromUrl`/`parseText` already use, so callers don't need a second
 *     error-handling shape for streaming vs. non-streaming layers.
 *  3. On success, build the `Grid` from the header's extent (the worker
 *     already built its OWN copy internally for traversal, but doesn't send
 *     it back over the wire — `makeGrid` is a pure function of the same
 *     extent, so recomputing it here is cheap and avoids widening the wire
 *     protocol just to carry a `Grid` literal), a fresh `CellCache` under
 *     the resident budget constants, and a stub `CityModel` (bbox from the
 *     header extent, `objects: {}` — see `streamStore.ts`'s doc comment for
 *     why a streaming layer's model is intentionally never materialized).
 *  4. Register the `Layer` (via `useLayerStore.addLayer`, `isStreaming:
 *     true`) and the `StreamState` (via `useStreamStore.register`) as one
 *     atomic-looking step from the caller's perspective.
 *
 * The **caller must pass a `Blob`, never an `ArrayBuffer`**, for a local
 * file — `fcbSource.ts`'s `openFcb` uses `FcbReader.fromBlob` for true range
 * access; `fromBytes` copies its whole input and would OOM a multi-GB file.
 * A `File` already IS a `Blob`, so passing it straight through (as this
 * module and its callers do) satisfies that without any extra step.
 */
import { WorkerClient } from "./workerClient";
import { makeGrid } from "./tileGrid";
import { CellCache } from "./cellCache";
import { RESIDENT_TRIANGLE_BUDGET, RESIDENT_BYTE_BUDGET } from "./constants";
import {
  useStreamStore,
  type CellEntry,
  type StreamState,
} from "./streamStore";
import { useLayerStore } from "../layers/layerStore";
import type { CityModel } from "../../domain/citymodel/types";
import type { CityModelReference } from "../../persistence/types";
import type {
  AdmissionError,
  FcbHeaderModel,
} from "../../domain/citymodel/flatcitybuf/fcbSource";
import type { Rule } from "../rules/types";

export interface OpenStreamingLayerInput {
  readonly source: { readonly url: string } | { readonly blob: Blob };
  readonly name: string;
  readonly modelRef: CityModelReference;
  readonly rules?: ReadonlyArray<Rule>;
  readonly rulesEnabled?: boolean;
  readonly visible?: boolean;
}

export async function openStreamingLayer(
  input: OpenStreamingLayerInput,
): Promise<string> {
  const client = new WorkerClient();
  try {
    const resp = await client.send(
      "url" in input.source
        ? { type: "open", url: input.source.url }
        : { type: "open", blob: input.source.blob },
    );
    if (resp.type === "error") {
      throw new Error(resp.message);
    }
    if (resp.type !== "opened") {
      throw new Error(
        `Unexpected response opening "${input.name}": ${resp.type}`,
      );
    }

    // Cast at the true boundary: the worker builds `header`/`admission` via
    // `headerModel`/`checkAdmission` (fcbSource.ts) before posting them, so
    // this is the wire's `unknown` catching up with what the worker actually
    // sent — not an unchecked assumption about foreign data.
    const header = resp.header as FcbHeaderModel;
    const admission = resp.admission as AdmissionError | null;
    if (admission) {
      throw new Error(admission.message);
    }
    if (!header.extent) {
      // Unreachable given checkAdmission's contract (its only extent-less
      // branch, "no-extent", is what `admission` above would have caught) —
      // defensive, not a real path today.
      throw new Error(`"${input.name}" has no usable geographical extent.`);
    }

    const grid = makeGrid(header.extent);
    const cache = new CellCache<CellEntry>({
      maxTriangles: RESIDENT_TRIANGLE_BUDGET,
      maxBytes: RESIDENT_BYTE_BUDGET,
    });
    const model: CityModel = {
      sourceEncoding: "flatcitybuf",
      metadata: { referenceSystem: header.referenceSystem },
      bbox: header.extent,
      objects: {},
      vertexCount: 0,
    };
    const stream: StreamState = {
      client,
      grid,
      header,
      cache,
      level: null,
      ladder: [],
      ladderVersion: 0,
      status: "idle",
      message: null,
      lastCommit: null,
      version: 0,
    };

    const layerId = useLayerStore.getState().addLayer({
      name: input.name,
      model,
      modelRef: input.modelRef,
      visible: input.visible ?? true,
      rules: input.rules ?? [],
      rulesEnabled: input.rulesEnabled ?? true,
      isStreaming: true,
    });
    useStreamStore.getState().register(layerId, stream);
    return layerId;
  } catch (err) {
    // Whether admission refused, the open response errored, or anything
    // above threw: this worker never got registered, so nothing else will
    // ever terminate it — do so here or it leaks for the lifetime of the tab.
    client.terminate();
    throw err;
  }
}
