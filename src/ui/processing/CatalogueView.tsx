/**
 * Spec §5: the searchable catalogue. Group headings hide when nothing in them
 * matches, a row that cannot run on the ACTIVE layer carries its reason as a
 * second line and a tooltip — and still opens the tool view, so the user can
 * read the parameters and switch the target layer there.
 */
import { useMemo } from "react";
import { useProcessingStore } from "../../features/processing/processingStore";
import {
  GROUP_LABELS,
  TOOLS,
  filterTools,
} from "../../features/processing/toolRegistry";
import { toolEligibility } from "../../features/processing/eligibility";
import type { EligibilityContext } from "../../features/processing/eligibility";
import type {
  Eligibility,
  ToolDefinition,
  ToolExtension,
  ToolGroup,
} from "../../features/processing/types";
import { ensureExtension } from "../../insights/duckdb";
import { useActiveLayer } from "../../features/workspace/activeLayer";
import { useEligibilityContext } from "./useEligibilityContext";
import { RecentRuns } from "./RecentRuns";
import { openToolView } from "./revealTools";

const GROUP_ORDER: ReadonlyArray<ToolGroup> = ["roof", "3d", "cross-layer"];

/** One extension's load state, as `useEligibilityContext` reports it. */
type ExtensionState = EligibilityContext["extensionState"][ToolExtension];

const CHIP_LABEL: Readonly<Record<ToolExtension, string>> = {
  spatial: "Spatial",
  three_d: "3D",
};

const CHIP_COST: Readonly<Record<ToolExtension, string>> = {
  spatial:
    "Loads the spatial extension on first run (about 24 MB, once per session)",
  three_d:
    "Loads the three_d extension on first run (about 1 MB, once per session)",
};

/**
 * Spec §5: "The chip's tooltip says whether the extension is loaded, and if
 * not, what loading costs." The failed tooltip is the same sentence the
 * disabled rows carry (`eligibility.ts`), so the chip and the reason cannot
 * disagree.
 */
function chipTitle(name: ToolExtension, state: ExtensionState): string {
  if (state === "loaded") return `The ${name} extension is loaded`;
  if (state === "loading") return `Loading the ${name} extension…`;
  if (state === "failed") {
    return `The ${name} extension could not be downloaded; check the connection and retry`;
  }
  return CHIP_COST[name];
}

export function CatalogueView() {
  const search = useProcessingStore((s) => s.search);
  const active = useActiveLayer();
  const ctx = useEligibilityContext(active);
  const visible = useMemo(() => filterTools(TOOLS, search), [search]);

  return (
    <>
      <input
        type="search"
        className="processing-search"
        aria-label="Search tools"
        placeholder="Search tools…"
        value={search}
        onChange={(e) =>
          useProcessingStore.getState().setSearch(e.target.value)
        }
      />
      {visible.length === 0 ? (
        <p className="processing-empty">
          No tool matches &apos;{search.trim()}&apos;. Footprint operations
          arrive in a later release.
        </p>
      ) : (
        GROUP_ORDER.map((group) => {
          const tools = visible.filter((t) => t.group === group);
          if (tools.length === 0) return null;
          return (
            <section key={group} className="processing-group">
              <h3 className="processing-group__label">{GROUP_LABELS[group]}</h3>
              {tools.map((tool) => (
                <ToolRow
                  key={tool.id}
                  tool={tool}
                  eligibility={toolEligibility(tool, ctx)}
                  extensionState={ctx.extensionState}
                />
              ))}
            </section>
          );
        })
      )}
      <RecentRuns />
    </>
  );
}

function ToolRow({
  tool,
  eligibility,
  extensionState,
}: {
  readonly tool: ToolDefinition;
  readonly eligibility: Eligibility;
  readonly extensionState: EligibilityContext["extensionState"];
}) {
  const reason = eligibility.ok ? null : eligibility.reason;
  const ext = tool.extension;
  // Gated on the EXTENSION's state, not on the row's reason: in M2 every
  // extension tool is still `implemented: false`, so "Not available yet"
  // outranks the download reason and it never reaches a row. §5's Retry still
  // belongs beside those rows — the chip's tooltip is where the user reads
  // why. It is also the one reason Retry can act on: a row disabled for a
  // missing layer or a failed table is not a download away from working.
  const canRetry = ext !== null && extensionState[ext] === "failed";
  return (
    // A wrapper, because the Retry link is a BUTTON and the row is a button:
    // nesting them is invalid HTML and browsers un-nest it unpredictably.
    <div className="processing-tool-row-wrap">
      <button
        type="button"
        className="processing-tool-row"
        aria-disabled={reason !== null}
        title={reason ?? undefined}
        onClick={() => openToolView(tool.id)}
      >
        <span className="processing-tool-row__head">
          <span className="processing-tool-row__name">{tool.name}</span>
          {ext !== null && (
            <span
              className="processing-chip"
              data-state={extensionState[ext]}
              title={chipTitle(ext, extensionState[ext])}
            >
              {CHIP_LABEL[ext]}
            </span>
          )}
        </span>
        <span className="processing-tool-row__desc">{tool.description}</span>
        {reason !== null && (
          <span className="processing-tool-row__reason">{reason}</span>
        )}
      </button>
      {canRetry && (
        <button
          type="button"
          className="processing-retry"
          // `ensureExtension`, NOT `retryEngine`: the engine is up, one
          // extension is not. Rebooting DuckDB would rebuild every layer table
          // to fix a download. The result is not awaited — the status publishes
          // `loading` and then `loaded`/`failed`, and the chip follows.
          onClick={() => {
            void ensureExtension(ext);
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}
