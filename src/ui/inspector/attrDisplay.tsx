/**
 * The one key/value row shared by every view that lists flat attributes:
 * the details panel's attribute and geo-feature tables, and
 * `GeoLayerInspector`'s layer info.
 *
 * `formatValue` lives in the sibling `formatAttrValue` module, not here —
 * this file exports only the component, which is what keeps react-refresh's
 * "only-export-components" rule clean.
 */

import type { ReactNode } from "react";

export function AttrRow({
  label,
  value,
  badge,
}: {
  label: string;
  value: string;
  /** Rendered beside the KEY — the computed badge (spec §8), never a second
   *  copy of the `.attr-row` markup. */
  badge?: ReactNode;
}) {
  return (
    <div className="attr-row">
      <span className={`attr-key${badge ? " attr-key-badged" : ""}`}>
        {label}
        {badge}
      </span>
      <span className="attr-value" title={value}>
        {value}
      </span>
    </div>
  );
}
