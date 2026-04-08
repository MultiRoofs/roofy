/**
 * Hook for loading city model files into the layer store.
 *
 * Extracts the file-loading logic from the app shell so it can be
 * reused by both the landing page and the "add layer" UI.
 */

import { useCallback, useState } from "react";
import type { CityModel } from "../../domain/citymodel/types";
import { detectEncoding } from "../../domain/citymodel/detectEncoding";
import { loadFlatCityBuf } from "../../domain/citymodel/flatcitybuf/loadFlatCityBuf";
import { parseText, loadFromUrl, fileNameFromUrl } from "../../domain/citymodel/loadCityModel";
import { useLayerStore } from "./layerStore";

export interface LayerFileLoader {
  addLayerFromFile: (file: File) => Promise<string | null>;
  addLayerFromUrl: (url: string) => Promise<string | null>;
  loading: boolean;
  error: string | null;
  clearError: () => void;
}

export function useLayerFileLoader(): LayerFileLoader {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addLayerFromFile = useCallback(async (file: File): Promise<string | null> => {
    setError(null);
    setLoading(true);
    try {
      let parsed: CityModel;

      if (detectEncoding(file.name) === "flatcitybuf") {
        const blobUrl = URL.createObjectURL(file);
        try {
          parsed = await loadFlatCityBuf(blobUrl);
        } finally {
          URL.revokeObjectURL(blobUrl);
        }
      } else {
        const text = await file.text();
        parsed = parseText(file.name, text);
      }

      const id = useLayerStore.getState().addLayer({
        name: file.name,
        model: parsed,
        modelRef: { type: "file", fileName: file.name },
        visible: true,
        rules: [],
        rulesEnabled: true,
      });
      return id;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse file.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const addLayerFromUrl = useCallback(async (url: string): Promise<string | null> => {
    setError(null);
    setLoading(true);
    try {
      const parsed = await loadFromUrl(url);
      const id = useLayerStore.getState().addLayer({
        name: fileNameFromUrl(url),
        model: parsed,
        modelRef: { type: "url", url },
        visible: true,
        rules: [],
        rulesEnabled: true,
      });
      return id;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load remote file.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { addLayerFromFile, addLayerFromUrl, loading, error, clearError };
}
