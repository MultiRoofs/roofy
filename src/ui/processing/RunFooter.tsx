/**
 * Spec §6's footer: one region that is the Run button, the progress block, the
 * result card or the failure, depending on the run the form is watching.
 *
 * It is a footer and not four components because the states REPLACE each other
 * in the same place — the user's eye stays where it was when they pressed Run.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  runById,
  useProcessingStore,
} from "../../features/processing/processingStore";
import {
  cancelRun,
  newLayerUndoBlock,
  retryRun,
  undoRun,
} from "../../features/processing/runQueue";
import { toolById } from "../../features/processing/toolRegistry";
import {
  resolveStyleOperator,
  resolveStyleValueSource,
  type RunRecord,
  type StyleByResult,
  type StyleValueSource,
} from "../../features/processing/types";
import type { OutputColumn } from "../../insights/computedColumns";
import { activateLayer } from "../../features/workspace/layerCoordination";
import { useShellStore } from "../shell/shellStore";
import { layerQuery, useQueryStore } from "../../features/query/queryStore";
import { appendColumns } from "../drawer/columnPolicy";
import { requestColumnReveal } from "../table/revealColumns";
import { openRunLog } from "./revealTools";
import { UNDO_ENGINE_STOPPED, phaseLine, plural, seconds } from "./runFormat";
import { useLayerStore } from "../../features/layers/layerStore";
import { useGeoLayerStore } from "../../features/geoLayers/geoLayerStore";
import { categoriesFor } from "../../features/geoLayers/categorize";
import { useRuleDraftStore } from "../../features/rules/ruleDraftStore";
import { useLayerTableStore } from "../../insights/layerTables";
import { runQuery, type QueryOutcome } from "../../insights/duckdb";
import { buildMedianSql, buildMostFrequentSql } from "../../insights/sql";
import { nextRuleColor } from "../../features/rules/nextRuleColor";

/** §6.2's reason for a Style-by-result button with nothing to style. */
const ALL_VALUES_EMPTY = "All values are empty";
/** §7's reason: the layer's table was rebuilt after the run, so the run no
 *  longer describes what a median would be read from. Same string the card
 *  already prints for a stale run. */
const STALE_LAYER_RELOADED = "stale: layer reloaded";
/**
 * The note `undoRun` writes onto a run it took back — and therefore the reason
 * Style by result is off on that card (gate defect F3).
 *
 * ONE constant for both readings: the two guards inside `useStyleByResult` and
 * `styleGeoLayerByAttribute` test the same note, and a string spelled twice is
 * how a button would come to be disabled for a reason the click no longer
 * recognises.
 */
const UNDONE_NOTE = "Undone";

/**
 * The columns the run WROTE, with their types.
 *
 * `RunRecord.columns` are the TABLE's spellings of what the run actually wrote;
 * the types are reproducible exactly, because `run.prefix` and `run.params` are
 * FROZEN (§6.1) and `outputColumns` is pure. Matched without regard to case,
 * like every other comparison between column names — DuckDB's identifiers are
 * case-insensitive and the table's spelling is the one that wins.
 */
function writtenColumns(run: RunRecord): ReadonlyArray<OutputColumn> {
  const promised = new Map(
    (toolById(run.toolId).outputColumns?.(run.prefix, run.params) ?? []).map(
      (c) => [c.name.toLowerCase(), c.type],
    ),
  );
  return run.columns.map((name) => ({
    name,
    // DOUBLE is the fallback for a tool that promises no columns at all; every
    // implemented tool in the registry does, so it is the honest default for a
    // record written before its tool declared them rather than a guess.
    type: promised.get(name.toLowerCase()) ?? "DOUBLE",
  }));
}

/**
 * §6.2's prefilled value, or `null` when it could not be read.
 *
 * `null` is not a failure to report when the TABLE is gone: the button is only
 * offered on a DONE run whose own writes went into that table, and a table that
 * has since gone takes the layer out of the tool's target list altogether
 * (`useToolForm.ts:83`). A literal needs no engine at all.
 */
