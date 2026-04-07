/**
 * Capture current viewer state into a ProjectSnapshot.
 *
 * Accepts all state values as parameters — no direct store imports.
 * The caller (app shell) reads from stores and passes values in.
 */

import type { Rule } from "../features/rules/types";
import type { PickMode } from "../domain/selection/types";
import type { CityModelReference, ProjectSnapshot, ViewState } from "./types";

const SNAPSHOT_VERSION = "1";

export interface CaptureInput {
  readonly label: string;
  readonly modelRef: CityModelReference | null;
  readonly cameraPosition: readonly [number, number, number];
  readonly cameraTarget: readonly [number, number, number];
  readonly datetime: Date;
  readonly rules: ReadonlyArray<Rule>;
  readonly rulesEnabled: boolean;
  readonly pickMode: PickMode;
}

export function captureSnapshot(input: CaptureInput): ProjectSnapshot {
  const viewState: ViewState = {
    cameraPosition: input.cameraPosition,
    cameraTarget: input.cameraTarget,
    datetime: input.datetime.toISOString(),
  };

  return {
    version: SNAPSHOT_VERSION,
    savedAt: new Date().toISOString(),
    label: input.label,
    modelRef: input.modelRef,
    viewState,
    rules: [...input.rules],
    rulesEnabled: input.rulesEnabled,
    pickMode: input.pickMode,
  };
}
