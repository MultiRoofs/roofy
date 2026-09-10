import { useProcessingStore } from "../../features/processing/processingStore";
import { toolById } from "../../features/processing/toolRegistry";
import type { ToolId } from "../../features/processing/types";

/**
 * Spec §6's parameter form. A placeholder until the form lands: it names the
 * tool and offers the way back, which is what the catalogue's rows and the
 * Escape order need from it today.
 */
export function ToolView({ toolId }: { readonly toolId: ToolId }) {
  const tool = toolById(toolId);
  return (
    <section className="processing-group">
      <button
        type="button"
        className="processing-back"
        onClick={() => useProcessingStore.getState().back()}
      >
        ← All tools
      </button>
      <h3 className="processing-tool-row__name">{tool.name}</h3>
      <p className="processing-empty">{tool.longDescription}</p>
    </section>
  );
}
