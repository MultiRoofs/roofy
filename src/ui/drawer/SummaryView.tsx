import { useEffect, useMemo, useState } from "react";
import { runQuery } from "../../insights/duckdb";
import type { LayerTable } from "../../insights/layerTables";
import { buildFeatureIdsSql, compileFilter } from "../../insights/sql";
import type { Layer } from "../../features/layers/layerStore";
import type { LayerQuery } from "../../features/query/types";
import { getResidentModel } from "../../features/streaming/residentModel";
import { useStreamStore } from "../../features/streaming/streamStore";
import { formatCount } from "../table/tableText";
import {
  summarizeCityModel,
  summarizeResidentRecords,
  type LayerSummary,
  type SummaryBin,
} from "./layerSummary";

type Scope = "all" | "matching";

function NumericRows({ rows }: { readonly rows: ReadonlyArray<SummaryBin> }) {
  if (rows.length === 0)
    return <span className="data-drawer-note">Unavailable</span>;
  const maximum = Math.max(...rows.map((row) => row.count), 1);
  return (
    <div className="summary-bars">
      {rows.map((row) => (
        <div className="summary-bar" key={row.label}>
          <span>{row.label}</span>
          <i style={{ width: `${(row.count / maximum) * 100}%` }} />
          <b>{row.count}</b>
        </div>
      ))}
    </div>
  );
}

function Definition({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function metric(value: number | null, suffix = ""): string {
  return value === null ? "Unavailable" : `${value.toFixed(1)}${suffix}`;
}

export function SummaryView({
  layer,
  query,
  table,
}: {
  readonly layer: Layer;
  readonly query: LayerQuery | null;
  readonly table: LayerTable | null;
}) {
  const [scope, setScope] = useState<Scope>("all");
  const streamVersion = useStreamStore(
    (state) => state.streams[layer.id]?.version,
  );
  const resident = layer.isStreaming
    ? getResidentModel(layer.id, streamVersion ?? 0)
    : null;
  const allSummary = useMemo(
    () =>
      layer.isStreaming
        ? summarizeResidentRecords(resident!.objects)
        : summarizeCityModel(layer.model.objects),
    [layer, resident],
  );
  const [matchingIds, setMatchingIds] = useState<ReadonlySet<string> | null>(
    null,
  );
  const [matchingLoading, setMatchingLoading] = useState(false);
  const [matchingError, setMatchingError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    if (query?.applied === null || query?.applied === undefined) {
      setScope("all");
      setMatchingIds(null);
      setMatchingLoading(false);
      setMatchingError(null);
      return () => {
        current = false;
      };
    }
    if (table === null) {
      setMatchingIds(null);
      setMatchingLoading(false);
      setMatchingError(
        "Matching records are unavailable until this layer's table is ready.",
      );
      return () => {
        current = false;
      };
    }
    const compiled = compileFilter(query.applied, table.columns);
    if (!compiled.ok || compiled.where === null) {
      setMatchingIds(null);
      setMatchingLoading(false);
      setMatchingError(
        compiled.ok ? "Matching records are unavailable." : compiled.message,
      );
      return () => {
        current = false;
      };
    }
    setMatchingLoading(true);
    setMatchingIds(null);
    setMatchingError(null);
    void runQuery(buildFeatureIdsSql(table.table, compiled.where)).then(
      (result) => {
        if (!current) return;
        setMatchingLoading(false);
        if (!result.ok) {
          setMatchingError(result.message);
          return;
        }
        setMatchingIds(new Set(result.rows.map((row) => String(row.id))));
      },
    );
    return () => {
      current = false;
    };
  }, [layer.id, query?.applied, table]);

  const summary: LayerSummary | null =
    scope === "all"
      ? allSummary
      : matchingIds === null
        ? null
        : layer.isStreaming
          ? summarizeResidentRecords(resident!.objects, matchingIds)
          : summarizeCityModel(layer.model.objects, matchingIds);
  const matchingAvailable =
    query?.applied !== null && query?.applied !== undefined;
  const scopeLabel = layer.isStreaming ? "currently loaded" : "buildings";

  return (
    <section className="data-drawer-summary" aria-label="Layer summary">
      <div className="summary-scope" role="group" aria-label="Summary scope">
        <button
          type="button"
          aria-pressed={scope === "all"}
          onClick={() => setScope("all")}
        >
          All
        </button>
        <button
          type="button"
          aria-pressed={scope === "matching"}
          disabled={!matchingAvailable}
          onClick={() => setScope("matching")}
        >
          Matching
        </button>
      </div>
      {matchingLoading && scope === "matching" ? (
        <span className="data-drawer-note">
          Calculating matching buildings…
        </span>
      ) : matchingError !== null && scope === "matching" ? (
        <p role="alert">{matchingError}</p>
      ) : summary === null ? null : (
        <>
          <p className="summary-scope-label">
            {formatCount(summary.buildings)}{" "}
            {scope === "matching" ? "matching " : ""}
            {scopeLabel}
            {layer.isStreaming ? " buildings — not the whole dataset" : ""}
          </p>
          <dl className="summary-definition-grid">
            <Definition
              label="Buildings"
              value={formatCount(summary.buildings)}
            />
            <Definition
              label="Parts"
              value={
                summary.parts === null
                  ? "Unavailable"
                  : formatCount(summary.parts)
              }
            />
            <Definition
              label="Roof surfaces"
              value={
                summary.roofSurfaces === null
                  ? "Unavailable"
                  : formatCount(summary.roofSurfaces)
              }
            />
            <Definition
              label="Total roof area"
              value={metric(summary.totalRoofArea, " m²")}
            />
            <Definition
              label="Mean height"
              value={metric(summary.meanHeight, " m")}
            />
          </dl>
          <div>
            <strong>Height distribution</strong>
            <NumericRows rows={summary.heightBins} />
          </div>
          <div>
            <strong>Roof type breakdown</strong>
            <NumericRows rows={summary.roofTypes} />
          </div>
          <div>
            <strong>Year of construction</strong>
            <NumericRows rows={summary.constructionYears} />
          </div>
        </>
      )}
      <p className="data-drawer-note">
        Selection-specific metrics are shown in the details panel.
      </p>
    </section>
  );
}
