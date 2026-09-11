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
import type {
  Eligibility,
  ToolDefinition,
  ToolGroup,
} from "../../features/processing/types";
import { useActiveLayer } from "../../features/workspace/activeLayer";
import { useEligibilityContext } from "./useEligibilityContext";
import { RecentRuns } from "./RecentRuns";
import { openToolView } from "./revealTools";

const GROUP_ORDER: ReadonlyArray<ToolGroup> = ["roof", "3d", "cross-layer"];

const CHIP_LABEL: Readonly<Record<"spatial" | "three_d", string>> = {
  spatial: "Spatial",
  three_d: "3D",
};

const CHIP_TITLE: Readonly<Record<"spatial" | "three_d", string>> = {
  spatial:
    "Loads the spatial extension on first run (about 24 MB, once per session)",
  three_d:
    "Loads the three_d extension on first run (about 1 MB, once per session)",
};

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
}: {
  readonly tool: ToolDefinition;
  readonly eligibility: Eligibility;
}) {
  const reason = eligibility.ok ? null : eligibility.reason;
  return (
    <button
      type="button"
      className="processing-tool-row"
      aria-disabled={reason !== null}
      title={reason ?? undefined}
      onClick={() => openToolView(tool.id)}
    >
      <span className="processing-tool-row__head">
        <span className="processing-tool-row__name">{tool.name}</span>
        {tool.extension !== null && (
          <span className="processing-chip" title={CHIP_TITLE[tool.extension]}>
            {CHIP_LABEL[tool.extension]}
          </span>
        )}
      </span>
      <span className="processing-tool-row__desc">{tool.description}</span>
      {reason !== null && (
        <span className="processing-tool-row__reason">{reason}</span>
      )}
    </button>
  );
}
