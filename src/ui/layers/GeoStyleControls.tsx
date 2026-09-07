/**
 * The two drawing controls a geospatial layer has: its opacity, and — for a
 * vector layer — the flat per-layer style plus "Color by attribute".
 *
 * Extracted from `GeoLayerInspector` so the active layer's Style section
 * (Task 18) and the inspector's geo view can render the SAME form while both
 * exist; Task 20 deletes the inspector's copy and this becomes the only one.
 * Extracting rather than copying is the whole point: two forms writing the
 * same `GeoLayerStyle` would be two places for the "spread the WHOLE style"
 * contract below to be got wrong.
 *
 * Each control owns its store write and takes only the live layer, so a host
 * needs no callbacks of its own — and both are unwrapped: the caller supplies
 * whatever section, heading or hairline its own panel dresses them in.
 */
import { useEffect, useMemo, useState } from "react";
import {
  useGeoLayerStore,
  type GeoLayer,
} from "../../features/geoLayers/geoLayerStore";
import type { GeoLayerStyle } from "../../features/geoLayers/geoLayerStyle";
import {
  attributeKeys,
  categoriesFor,
} from "../../features/geoLayers/categorize";
import { resolveGeoJsonDocument } from "../../features/geoLayers/geoLayerDocument";
import { CATEGORY_OTHER_HEX } from "../../scene/cityColors";
import { colorInputValue } from "./geoLayerMeta";

/**
 * Layer opacity, for the two kinds that have a handle for it.
 *
 * A 3D tileset gets none: its appearance IS the tiles' own materials, and the
 * descriptor's `opacity` is a slider over someone else's photogrammetry that
 * was judged not worth the row. Callers gate on the kind themselves.
 */
export function GeoOpacityControl({ layer }: { readonly layer: GeoLayer }) {
  const updateGeoLayer = useGeoLayerStore((s) => s.updateGeoLayer);
  return (
    <input
      className="geo-opacity-slider"
      type="range"
      min={0}
      max={1}
      step={0.05}
      value={layer.opacity}
      aria-label="Opacity"
      title={`Opacity — ${Math.round(layer.opacity * 100)}%`}
      onChange={(e) =>
        updateGeoLayer(layer.id, { opacity: Number(e.target.value) })
      }
    />
  );
}

/**
 * Colour, point size, line width, fill opacity and "Color by attribute" — a
 * VECTOR layer only: a raster tile's pixels arrive already drawn, and a 3D
 * tileset carries its own materials.
 *
 * The numbers commit on `change` with a bare `Number(...)`: the store
 * normalizes on write (a NaN or a zero falls back to the default rather than
 * reaching the engine), so the input does not need its own validation branch.
 * The ONE guarded case is the empty field, which is a user mid-edit rather
 * than a value — `Number("")` is 0, so committing it would jump a layer
 * sitting at 8 px to the app default the moment its box was cleared for
 * retyping.
 */
export function GeoVectorStyleFields({
  layer,
}: {
  readonly layer: GeoJsonLayer;
}) {
  const updateGeoLayer = useGeoLayerStore((s) => s.updateGeoLayer);

  /** One edited field at a time, but the store takes the WHOLE style — see
   *  `GeoLayerPatch.style`. */
  const editStyle = (patch: Partial<GeoLayerStyle>) =>
    updateGeoLayer(layer.id, { style: { ...layer.style, ...patch } });

  return (
    <div className="geo-style-fields">
      <label className="geo-style-field">
        <span>Color</span>
        <input
          className="geo-style-color"
          type="color"
          aria-label="Layer color"
          value={colorInputValue(layer.style.color)}
          onChange={(e) => editStyle({ color: e.target.value })}
        />
      </label>

      <label className="geo-style-field">
        <span>Point size</span>
        <input
          className="geo-style-number"
          type="number"
          min={1}
          step={1}
          aria-label="Point size"
          title="Point size, in pixels"
          value={layer.style.pointSizePx}
          onChange={(e) => {
            if (e.target.value !== "")
              editStyle({ pointSizePx: Number(e.target.value) });
          }}
        />
      </label>

      <label className="geo-style-field">
        <span>Line width</span>
        <input
          className="geo-style-number"
          type="number"
          min={1}
          step={1}
          aria-label="Line width"
          title="Line width, in pixels"
          value={layer.style.lineWidthPx}
          onChange={(e) => {
            if (e.target.value !== "")
              editStyle({ lineWidthPx: Number(e.target.value) });
          }}
        />
      </label>

      <label className="geo-style-field">
        <span>Fill opacity</span>
        <input
          className="geo-style-slider"
          type="range"
          min={0}
          max={1}
          step={0.05}
          aria-label="Fill opacity"
          title={`Polygon fill opacity — ${Math.round(
            layer.style.fillOpacity * 100,
          )}% (multiplies the layer's own opacity)`}
          value={layer.style.fillOpacity}
          onChange={(e) => editStyle({ fillOpacity: Number(e.target.value) })}
        />
      </label>

      <GeoColorByAttribute layer={layer} editStyle={editStyle} />

      {/* The city models' rule editor does not generalise to a vector layer:
          rules read CityJSON attributes and roof metrics, not GeoJSON
          properties — "Color by attribute" above is the vector answer. */}
      <p className="active-layer-note geo-style-note">
        Rules are available for city models.
      </p>
    </div>
  );
}

/** A GeoJSON layer, narrowed — the only kind with a document to read keys
 *  from. */
type GeoJsonLayer = Extract<GeoLayer, { kind: "geojson" }>;

