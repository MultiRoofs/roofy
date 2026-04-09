/**
 * Per-layer LoD selector dropdown.
 *
 * Shows available LoDs for a layer and lets the user choose which
 * one to render. Always visible even with a single LoD so the user
 * knows what's available.
 */

import { useLayerStore } from "../../features/layers/layerStore";

interface LodSelectorProps {
  readonly layerId: string;
  readonly availableLods: ReadonlyArray<string>;
  readonly selectedLod: string | null;
}

export function LodSelector({
  layerId,
  availableLods,
  selectedLod,
}: LodSelectorProps) {
  const setLayerLod = useLayerStore((s) => s.setLayerLod);

  if (availableLods.length === 0) return null;

  return (
    <select
      className="lod-select"
      value={selectedLod ?? ""}
      onChange={(e) => setLayerLod(layerId, e.target.value || null)}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      title="Level of Detail"
    >
      {availableLods.map((lod) => (
        <option key={lod} value={lod}>
          LoD {lod}
        </option>
      ))}
    </select>
  );
}
