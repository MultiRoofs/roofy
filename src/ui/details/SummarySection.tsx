/**
 * The SUMMARY section — the derived numbers for the current selection,
 * rendered as key/value rows. A row marked `act: "owner"` (the "Belongs to"
 * row of a surface summary) renders as a link that selects the owning
 * building.
 */
import type { SummaryRow } from "./subject";

export function SummarySection({
  rows,
  onSelectOwner,
}: {
  readonly rows: ReadonlyArray<SummaryRow>;
  readonly onSelectOwner?: () => void;
}) {
  return (
    <section className="details-section">
      <h3 className="details-section-title">Summary</h3>
      {rows.map((row) =>
        row.act === "owner" ? (
          <div key={row.label} className="attr-row">
            <span className="attr-key">{row.label}</span>
            <button
              className="attr-value attr-value-link"
              onClick={onSelectOwner}
            >
              {row.value}
            </button>
          </div>
        ) : (
          <div key={row.label} className="attr-row">
            <span className="attr-key">{row.label}</span>
            <span className="attr-value" title={row.value}>
              {row.value}
            </span>
          </div>
        ),
      )}
    </section>
  );
}
