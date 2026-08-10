/**
 * Per-layer visibility toggles for TOP-LEVEL city object groups.
 *
 * The groups are first-level CityJSON types: hiding "Building" hides its
 * `BuildingPart`s and `BuildingInstallation`s too (`toplevelCityObjectType` in
 * navara-core), which is the only fold that hides anything on real data — the
 * `Building` carries the semantics and the parts carry all the geometry.
 *
 * Its own component per row, like `LayerObjectCount`: the `useStreamStore`
 * subscription below would otherwise be a hook inside `LayerPanel`'s `.map()`,
 * and the number of rows changes whenever a layer is added or removed. Each
 * mounted instance has its own stable hook order instead.
 *
 * The disclosure renders the caret inline in the row and the list as a
 * full-width block UNDER it (`.layer-item` wraps) — the rows are dense and the
 * panel is 180–480 px wide, so an inline list would have nowhere to go.
 */

import { useState } from "react";
import { useLayerStore } from "../../features/layers/layerStore";
import type { Layer } from "../../features/layers/layerStore";
import { useStreamStore } from "../../features/streaming/streamStore";

export function LayerTypeToggles({ layer }: { readonly layer: Layer }) {
  const setHiddenTypes = useLayerStore((s) => s.setHiddenTypes);
  // A streaming layer's groups are discovered from the cells the worker
  // decodes, exactly like its LoD ladder, so they come from the stream store
  // rather than the (stub) model — see `Layer.availableObjectTypes`.
  const streamTypes = useStreamStore((s) => s.streams[layer.id]?.types);
  const [open, setOpen] = useState(false);

  const types = layer.isStreaming
    ? (streamTypes ?? [])
    : layer.availableObjectTypes;

  // A single-group static layer has nothing to choose between, and its list is
  // final. A streaming layer keeps the disclosure however few groups it has
  // seen so far, because that number only grows as the user pans.
  if (!layer.isStreaming && types.length <= 1) return null;

  const hidden = new Set(layer.hiddenTypes);

  const toggle = (type: string) => {
    // A fresh array every time: `handleSync` compares identity to decide
    // whether to rebuild the layer's geometry.
    setHiddenTypes(
      layer.id,
      hidden.has(type)
        ? layer.hiddenTypes.filter((t) => t !== type)
        : [...layer.hiddenTypes, type],
    );
  };

  return (
    <>
      <button
        className={`layer-types-btn ${open ? "is-open" : ""}`}
        aria-expanded={open}
        aria-label="Object types"
        title="Object types to show in this layer"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <svg viewBox="0 0 24 24" width="10" height="10">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="layer-types-list" onClick={(e) => e.stopPropagation()}>
          {types.length === 0 ? (
            <span className="layer-types-empty">
              Types appear as features stream in
            </span>
          ) : (
            types.map((type) => (
              <label className="layer-types-item" key={type}>
                <input
                  type="checkbox"
                  checked={!hidden.has(type)}
                  onChange={() => toggle(type)}
                />
                {type}
              </label>
            ))
          )}
        </div>
      )}
    </>
  );
}