/**
 * "Color by attribute": a select of the document's property keys, and under
 * it one swatch row per category of the chosen attribute.
 *
 * The keys come from the layer's OWN document — inline data directly, a URL
 * through the document cache (`geoLayerDocument.ts`), appearing when the
 * fetch lands. Picking an attribute computes the categories fresh
 * (`categoriesFor`: first eight distinct values in first-seen order on the
 * palette, the rest in the fixed OTHER bucket), so switching attributes
 * DROPS the old swatch edits rather than carrying colours across a meaning
 * change. A swatch edit writes the whole `categories` array back through the
 * store's whole-style door; `None` clears `colorByAttribute` entirely, which
 * leaves fresh feature sets un-overridden (the flat layer colour wins).
 *
 * The OTHER row is the engine's paint for every value past the eighth, NOT
 * editable in 12.3 — its colour is the reserved `CATEGORY_OTHER_HEX`.
 */
function GeoColorByAttribute({
  layer,
  editStyle,
}: {
  readonly layer: GeoJsonLayer;
  readonly editStyle: (patch: Partial<GeoLayerStyle>) => void;
}) {
  const updateGeoLayer = useGeoLayerStore((s) => s.updateGeoLayer);
  const colorByAttribute = layer.style.colorByAttribute;

  // Inline data's keys are free and stable on the config's identity; a URL's
  // arrive when the cached fetch lands (null = still loading).
  const inlineKeys = useMemo(
    () =>
      layer.config.data === undefined ? null : attributeKeys(layer.config.data),
    [layer.config.data],
  );
  const [fetchedKeys, setFetchedKeys] = useState<readonly string[] | null>(
    null,
  );
  useEffect(() => {
    if (inlineKeys !== null) return;
    const config = layer.config;
    if (config.url === undefined || config.url === "") {
      setFetchedKeys([]);
      return;
    }
    let cancelled = false;
    resolveGeoJsonDocument(config).then(
      (document) => {
        if (!cancelled) setFetchedKeys(attributeKeys(document));
      },
      () => {
        if (!cancelled) setFetchedKeys([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [layer.config, inlineKeys]);
  const keys = inlineKeys ?? fetchedKeys;

  const pickAttribute = (attribute: string) => {
    if (attribute === "") {
      // Cleared, not emptied: the field leaves the style object entirely.
      const { colorByAttribute: _dropped, ...rest } = layer.style;
      updateGeoLayer(layer.id, { style: rest });
      return;
    }
    const apply = (document: unknown) => {
      // Read the LIVE record at write time: an async resolve may land after
      // another edit, and spreading the render-time style would drop it.
      const current = useGeoLayerStore
        .getState()
        .layers.find((l) => l.id === layer.id);
      if (current === undefined) return;
      updateGeoLayer(layer.id, {
        style: {
          ...current.style,
          colorByAttribute: {
            attribute,
            categories: categoriesFor(document, attribute),
          },
        },
      });
    };
    if (layer.config.data !== undefined) {
      apply(layer.config.data);
      return;
    }
    void resolveGeoJsonDocument(layer.config).then(
      (document) => {
        // A failed fetch has no keys to compute from: leave the store
        // untouched (and the select on its previous value) rather than
        // writing an empty colouring the normalize door would drop anyway.
        if (document !== null) apply(document);
      },
      () => {
        // The document cache evicts a failed fetch; nothing to write. The
        // rejection handler (rather than a `.catch`) keeps a network failure
        // from surfacing as an unhandled rejection.
      },
    );
  };

  const editCategory = (index: number, color: string) => {
    if (colorByAttribute === undefined) return;
    editStyle({
      colorByAttribute: {
        ...colorByAttribute,
        categories: colorByAttribute.categories.map((category, i) =>
          i === index ? { ...category, color } : category,
        ),
      },
    });
  };

  // The select's value must always name an option: while a URL fetch is in
  // flight the current attribute may not be in the key list yet.
  const options =
    colorByAttribute !== undefined &&
    !(keys ?? []).includes(colorByAttribute.attribute)
      ? [...(keys ?? []), colorByAttribute.attribute]
      : (keys ?? []);

  return (
    <>
      <label className="geo-style-field">
        <span>Color by attribute</span>
        <select
          className="geo-style-select"
          value={colorByAttribute?.attribute ?? ""}
          onChange={(e) => pickAttribute(e.target.value)}
        >
          <option value="">None</option>
          {options.map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
        </select>
      </label>
      {keys === null && (
        <p className="active-layer-note geo-style-note">Loading attributes…</p>
      )}

      {colorByAttribute !== undefined && (
        <ul className="geo-style-categories">
          {colorByAttribute.categories.map((category, index) => {
            // The OTHER bucket is exactly the null-valued category painted in
            // the reserved colour — `categoriesFor` mints it only on overflow.
            const isOther =
              category.value === null && category.color === CATEGORY_OTHER_HEX;
            const label = category.value ?? (isOther ? "Other" : "Missing");
            const accessibleName =
              category.value === null
                ? `Colour for ${label}`
                : `Colour for "${category.value}"`;
            return (
              <li key={index} className="geo-style-category">
                <span
                  className="geo-style-category-label"
                  title={category.value ?? label}
                >
                  {label}
                </span>
                <input
                  className="geo-style-color"
                  type="color"
                  value={colorInputValue(category.color)}
                  aria-label={accessibleName}
                  {...(isOther
                    ? {
                        disabled: true,
                        title: "Every value past the eighth — not editable",
                      }
                    : {
                        onChange: (e: { target: { value: string } }) =>
                          editCategory(index, e.target.value),
                      })}
                />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
