/**
 * Legend overlay displayed on the viewport.
 *
 * Shows, GROUPED BY LAYER, how each visible layer is coloured: the semantic
 * Roof / Wall / Ground palette, the user's rules plus "Unmatched", one
 * colour, or a vector layer's category list. Grouping is per-layer because
 * rules are per-layer state — two layers can carry rules of the same name in
 * different colours, and a flat list is ambiguous as soon as a second layer
 * is loaded. The heading renders in the single-layer case too, so the legend
 * doesn't change shape when a second layer arrives.
 *
 * The heading is a BUTTON: clicking it activates the layer and opens its
 * Style section (through `requestSection`, which also un-collapses the left
 * panel) — the legend is the one place on the map that points at a layer's
 * styling, so it doubles as the way in.
 *
 * Presentation size: when BOTH side panels are collapsed (the projector
 * state, or a right panel that does not exist because nothing is selected)
 * the rows grow to 14px — the legend is then the only chrome left and reads
 * from across a room.
 */
import { useMemo, useState, useId } from "react";
import { useLayerStore } from "../../features/layers/layerStore";
import { useGeoLayerStore } from "../../features/geoLayers/geoLayerStore";
import { getResidentModel } from "../../features/streaming/residentModel";
import { useStreamStore } from "../../features/streaming/streamStore";
import { useShellStore } from "../shell/shellStore";
import { useSelectionStore } from "../../features/selection/selectionStore";
import { countedLegendGroups } from "./legendCounts";
import { useSceneThemeStore } from "../../features/sceneTheme/sceneThemeStore";
import { useGeoFeatureVisibilityStore } from "../../features/geoLayers/geoFeatureVisibilityStore";

export function LegendOverlay() {
  const layers = useLayerStore((s) => s.layers);
  const geoLayers = useGeoLayerStore((s) => s.layers);
  const leftCollapsed = useShellStore((s) => s.leftCollapsed);
  const rightCollapsed = useShellStore((s) => s.rightCollapsed);
  // A right panel that does not exist (nothing selected) counts as collapsed
  // for the presentation size — see the module doc.
  const hasSelection = useSelectionStore(
    (s) => s.selections.length > 0 || s.geoSelection !== null,
  );
  const streams = useStreamStore((state) => state.streams);
  const [visible, setVisible] = useState(true);
  const contentId = useId();
  const cyber = useSceneThemeStore((s) => s.theme === "cyber");
  const geoVisibleIds = useGeoFeatureVisibilityStore((s) => s.visible);
  const geoDocuments = useMemo(
    () =>
      new Map(
        geoLayers
          .filter((layer) => layer.kind === "geojson")
          .map((layer) => [layer.id, layer.config.preparedData ?? null]),
      ),
    [geoLayers],
  );

  const residents = useMemo(() => {
    const next = new Map();
    for (const layer of layers) {
      if (!layer.isStreaming) continue;
      next.set(
        layer.id,
        getResidentModel(layer.id, streams[layer.id]?.version ?? 0),
      );
    }
    return next;
  }, [layers, streams]);
  const groups = useMemo(
    () =>
      countedLegendGroups(
        layers,
        geoLayers,
        residents,
        geoDocuments,
        geoVisibleIds,
      ),
    [geoDocuments, geoLayers, geoVisibleIds, layers, residents],
  );
  if (groups.length === 0) return null;

  const presentation = leftCollapsed && (rightCollapsed || !hasSelection);

  return (
    <div
      className={
        presentation ? "legend-overlay legend-presentation" : "legend-overlay"
      }
    >
      <div className="legend-card">
        <div className="legend-header">
          <div className="legend-title">Legend</div>
          <button
            type="button"
            className="legend-collapse"
            onClick={() => setVisible((value) => !value)}
            aria-label={visible ? "Collapse legend" : "Expand legend"}
            title={visible ? "Collapse legend" : "Expand legend"}
            aria-expanded={visible}
            aria-controls={contentId}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d={visible ? "m4 6 4 4 4-4" : "m4 10 4-4 4 4"} />
            </svg>
          </button>
        </div>
        <div id={contentId} hidden={!visible}>
          {cyber && (
            <p className="legend-warning">
              Cyber presentation overrides layer colours.
            </p>
          )}
          {groups.map((group) => (
            <div
              key={group.layerId}
              className="legend-group"
              role="group"
              aria-label={group.name}
            >
              <button
                className="legend-group-name"
                title={`Open ${group.name} style`}
                onClick={() =>
                  useShellStore
                    .getState()
                    .requestSection(group.layerId, "style")
                }
              >
                <span>{group.name}</span>
                <span className="legend-group-chevron" aria-hidden>
                  ›
                </span>
              </button>
              {group.rows.some((row) => row.currentlyLoaded) && (
                <p className="legend-scope-note">Currently loaded</p>
              )}
              {group.rows.map((row, index) => (
                <div
                  key={`${group.layerId}:${row.kind}:${index}`}
                  className="legend-item"
                >
                  <div
                    className="legend-dot"
                    style={{ background: row.color }}
                  />
                  <span>{row.label}</span>
                  <span className="legend-count">
                    {row.count === null ? "Unavailable" : row.count}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
