import type { StreamStatus } from "../features/streaming/streamStore";

interface StatusBarProps {
  readonly objectCount: number;
  /** The objects the layers' datasets hold in total, or `null` when unknown
   *  (any FlatCityBuf stream). Differs from `objectCount` only while a
   *  stream holds part of its dataset. */
  readonly totalObjectCount?: number | null;
  readonly fps?: number;
  readonly cursorPosition?: readonly [number, number, number] | null;
  readonly streamStatus?: StreamStatus | null;
  readonly streamMessage?: string | null;
  readonly residentCellCount?: number;
}
export function StatusBar({
  objectCount,
  totalObjectCount = null,
  fps,
  cursorPosition,
  streamStatus,
  streamMessage,
  residentCellCount,
}: StatusBarProps) {
  return (
    <footer className="statusbar statusbar--map">
      <div className="statusbar__left">
        <span>Navara</span>
        {fps !== undefined && <span>· {fps} FPS</span>}
        <span>
          ·{" "}
          {totalObjectCount !== null && totalObjectCount !== objectCount
            ? `${formatCount(objectCount)} of ${formatCount(totalObjectCount)}`
            : formatCount(objectCount)}{" "}
          loaded objects
        </span>
      </div>
      <div className="statusbar__centre" title="WGS84 ellipsoidal height">
        {cursorPosition && formatCoordinate(cursorPosition)}
      </div>
      <div className="statusbar__right">
        {streamStatus && (
          <>
            <span className={`status-dot ${streamDotClass(streamStatus)}`} />
            <span>
              {residentCellCount ?? 0} resident cells ·{" "}
              {streamLabel(streamStatus, streamMessage ?? null)}
            </span>
          </>
        )}
      </div>
    </footer>
  );
}
export function formatCoordinate([lng, lat, height]: readonly [
  number,
  number,
  number,
]): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lng).toFixed(4)}° ${ew} · ${Math.round(height)} m`;
}
function streamLabel(status: StreamStatus, message: string | null) {
  return status === "idle"
    ? "Settled"
    : status === "probing"
      ? "Probing…"
      : status === "fetching"
        ? "Loading…"
        : status === "too-far"
          ? "Zoom in to load"
          : (message ?? "Streaming error");
}
function streamDotClass(status: StreamStatus) {
  return status === "error"
    ? "dot-error"
    : status === "too-far"
      ? "dot-partial"
      : status === "probing" || status === "fetching"
        ? "dot-loading"
        : "dot-ready";
}
function formatCount(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}
