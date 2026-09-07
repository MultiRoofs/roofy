/**
 * The one key/value row shared by every inspector view that lists flat
 * attributes: `InspectorPanel`'s Object tab, `GeoLayerInspector`'s layer
 * info, and the details panel's geo feature properties.
 *
 * Split out of `InspectorPanel.tsx` so it can be reused without importing
 * that whole component. `formatValue` lives in the sibling `formatAttrValue`
 * module, not here — this file exports only the component, which is what
 * keeps react-refresh's "only-export-components" rule clean.
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