async function readStyleValue(
  layerId: string,
  column: string,
  // The RESOLVED source, never `StyleByResult["value"]` — that union includes
  // a FUNCTION of the picked column (§7.5 needs two answers), and `.kind` does
  // not exist on it. The caller resolves it with `resolveStyleValueSource`,
  // which is the one place either function-union field is read.
  source: StyleValueSource,
): Promise<
  QueryOutcome | null | { readonly literal: number | string | boolean }
> {
  if (source.kind === "literal") return { literal: source.value };
  const entry = useLayerTableStore.getState().tables[layerId];
  if (entry?.state !== "ready") return null;
  return await runQuery(
    source.kind === "median"
      ? buildMedianSql(entry.info.table, column)
      : buildMostFrequentSql(entry.info.table, column),
  );
}

/**
 * §7.6's Style by result: "opens the vector layer's STYLE section with Color by
 * attribute set to the first output column (categories prefilled from its
 * values)".
 *
 * The VECTOR answer to §6.2's button, and the reason it is a branch of its own
 * rather than a rule: a geo layer has no rules (the editor reads CityJSON
 * attributes and roof metrics) and no table, so there is nothing to read a
 * median from and nothing to draft. The colouring is written STRAIGHT to the
 * store — unlike the rule draft, which waits for Save — because that is what
 * "Color by attribute" is: the same one-step edit the select in the style
 * section makes, and the same `categoriesFor` over the same document.
 *
 * THE DOCUMENT IS `preparedData` FIRST, which is where §7.6's publication put
 * the run's own column: `config.data` is the FILE, and the categories of a
 * column the file never had would be empty.
 *
 * The layer is re-read from the store at click time and narrowed to a GeoJSON
 * one: a layer removed while the card was on screen is abandoned silently
 * (`requestSection` activates whatever id it is handed, which would resurrect
 * it), exactly as the city path abandons a removed city layer.
 */
function styleGeoLayerByAttribute(
  run: RunRecord,
  layerId: string,
  column: OutputColumn,
): void {
  // §7: a run that went stale or was undone while the card was on screen no
  // longer describes the column this colouring would be about. An Undo leaves
  // the record on `done` and says so only in the note (`runQueue.ts`'s
  // `undoRun`), so the note is part of the test — the same guard the median
  // path makes, because the two are one button.
  const current = runById(run.id);
  if (
    current === null ||
    current.stale ||
    current.status !== "done" ||
    current.note === UNDONE_NOTE
  )
    return;
  const layer = useGeoLayerStore
    .getState()
    .layers.find((l) => l.id === layerId);
  if (layer === undefined || layer.kind !== "geojson") return;
  const document = layer.config.preparedData ?? layer.config.data;
  if (document === undefined) return;
  useGeoLayerStore.getState().updateGeoLayer(layerId, {
    // The WHOLE style, as `GeoLayerPatch.style` requires.
    style: {
      ...layer.style,
      colorByAttribute: {
        attribute: column.name,
        categories: categoriesFor(document, column.name),
      },
    },
  });
  // Last, so the panel opens on a colouring that is already written.
  useShellStore.getState().requestSection(layerId, "style");
}

/**
 * §6.2's "Style by result": open the target's STYLE section with the rule
 * editor on a DRAFT — never a saved rule, and never a repaint, because "the map
 * does NOT change until the user presses Save in the editor". `Color by =
 * Rules` is the EDITOR's write, applied when that Save comes (M3 ruling C6);
 * nothing in this file touches `colorBy`.
 *
 * WHICH column, WHICH operator and WHERE the value comes from are the tool's
 * own answer — `ToolDefinition.styleByResult`, read through the two resolvers.
 * This hook only carries it out.
 *
 * A value the descriptor sources from the DATA (§7.4's `extent_height_m >`
 * median, §7.5's most frequent text) is read at click time, which is why this
 * is async: it is one DuckDB round trip and the navigation waits for it. A
 * LITERAL (§7.3's `solid_valid = false`) needs no engine and no wait.
 *
 * A read that produces no usable value — NULL, no row, a non-finite number —
 * opens NOTHING and says why in the toast (§6.2's own failure surface). The
 * rejected alternative was a `> 0` fallback: it looks exactly like a real
 * answer, and DuckDB had already handed us the reason it failed.
 *
 * `pending` and `token` are the two guards the awaited gap needs: the button
 * is disabled while its read is in flight, so two overlapping reads cannot
 * each replace the whole draft on arrival, and the token invalidates a read
 * whose CONTEXT has gone — a newer click, an unmount, or the card being
 * dismissed by Run again, which swaps `run` for null without unmounting the
 * footer (`ToolView.tsx:209-215`). That last one is why the invalidation is
 * keyed on the run's identity and not on the unmount alone.
 */
