/**
 * The active layer's own panel: everything the layer row stopped carrying
 * when it became a two-line block (Task 17), laid out as a form under the
 * list instead of squeezed into a 240 px strip.
 *
 * It follows the workspace's ONE active layer and renders nothing when there
 * is none. There is no "first layer" fallback: a panel that quietly described
 * some other layer than the one highlighted in the list is the disagreement
 * this milestone exists to remove.
 *
 * Three disclosures, in the order the questions are asked: how is it drawn
 * (Style), what is being left out (Filter), what IS it (Details). Their
 * open/closed state belongs to the SHELL and is keyed by layer
 * (`shellStore.openSections`), so switching layers and coming back finds the
 * panel as it was left — and a layer that has never been configured opens on
 * Style alone.
 *
 * This is also where a `requestedSection` is CONSUMED. Another part of the UI
 * (the legend, a "filtered" chip, "Edit in table") asks the shell to take the
 * user to one layer's one section; `shellStore.requestSection` activates the
 * layer and opens the section, and this panel finishes the job — scrolls the
 * header into view and clears the request, so it cannot fire again on the
 * next render and re-open a section the user has since closed.
 */
import { useEffect, useRef } from "react";
import { layerKindLine } from "../../features/layers/layerPresentation";
import {
  useActiveLayer,
  type ActiveLayer,
} from "../../features/workspace/activeLayer";
import {
  DEFAULT_OPEN_SECTIONS,
  useShellStore,
  type PanelSection,
} from "../shell/shellStore";
import { DetailsSection } from "./DetailsSection";
import { FilterSection } from "./FilterSection";
import { StyleSection } from "./StyleSection";

export interface ActiveLayerPanelProps {
  /** The whole item, not an id: a city layer and a geo layer are flown to by
   *  different code paths, and the caller already has to tell them apart.
   *  REQUIRED — a zoom button that silently did nothing would be worse than
   *  no button, and Task 19 owns the wiring. */
  readonly onZoomToLayer: (item: ActiveLayer) => void;
}

const SECTIONS: ReadonlyArray<{
  readonly id: PanelSection;
  readonly label: string;
}> = [
  { id: "style", label: "Style" },
  { id: "filter", label: "Filter" },
  { id: "details", label: "Details" },
];

export function ActiveLayerPanel({ onZoomToLayer }: ActiveLayerPanelProps) {
  const item = useActiveLayer();
  const layerId = item?.layer.id ?? null;

  // `DEFAULT_OPEN_SECTIONS` is a module constant, so the fallback is
  // reference-stable and this selector cannot loop.
  const openSections = useShellStore((s) =>
    layerId === null
      ? DEFAULT_OPEN_SECTIONS
      : (s.openSections[layerId] ?? DEFAULT_OPEN_SECTIONS),
  );
  const requestedSection = useShellStore((s) => s.requestedSection);
  const drawerOpen = useShellStore((s) => s.drawerOpen);

  // The ACTIONS come through `getState()`, not a selector: they never change
  // identity, so subscribing to them buys nothing — and `ShellActions`
  // declares them as method shorthand, which `typescript-eslint`'s
  // `unbound-method` rule refuses when one is captured as a reference (the
  // same reason `LayerActions` declares its own as properties).
  const shell = () => useShellStore.getState();

  // The HEADERS, not the bodies: a closed section has no body to scroll to,
  // and the header is what the user needs on screen to see that it opened.
  const headers = useRef<Partial<Record<PanelSection, HTMLElement | null>>>({});

  useEffect(() => {
    if (layerId === null || requestedSection === null) return;
    if (requestedSection.layerId !== layerId) return;
    const { section } = requestedSection;
    // Read-then-toggle, from the live state: `toggleSection` TOGGLES, so
    // calling it on a section `requestSection` already opened would close it.
    const state = useShellStore.getState();
    const current = state.openSections[layerId] ?? DEFAULT_OPEN_SECTIONS;
    if (!current.includes(section)) state.toggleSection(layerId, section);
    // `?.()` because jsdom implements no `scrollIntoView` — the guard is for
    // the test environment, not for a browser.
    headers.current[section]?.scrollIntoView?.({ block: "nearest" });
    state.requestSection(null);
  }, [layerId, requestedSection]);

  if (item === null || layerId === null) return null;

  const { name } = item.layer;

  return (
    <section className="active-layer" aria-label={`Active layer: ${name}`}>
      <header className="active-layer-head">
        <h3 className="active-layer-title" title={name}>
          {name}
        </h3>
        <p className="active-layer-kind">{layerKindLine(item)}</p>
        <div className="active-layer-actions">
          <button
            type="button"
            className="active-layer-action"
            onClick={() => onZoomToLayer(item)}
          >
            Zoom to layer
          </button>
          {/* City kinds only: a geospatial layer has no attribute table
              behind it, so the drawer would open on nothing. */}
          {item.kind === "city" && (
            <button
              type="button"
              className={`active-layer-action ${drawerOpen ? "is-on" : ""}`}
              // No `aria-pressed`: the LABEL already flips, and a toggle that
              // both renames itself and reports a pressed state announces
              // "Close table, pressed" — two encodings of one fact, and the
              // reading is backwards.
              onClick={() =>
                drawerOpen ? shell().closeDrawer() : shell().openDrawer()
              }
            >
              {drawerOpen ? "Close table" : "Open table"}
            </button>
          )}
        </div>
      </header>

      {/* Keyed by layer so switching layers REMOUNTS the sections: the rule
          editor's "editing this rule" and the metadata disclosure are about
          the layer that was open, not about the panel. */}
      <div className="active-layer-sections" key={layerId}>
        {SECTIONS.map(({ id, label }) => {
          const open = openSections.includes(id);
          return (
            <div className="active-layer-section" key={id}>
              <button
                type="button"
                ref={(el) => {
                  headers.current[id] = el;
                }}
                className="active-layer-section-header"
                aria-expanded={open}
                aria-controls={`active-layer-section-${id}`}
                onClick={() => shell().toggleSection(layerId, id)}
              >
                <svg
                  className={`active-layer-caret ${open ? "is-open" : ""}`}
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <polyline points="9 6 15 12 9 18" />
                </svg>
                <span className="active-layer-section-title">{label}</span>
              </button>
              {open && (
                <div
                  className="active-layer-section-body"
                  id={`active-layer-section-${id}`}
                >
                  <SectionBody section={id} item={item} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SectionBody({
  section,
  item,
}: {
  readonly section: PanelSection;
  readonly item: ActiveLayer;
}) {
  switch (section) {
    case "style":
      return <StyleSection item={item} />;
    case "filter":
      return <FilterSection item={item} />;
    case "details":
      return <DetailsSection item={item} />;
  }
}
