/**
 * §7.5, §7.6 and §7.7's PARAMETERS, in ONE component.
 *
 * Three tools and one file, for the reason `crossLayerParams.ts` is one module:
 * they share the building-geometry radio and the predicate, and three files
 * would be three places for the disabled-option rule to drift. `ToolView`'s
 * dispatch is one branch on the tool's GROUP rather than three on its id.
 *
 * A `{ params, onChange }` sibling of `RoofMetricsParams`: no store access, the
 * bag normalised on the way in by the hook and written back WHOLE on every
 * change — which is what makes "untick everything" a state the form can reach.
 * Everything else it needs (the proxies the target can offer, the source's
 * property keys and types, the city layer's numeric columns) is a prop, because
 * they are facts about two other layers and this component should not be the
 * third place that looks them up.
 *
 * **IT OWNS §6'S INLINE VALIDATION FOR THESE THREE TOOLS.** `RoofMetricsParams`
 * leaves the sentence to `ToolView`, which prints one paragraph under the
 * section; Aggregate's offences are ROW-shaped (residual B11), so the sentence
 * has to render beside the row it is about and be associated with that row's
 * controls. Splitting it — rows here, everything else in the view — would print
 * the same sentence twice, which reads as two problems. So the whole answer is
 * rendered here, from `crossLayerParamsError` and `aggregateRowErrors`: the
 * same two functions the hook blocks Run with, over a context whose `table` is
 * null because neither function reads it.
 */
import { useId, useState } from "react";
import type { ProxyOption } from "../../features/processing/buildingProxy";
import {
  aggregateParams,
  aggregateRowErrors,
  crossLayerParamsError,
  distanceParams,
  joinParams,
  type AggregateOp,
  type CrossLayerContext,
  type JoinPredicate,
  type JoinTie,
} from "../../features/processing/crossLayerParams";
import type { ToolId } from "../../features/processing/types";
import type { ColumnType } from "../../insights/computedColumns";

/** §7.5's three predicates, in §7.5's order and its own spelling, with its own
 *  parentheticals as each option's tooltip. */
const PREDICATES: ReadonlyArray<{
  readonly key: JoinPredicate;
  readonly label: string;
  readonly hint: string;
}> = [
  {
    key: "intersects",
    label: "intersects",
    hint: "Touching a boundary counts",
  },
  {
    key: "within",
    label: "within",
    hint: "The whole proxy inside the area, boundary included",
  },
  {
    key: "centreWithin",
    label: "centre within",
    hint: "Forces the centre proxy",
  },
];

const TIES: ReadonlyArray<{ readonly key: JoinTie; readonly label: string }> = [
  { key: "first", label: "first (by source order)" },
  { key: "largestOverlap", label: "largest overlap" },
  { key: "countOnly", label: "count only" },
];

const OPS: ReadonlyArray<AggregateOp> = ["count", "sum", "mean", "min", "max"];

/** §6: the pair that cannot combine, disabled with that text. */
const NEEDS_AREA_PROXY = "Largest overlap needs a footprint or rectangle";
/** §7.5's field-checklist search appears past this many properties. */
const SEARCH_AT = 12;

export function CrossLayerParams({
  toolId,
  params,
  onChange,
  proxies,
  sourcePropertyKeys,
  sourcePropertyTypes,
  sourceHasFeatureIds,
  numericColumns,
}: {
  readonly toolId: ToolId;
  readonly params: Readonly<Record<string, unknown>>;
  readonly onChange: (next: Readonly<Record<string, unknown>>) => void;
  readonly proxies: ReadonlyArray<ProxyOption>;
  readonly sourcePropertyKeys: ReadonlyArray<string>;
  readonly sourcePropertyTypes: ReadonlyMap<string, ColumnType>;
  readonly sourceHasFeatureIds: boolean;
  readonly numericColumns: ReadonlyArray<string>;
}) {
  const [search, setSearch] = useState("");
  const proxy =
    toolId === "distance-to-nearest"
      ? distanceParams(params).proxy
      : toolId === "aggregate-per-area"
        ? aggregateParams(params).proxy
        : joinParams(params).proxy;
  const footprintNote = proxies.find((o) => !o.available)?.note ?? null;
  // `table: null` is not a shortcut: `crossLayerParamsError` never reads it, so
  // this component's answer and the hook's are the same answer by construction.
  const ctx: CrossLayerContext = {
    table: null,
    sourcePropertyKeys,
    sourcePropertyTypes,
    sourceHasFeatureIds,
    numericColumns,
  };
  const error = crossLayerParamsError(toolId, params, ctx);
  // Aggregate prints its row errors beside the rows, so the section-level
  // paragraph would be the same sentence a second time. The condition is
  // STRUCTURAL — "are there rows to carry it?" — rather than a match on the
  // sentence, which this component does not own.
  const rowLevel =
    toolId === "aggregate-per-area" && aggregateParams(params).rows.length > 0;
  const sectionError = rowLevel ? null : error;

  return (
    <>
      <div className="processing-field">
        <span>Building geometry</span>
        <div
          className="processing-radios"
          role="radiogroup"
          aria-label="Building geometry"
        >
          {proxies.map((option) => (
            <label key={option.key} title={option.note ?? undefined}>
              <input
                type="radio"
                name="proxy"
                disabled={!option.available}
                checked={proxy === option.key}
                onChange={() => onChange({ ...params, proxy: option.key })}
              />
              {option.label}
            </label>
          ))}
        </div>
      </div>
      {footprintNote !== null && (
        <p className="processing-note">{footprintNote}</p>
      )}
      {toolId === "join-by-location" && (
        <JoinFields
          params={params}
          onChange={onChange}
          keys={sourcePropertyKeys}
          types={sourcePropertyTypes}
          search={search}
          setSearch={setSearch}
        />
      )}
      {toolId === "distance-to-nearest" && (
        <DistanceFields
          params={params}
          onChange={onChange}
          keys={sourcePropertyKeys}
          hasFeatureIds={sourceHasFeatureIds}
        />
      )}
      {toolId === "aggregate-per-area" && (
        <AggregateFields
          params={params}
          onChange={onChange}
          numericColumns={numericColumns}
        />
      )}
      {sectionError !== null && (
        <p className="processing-error" role="alert">
          {sectionError}
        </p>
      )}
    </>
  );
}

