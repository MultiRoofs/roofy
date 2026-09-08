/** The linked-data drawer entry point.  It retains the table lifecycle gate
 * in TablePanel while the records implementation is progressively split out. */
import type { DuckDBStatus } from "../../insights/duckdb";
import { TablePanel } from "../table/TablePanel";
import "./drawer.css";

export interface DataDrawerProps {
  readonly duckdbStatus: DuckDBStatus;
  readonly onRetryDuckDB: () => void;
}
export function DataDrawer(props: DataDrawerProps) {
  return (
    <div className="data-drawer">
      <TablePanel {...props} />
    </div>
  );
}
