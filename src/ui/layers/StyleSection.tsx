import { useState } from "react";
/**
 * "How is this layer drawn?" — the first of the active layer's three
 * sections, and the one open by default, because it is the question a user
 * has about a layer they just clicked.
 *
 * What that means differs by kind, and the section answers in the kind's own
 * terms rather than showing a lowest-common-denominator form:
 *
 *  - a CITY layer (static or streaming) opens on ONE question, `Color by`:
 *    the semantic surface palette, the user's rules, or one colour for the
 *    whole layer. The select is the layer's `colorBy` and nothing else reads
 *    or writes that mode — it replaced the rule editor's own On/Off checkbox
 *    (R10), which was a second answer to the same question and could disagree
 *    with this one;
 *  - a VECTOR layer has the flat per-layer style plus its opacity;
 *  - a RASTER layer has opacity and nothing else: its pixels arrive already
 *    drawn;
 *  - a 3D TILESET has nothing, and says so — an empty box reads as a bug.
 *
 * There is no colormap for a raster and no per-rule appearance here: the
 * engine offers no handle for either (see `docs/architecture-notes.md`), and
 * a control that cannot do anything is worse than its absence.
 */
import { useLayerStore } from "../../features/layers/layerStore";
import { COLOR_BY_MODES, type ColorBy } from "../../features/rules/colorBy";
import { SINGLE_COLOR_HEX } from "../../scene/cityColors";
import type { ActiveLayer } from "../../features/workspace/activeLayer";
import { RulesEditor } from "./RulesEditor";
import { useRuleDraftStore } from "../../features/rules/ruleDraftStore";
import { SurfaceTypePalette } from "./SurfaceTypePalette";
import { GeoOpacityControl, GeoVectorStyleFields } from "./GeoStyleControls";

/** The select's options, in the order a user meets them: the default first,
 *  then the powerful one, then the blunt one. */
const MODE_LABELS: Readonly<Record<ColorBy, string>> = {
  surface: "Surface type",
  rules: "Rules",
  single: "Single colour",
};

/**
 * The affected-unit line — "Delft · Color roof surfaces by rules".
 *
 * Named rather than assumed: a user with three city layers open is one click
 * away from painting Rotterdam's roofs while reading Delft's name in the list,
 * and this line is what makes the mistake visible before the map does.
 */
const MODE_PHRASES: Readonly<Record<ColorBy, string>> = {
  surface: "Color roof surfaces by surface type",
  rules: "Color roof surfaces by rules",
  single: "Color roof surfaces with one colour",
};

export function StyleSection({ item }: { readonly item: ActiveLayer }) {
  if (item.kind === "city") {
    return <CityStyleFields layerId={item.layer.id} />;
  }

  const layer = item.layer;
  if (layer.kind === "3d-tiles") {
    return <p className="active-layer-note">No style options</p>;
  }

  return (
    <div className="active-layer-fields">
      {/* A caption, not a `<label>`: the slider carries its own `aria-label`
          (the two read the same), and wrapping it would give the control two
          labelling paths to the same name. */}
      <div className="active-layer-field">
        <span className="active-layer-field-label" aria-hidden>
          Opacity
        </span>
        <GeoOpacityControl layer={layer} />
      </div>
      {layer.kind === "geojson" && <GeoVectorStyleFields layer={layer} />}
    </div>
  );
}

/**
 * Subscribed to the STORE by id rather than reading the `ActiveLayer` record
 * it was rendered from: that record was captured by `ActiveLayerPanel` at its
 * own render, so the moment this select writes a new mode the prop is one
 * mode behind — and the section would show the old mode's body under the new
 * mode's select until something else happened to re-render the panel.
 *
 * `RulesEditor` already reads the layer this way, for the same reason.
 */
function CityStyleFields({ layerId }: { readonly layerId: string }) {
  const layer = useLayerStore((s) => s.layers.find((l) => l.id === layerId));
  const updateLayer = useLayerStore((s) => s.updateLayer);
  const layers = useLayerStore((s) => s.layers);
  const copyStyle = useLayerStore((s) => s.copyStyle);
  const [copyOpen, setCopyOpen] = useState(false);
  const [sourceId, setSourceId] = useState("");
  const [copied, setCopied] = useState("");
  // Subscribed, not read once: the draft is written from OUTSIDE this tree
  // (the processing card's "Style by result"), so nothing else would re-render
  // the section when it appears.
  const draftOpen = useRuleDraftStore((s) => s.drafts[layerId]?.open === true);
  if (layer === undefined) return null;

  // `?? "surface"` for a record that predates the field: the mode that paints
  // nothing is the safe reading of "we do not know", the same fail-safe
  // `effectiveRules` applies to an unrecognised mode.
  const colorBy: ColorBy = layer.colorBy ?? "surface";

  return (
    <div className="style-city">
      <button
        type="button"
        className="active-layer-action"
        aria-expanded={copyOpen}
        onClick={() => setCopyOpen(!copyOpen)}
      >
        Copy from…
      </button>
      {copyOpen && (
        <div className="style-copy-fields">
          <label>
            Source layer
            <select
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
            >
              <option value="">Choose a layer</option>
              {layers
                .filter((l) => l.id !== layerId)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
          </label>
          <p className="active-layer-note">
            Replaces this layer’s style and rules. Attributes used by rules must
            exist in this layer.
          </p>
          <button
            type="button"
            disabled={
              !layers.some((l) => l.id === sourceId && l.id !== layerId)
            }
            onClick={() => {
              copyStyle(layerId, sourceId);
              setCopied(
                `Style copied from ${layers.find((l) => l.id === sourceId)?.name}`,
              );
              setCopyOpen(false);
            }}
          >
            Copy style
          </button>
        </div>
      )}
      {copied && (
        <p role="status" className="active-layer-note">
          {copied}
        </p>
      )}
      <label className="style-field">
        <span className="style-field-label">Color by</span>
        <select
          className="rule-select"
          value={colorBy}
          onChange={(e) =>
            updateLayer(layerId, { colorBy: e.target.value as ColorBy })
          }
        >
          {COLOR_BY_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {MODE_LABELS[mode]}
            </option>
          ))}
        </select>
      </label>

      <p className="style-affected">
        {layer.name} &middot; {MODE_PHRASES[colorBy]}
      </p>

      {colorBy === "surface" && <SurfaceTypePalette />}

      {/* The editor branches on `isStreaming` internally and reads a streaming
          layer's attribute keys from the resident model, because a streaming
          layer's `model` is a stub (see residentModel.ts).

          OR an open DRAFT, whatever the mode: §6.2's "Style by result" writes a
          draft and deliberately does NOT touch `colorBy` ("the map does not
          change until the user presses Save in the editor"), so on a layer
          still on Surface type or Single colour this gate is the only thing
          that puts that draft on screen. Keyed on `open`, so Cancel — which
          clears the draft — closes it again. */}
      {(colorBy === "rules" || draftOpen) && (
        <RulesEditor model={layer.model} layerId={layerId} />
      )}

      {colorBy === "single" && (
        <label className="style-field">
          <span className="style-field-label">Single colour</span>
          <input
            type="color"
            className="rule-color-picker"
            value={layer.singleColor ?? SINGLE_COLOR_HEX}
            onChange={(e) =>
              updateLayer(layerId, { singleColor: e.target.value })
            }
          />
        </label>
      )}
    </div>
  );
}