function useStyleByResult(runId: string | null): {
  readonly pending: boolean;
  readonly start: (
    run: RunRecord,
    column: OutputColumn,
    descriptor: StyleByResult,
  ) => void;
} {
  const [pending, setPending] = useState(false);
  const tokenRef = useRef(0);
  useEffect(
    () => () => {
      // Leaving this run's card: whatever it started is no longer wanted, and
      // the card that replaces it starts with a button of its own.
      tokenRef.current += 1;
      setPending(false);
    },
    [runId],
  );

  const start = useCallback(
    (run: RunRecord, column: OutputColumn, descriptor: StyleByResult) => {
      // The run's own target is the frozen truth (§6.1), as for Open table —
      // except for a New-layer run, whose results live in the COPY (§6.2).
      const layerId = run.newLayerId ?? run.targetLayerId;
      const token = tokenRef.current + 1;
      tokenRef.current = token;
      setPending(true);
      void (async () => {
        try {
          // §7.6's descriptor, decided BEFORE the value read and before the
          // city-layer lookups below — both of which are about a table and a
          // rule draft this branch has neither of. Its target is a VECTOR
          // layer, so `useLayerStore` does not hold it and the "still alive"
          // test above would abandon every one of these clicks.
          if (descriptor.kind === "attribute") {
            styleGeoLayerByAttribute(run, layerId, column);
            return;
          }
          const outcome = await readStyleValue(
            layerId,
            column.name,
            resolveStyleValueSource(descriptor, column),
          );
          if (tokenRef.current !== token) return;
          // No table to read: an impossible state for a done run, and one with
          // nothing true to say about it. See `readStyleValue`.
          if (outcome === null) return;
          // The layer can be removed while the read is in flight, and
          // `requestSection` activates whatever id it is handed
          // (shellStore.ts:173) — which would resurrect it. Abandon silently:
          // the user removed the layer, they are not waiting for news about it.
          const alive = useLayerStore
            .getState()
            .layers.some((l) => l.id === layerId);
          if (!alive) return;

          // §7: a run that went stale or was undone while the read was in
          // flight no longer describes the column this value came from. An
          // Undo leaves the record on `done` and says so only in the note
          // (`runQueue.ts:2104`), so the note is part of the test — without it
          // a draft would be opened over values that have been taken back.
          const current = runById(run.id);
          if (
            current === null ||
            current.stale ||
            current.status !== "done" ||
            current.note === UNDONE_NOTE
          )
            return;

          let value: number | string | boolean;
          if ("literal" in outcome) {
            value = outcome.literal;
          } else {
            if (!outcome.ok) {
              // Verbatim: `runQuery` has already put the error through
              // `formatDuckDBError` (duckdb.ts:396), which IS §6.3's "first
              // error line, as the export dialog shows DuckDB errors".
              useProcessingStore.getState().pushNotice(outcome.message);
              return;
            }
            const read = outcome.rows[0]?.["m"];
            // NULL, or no row at all: the column has no value to style by.
            const usable =
              (typeof read === "number" && Number.isFinite(read)) ||
              typeof read === "string" ||
              typeof read === "boolean";
            if (!usable) {
              useProcessingStore.getState().pushNotice(ALL_VALUES_EMPTY);
              return;
            }
            value = read;
          }

          useRuleDraftStore.getState().setDraft(layerId, {
            editingId: null,
            open: true,
            form: {
              // Named after the column, not left empty as "+ Add rule" starts:
              // the editor will not save an unnamed rule, and a user who came
              // here by pressing one button should not have to invent a name
              // before they can see the result on the map. It is a draft —
              // they rename it in the field it lands in.
              name: column.name,
              // §6.2's "the next palette colour": a second Style-by-result
              // draft on the same layer is invisible against the first if both
              // take `RULE_PALETTE_HEX[0]`. Read from the STORE at this
              // moment, never from a value captured when the card rendered.
              color: nextRuleColor(
                useLayerStore.getState().layers.find((l) => l.id === layerId)
                  ?.rules ?? [],
              ),
              logic: "AND",
              conditions: [
                {
                  field: column.name,
                  operator: resolveStyleOperator(descriptor, column),
                  value,
                },
              ],
            },
            // Which Save this draft gets (M3 ruling C6): a RESULT draft
            // switches the layer to `Color by = Rules` from ANY mode when the
            // user saves it — that is what they asked to see — while a rule
            // typed by hand keeps `ensureRulesMode`'s surface-only flip.
            origin: "style-by-result",
          });
          // §6.2: "The map does NOT change until the user presses Save in the
          // editor, as with any rule." The editor's Save is the ONE writer of
          // `colorBy` for a rule, so nothing here touches it. Setting it
          // eagerly repainted a layer on Surface type to the unmatched colour
          // before the user had seen the draft.
          //
          // Last, so the panel opens on a draft that is already written.
          useShellStore.getState().requestSection(layerId, "style");
        } finally {
          if (tokenRef.current === token) setPending(false);
        }
      })();
    },
    [],
  );

  return { pending, start };
}

