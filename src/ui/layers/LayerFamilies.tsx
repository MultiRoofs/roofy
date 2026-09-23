/**
 * "Which object families does this package render, and whose table am I
 * reading?" — the streamed CityParquet block above Object visibility.
 *
 * A CityParquet package is a SET of object families (building, bridge,
 * water_body, transportation, vegetation, city_furniture), one Parquet file
 * each. Ruling R-D opens Building alone, so the other families are AVAILABLE
 * and not loaded — a state the user can only act on if the UI says it, which is
 * what this block is for.
 *
 * FOUR STATES STAY DISTINCT (the performance handoff, and the plan's
 * "loading / available / opened / visible" bullet):
 *
 *  - _available_: the family is in the manifest. Every row here is.
 *  - _opened_: its geometry is streaming. The CHECKBOX.
 *  - its TABLE: absent / creating / ready / failed, moved by the table button
 *    alone — "opening a family's table can load attributes without rendering
 *    its geometry" is the handoff's own sentence, and the button honours it for
 *    a family whose geometry is closed.
 *  - _visible_: hidden types and filters, which is the block BELOW this one. A
 *    family is opened; a type is visible. Conflating them would let a user hide
 *    "Bridge" and wonder why the bridge table is still full.
 *
 * WHY THE TOGGLE CAN BE DISABLED. Closing the last open family would leave the
 * layer with no stream at all, so the store refuses it; the control says so
 * before the click rather than answering with a toast. And a toggle needs the
 * live stream plugin (the reopen tears the layer's worker down and opens a new
 * one), so with the engine down every toggle is inert and says why — the TABLE
 * button still works, because a view over the file needs no 3D engine.
 */
import { ActionIcon } from "../ActionIcon";
import {
  retryFamilyReopen,
  setFamilyEnabled,
  useFamilyStore,
} from "../../features/layers/familyStore";
import { geometryText, openedSummary } from "./layerFamiliesText";
import { getStreamPlugin } from "../../features/streaming/streamPlugin";
import { useShellStore } from "../shell/shellStore";

export function LayerFamilies({ layerId }: { readonly layerId: string }) {
  const entry = useFamilyStore((s) => s.layers[layerId]);
  if (entry === undefined || entry.families.length === 0) return null;

  const { families, enabled, opened, active, geometry, table, reopen } = entry;
  const plugin = getStreamPlugin();
  const reopening = reopen.state === "reopening";

  /** Show this family's table — whatever its geometry is doing. */
  const showTable = (key: string) => {
    // `setActiveFamily` ensures the view if this family has none (it is the one
    // door that does, so a table button pressed twice costs one DESCRIBE).
    useFamilyStore.getState().setActiveFamily(layerId, key);
    useShellStore.getState().openDrawer();
  };

  return (
    <div className="active-layer-group">
      <h4 className="active-layer-group-title">Object families</h4>
      <div className="layer-families" role="group" aria-label="Object families">
        <p className="active-layer-note">{openedSummary(families, opened)}</p>
        {reopen.state === "failed" && (
          <p className="active-layer-note layer-families-error" role="alert">
            {reopen.message}
          </p>
        )}
        {families.map((family) => {
          const state = geometry[family.key];
          const isEnabled = enabled.has(family.key);
          // The store refuses closing the last one, so the control says so first.
          const last = isEnabled && enabled.size === 1;
          const tableState = table[family.key] ?? "absent";
          return (
            <div
              className="layer-types-item layer-families-item"
              key={family.key}
            >
              <input
                type="checkbox"
                checked={isEnabled}
                aria-label={`Show ${family.label} geometry`}
                disabled={last || reopening || plugin === null}
                title={
                  plugin === null
                    ? "The 3D engine is not running, so this layer's families cannot be reopened"
                    : last
                      ? "At least one object family has to stay open"
                      : reopening
                        ? "Reopening this layer…"
                        : `Stream ${family.label} geometry`
                }
                onChange={(event) => {
                  const live = getStreamPlugin();
                  if (live === null) return;
                  void setFamilyEnabled({
                    plugin: live,
                    layerId,
                    family: family.key,
                    enabled: event.target.checked,
                  });
                }}
              />
              <span className="layer-families-label" title={family.href}>
                {family.label}
              </span>
              <span className="layer-families-state">
                {geometryText(state, family.rowCount)}
              </span>
              {state === "failed" && (
                <button
                  type="button"
                  className="active-layer-action layer-families-btn"
                  disabled={reopening || plugin === null}
                  onClick={() => {
                    const live = getStreamPlugin();
                    if (live === null) return;
                    void retryFamilyReopen({ plugin: live, layerId });
                  }}
                >
                  Retry
                </button>
              )}
              <button
                type="button"
                className="active-layer-action layer-families-btn"
                aria-label={`Show ${family.label} table`}
                aria-pressed={active === family.key}
                title={
                  tableState === "failed"
                    ? "This family's table could not be created — press to try again"
                    : `Browse ${family.label}'s attributes, whether or not its geometry is drawn`
                }
                onClick={() => showTable(family.key)}
              >
                <ActionIcon name="table" />
                {tableState === "creating" ? "Loading…" : "Table"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
