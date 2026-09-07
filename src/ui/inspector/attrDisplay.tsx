/**
 * The one key/value row shared by every view that lists flat attributes:
 * the details panel's attribute and geo-feature tables, and
 * `GeoLayerInspector`'s layer info.
 *
 * `formatValue` lives in the sibling `formatAttrValue` module, not here —
 * this file exports only the component, which is what keeps react-refresh's
 * "only-export-components" rule clean.
 */

export function AttrRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="attr-row">
      <span className="attr-key">{label}</span>
      <span className="attr-value" title={value}>
        {value}
      </span>
    </div>
  );
}
