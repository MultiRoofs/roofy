/**
 * The one attribute-value formatter, shared by every inspector view that
 * lists flat attributes. Split into its own (non-`.tsx`) module so
 * `attrDisplay.tsx`'s `AttrRow` stays the only export there — a `.tsx` file
 * mixing a component with a plain function trips react-refresh's
 * "only-export-components" rule.
 */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return typeof value === "string" ? value : JSON.stringify(value);
}
