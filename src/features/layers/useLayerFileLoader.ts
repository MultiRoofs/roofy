/**
 * Hook for loading city model files into the layer store.
 *
 * Extracts the file-loading logic from the app shell so it can be
 * reused by both the landing page and the "add layer" UI.
 */

import { useCallback, useState } from "react";
import type { CityModel } from "../../domain/citymodel/types";
import { detectEncoding } from "../../domain/citymodel/detectEncoding";
import {
  parseText,
  loadFromUrl,
  fileNameFromUrl,
} from "../../domain/citymodel/loadCityModel";
import { useLayerStore } from "./layerStore";
import { openStreamingLayer } from "../streaming/openStreamingLayer";
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

export function useLayerFileLoader(): LayerFileLoader {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
            source: { blob: file },
            name: file.name,
            modelRef: { type: "file", fileName: file.name },
            rules: overrides?.rules,
            rulesEnabled: overrides?.rulesEnabled,
            visible: overrides?.visible,
          });
        } else {
          const text = await file.text();
          const parsed: CityModel = parseText(file.name, text);
          layerId = useLayerStore.getState().addLayer({
            name: file.name,
            model: parsed,
            modelRef: { type: "file", fileName: file.name },
            visible: overrides?.visible ?? true,
            rules: overrides?.rules ?? [],
            rulesEnabled: overrides?.rulesEnabled ?? true,
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
