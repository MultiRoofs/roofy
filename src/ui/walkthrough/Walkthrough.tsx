import {
  ensureDelftLandUse,
  DELFT_LANDUSE_URL,
} from "../../features/walkthrough/delftLandUse";
import { useGeoLayerStore } from "../../features/geoLayers/geoLayerStore";
import { placeWalkthroughCard, spotlightBounds } from "./placement";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useWalkthroughStore } from "../../features/walkthrough/walkthroughStore";
import {
  DELFT_SAMPLE_URL,
  WALKTHROUGH_STEPS,
  type WalkthroughStepId,
} from "../../features/walkthrough/steps";
import { useLayerStore } from "../../features/layers/layerStore";
import { useSelectionStore } from "../../features/selection/selectionStore";
import { useWorkspaceStore } from "../../features/workspace/workspaceStore";
import { useQueryStore } from "../../features/query/queryStore";
import { useProcessingStore } from "../../features/processing/processingStore";
import { useSolarStore } from "../../features/solar/solarStore";
import { useRenderDebugStore } from "../../features/debug/renderDebugStore";
import { useSceneSheetStore } from "../../features/sceneSheet/sceneSheetStore";
import { useShellStore } from "../shell/shellStore";
import "./walkthrough.css";

const TARGETS: Record<WalkthroughStepId, string | null> = {
  load: ".left-panel",
  pick: ".viewport",
  inspect: ".details-panel",
  style: ".style-city",
  filter: ".data-drawer",
  stats: ".data-drawer",
  volume: ".processing-panel",
  join: ".processing-panel",
  sun: ".sun-shade-sheet",
  share: ".scene-export-popover, .share-dialog, .workspace-header",
};

/** Open UI only; loading, rules, filtering and processing remain user actions. */
function reveal(step: WalkthroughStepId, layerId: string) {
  const shell = useShellStore.getState();
  useWorkspaceStore.getState().setActiveLayerId(layerId);
  if (step !== "sun") useSceneSheetStore.getState().setSheet(null);
  if (["pick", "inspect", "style", "sun", "share"].includes(step))
    shell.closeDrawer();
  if (
    ["pick", "inspect", "style", "filter", "stats", "sun", "share"].includes(
      step,
    )
  )
    useProcessingStore.getState().setOpen(false);
  if (step === "pick") {
    useSelectionStore.getState().setToolMode("select");
    shell.setRightCollapsed(false);
  }
  if (step === "inspect") shell.setRightCollapsed(false);
  if (step === "style") shell.requestSection(layerId, "style");
  if (step === "filter" || step === "stats") {
    shell.setDrawerHeight(Math.max(shell.drawerHeight, 320));
  }
  if (step === "filter") shell.openFilter();
  if (step === "stats") shell.openDrawer();
  if (step === "volume" || step === "join") {
    shell.closeDrawer();
    shell.setRightCollapsed(false);
    useProcessingStore
      .getState()
      .openTool(step === "volume" ? "measure-solids" : "join-by-location");
  }
  if (step === "sun") useSceneSheetStore.getState().setSheet("sun");
}

type Rect = { left: number; top: number; width: number; height: number };
function useSpotlight(selector: string | null) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [matchingSeen, setMatchingSeen] = useState(false);
  useEffect(() => {
    setDialogOpen(false);
    setMatchingSeen(false);
    if (!selector) {
      setRect(null);
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const target = [...document.querySelectorAll<HTMLElement>(selector)].find(
        (el) => el.getBoundingClientRect().width > 0 && !el.closest("[inert]"),
      );
      const bounds = target?.getBoundingClientRect();
      const next = bounds
        ? spotlightBounds(bounds, {
            width: window.innerWidth,
            height: window.innerHeight,
          })
        : null;
      setRect((old) =>
        JSON.stringify(old) === JSON.stringify(next) ? old : next,
      );
      if (document.querySelector(".scene-export-popover, .share-dialog"))
        setDialogOpen(true);
      if (document.querySelector(".column-stats-popover dl"))
        setMatchingSeen(true);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "aria-expanded", "aria-pressed"],
    });
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, true);
    update();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", schedule, true);
    };
  }, [selector]);
  return { rect, dialogOpen, matchingSeen };
}

