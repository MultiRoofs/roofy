/**
 * Per-layer appearance selector: which of the model's CityJSON appearance
 * themes to draw — a TEXTURE theme (images on the facades) or a MATERIAL
 * theme (per-surface diffuse colours) — or none, which is the semantic /
 * rule colouring the viewer has always drawn.
 *
 * Rendered next to `LodSelector` in the layer row, only for a layer whose
 * model carries at least one theme; a model without appearance never shows
 * it, so the row is unchanged for the common case.
 *
 * Textures are the DATASET's images: a relative `image` path resolves
 * against the URL the layer was loaded from. A layer that came from a local
 * file has no such URL, so its relative images cannot be fetched and those
 * faces keep their colours — the control says so in its tooltip rather than
 * hiding the theme, because the choice itself is still meaningful (a
 * snapshot restored from a URL later will draw it).
 */

import type { AppearanceTheme } from "@cityjson/navara-core";
import { useLayerStore } from "../../features/layers/layerStore";
import {
  appearanceFromOptionValue,
  appearanceOptionValue,
} from "./appearanceOption";

interface AppearanceSelectorProps {
  readonly layerId: string;
  readonly themes: ReadonlyArray<AppearanceTheme>;
  readonly selected: AppearanceTheme | null;
  /** Whether relative texture paths can be fetched (the layer has a URL). */
  readonly texturesResolvable: boolean;
}

export function AppearanceSelector({
  layerId,
  themes,
  selected,
  texturesResolvable,
}: AppearanceSelectorProps) {
  const setLayerAppearance = useLayerStore((s) => s.setLayerAppearance);
  if (themes.length === 0) return null;

  const localFileNote =
    !texturesResolvable && selected?.kind === "texture"
      ? " — this layer was loaded from a local file, so its relative texture images cannot be fetched; those surfaces keep their colours"
      : "";

  return (
    <select
      className="lod-select appearance-select"
      aria-label="Appearance"
      value={appearanceOptionValue(selected)}
      onChange={(e) =>
        setLayerAppearance(
          layerId,
          appearanceFromOptionValue(e.target.value, themes),
        )
      }
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      title={`Appearance (texture or material theme)${localFileNote}`}
    >
      <option value="">None</option>
      {themes.map((theme) => (
        <option
          key={appearanceOptionValue(theme)}
          value={appearanceOptionValue(theme)}
        >
          {theme.kind === "texture" ? "Texture" : "Material"}: {theme.name}
        </option>
      ))}
    </select>
  );
}
