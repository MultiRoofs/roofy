/**
 * Spec §4.2: with the toolbox open the right panel carries a tab strip — Tools
 * always, Details only while a selection exists.
 *
 * Picking a feature must NOT steal the tab: a user reading a tool's parameters
 * and clicking a building to check its attributes would otherwise lose the
 * form. So the Details tab only gains a quiet dot, and the dot is DERIVED from
 * "the title the user has looked at" rather than set by a pick — which is why
 * `seenTitle` starts at the title present on mount: opening the toolbox over an
 * existing selection is not a change the user needs pointed out.
 *
 * Which tab is up lives in `processingStore`, not here: spec §4.1's Tools button
 * has to be able to switch to Tools, and a store field is the only thing both
 * the map header and this panel can see.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useProcessingStore } from "../../features/processing/processingStore";
import { CatalogueView } from "./CatalogueView";
import { ToolView } from "./ToolView";
import { LogView } from "./LogView";
import "./processing.css";

interface Props {
  /** The Details panel when a selection exists, else null. */
  readonly details: ReactNode | null;
  readonly detailsTitle: string;
}

export function ProcessingPanel({ details, detailsTitle }: Props) {
  const view = useProcessingStore((s) => s.view);
  const tab = useProcessingStore((s) => s.activeTab);
  const setTab = useProcessingStore((s) => s.setTab);
  const [seenTitle, setSeenTitle] = useState<string>(() => detailsTitle);
  const hasDetails = details !== null;
  const showDetails = hasDetails && tab === "details";

  // Clearing the selection removes the Details tab, so the strip falls back.
  useEffect(() => {
    if (!hasDetails) setTab("tools");
  }, [hasDetails, setTab]);

  // While Details is the visible tab its title has, by definition, been seen.
  useEffect(() => {
    if (showDetails) setSeenTitle(detailsTitle);
  }, [showDetails, detailsTitle]);

  const emphasis = hasDetails && !showDetails && seenTitle !== detailsTitle;

  return (
    <aside className="processing-panel" aria-label="Tools panel">
      <div className="processing-tabs">
        <div
          className="processing-tabs__list"
          role="tablist"
          aria-label="Right panel"
        >
          <button
            type="button"
            role="tab"
            className="processing-tab"
            aria-selected={!showDetails}
            onClick={() => setTab("tools")}
          >
            Tools
          </button>
          {hasDetails && (
            <button
              type="button"
              role="tab"
              className="processing-tab"
              aria-selected={showDetails}
              onClick={() => setTab("details")}
            >
              {emphasis && (
                <span className="processing-tab__emphasis" aria-hidden="true" />
              )}
              Details · {detailsTitle}
            </button>
          )}
        </div>
        <button
          type="button"
          className="processing-tab processing-tab--close"
          aria-label="Close tools"
          onClick={() => useProcessingStore.getState().setOpen(false)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      {showDetails ? (
        details
      ) : (
        <div className="processing-body">
          {view.kind === "catalogue" && <CatalogueView />}
          {view.kind === "tool" && <ToolView toolId={view.toolId} />}
          {view.kind === "log" && <LogView runId={view.runId} />}
        </div>
      )}
    </aside>
  );
}
