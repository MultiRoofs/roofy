# Navara migration — final whole-branch review (C26+)

Date: 2026-08-03
Reviewer: final whole-branch pass (cross-task coherence, spec completeness, dead seams, deferred triage)
Scope: develop 3e81083..8cbbbd0 (77 commits, app) + packages/cityjson-navara-plugins c5f5fc6..6404fd1 (46 commits, entire submodule history)

## Verdict: APPROVE

No must-fix-before-merge findings. Every spec §2 decision, §3 package/API item, §4
architecture element and §7 milestone is implemented or explicitly recorded as
dropped per §9. The shared contracts are one shape everywhere. Both verification
bars re-ran green on this machine at 8cbbbd0. The deferred inventory triages to
0 must-fix / 14 should-fix-soon / 22 fine-as-is.

---

## 1. Green bar (re-run 2026-08-03 at 8cbbbd0, this review)

| Check                       | Result                                                           |
| --------------------------- | ---------------------------------------------------------------- |
| App `npx tsc -b --noEmit`   | exit 0                                                           |
| App `npx vitest run`        | 53 files / 622 tests, all pass (expected 53/622 ✓)               |
| App `npm run build`         | succeeds (warns: 9.8 MB main chunk — see §5)                     |
| App `npx vp check`          | 0 errors, 9 warnings                                             |
| Submodule `pnpm typecheck`  | clean                                                            |
| Submodule `pnpm vitest run` | 42 files / 572 tests, all pass (expected 42/572 ✓)               |
| Submodule `pnpm build`      | succeeds (index + /plugin entries, engine externalised)          |
| Submodule pointer           | 6404fd1 = origin/main (pushed), work tree clean, gitlink in sync |

## 2. Spec sweep (docs/superpowers/specs/2026-08-01-navara-migration-design.md)

Every item verified against the ledger; the load-bearing ones re-verified in code:

- **§2.1 big-bang replace** — R3F stack deleted (1a04702, e57a42e); `NavaraViewport`
  behind the same `CitySceneHandle` (verified: `src/scene/NavaraViewport.tsx:124-134`
  — fitAll/fitLayer/alignView/get/setCameraState + `ready` + `getStreamingPlugin`).
- **§2.2 parity scope** — FCB streaming + LoD ladder survive (C14 browser smoke: cells,
  level swaps, picks on streamed features); Google tiles native `3d-tiles` layer
  (3e563fe, `src/scene/googleTiles.ts`). Measure/box-select dropped per §9, disabled
  with visible disabled state (5518189).
- **§2.3 approach A custom MeshDesc** — `CityMeshArraysDesc`/`CityModelMeshDesc` +
  `addCityMeshArrays` single implementation in navara-cityjson, consumed by streaming
  via injected factory (`navara-flatcitybuf/src/cellMeshFactory.ts:54`). Vertex-colour
  MRT confirmed by the B1 spike (`MRT_VERTEX_COLORS_OK=true`, standard material, no
  shader override needed).
- **§2.4 self-contained plugins** — parsers, geometry, rules+metrics (per the
  2026-08-02 amendment), streaming engine, picking, styling hooks all in the
  monorepo; app keeps stores/UI/analytics/persistence. Verified core exports
  `evaluateRule`/`matchRule`/`computeRoofMetrics`/`SurfaceStyleEvaluator`.
- **§2.5 monorepo layout** — 4 packages incl. cityparquet scaffold-only, submodule at
  `packages/cityjson-navara-plugins`, `file:` deps + Vite alias + tsconfig paths.
