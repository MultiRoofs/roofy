/**
 * Stage ONE tool's `destinations` for the length of one case, and put it back.
 *
 * Every shipped tool now offers both destinations (Task 23 flipped the last
 * one, `aggregate-per-area`), so the rules about a tool that does NOT offer
 * "New layer" — the form's disabled radio and the queue head's refusal — have
 * no real entry to ask any more. They are still production rules the next tool
 * will meet, so the tests stage a definition instead of losing the coverage,
 * the way `useToolForm.test.tsx` and `lodSelect.test.tsx` stage an unimplemented
 * one.
 *
 * SHARED rather than copied into each suite: the trick it hides is not obvious
 * — `vi.spyOn(tool, "destinations", "get")` cannot be used, because
 * `destinations` is a data property on an object literal and not an accessor —
 * and two copies of it are two places to get the restore wrong.
 *
 * Not a `*.test.ts` file, so Vitest's `include` never collects it.
 */
import { TOOLS } from "../../../../src/features/processing/toolRegistry";
import type { ToolDestination } from "../../../../src/features/processing/types";

/** ASYNC, and the `await` is not optional: the queue's head guard is checked
 *  inside `execute`, which runs after `submitRun` returns — a synchronous body
 *  would put the definition back before the run ever read it. */
export async function withDestinations(
  toolId: string,
  destinations: ReadonlyArray<ToolDestination>,
  body: () => Promise<void> | void,
): Promise<void> {
  const tool = TOOLS.find((t) => t.id === toolId);
  if (!tool) throw new Error(`no tool ${toolId}`);
  const before = tool.destinations;
  const set = (value: ReadonlyArray<ToolDestination>) =>
    Object.defineProperty(tool, "destinations", {
      value,
      configurable: true,
      writable: true,
    });
  set(destinations);
  try {
    await body();
  } finally {
    set(before);
  }
}
