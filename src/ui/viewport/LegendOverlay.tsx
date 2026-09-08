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
import { useMemo, useState } from "react";
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
      {visible && (
        <div className="legend-card">
          <div className="legend-title">Legend</div>
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
      )}
      <button
        className="legend-toggle"
        onClick={() => setVisible((v) => !v)}
        title={visible ? "Hide legend" : "Show legend"}
        aria-label={visible ? "Hide legend" : "Show legend"}
      >
        <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden>
          <path
            d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>{visible ? "Hide legend" : "Show legend"}</span>
      </button>
    </div>
  );
}
