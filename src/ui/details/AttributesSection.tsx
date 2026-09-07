/**
 * The ATTRIBUTES section — a two-column key/value table of the subject's
 * attributes, with a search field filtering by key when there are more than
 * eight rows.
 */
import { useState } from "react";
import { AttrRow } from "../inspector/attrDisplay";
import { formatValue } from "../inspector/formatAttrValue";

export function AttributesSection({
  attributes,
}: {
  readonly attributes: Readonly<Record<string, unknown>>;
}) {
  const entries = Object.entries(attributes);
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
      <h3 className="details-section-title">Attributes</h3>
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
      {filtered.map(([key, value]) => (
        <AttrRow key={key} label={key} value={formatValue(value)} />
      ))}
    </section>
  );
}
