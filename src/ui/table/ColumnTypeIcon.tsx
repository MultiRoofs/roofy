import type { ColumnInfo } from "../../insights/columnKind";
import { columnTypeLabel } from "../../insights/filterCandidates";
export function ColumnTypeIcon({ column }: { column: ColumnInfo | undefined }) {
  const label = columnTypeLabel(column);
  const paths: Record<string, string> = {
    Number: "M6 2 4 14M12 2l-2 12M2 6h12M1 10h12",
    Text: "M2 13 6 3l4 10M3.5 9h5M11 7h4m-2-2v8",
    Boolean: "m3 8 3 3 7-7",
    "Date / time": "M3 4h10v10H3zM5 2v4m6-4v4M3 7h10",
    Nested: "M5 2H3v12h2m6-12h2v12h-2",
  };
  return (
    <span
      className="filter-type-icon"
      role="img"
      aria-label={`${label} column`}
      title={`${label} · ${column?.type ?? "Unknown"}`}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d={paths[label] ?? "M3 3h10v10H3z"} />
      </svg>
    </span>
  );
}
