import type { ColumnInfo } from "../../insights/columnKind";

export const DERIVED_COLUMNS = [
  { key: "__roofy_roof_area", label: "Roof area", type: "DERIVED" },
  { key: "__roofy_mean_slope", label: "Mean slope", type: "DERIVED" },
  { key: "__roofy_parts", label: "Parts", type: "DERIVED" },
] as const;

export function derivedColumns(
  columns: ReadonlyArray<ColumnInfo>,
): ReadonlyArray<ColumnInfo> {
  const occupied = new Set(columns.map((column) => column.name));
  return DERIVED_COLUMNS.map((column) => {
    let name: string = column.key;
    while (occupied.has(name)) name = `_${name}`;
    occupied.add(name);
    return { name, type: column.type, kind: "nested" as const };
  });
}

/** Buildings add internal derived fields without ever replacing a source
 * attribute of the same user-facing name. Raw keeps structural source fields.
 *
 * `computed` is the provenance registry's column set for the layer: spec §8
 * puts a tool's results ON by default, after the file's columns — a run whose
 * three new columns land in "Available" and nowhere else looks like a run that
 * did nothing. Raw already lists every column of the table, so they are only
 * appended for the buildings view. */
export function defaultColumns(
  columns: ReadonlyArray<ColumnInfo>,
  view: "buildings" | "raw",
  computed: ReadonlySet<string> = new Set(),
): ReadonlyArray<ColumnInfo> {
  if (view === "raw") return columns.filter((column) => column.kind !== "blob");
  const base = columns.filter(
    (column) =>
      [
        "id",
        "function",
        "roofType",
        "measuredHeight",
        "yearOfConstruction",
        "status",
      ].includes(column.name) && !computed.has(column.name),
  );
  return [
    ...base,
    ...derivedColumns(columns),
    ...columns.filter(
      (column) => computed.has(column.name) && column.kind !== "blob",
    ),
  ];
}

export function columnLabel(name: string): string {
  return (
    DERIVED_COLUMNS.find((column) => name.endsWith(column.key))?.label ?? name
  );
}

/** Human-readable derived-field headers and units. Source field names/types
 * stay literal because their units are not known by the viewer. */
export function derivedColumnTitle(name: string): string {
  const key = DERIVED_COLUMNS.find((column) => name.endsWith(column.key))?.key;
  switch (key) {
    case "__roofy_roof_area":
      return "Roof area (m²)";
    case "__roofy_mean_slope":
      return "Mean slope (°)";
    case "__roofy_parts":
      return "Parts (count)";
    default:
      return columnLabel(name);
  }
}
