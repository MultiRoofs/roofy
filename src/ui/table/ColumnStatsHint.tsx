import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  COLUMN_STATS_LIMIT,
  type ColumnStats,
  type ColumnStatsLoader,
} from "../../insights/columnStats";
export function ColumnStatsHint({
  name,
  load,
}: {
  name: string;
  load: ColumnStatsLoader;
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const generation = useRef(0);
  const [position, setPosition] = useState<{
    left: number;
    bottom: number;
  } | null>(null);
  const [stats, setStats] = useState<ColumnStats | null>(null);
  const [error, setError] = useState(false);
  const cancel = () => {
    clearTimeout(timer.current);
  };
  const close = () => {
    cancel();
    generation.current++;
    setPosition(null);
  };
  useEffect(() => {
    close();
    return () => {
      cancel();
      generation.current++;
    };
  }, [load, name]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", escape);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, []);
  const open = () => {
    cancel();
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const gen = ++generation.current;
    setStats(null);
    setError(false);
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 288)),
      bottom: Math.max(
        8,
        Math.min(window.innerHeight - rect.top + 6, window.innerHeight - 280),
      ),
    });
    void load(name).then(
      (value) => {
        if (gen === generation.current) setStats(value);
      },
      () => {
        if (gen === generation.current) setError(true);
      },
    );
  };
  const schedule = () => {
    cancel();
    timer.current = setTimeout(open, 1000);
  };
  const leave = () => {
    cancel();
    timer.current = setTimeout(close, 150);
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        className="column-stats-trigger"
        aria-label={`Statistics for ${name}`}
        aria-describedby={position ? id : undefined}
        onMouseEnter={schedule}
        onMouseLeave={leave}
        onFocus={schedule}
        onBlur={leave}
        onClick={open}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 12V8m5 4V3m5 9V6" />
        </svg>
      </button>
      {position &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className="column-stats-popover"
            style={position}
            onMouseEnter={cancel}
            onMouseLeave={leave}
          >
            <strong>{name}</strong>
            {error ? (
              <p>Couldn’t load statistics. Click the icon to retry.</p>
            ) : stats ? (
              <>
                <dl>
                  {[
                    ["Minimum", stats.min ?? "—"],
                    ["Maximum", stats.max ?? "—"],
                    ["Cardinality (distinct)", stats.distinct.toLocaleString()],
                    [
                      "Distinct / non-empty",
                      stats.count === stats.missing
                        ? "—"
                        : `${((100 * stats.distinct) / (stats.count - stats.missing)).toFixed(1)}%`,
                    ],
                    ["Missing", stats.missing.toLocaleString()],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd title={value}>{value}</dd>
                    </div>
                  ))}
                </dl>
                <p>
                  {stats.count.toLocaleString()} matching rows examined
                  {stats.count >= COLUMN_STATS_LIMIT
                    ? " · Limited summary, not full-column statistics."
                    : "."}
                </p>
              </>
            ) : (
              <p role="status">Calculating statistics…</p>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
