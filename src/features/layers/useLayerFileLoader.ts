/**
 * Hook for loading city model files into the layer store.
 *
 * Extracts the file-loading logic from the app shell so it can be
 * reused by both the landing page and the "add layer" UI.
 */

import { useCallback, useRef, useState } from "react";
import type { CityModel } from "../../domain/citymodel/types";
import { detectEncoding } from "../../domain/citymodel/detectEncoding";
import {
  parseText,
  loadFromUrl,
  fileNameFromUrl,
  decodeModelBytes,
} from "../../domain/citymodel/loadCityModel";
import { useLayerStore } from "./layerStore";
import { openStreamingLayer } from "../streaming/openStreamingLayer";
import {
  requireStreamPlugin,
  type StreamPlugin,
} from "../streaming/streamPlugin";
import type { Rule } from "../rules/types";

/** Optional per-layer settings to apply instead of the usual fresh-layer
 *  defaults (rules: [], rulesEnabled: true, visible: true, lodMode: "auto")
 *  — used when re-linking a file to a layer restored from a snapshot, so
 *  the saved rules/visibility/LoD survive the re-selection (see App.tsx's
 *  "unavailable layers" resolve flow). */
export interface LayerOverrides {
  readonly rules?: ReadonlyArray<Rule>;
  readonly rulesEnabled?: boolean;
  readonly visible?: boolean;
  readonly lodMode?: "auto" | "manual";
  readonly selectedLod?: string | null;
  /** Applied at creation, not afterwards: the layer is built (or its first
   *  cell fetched) already filtered. */
  readonly hiddenTypes?: ReadonlyArray<string>;
}

function applyPostCreateOverrides(
  layerId: string,
  overrides: LayerOverrides | undefined,
): void {
  if (!overrides) return;
  if (overrides.lodMode === "manual") {
    useLayerStore.getState().setLodMode(layerId, "manual");
  }
  if (overrides.selectedLod !== undefined && overrides.selectedLod !== null) {
    const layer = useLayerStore.getState().layers.find((l) => l.id === layerId);
    // Only apply a saved LoD that actually exists on the (possibly
    // different) file being re-linked — an invalid value would silently
    // pin a LoD the new content never renders.
    if (layer?.availableLods.includes(overrides.selectedLod)) {
      useLayerStore.getState().setLayerLod(layerId, overrides.selectedLod);
    }
  }
}

export interface LayerFileLoader {
  addLayerFromFile: (
    file: File,
    overrides?: LayerOverrides,
  ) => Promise<string | null>;
  addLayerFromUrl: (url: string) => Promise<string | null>;
  loading: boolean;
  error: string | null;
  clearError: () => void;
}

export interface LayerFileLoaderOptions {
  /**
   * How to obtain the live FlatCityBuf plugin for a `.fcb` source.
   *
   * A promise, not an instance: a viewport that is still starting hands the
   * plugin out through `CitySceneHandle.getStreamingPlugin()`, which QUEUES
   * behind its `ready` gate instead of failing a `.fcb` opened during the
   * first render (Task C13). Defaults to `requireStreamPlugin()`, which throws
   * a user-facing "the 3D engine is not running yet" for a caller that has no
   * viewport to ask — the error state below surfaces either one identically.
   */
  readonly resolveStreamPlugin?: () => Promise<StreamPlugin>;
}

const defaultResolveStreamPlugin = async (): Promise<StreamPlugin> =>
  requireStreamPlugin();

export function useLayerFileLoader(
  options: LayerFileLoaderOptions = {},
): LayerFileLoader {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Through a ref, so an inline `resolveStreamPlugin={() => …}` cannot change
  // the identity of the two loaders below — `App.tsx` lists them in dependency
  // arrays, and a new function per render would re-run those effects.
  const resolveStreamPlugin = useRef(
    options.resolveStreamPlugin ?? defaultResolveStreamPlugin,
  );
  resolveStreamPlugin.current =
    options.resolveStreamPlugin ?? defaultResolveStreamPlugin;

  const addLayerFromFile = useCallback(
    async (file: File, overrides?: LayerOverrides): Promise<string | null> => {
      setError(null);
      setLoading(true);
      try {
        let layerId: string;
        if (detectEncoding(file.name) === "flatcitybuf") {
          // A `File` IS a `Blob` — passed straight through, never read into
          // an ArrayBuffer first (see openStreamingLayer.ts's doc comment
          // on why fromBytes' copy would OOM a multi-GB local file).
          layerId = await openStreamingLayer({
            plugin: await resolveStreamPlugin.current(),
            source: { blob: file },
            name: file.name,
            modelRef: { type: "file", fileName: file.name },
            rules: overrides?.rules,
            rulesEnabled: overrides?.rulesEnabled,
            visible: overrides?.visible,
            hiddenTypes: overrides?.hiddenTypes,
          });
        } else {
          // Bytes, not `file.text()`: a dropped `.city.json.gz` — the form 3D
          // BAG ships in, and therefore the form a user saves off the catalog
          // — would otherwise reach the parser as mojibake. `decodeModelBytes`
          // decides on the MAGIC BYTES, so an uncompressed file still takes the
          // plain UTF-8 path.
          const text = await decodeModelBytes(
            new Uint8Array(await file.arrayBuffer()),
          );
          const parsed: CityModel = parseText(file.name, text);
          layerId = useLayerStore.getState().addLayer({
            name: file.name,
            model: parsed,
            modelRef: { type: "file", fileName: file.name },
            visible: overrides?.visible ?? true,
            rules: overrides?.rules ?? [],
            rulesEnabled: overrides?.rulesEnabled ?? true,
            hiddenTypes: overrides?.hiddenTypes,
          });
        }
        applyPostCreateOverrides(layerId, overrides);
        return layerId;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to parse file.");
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const addLayerFromUrl = useCallback(
    async (url: string): Promise<string | null> => {
      setError(null);
      setLoading(true);
      try {
        if (detectEncoding(url) === "flatcitybuf") {
          return await openStreamingLayer({
            plugin: await resolveStreamPlugin.current(),
            source: { url },
            name: fileNameFromUrl(url),
            modelRef: { type: "url", url },
          });
        }

        const parsed = await loadFromUrl(url);
        return useLayerStore.getState().addLayer({
          name: fileNameFromUrl(url),
          model: parsed,
          modelRef: { type: "url", url },
          visible: true,
          rules: [],
          rulesEnabled: true,
        });
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Failed to load remote file.",
        );
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const clearError = useCallback(() => setError(null), []);

  return { addLayerFromFile, addLayerFromUrl, loading, error, clearError };
}
