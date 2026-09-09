import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useSceneSheetStore } from "../../features/sceneSheet/sceneSheetStore";
import "./sceneButtons.css";

export function SceneButtons({
  renderSun,
  renderSettings,
}: {
  readonly renderSun: (onClose: () => void) => ReactNode;
  readonly renderSettings: (onClose: () => void) => ReactNode;
}) {
  const sheet = useSceneSheetStore((s) => s.sheet);
  const setSheet = useSceneSheetStore((s) => s.setSheet);
  const sun = useRef<HTMLButtonElement>(null);
  const settings = useRef<HTMLButtonElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const previous = useRef<typeof sheet>(null);
  const close = () => setSheet(null);
  useEffect(() => {
    if (sheet !== null)
      host.current
        ?.querySelector<HTMLElement>("button, input, select")
        ?.focus();
    if (sheet === null && previous.current === "sun") sun.current?.focus();
    if (sheet === null && previous.current === "settings")
      settings.current?.focus();
    previous.current = sheet;
  }, [sheet]);
  return (
    <div className="scene-buttons">
      <div className="scene-buttons__triggers">
        <button
          ref={sun}
          type="button"
          aria-pressed={sheet === "sun"}
          aria-expanded={sheet === "sun"}
          aria-haspopup="dialog"
          aria-label="Sun & shade"
          onClick={() => setSheet(sheet === "sun" ? null : "sun")}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="5" />
            <path d="M8 3a5 5 0 0 1 0 10Z" fill="currentColor" stroke="none" />
          </svg>
          <span className="scene-buttons__label">Sun &amp; shade</span>
        </button>
        <button
          ref={settings}
          type="button"
          aria-pressed={sheet === "settings"}
          aria-expanded={sheet === "settings"}
          aria-haspopup="dialog"
          aria-label="Scene settings"
          onClick={() => setSheet(sheet === "settings" ? null : "settings")}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2 5h12M2 11h12M6 3v4M10 9v4" />
          </svg>
          <span className="scene-buttons__label">Scene settings</span>
        </button>
      </div>
      {sheet !== null && (
        <div ref={host} className="scene-buttons__sheet">
          {sheet === "sun" ? renderSun(close) : renderSettings(close)}
        </div>
      )}
    </div>
  );
}
