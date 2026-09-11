/**
 * The executor table, and nothing else.
 *
 * TYPE-only import of `../runQueue`, so this module has no runtime edge back to
 * the queue that imports it: the queue reads `EXECUTORS`, each tool module calls
 * `registerExecutor`, and `./register` is the one place that imports the tool
 * modules for their side effect.
 */
import type { ToolExecutor } from "../runQueue";
import type { ToolId } from "../types";

export const EXECUTORS: Partial<Record<ToolId, ToolExecutor>> = {};

export function registerExecutor(id: ToolId, executor: ToolExecutor): void {
  EXECUTORS[id] = executor;
}