function PredicateSelect({
  value,
  onPick,
}: {
  readonly value: JoinPredicate;
  readonly onPick: (next: JoinPredicate) => void;
}) {
  return (
    <label className="processing-field">
      <span>Predicate</span>
      <select
        aria-label="Predicate"
        value={value}
        onChange={(e) => onPick(e.target.value as JoinPredicate)}
      >
        {/* §7.5's own parentheticals are the options' titles — including
            "forces the centre proxy", which is the whole of what the reader
            needs to know about `centre within` and is the spec's own wording.
            No second sentence is invented under the select for it. */}
        {PREDICATES.map((option) => (
          <option key={option.key} value={option.key} title={option.hint}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function JoinFields({
  params,
  onChange,
  keys,
  types,
  search,
  setSearch,
}: {
  readonly params: Readonly<Record<string, unknown>>;
  readonly onChange: (next: Readonly<Record<string, unknown>>) => void;
  readonly keys: ReadonlyArray<string>;
  readonly types: ReadonlyMap<string, ColumnType>;
  readonly search: string;
  readonly setSearch: (next: string) => void;
}) {
  const current = joinParams(params);
  const ticked = new Set(current.fields);
  const shown =
    keys.length > SEARCH_AT && search.trim() !== ""
      ? keys.filter((k) =>
          k.toLowerCase().includes(search.trim().toLowerCase()),
        )
      : keys;
  return (
    <>
      <PredicateSelect
        value={current.predicate}
        onPick={(predicate) => onChange({ ...params, predicate })}
      />
      <div className="processing-field">
        <span>Fields to copy</span>
        <div>
          {keys.length > SEARCH_AT && (
            <input
              type="search"
              aria-label="Search fields"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          )}
          <div className="processing-checks">
            {shown.map((key) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={ticked.has(key)}
                  onChange={() =>
                    onChange({
                      ...params,
                      // Rebuilt from the SOURCE order, not click order: §6.2's
                      // "first copied TEXT field" depends on it.
                      fields: keys.filter((k) =>
                        k === key ? !ticked.has(k) : ticked.has(k),
                      ),
                    })
                  }
                />
                {key}
                <span className="processing-note">
                  {types.get(key) ?? "VARCHAR"}
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>
      <label className="processing-field">
        <span>When several areas match</span>
        <select
          aria-label="When several areas match"
          value={current.tie}
          onChange={(e) => {
            const tie = e.target.value as JoinTie;
            onChange({
              ...params,
              tie,
              // §7.5: "count only" "writes no fields and forces the match
              // count on".
              writeMatchCount:
                tie === "countOnly" ? true : current.writeMatchCount,
            });
          }}
        >
          {TIES.map((option) => (
            <option
              key={option.key}
              value={option.key}
              // §6: "a proxy/predicate pair that cannot combine … disables the
              // option with that text".
              disabled={
                option.key === "largestOverlap" && current.proxy === "centre"
              }
              title={
                option.key === "largestOverlap" && current.proxy === "centre"
                  ? NEEDS_AREA_PROXY
                  : undefined
              }
            >
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="processing-check">
        <input
          type="checkbox"
          checked={current.writeMatchCount}
          disabled={current.tie === "countOnly"}
          onChange={() =>
            onChange({ ...params, writeMatchCount: !current.writeMatchCount })
          }
        />
        Also write the match count
      </label>
    </>
  );
}

function DistanceFields({
  params,
  onChange,
  keys,
  hasFeatureIds,
}: {
  readonly params: Readonly<Record<string, unknown>>;
  readonly onChange: (next: Readonly<Record<string, unknown>>) => void;
  readonly keys: ReadonlyArray<string>;
  readonly hasFeatureIds: boolean;
}) {
  const current = distanceParams(params);
  return (
    <>
      <label className="processing-field">
        <span>Max search distance (m)</span>
        <input
          type="number"
          aria-label="Max search distance (m)"
          min={0}
          step="any"
          value={current.maxDistanceM}
          onChange={(e) =>
            onChange({ ...params, maxDistanceM: Number(e.target.value) })
          }
        />
      </label>
      <label className="processing-check">
        <input
          type="checkbox"
          checked={current.writeNearestId}
          onChange={() =>
            onChange({ ...params, writeNearestId: !current.writeNearestId })
          }
        />
        Also write the nearest feature&apos;s id
      </label>
      {current.writeNearestId && (
        <label className="processing-field">
          <span>Nearest feature&apos;s id</span>
          <select
            aria-label="Nearest feature's id"
            value={current.nearestIdProperty ?? ""}
            onChange={(e) =>
              onChange({
                ...params,
                nearestIdProperty:
                  e.target.value === "" ? null : e.target.value,
              })
            }
          >
            {/* §7.7: the feature's OWN id, offered only when the source has
                one. Its value is the empty string, which is `null` in the bag
                — the same spelling `distanceParams` reads. */}
            {hasFeatureIds ? (
              <option value="">The feature&apos;s id</option>
            ) : (
              // §7.7's own sentence for this state, verbatim.
              <option value="">Choose the property to copy</option>
            )}
            {keys.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

function AggregateFields({
  params,
  onChange,
  numericColumns,
}: {
  readonly params: Readonly<Record<string, unknown>>;
  readonly onChange: (next: Readonly<Record<string, unknown>>) => void;
  readonly numericColumns: ReadonlyArray<string>;
}) {
  const current = aggregateParams(params);
  // Residual B11: one sentence per row, from the same function
  // `crossLayerParamsError` is built out of, so the message Run is blocked with
  // is literally the one beside the row.
  const rowErrors = aggregateRowErrors(current);
  const errorId = useId();
  const replace = (
    index: number,
    next: { readonly op: AggregateOp; readonly column: string | null },
  ) =>
    onChange({
      ...params,
      rows: current.rows.map((row, i) => (i === index ? next : row)),
    });
  return (
    <>
      <PredicateSelect
        value={current.predicate}
        onPick={(predicate) => onChange({ ...params, predicate })}
      />
      {current.rows.map((row, index) => {
        const rowError = rowErrors[index] ?? null;
        const describedBy =
          rowError === null ? undefined : `${errorId}-${index}`;
        return (
          // The rows are an ORDERED list the user edits in place; the index IS
          // the identity (two `sum`s of one column are a real, flagged state).
          <div key={index} className="processing-aggregate">
            <div className="processing-aggregate__row">
              <select
                aria-label={`Aggregate ${index + 1}`}
                aria-describedby={describedBy}
                value={row.op}
                onChange={(e) => {
                  const op = e.target.value as AggregateOp;
                  replace(index, {
                    op,
                    column:
                      op === "count"
                        ? null
                        : (row.column ?? numericColumns[0] ?? null),
                  });
                }}
              >
                {OPS.map((op) => (
                  <option key={op} value={op}>
                    {op}
                  </option>
                ))}
              </select>
              {row.op !== "count" && (
                <select
                  aria-label={`Column ${index + 1}`}
                  aria-describedby={describedBy}
                  value={row.column ?? ""}
                  onChange={(e) =>
                    replace(index, {
                      op: row.op,
                      column: e.target.value === "" ? null : e.target.value,
                    })
                  }
                >
                  {/* A row with no column is a REAL state — a source layer with
                      no numeric column has nothing to offer — and a controlled
                      select whose value matches no option renders the first one
                      instead, which would show a column the bag does not carry.
                      The placeholder is the same sentence the blocking error
                      uses. **[adapted copy A17]** */}
                  {row.column === null && (
                    <option value="">Choose a column to summarise</option>
                  )}
                  {numericColumns.map((column) => (
                    <option key={column} value={column}>
                      {column}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                className="processing-aggregate__remove"
                aria-label={`Remove aggregate ${index + 1}`}
                onClick={() =>
                  onChange({
                    ...params,
                    rows: current.rows.filter((_, i) => i !== index),
                  })
                }
              >
                ×
              </button>
            </div>
            {rowError !== null && (
              <p className="processing-error" id={describedBy} role="alert">
                {rowError}
              </p>
            )}
          </div>
        );
      })}
      <button
        type="button"
        className="processing-add"
        onClick={() =>
          onChange({
            ...params,
            rows: [...current.rows, { op: "count", column: null }],
          })
        }
      >
        + Add aggregate
      </button>
    </>
  );
}