interface Props {
  /** The latest run of this tool on this target, or null. */
  readonly run: RunRecord | null;
  readonly canRun: boolean;
  /** Why Run is disabled, or the queue note — rendered under the button. */
  readonly reason: string | null;
  /** §6.2: dismiss the result card and hand the form back, unlocked. */
  readonly onRunAgain: () => void;
}

/** Ticks while the run is in flight; the finished run's own `elapsedMs` after. */
function useElapsed(run: RunRecord | null): number {
  const live =
    run !== null && (run.status === "running" || run.status === "cancelling");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [live, run?.id]);
  if (run === null) return 0;
  return live ? Math.max(0, now - run.startedAt) : run.elapsedMs;
}

export function RunFooter({ run, canRun, reason, onRunAgain }: Props) {
  const elapsed = useElapsed(run);
  // §6.1: the engine died, so every backup table died with it. The button stays
  // where it was, disabled and explaining itself, rather than vanishing — a
  // card that quietly loses its Undo reads as a card that was never undoable.
  const engineStopped = useProcessingStore((s) => s.engineStopped);
  const style = useStyleByResult(run?.id ?? null);
  const status = run?.status ?? null;

  if (run !== null && (status === "running" || status === "cancelling")) {
    return (
      <div className="processing-footer processing-footer--progress">
        <div
          className="processing-progress"
          role="progressbar"
          aria-busy="true"
          aria-label={status === "cancelling" ? "Cancelling" : "Running"}
        />
        {/* The phase is the only thing that CHANGES under a screen reader here;
            the elapsed ticker beside it is deliberately NOT a live region — at
            250 ms it would talk over every other announcement. */}
        <p className="processing-phases" aria-live="polite">
          {phaseLine(run.phase)}
        </p>
        <div className="processing-footer__row">
          <span className="processing-elapsed">{seconds(elapsed)}</span>
          {/* §6.1's button is "Cancel". The label is what tells a screen
              reader WHICH Cancel this is — the idle footer's Cancel leaves the
              tool, this one stops the run — and it is the name every test
              reaches the button by. */}
          <button
            type="button"
            aria-label="Cancel run"
            disabled={status === "cancelling"}
            onClick={() => cancelRun(run.id)}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (run !== null && status === "queued") {
    return (
      <div className="processing-footer processing-footer--progress">
        <p className="processing-phases">{reason ?? "Queued"}</p>
        <div className="processing-footer__row">
          <button
            type="button"
            aria-label="Cancel run"
            onClick={() => cancelRun(run.id)}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (run !== null && status === "done") {
    // §6.2/§7 through ONE descriptor: the tool says which column, which
    // operator and where the value comes from. No `toolId` appears in this
    // component.
    // §6.2: for a New-layer run every action points at the COPY — "Open table
    // (the drawer on the new layer), Style by result (the new layer's STYLE
    // section)" — and not at the target, which the run left untouched.
    const cardLayerId = run.newLayerId ?? run.targetLayerId;
    const created = run.newLayerId !== null;
    // §6.2's block on a derived layer that has since been used. Null for a
    // This-layer run, whose Undo has its own rules.
    const undoBlock = newLayerUndoBlock(run);
    /**
     * Is the layer the actions point at still there, AT CLICK TIME?
     *
     * §6.2's Undo removes the copy and leaves the card standing ("Undone"),
     * with `newLayerId` still on the frozen record — so Zoom to layer and Open
     * table would activate an id that is gone, and nothing would correct it:
     * `setActiveLayerId` does not validate, and the invariant that hands the
     * active layer over watches the LAYER stores, not this write. The same
     * guard `useStyleByResult` already makes for its own awaited gap, and a
     * removed layer is equally the answer to "the user threw it away" — the
     * click is abandoned silently rather than resurrecting a row.
     */
    const cardLayerAlive = (): boolean =>
      useLayerStore.getState().layers.some((l) => l.id === cardLayerId) ||
      useGeoLayerStore.getState().layers.some((l) => l.id === cardLayerId);
    const descriptor = toolById(run.toolId).styleByResult;
    const written = writtenColumns(run);
    const styleColumn = descriptor?.pick(written) ?? null;
    // Why the button is off, as a reason the user can READ — not only a
    // tooltip on a disabled control, which no keyboard or screen-reader user
    // reaches — in the same muted note Run's own reason gets.
    //
    // §6.2: "disabled with 'All values are empty' when the chosen column is
    // NULL for every object in the run". The RUN knows that — `summarise`
    // counted it — and `measured === 0` does not: a run with only Dominant
    // azimuth ticked over flat roofs measures every building and writes NULL
    // to all of them. A STALE run is disabled too, and OUTRANKS empty: its
    // table was rebuilt under it, which is why no median can be trusted at
    // all, so "All values are empty" would be a claim about data this run no
    // longer describes. The card already prints the stale reason above the
    // actions, so that one is not repeated below them.
    const styleReason = run.stale
      ? STALE_LAYER_RELOADED
      : // An UNDONE run is the same case as a stale one and outranks empty for
        // the same reason (gate defect F3): its values have been taken back, so
        // the guards inside `style.start` abandon the click — a live button that
        // opens nothing is worse than a disabled one. The record's own word is
        // the reason, because the card already prints it as the note.
        run.note === UNDONE_NOTE
        ? UNDONE_NOTE
        : styleColumn === null ||
            run.summary === null ||
            (run.summary.nonNullByColumn[styleColumn.name] ?? 0) === 0
          ? ALL_VALUES_EMPTY
          : null;
    return (
      <div className="processing-footer processing-footer--card">
        <div className="processing-card">
          <p className="processing-card__line">
            <span aria-hidden="true">✓ </span>
            <span>{run.summary?.line ?? "Done"}</span>
          </p>
          {run.summary?.detail && (
            <p className="processing-note">{run.summary.detail}</p>
          )}
          {/* §6.2's This-layer card names what it wrote and where. A
              New-layer run wrote nothing to the target: its own "Created …"
              line already names the layer, and repeating a target that did not
              change would be the one sentence on the card that is false. */}
          {!created && (
            <p className="processing-note">
              Wrote {plural(run.columns.length, "column", "columns")} to{" "}
              {run.targetName}.
            </p>
          )}
          {run.note !== null && <p className="processing-note">{run.note}</p>}
          {run.stale && (
            <p className="processing-note">stale: layer reloaded</p>
          )}
          <div className="processing-card__actions">
            {/* §6.2 lists it FIRST for a New-layer run: the copy is somewhere
                on the globe and the user has not seen it yet. */}
            {created && (
              <button
                type="button"
                onClick={() => {
                  if (!cardLayerAlive()) return;
                  activateLayer(cardLayerId);
                  useShellStore.getState().requestZoom(cardLayerId);
                }}
              >
                Zoom to layer
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (!cardLayerAlive()) return;
                // The run's own target is the frozen truth (§6.1); the form's
                // select may have moved on since it finished.
                activateLayer(cardLayerId);
                useShellStore.getState().openDrawer();
                // §6.2: "the new columns appended after the existing ones".
                // Only for a list the user has customised — a default list
                // picks the run's columns up on its own, and re-appending to
                // it would freeze the default.
                const columns = layerQuery(
                  useQueryStore.getState(),
                  cardLayerId,
                ).columns;
                const next = appendColumns(columns, run.columns);
                if (next !== null && next !== columns)
                  useQueryStore.getState().setColumns(cardLayerId, next);
                // §6.2: "…and scrolled into view". Requested unconditionally,
                // including for the DEFAULT column list (which already shows
                // the run's columns without an append) — the scroll is what
                // the user came for either way.
                requestColumnReveal(cardLayerId, run.columns);
              }}
            >
              Open table
            </button>
            {/* §6.2: "absent when the run wrote no styleable column" — which
                is the tool's DESCRIPTOR answering, not this component: a tool
                with no `styleByResult`, or one whose `pick` found nothing among
                the columns the run actually wrote, offers no button. Spelled as
                two narrowing guards rather than a non-null assertion, so the
                closure below carries both facts. */}
            {descriptor !== null && styleColumn !== null && (
              <button
                type="button"
                disabled={styleReason !== null || style.pending}
                title={styleReason ?? undefined}
                onClick={() => style.start(run, styleColumn, descriptor)}
              >
                Style by result
              </button>
            )}
            {run.undoable && (
              <button
                type="button"
                disabled={engineStopped || undoBlock !== null}
                title={
                  engineStopped ? UNDO_ENGINE_STOPPED : (undoBlock ?? undefined)
                }
                onClick={() => void undoRun(run.id)}
              >
                Undo
              </button>
            )}
            <button type="button" onClick={() => openRunLog(run.id)}>
              Log
            </button>
          </div>
          {styleColumn !== null &&
            styleReason !== null &&
            styleReason !== STALE_LAYER_RELOADED &&
            styleReason !== UNDONE_NOTE && (
              <p className="processing-note">{styleReason}</p>
            )}
        </div>
        <div className="processing-footer__row">
          {/* Not a submit: it unlocks the form, it does not re-run. Never
              disabled — a draft that Run would refuse is exactly the draft the
              user has come back to fix. */}
          <button type="button" className="processing-run" onClick={onRunAgain}>
            Run again
          </button>
        </div>
      </div>
    );
  }

  if (run !== null && status === "failed") {
    return (
      <div className="processing-footer processing-footer--card">
        <div className="processing-card processing-card--failed">
          <p className="processing-card__line">
            <span aria-hidden="true">✕ </span>
            <span>Failed after {seconds(run.elapsedMs)}</span>
          </p>
          <p className="processing-error">{run.error}</p>
          <div className="processing-card__actions">
            {/* §6.3: "Retry re-runs with the same parameters" — the run's own
                frozen request, never the form's draft, which the user is free
                to edit (or invalidate) while a failure is on screen. The
                queue keeps that request, ids and all: a Retry rebuilt from
                the card would re-resolve "Selected" against whatever is
                selected NOW. */}
            <button type="button" onClick={() => retryRun(run.id)}>
              Retry
            </button>
            <button type="button" onClick={() => openRunLog(run.id)}>
              Log
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="processing-footer">
      {run !== null && run.note !== null && (
        <p className="processing-note">{run.note}</p>
      )}
      <div className="processing-footer__row">
        <button
          type="button"
          onClick={() => useProcessingStore.getState().back()}
        >
          Cancel
        </button>
        <button type="submit" className="processing-run" disabled={!canRun}>
          Run
        </button>
      </div>
      {reason !== null && <p className="processing-note">{reason}</p>}
    </div>
  );
}