- **§3 API sketch** — `CityModelHandle` (`navara-cityjson/src/types.ts:45`) carries the
  spec's eight members verbatim plus three additive ones (`heightOffset()`,
  `batchIdMap()`, `resolveRaycast()`), each with a documented reason. The streaming
  handle implements the identical shape (submodule 2679170 "interaction parity —
  resolveRaycast and heightOffset"). B1–B5 race behaviors are present as named tests
  (B1 resync/ladder, B2 stale-rule flag, B3 swap-timeout evict/rollback, B4 budget
  moved with commit planner, B5 backfill).
- **§4.2 camera/persistence breaking** — snapshot v3 `{lng,lat,height,heading,pitch,roll}`,
  `SNAPSHOT_VERSION="3"`, v1/v2 rejected via `UnsupportedSnapshotVersionError`
  (`restoreSnapshot.ts:17`); share hash carries `v:3` + `cam`, with explicit
  older/newer-version messages (`urlShare.ts:118-119` — the C18 carry-forward about
  silent pre-v3 links WAS closed, ledger's last word understates this).
- **§4.3 coordinates** — exact per-vertex ENU projection, per-layer/per-cell frames,
  `-π/2`/sceneTransform retired, CRS gate + single metric-units gate
  (`navara-core/src/citymodel/crsProjDefs.ts:79 assertMetricCrs`, consumed by BOTH
  static `enuPlacement.ts:89` and streaming admission — the B6 carry-forward landed).
- **§4.4 solar** — engine-native sun; suncalc gone from package.json; sun readout from
  render loop (b033f90); dead proj4 solar path pruned (C22).
- **§4.5 deps** — verified package.json: `three@0.183.2`, `postprocessing@6.39.0`,
  `@types/three@0.183.1`, `@navaramap/* 0.0.5` all exact; all removed deps absent;
  `@types/proj4` gone. (Residual: app `proj4: ^2.20.8` caret — see triage S14.)
- **§6 testing** — tests moved with code; app persistence/sync tests rewritten
  (appEngineBoot, appRestoreShare); layerSceneMap retired; browser smokes at each
  milestone with committed screenshot evidence.
- **§7 milestones M7.1–M7.7** — all complete per ledger, roadmap Milestone 8 current
  and honest (it plainly states the final review was outstanding).

## 3. Cross-task coherence (the shared contracts)

All one shape; the drift the per-task gates flagged was closed:

- **CityModelHandle** — single definition, static and streaming implement it; the
  pick router treats both structurally.
- **SurfaceStyleEvaluator** — defined once in core (`styling/ruleColors.ts`), compiled
  app-side by `compileRuleEvaluator` (has its direct unit test —
  `tests/unit/scene/compileRuleEvaluator.test.ts` — the A12 deferral was closed).
- **addCityMeshArrays** — one implementation (navara-cityjson), streaming consumes it
  through the engine-free `cellMeshFactory` seam; both colour branches copy
  (C8/C10a aliasing hazard closed and asserted in Node).
- **Pick routing** — `resolveNearestHit` (`pickEventHandlers.ts:82`) takes globally
  nearest across handles by `RaycastHit.distance` with NaN-safe comparison — the
  B12 IMPORTANT first-layer-wins carry-forward is fixed, and `resolveFirstHit` no
  longer exists. Identity rides `object3d.userData.layerId` (`handleSync.ts:383`),
  not `PickedFeature.properties`, per the B7 ruling.
- **ENU frame + heightOffset pairing** — the C5/C8 CRITICAL invariant has its
  cross-seam test (`cellMeshes.test.ts:135` "builds the identical frame the worker
  bakes its vertices in", plus the 5 mm ECEF round-trip), mutation-verified per
  ledger. Cursor readout subtracts the layer's `heightOffset()` (B13 closed).
- **B16 multi-surface highlight collapse** — fixed in submodule cbda0b8 ("paint every
  selected surface of the same object, not just the last");
  `surfaceColorLayers.ts:136` keys a `Map<objectIdx, Set<surfaceIdx>>`.
- **Engine-binding isolation** — `@navaramap/*` imports confined to the named
  `/plugin`-subpath binding modules; main barrels Node-importable (load-bearing
  since `NODE_IMPORT_SAFE=false`).
- **Docs coherence** — CLAUDE.md, roadmap Milestone 8, and the spike findings tell
  the same story with the same numbers; the C25 stale-roadmap-header/next-step
  carry-forwards were fixed. One straggler: `agents.md` (see triage S8).

## 4. Dead seams

Prune post-merge (nothing blocks):

1. **`resolvePickedFeature`** (`src/scene/handleSync.ts:377`) — zero runtime callers;
   referenced only by a NavaraViewport comment saying it "stands ready". Delete, or
   wire it where the comment imagines it.
2. **`StreamState.ladderVersion`** (`streamStore.ts:65`) — bumped on ladder change,
   read by no src module (LodSelector subscribes to `ladder` itself); only tests
   assert it. Delete the field.

Keep, deliberately (documented reserved API — do not prune without revisiting the
pick-strategy ruling):

3. **`batchIdMap()`** on the handle + **`PickStrategy: "pickable-wrapper"`** branch —
   inert under `own-raycast` (a wrapper pick resolves null with one warning), kept
   as the documented fallback for a future engine with per-triangle batch ids.
   ~40 lines of dead branch; acceptable as long as `pickStrategy.ts`'s comment
   stays true.
4. The two kept re-export shims (`domain/citymodel/types.ts`, `features/rules/types.ts`)
   — adjudicated app vocabulary in C22, doc comments updated. Agreed.

## 5. Staff-engineer notes (non-blocking)

- **Bundle**: main JS chunk is 9.8 MB (3.1 MB gzip) with no code splitting, plus the
  39 MB DuckDB wasm. Post-merge perf ticket: dynamic-import DuckDB/analytics, split
  the engine.
- **Alpha engine pin**: several behaviors are verified against vendored 0.0.5 source
  (sky-detector's synchronous same-event dispatch, `@navaramap/font`'s second three
  copy, singleton worker pool). CLAUDE.md documents each; any Navara upgrade must
  re-verify that list — worth a checklist item in the upgrade note. File the four
  upstream-reportable bugs (ledger B11a/B15, CLAUDE.md Known Issues a–d) while fresh.
- **Submodule consumption** is source-aliased in dev; clean-clone CI was made green
  (8c0e234 workspace-root deps). The pre-commit hook does not reach the submodule
  (triage S9).
- The C26 restore-camera race fix (9c8c65b, `autoFitSuppression.ts`) is module-level
  state by necessity (restore predates the viewport) — well-reasoned, counter-based,
  release-idempotent; its nesting semantics are untested (triage F6).

## 6. Deferred/parked triage — the full inventory

Counts: **MUST-FIX-BEFORE-MERGE: 0 · SHOULD-FIX-SOON: 14 · FINE-AS-IS: 22**

### MUST-FIX-BEFORE-MERGE (breaks a user flow or licence/correctness obligation)

None. Specifically checked: geoid attribution renders unconditionally from
`GEOID_ATTRIBUTION` (`AttributionOverlay.tsx:75` — licence obligation met); Google
credit conditional on the tiles layer (registration-tracked, the safer failure mode);
C26 smoke closed the restore-camera race; every user flow in the exit criteria is
browser-proven.

### SHOULD-FIX-SOON (post-merge tickets, in priority order)

- **S1. File-backed layer re-selection loses the restored camera** (C20 residual,
  documented-deliberate). Verified: `handleResolveUnavailableLayer` (`App.tsx:941`)
  calls `addLayerFromFile` with neither `suppressAutoFit()` nor a camera re-apply, so
  the layer-add auto-fit overwrites the restored viewpoint. Every file-backed
  workspace restore hits this. Fix is small: stash the restored camera with the
  `UnavailableLayer` entry and re-apply (or suppress the fit) on resolve.
- **S2. No camera validity clamp** — `captureSnapshot` accepts any camera
  (height −1715 m observed saveable in C26); restore then applies it. Add range
  validation/clamping at capture or restore.
- **S3. Unbounded first-commit streaming fetch** — a dead/stalling `.fcb` leaves the
  layer loading forever (open/geoid/boot are all bounded; the first commit is not).
  Add a generous bound analogous to `GEOID_TIMEOUT_MS`.
- **S4. `geoidHeight.ts` bare `fetchImpl` calls lack `AbortSignal.timeout`** (C11
  follow-up) — the plugin-side race stops _waiting_ but does not _cancel_.
- **S5. Advanced Settings render/debug toggles unwired** — `renderDebugStore` +
  `atmosphereStore` have no reader outside the panel (verified via C25). Wire to the
  engine or delete; a settings panel that silently does nothing erodes trust.
- **S6. `LEVEL_SWAP_TIMEOUT_MS=1500`** needs a real-GPU measurement for genuine level
  swaps (first-commit exemption already landed in 97afdbd).
- **S7. Hover raycast: no BVH, no throttle**, nearest-hit across all handles per
  mousemove. Fine today; profile with several large layers, then BVH or throttle.
- **S8. `agents.md` is severely stale** — still describes the pre-migration app
  (suncalc, M1–4, no Navara), now contradicting CLAUDE.md. Rewrite or delete.
- **S9. Submodule has no lint script/hook** — the app's `vp check --fix` hook does not
  reach it (documented in CLAUDE.md). Add a lint script + CI step; also the CI
  workflow wants `permissions: contents: read` + a concurrency group (A5).
- **S10. Prune the two dead seams** (§4: `resolvePickedFeature`, `ladderVersion`).
- **S11. File the four upstream Navara bug reports** (duplicate three via
  `@navaramap/font`, no pointer events over sky, singleton tile-worker pool,
  `registerMesh`-before-init throw).
- **S12. Streaming layers don't survive an engine restart** (zombie store rows if a
  future path unmounts the viewport with layers present) — guard when/if a second
  mount path appears.
- **S13. Terrain cursor readout uses `layers[0]`'s CRS** — wrong readout numbers with
  mixed-CRS layers.
- **S14. Pin app `proj4` exactly** (`^2.20.8` caret vs submodule's pinned 2.20.8) —
  it is a singleton-registry library in `resolve.dedupe`; the caret invites drift.

### FINE-AS-IS (documented limitations; no ticket needed)

- **F1.** Measure/box-select disabled, not implemented — spec §9 non-goal; toolbar
  shows the disabled state; documented in CLAUDE.md + roadmap.
- **F2.** Normals not recomputed after ENU projection (slight shading distortion,
  static + streaming alike) — documented in CLAUDE.md Known Issues.
- **F3.** Geoid vertical placement is EGM2008-accurate not NAP-exact, from a
  best-effort no-SLA service, falling back to 0 with one warn — documented; failure
  mode is "visibly sunk", not missing.
- **F4.** Pre-v3 snapshots/share links rejected — verified both paths now carry an
  explanatory message; breaking per project philosophy.
- **F5.** `.layer-vis-btn` class shared by LayerPanel + GoogleTilesPanel — a test-
  automation ambiguity only (C26 re-verified real behavior). Add `data-testid`s
  opportunistically.
- **F6.** `autoFitSuppression` nested-scope counter untested — 8-line pure module
  with idempotent release; add a unit test when next in the file.
- **F7.** First auto-fit frames the pre-geoid position; the layer re-places when the
  sample lands but the camera does not re-fit (B11b) — a one-time visual blip.
- **F8.** Sky-hover clearing depends on the engine's synchronous same-event dispatch
  (verified against vendored 0.0.5; exact pin mitigates; a future rAF-batching
  engine breaks it loudly at upgrade-verification time per §5).
- **F9.** No committed multi-LoD fixture (B16 LoD smoke used a scratchpad file).
- **F10.** `fixtures/two-buildings.city.jsonl` duplicated app + submodule with no
  drift guard (A9).
- **F11.** Worker `open` #2 drops the previous reader without close (pre-existing
  convention, two-phase open costs one extra header read).
- **F12.** Concurrent same-id `openStream` both pass the duplicate check (same shape
  as the static path).
- **F13.** Failed recolor unrecoverable under no-op rule-set drop (old-app parity);
  rules-epoch FIFO gap theoretical.
- **F14.** Store `version` vs handle `version` can drift after re-register — nothing
  compares them.
- **F15.** Settle controller: a bare `moveend` with no preceding `movestart`
  (attach mid-gesture) arms without `onFirstChange` — brief-faithful.
- **F16.** Sky/all-miss viewport footprint yields a small under-camera fetch
  (old-app parity, cover bounded 9..64; revisit hook documented in
  `viewportFootprint.ts`).
- **F17.** Dead `overrides` block in app package.json (vite/vitest now real pinned
  deps) — harmless redundancy; drop when next touching the file.
- **F18.** `npm install --dry-run` not idempotent (apache-arrow churn).
- **F19.** FCB worker chunk bundles three (~dead weight via core's ShapeUtils import).
- **F20.** Google tiles credit tracks layer registration, not pixel rendering —
  disclosed; the safer direction for a licence.
- **F21.** `readyGate` outlives a failing re-init (dev-only path); test isolation
  leans on microtask flush.
- **F22.** Trivia bundle: `onTriangleCount(0)` on teardown; cellMeshes test retitle
  (C8); LodSelector doc-comment drift; per-vertex-cost comments — sweep whenever
  next in those files.

### Deferred items verified CLOSED during this review (ledger's last word lags)

- Pre-v3 share links now get an explanatory message (S-was: C18 carry-forward) —
  `urlShare.ts:118-119`.
- `compileRuleEvaluator` direct unit test exists (A12 deferral).
- B12 first-layer-wins → nearest-across-handles (`resolveNearestHit`).
- B16 multi-surface highlight collapse (submodule cbda0b8).
- B13 cursor readout geoid subtraction (`heightOffset()` published + used).
- `@types/proj4` removed app-side; `postprocessing`/`@types/three` pinned (C23).
- Roadmap header/next-step staleness; lowercase `claude.md`; `src/shared/` empty
  dir (all gone at 8cbbbd0).

---

## Summary

A 77-commit engine migration that lands exactly what its spec says, with the
process discipline to prove it: per-task review gates, mutation-verified invariant
tests across the app/worker seam, browser smokes with committed evidence, and a
ledger honest enough that this final pass found its "open" items mostly _over_-
reported (seven were already closed). Both repos' full verification bars re-ran
green during this review. Nothing blocks the merge; the fourteen should-fix items
above are ordinary post-merge tickets, led by the file-backed-restore camera loss
(S1) and the missing camera validity clamp (S2).
