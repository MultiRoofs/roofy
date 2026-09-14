/**
 * The ATTRIBUTES section — a two-column key/value table of the subject's
 * attributes, with a search field filtering by key when there are more than
 * eight rows.
 */
import {
  attributeKeys,
  reorderAttribute,
} from "../../features/attributes/attributeOrder";
import { useState, type ReactNode } from "react";
import { AttrRow } from "../inspector/attrDisplay";
import { formatValue } from "../inspector/formatAttrValue";

export function AttributesSection({
  attributes,
  order = [],
  onOrderChange,
  trailing = null,
}: {
  readonly order?: ReadonlyArray<string>;
  readonly onOrderChange?: (order: ReadonlyArray<string>) => void;
  readonly attributes: Readonly<Record<string, unknown>>;
  /** Appended inside the section: the COMPUTED group (spec §8), which is not
   *  part of `attributes` here because a tool's results are not reorderable
   *  with the file's own keys. */
  readonly trailing?: ReactNode;
}) {
  const keys = attributeKeys(attributes, order);
  const entries = keys.map((key) => [key, attributes[key]] as const);
  const [reordering, setReordering] = useState(false);
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const clearDrag = () => {
    setDragging(null);
    setDropTarget(null);
  };

  const filtered =
    query === ""
      ? entries
      : entries.filter(([key]) =>
          key.toLowerCase().includes(query.toLowerCase()),
        );

  if (entries.length === 0) {
    return (
      <section className="details-section">
        <h3 className="details-section-title">Attributes</h3>
        {/* "No attributes" is about the FILE's attributes. With a computed
            group to show, saying it would deny values that are right there. */}
        {trailing === null ? (
          <div className="details-placeholder">No attributes</div>
        ) : (
          trailing
        )}
      </section>
    );
  }

  return (
    <section className="details-section">
      <div className="attribute-section-heading">
        <h3 className="details-section-title">Attributes</h3>
        {onOrderChange && entries.length > 1 && (
          <button
            type="button"
            className="active-layer-action"
            aria-label={
              reordering ? "Finish reordering attributes" : "Reorder attributes"
            }
            aria-pressed={reordering}
            onClick={() => {
              clearDrag();
              setReordering(!reordering);
            }}
          >
            {reordering ? "Done" : "Reorder"}
          </button>
        )}
      </div>
      {reordering && (
        <p className="details-note">
          Drag rows or use the arrow buttons to reorder. Order is shared by
          objects of this type in this layer.
        </p>
      )}
      {entries.length > 8 && (
        <input
          className="details-search"
          type="search"
          placeholder="Filter attributes"
          aria-label="Filter attributes"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {filtered.map(([key, value], index) => (
        <div
          key={key}
          className="attribute-order-row"
          data-dragging={dragging === key || undefined}
          data-drop-target={dropTarget === key || undefined}
          onDragOver={(event) => {
            if (!reordering || dragging === null || dragging === key) return;
            event.preventDefault();
            setDropTarget(key);
          }}
          onDragLeave={() => setDropTarget(null)}
          onDrop={(event) => {
            if (!reordering || dragging === null || !keys.includes(dragging))
              return;
            event.preventDefault();
            if (dragging !== key)
              onOrderChange?.(reorderAttribute(order, keys, dragging, key));
            clearDrag();
          }}
        >
          {reordering && onOrderChange && (
            <button
              type="button"
              className="attribute-drag-handle"
              aria-label={`Drag ${key}`}
              title="Drag to reorder. You can also use the arrow buttons."
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", key);
                setDragging(key);
              }}
              onDragEnd={clearDrag}
              onKeyDown={(event) => {
                if (event.key === "Escape") clearDrag();
              }}
            >
              <svg
                width="12"
                height="16"
                viewBox="0 0 12 16"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  d="M3 3h1M8 3h1M3 8h1M8 8h1M3 13h1M8 13h1"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
          <AttrRow label={key} value={formatValue(value)} />
          {reordering && onOrderChange && (
            <div className="attribute-order-actions">
              <button
                type="button"
                aria-label={`Move ${key} up`}
                disabled={index === 0}
                onClick={() =>
                  onOrderChange(
                    reorderAttribute(order, keys, key, filtered[index - 1]![0]),
                  )
                }
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="m4 10 4-4 4 4" />
                </svg>
              </button>
              <button
                type="button"
                aria-label={`Move ${key} down`}
                disabled={index === filtered.length - 1}
                onClick={() =>
                  onOrderChange(
                    reorderAttribute(order, keys, key, filtered[index + 1]![0]),
                  )
                }
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="m4 6 4 4 4-4" />
                </svg>
              </button>
            </div>
          )}
        </div>
      ))}
      {trailing}
    </section>
  );
}
