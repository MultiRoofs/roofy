/**
 * The ATTRIBUTES section — a two-column key/value table of the subject's
 * attributes, with a search field filtering by key when there are more than
 * eight rows.
 */
import {
  attributeKeys,
  reorderAttribute,
} from "../../features/attributes/attributeOrder";
import { useState } from "react";
import { AttrRow } from "../inspector/attrDisplay";
import { formatValue } from "../inspector/formatAttrValue";

export function AttributesSection({
  attributes,
  order = [],
  onOrderChange,
}: {
  readonly order?: ReadonlyArray<string>;
  readonly onOrderChange?: (order: ReadonlyArray<string>) => void;
  readonly attributes: Readonly<Record<string, unknown>>;
}) {
  const keys = attributeKeys(attributes, order);
  const entries = keys.map((key) => [key, attributes[key]] as const);
  const [reordering, setReordering] = useState(false);
  const [query, setQuery] = useState("");

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
        <div className="details-placeholder">No attributes</div>
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
            onClick={() => setReordering(!reordering)}
          >
            {reordering ? "Done" : "Reorder"}
          </button>
        )}
      </div>
      {reordering && (
        <p className="details-note">
          Order is shared by objects of this type in this layer.
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
        <div key={key} className="attribute-order-row">
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
    </section>
  );
}
