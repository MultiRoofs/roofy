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
          onClick={() => setSheet(sheet === "sun" ? null : "sun")}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="3" />
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2" />
          </svg>
          Sun &amp; shade
        </button>
        <button
          ref={settings}
          type="button"
          aria-pressed={sheet === "settings"}
          aria-expanded={sheet === "settings"}
          aria-haspopup="dialog"
          onClick={() => setSheet(sheet === "settings" ? null : "settings")}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="2" />
            <path d="M8 1v3M8 12v3M1 8h3M12 8h3" />
          </svg>
          Scene settings
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