export function Walkthrough({
  onLoadSample,
  externalLoadControl = false,
  loading,
  loadError,
}: {
  onLoadSample: () => void;
  externalLoadControl?: boolean;
  loading: boolean;
  loadError: string | null;
}) {
  const tour = useWalkthroughStore((s) => s);
  const layer = useLayerStore((s) =>
    s.layers.find(
      (l) => l.modelRef.type === "url" && l.modelRef.url === DELFT_SAMPLE_URL,
    ),
  );
  const landUse = useGeoLayerStore((s) =>
    s.layers.find(
      (item) =>
        item.kind === "geojson" && item.config.url === DELFT_LANDUSE_URL,
    ),
  );
  const joinDone = useProcessingStore((s) =>
    s.runs.some(
      (run) =>
        run.toolId === "join-by-location" &&
        run.targetLayerId === layer?.id &&
        run.sourceLayerId === landUse?.id &&
        run.status === "done" &&
        !run.stale &&
        run.note !== "Undone",
    ),
  );
  const selected = useSelectionStore((s) =>
    s.selections.some((item) => item.layerId === layer?.id),
  );
  const query = useQueryStore((s) => (layer ? s.queries[layer.id] : undefined));
  const volumeDone = useProcessingStore((s) =>
    s.runs.some(
      (r) =>
        r.targetLayerId === layer?.id &&
        r.toolId === "measure-solids" &&
        r.status === "done" &&
        !r.stale &&
        r.note !== "Undone" &&
        Array.isArray(r.params.measures) &&
        r.params.measures.includes("volume"),
    ),
  );
  const datetime = useSolarStore((s) => s.datetime.getTime());
  const shadows = useRenderDebugStore((s) => s.sunShadowsEnabled);
  const step = WALKTHROUGH_STEPS[tour.index]!;
  const active = tour.phase === "active";
  const visible = tour.phase !== "idle";
  const dismiss = tour.dismiss;
  const offer = tour.offer;
  const layerId = layer?.id;
  const missingLayer = active && step.id !== "load" && !layer;
  const { rect, dialogOpen, matchingSeen } = useSpotlight(
    active && !missingLayer ? TARGETS[step.id] : null,
  );
  const [sunStart, setSunStart] = useState(datetime);
  const panelRef = useRef<HTMLElement>(null);
  const [panelSize, setPanelSize] = useState({ width: 320, height: 280 });
  const [viewport, setViewport] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  useEffect(() => {
    const resize = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    offer();
  }, [offer]);
  useEffect(() => {
    if (active && step.id === "load")
      useShellStore.getState().setLeftCollapsed(false);
    if (!active || !layerId) return;
    ensureDelftLandUse();
    reveal(step.id, layerId);
    if (step.id === "sun")
      setSunStart(useSolarStore.getState().datetime.getTime());
  }, [active, step.id, layerId]);
  useEffect(() => {
    if (!visible) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (
        document.querySelector(
          '[role="dialog"], .header-popover, .map-sheet, .column-stats-popover',
        )
      )
        return;
      if (
        (event.target as HTMLElement)?.matches?.(
          "input, textarea, select, [contenteditable=true]",
        )
      )
        return;
      event.stopImmediatePropagation();
      dismiss();
    };
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("keydown", escape, true);
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
    };
  }, [visible, dismiss]);
  useLayoutEffect(() => {
    if (tour.phase === "idle") return;
    panelRef.current?.focus({ preventScroll: true });
  }, [tour.phase, tour.index]);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const update = () =>
      setPanelSize({ width: panel.offsetWidth, height: panel.offsetHeight });
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(panel);
    update();
    return () => observer.disconnect();
  }, [tour.phase]);

  if (tour.phase === "idle") return null;
  const completed: Record<WalkthroughStepId, boolean> = {
    load: !!layer,
    pick: selected,
    inspect: selected,
    style:
      layer?.colorBy === "rules" && layer.rules.some((rule) => rule.enabled),
    filter: !!query?.applied?.conditions.length,
    stats: matchingSeen,
    volume: volumeDone,
    join: !!landUse && joinDone,
    sun: shadows && datetime !== sunStart,
    share: dialogOpen,
  };
  const done = !missingLayer && completed[step.id];
  const width = panelSize.width;
  const height = panelSize.height;
  const { left, top, side } = placeWalkthroughCard(
    active ? rect : null,
    panelSize,
    viewport,
  );
  const arrow =
    side === "right"
      ? { left: left - 6, top: top + 24 }
      : side === "left"
        ? { left: left + width - 6, top: top + 24 }
        : side === "above"
          ? { left: left + 28, top: top + height - 6 }
          : side === "below"
            ? { left: left + 28, top: top - 6 }
            : null;

  return createPortal(
    <div className="walkthrough-layer">
      {rect && active ? (
        <div
          className="walkthrough-spotlight"
          style={rect}
          aria-hidden="true"
        />
      ) : (
        <div className="walkthrough-dimmer" aria-hidden="true" />
      )}
      {arrow && (
        <div className="walkthrough-arrow" style={arrow} aria-hidden="true" />
      )}
      <section
        className="walkthrough-card"
        ref={panelRef}
        tabIndex={-1}
        role="region"
        aria-label="Roofy walkthrough"
        style={{ left, top }}
      >
        <div className="walkthrough-heading">
          <h2>
            {tour.phase === "welcome"
              ? "Explore Delft with Roofy"
              : tour.phase === "finished"
                ? "Keep exploring"
                : missingLayer
                  ? "Bring Delft back"
                  : step.title}
          </h2>
          <button
            type="button"
            className="walkthrough-close"
            aria-label="Close walkthrough"
            onClick={tour.dismiss}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        {active && (
          <p className="walkthrough-progress">
            {step.chapter} of 8 · Delft walkthrough
          </p>
        )}
        <p>
          {tour.phase === "welcome"
            ? "Try a guided route from a city model to useful insights. Select buildings, colour roofs, filter attributes and calculate volume using the real workspace."
            : tour.phase === "finished"
              ? "You’ve reached the end of the guide. Keep experimenting with Delft or add your own city model. Restart the walkthrough anytime from Preferences."
              : missingLayer
                ? "The example layer is no longer loaded. Reload Delft to continue this exercise, or close the walkthrough."
                : step.body}
        </p>
        {tour.phase === "welcome" && (
          <p className="walkthrough-note">
            Eight chapters, at your pace. You can skip an exercise or leave at
            any time.
          </p>
        )}
        {active && !missingLayer && (
          <p
            className={`walkthrough-task ${done ? "is-complete" : ""}`}
            role="status"
          >
            {done ? "Ready to continue" : step.action}
          </p>
        )}
        {active && (step.id === "load" || missingLayer) && !layer && (
          <>
            {(!externalLoadControl || missingLayer) && (
              <button
                className="walkthrough-primary"
                type="button"
                onClick={onLoadSample}
                disabled={loading}
              >
                {loading ? "Loading Delft…" : "Load Delft sample"}
              </button>
            )}
            {loadError && (
              <p role="alert" className="walkthrough-error">
                {loadError} Try loading the sample again.
              </p>
            )}
          </>
        )}
        {active && step.id === "join" && !landUse && (
          <button type="button" onClick={() => ensureDelftLandUse()}>
            Reload Delft land use
          </button>
        )}
        {active && !missingLayer && !rect && step.id !== "load" && layer && (
          <button type="button" onClick={() => reveal(step.id, layer.id)}>
            Show this step
          </button>
        )}
        <div className="walkthrough-footer">
          {tour.phase === "welcome" ? (
            <>
              <button type="button" onClick={tour.dismiss}>
                Explore on my own
              </button>
              <button
                type="button"
                className="walkthrough-primary"
                onClick={tour.start}
              >
                Start walkthrough
              </button>
            </>
          ) : tour.phase === "finished" ? (
            <button
              type="button"
              className="walkthrough-primary"
              onClick={tour.dismiss}
            >
              Return to the map
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={tour.index === 0}
                onClick={tour.back}
              >
                Back
              </button>
              {step.id !== "load" && (
                <button
                  type="button"
                  className="walkthrough-skip"
                  onClick={tour.next}
                >
                  Skip step
                </button>
              )}
              <button
                type="button"
                className="walkthrough-primary"
                disabled={!done}
                onClick={tour.next}
              >
                {step.id === "share" ? "Finish" : "Continue"}
              </button>
            </>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}
