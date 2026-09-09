import { useState, useRef, useLayoutEffect, type RefObject } from "react";
import type { ColumnInfo } from "../../insights/columnKind";
export function ColumnsPanel({
  columns,
  visible,
  label,
  onChange,
  onMove,
  onClose,
  anchorRef,
}: {
  readonly anchorRef?: RefObject<HTMLButtonElement | null>;
  readonly columns: ReadonlyArray<ColumnInfo>;
  readonly visible: ReadonlyArray<ColumnInfo>;
  readonly label: (name: string) => string;
  readonly onChange: (names: ReadonlyArray<string> | null) => void;
  readonly onMove: (source: string, target: string) => void;
  readonly onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const anchor = anchorRef?.current;
    if (!panel || !anchor) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const height = Math.min(420, window.innerHeight - 24);
      const width = Math.min(360, window.innerWidth - 24);
      panel.style.width = `${width}px`;
      panel.style.height = `${height}px`;
      panel.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
      panel.style.top = `${Math.max(12, Math.min(rect.top >= height + 20 ? rect.top - height - 8 : rect.bottom + 8, window.innerHeight - height - 12))}px`;
    };
    panel.showPopover?.();
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchorRef]);
  const names = visible.map((column) => column.name);
  const matches = (column: ColumnInfo) =>
    `${column.name} ${label(column.name)}`
      .toLowerCase()
      .includes(search.toLowerCase());
  const shown = visible.filter(matches);
  const available = columns.filter(
    (column) => !names.includes(column.name) && matches(column),
  );
  return (
    <div
      ref={panelRef}
      popover={
        typeof HTMLElement !== "undefined" &&
        "showPopover" in HTMLElement.prototype
          ? "manual"
          : undefined
      }
      className="columns-popover columns-floating"
      role="group"
      aria-label="Columns"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="columns-panel-heading">
        <strong>Columns</strong>
        <button
          type="button"
          className="table-action-btn"
          aria-label="Close columns"
          onClick={onClose}
        >
          Done
        </button>
      </div>
      <input
        className="details-search"
        type="search"
        aria-label="Find columns"
        placeholder="Find a column"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="columns-panel-list">
        <h4>Shown · {names.length}</h4>
        {shown.map((column) => {
          const index = names.indexOf(column.name);
          return (
            <div className="column-picker-row" key={column.name}>
              <label>
                <input
                  type="checkbox"
                  checked
                  onChange={() =>
                    onChange(names.filter((name) => name !== column.name))
                  }
                />
                <span>{label(column.name)}</span>
              </label>
              <div className="column-move-controls">
                <button
                  type="button"
                  aria-label={`Move ${column.name} up`}
                  title="Move left in table"
                  disabled={index === 0}
                  onClick={() => onMove(column.name, names[index - 1]!)}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="m4 10 4-4 4 4" />
                  </svg>
                </button>
                <button
                  type="button"
                  aria-label={`Move ${column.name} down`}
                  title="Move right in table"
                  disabled={index === names.length - 1}
                  onClick={() => onMove(column.name, names[index + 1]!)}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="m4 6 4 4 4-4" />
                  </svg>
                </button>
              </div>
            </div>
          );
        })}
        <h4>Available · {available.length}</h4>
        {available.map((column) => (
          <div className="column-picker-row" key={column.name}>
            <label>
              <input
                type="checkbox"
                checked={false}
                onChange={() => onChange([...names, column.name])}
              />
              <span>{label(column.name)}</span>
            </label>
          </div>
        ))}
        {shown.length === 0 && available.length === 0 && (
          <p className="details-note">No matching columns</p>
        )}
      </div>
      <div className="columns-panel-footer">
        <button
          type="button"
          className="table-action-btn"
          onClick={() => onChange(null)}
        >
          Reset columns
        </button>
        <span>Saved with workspace</span>
      </div>
    </div>
  );
}
