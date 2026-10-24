# Roofy UI redesign — continuation brief (written 2026-09-07)

You are taking over Milestone 12 (the UI redesign) mid-flight. Slices 12.1 and
12.2 are merged and pushed; slice 12.3 is four tasks in. This document is the
handover: what is done, where everything lives, how the work is run, and what
to do next.

---

## 1. The goal

Rebuild Roofy's interface around four homes and two singletons, per the
approved design record:

- **Workspace** in the header, **Scene** on the map, **Layer** in the left
  panel plus the bottom drawer, **Selection** in the right panel.
- ONE active layer across city, streaming and geospatial layers; ONE
  selection. A layer click never moves the camera.

The binding authority is the design spec. The plan argues from it; where they
disagree, the spec wins unless a recorded ruling says otherwise.

| What                                             | Where                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| Design spec (binding)                            | `docs/superpowers/specs/2026-09-06-ui-redesign-design.md`           |
| Implementation plan                              | `docs/superpowers/plans/2026-09-06-ui-redesign.md`                  |
| Architecture map (pre-12.1, line refs are STALE) | `docs/superpowers/specs/2026-09-06-ui-redesign-architecture-map.md` |
| Milestone 12 in the roadmap                      | `docs/roadmap.md`                                                   |
| Decision records                                 | `docs/architecture-notes.md`                                        |
| Original user brief                              | `docs/ui-redesign-handoff.md`                                       |

## 2. Where the work is

- **Worktree:** `/data2/hideba/multiroof-viewer-redesign`, branch `redesign`.
  Run everything from here; do not `cd` to the main checkout.
- **Ledger (READ FIRST):**
  `.superpowers/sdd/2026-09-06-ui-redesign/progress.md` — git-ignored, and the
  only record of every ruling, probe outcome, deferral and task completion.
  After a context compaction, trust it and `git log` over recollection.
- Beside it: `task-N-brief.md` (extracted requirements),
  `task-N-report.md` (implementer reports), `review-BASE..HEAD.diff` (review
  packages), `slice-12.3-rulings.md` (the slice's binding rulings, extracted
  for implementers to read).
- **Helper scripts** (superpowers plugin):
  `/home/hbbaba/.claude/plugins/cache/claude-plugins-official/superpowers/6.3.0/skills/subagent-driven-development/scripts/`
  — `task-brief PLAN N` writes `task-N-brief.md`; `review-package PLAN BASE HEAD`
  writes the diff file a reviewer reads.
- **Browser harness:** `/tmp/roofy-ui-prototype.rExpRq/smoke-12.2/` —
  `lib.mjs` (headless Chromium over raw CDP), `gate.mjs` (the 12.2 slice
  gate, a good template), `static-server.mjs` (CORS fixture server on 5390
  serving `static/parcels.geojson`), plus per-task probe scripts and their
  screenshots. The dev server runs on 5199 (`npm run dev -- --port 5199`).

## 3. How the work is run

Subagent-driven development, one task at a time:

1. `task-brief` the task, record BASE (`git rev-parse HEAD`), ledger the
   dispatch.
2. Dispatch ONE implementer subagent with: the brief path, the slice-rulings
   path, the interfaces and decisions the brief cannot know (find code by
   content — line references in briefs predate the current code), the project
   rules, and the report path. Never paste accumulated history.
3. On its report: `review-package PLAN BASE HEAD`, then dispatch a reviewer
   subagent with the brief, the report and the diff file.
4. Rule on every finding yourself. Fix rounds resume the same implementer via
   a message; scoped re-reviews for anything non-trivial. Record every ruling
   in the ledger as `Ruling: <what> — <why> — <cost if wrong>`.
5. Model tiers: sonnet for transcription-shaped work, opus for anything
   touching `App.tsx`, the viewport, the engine sync modules or multiple
   stores. Always name the model explicitly.

Do not stop to ask the user between tasks. Stop only for a destructive or
irreversible action, or a plan so broken every path forward is a guess.

## 4. Project rules that bite (full set in `CLAUDE.md`)

- **The working tree carries another session's files**: `index.html` is
  modified and `.impeccable/`, `DESIGN.md`, `PRODUCT.md` are untracked. Never
  stage, format or touch them. `npx vp check` flags
  `.impeccable/hook.cache.json`; ignore that one hit.
- **Never bypass the git hooks.** The pre-push hook lints the whole working
  tree, so the other session's files block a normal push. Push from a clean
  temporary worktree of the same commit on the same filesystem:
  `git worktree add --detach /data2/hideba/roofy-push-wt <sha>`, `cp -al` the
  `node_modules`, the submodule directory (delete its copied `.git` file) and
  `.vite-hooks/_` into it, `git push origin HEAD:develop > log 2>&1` (never
  pipe the output — vite-plus crashes), then remove the worktree. Confirm the
  hook ran by its `pass:` and `Test Files` lines.
- **Never `git stash`** — the stack is shared with other worktrees and
  sessions.
- TDD, red-green-refactor. Tests import from `"vitest"`.
- Commit prefixes `feat:`/`fix:`/`docs:`/`refactor:`/`test:`/`chore:`, each
  ending with a `Co-Authored-By:` line.
- The plugin submodule (`packages/cityjson-navara-plugins`) is untouched in
  12.3 by ruling R1; if a later slice needs it, commit and push the submodule
  FIRST, then the pointer bump.
- Engine rules that have cost time before: `@navaramap/*` imports only in the
  named engine modules; at most one Navara viewport per page and the map
  slot's element identity must survive layout changes; `AttributionOverlay`
  renders unconditionally (licence); never write `view.globe.color` or
  `view.globe.wireframe`; keep the terrain layer.

## 5. State on 2026-09-07

**Pushed to `origin/develop` at `a0a4616`:** slices 12.1 (one active layer,
one selection, persistence v4) and 12.2 (the shell grid, workspace header and
theme preference, the unified layer list, the active layer's Style/Filter/
Details, the Add layer dialog with format detection, geo-only workspaces,
deletion of the old toolbar/sidebar/layer panel).

**On `redesign`, not yet pushed** (12 commits, `2684953..8bc7c42`): the 12.3
plan and its review fold, plus tasks 25–28:

| Task | What landed                                                                                                                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T25  | 12.2 loose ends: geo re-link on unavailable placeholders, a rail dot for failed adds, shell re-clamp on window resize, the in-flight geo-fit test                                                                                                       |
| T26  | `src/features/rules/colorBy.ts` (`effectiveRules`, `effectiveRulesEnabled`, `firstMatchingRule`, synthetic catch-all rules), `Layer.colorBy/singleColor/unmatchedColor`, cityColors constants, persistence round-trip — plus the two feasibility probes |
| T27  | `src/features/rules/ruleDraftStore.ts` — unsaved rule editors survive switching layers                                                                                                                                                                  |
| T28  | The city `StyleSection`: Color by (surface / rules / single), preset chips, rule rows with Move up/down, the editable unmatched colour, the On/Off toggle removed                                                                                       |

**Probe outcomes (live browser, recorded in the ledger):**

- Zero-condition synthetic rules work through the FlatCityBuf streaming path:
  resident roofs recolour AND cells streamed afterwards carry the colour. This
  is what lets 12.3 avoid a submodule change (ruling R1).
- The engine's geo feature evaluator DOES carry `info.properties` with
  distinct per-feature values for point, polyline and polygon feature sets, so
  `Color by attribute` (Task 29) is feasible. **`batchId` is re-minted on every
  feature-set recreation — never cache batch ids across one.**

## 6. What to do next

**Slice 12.3, tasks 29–35**, detailed in the plan with binding rulings R1–R10
(read `slice-12.3-rulings.md`):

- **T29** geo StyleSection: fill/opacity plus `Color by attribute` with a
  typed categorical palette, painted through ONE `applyFeatureColors` that
  also serves the pick highlight (highlight wins). Probe said feasible.
- **T30** rebuild `LegendOverlay` from a pure `legendModel.ts`, grouped per
  layer, heading opens that layer's Style; presentation size when both panels
  are collapsed. It still filters on the vestigial `rulesEnabled` — fix that
  here and delete the field.
- **T31/T32** build `src/ui/details/DetailsPanel.tsx` beside the still-mounted
  inspector: identity trail, Summary, Attributes, then Rule match, Parts,
  Geometry, multi-selection and the geo feature view.
- **T33** swap App's right slot to `DetailsPanel`; **T34** delete
  `InspectorPanel` and `AnalysisTab` (keep `StatsTab` unmounted for 12.4);
  **T35** the slice gate: checks, browser smoke, docs, push.

**Then** detail and execute 12.4 (linked data and filtering), 12.5 (scene
controls) and 12.6 (verification against the nine acceptance scenarios), each
written against the code as it then exists and reviewed before execution
(`codex exec --skip-git-repo-check -m gpt-6-astra`, fallback
`claude -p --model opus`).

### The user's queued task — do it in slice 12.5

Add a **Shadow quality** control to the scene settings UI (the roadmap's
PENDING ADD-ON under 12.5). The knob already exists — do not add another:

- `renderDebugStore.shadowQuality` is `"low" | "medium" | "high"`, default
  `"medium"`, setter `setShadowQuality` (`src/features/debug/renderDebugStore.ts`).
- Each level is a row of `src/scene/shadowQuality.ts` (shadow map
  1024/2048/4096 per cascade, bias scaled to the texel). `NavaraViewport`
  already writes the row live on change; nothing engine-side is needed.

Build: a select labelled "Shadow quality" with Low / Medium / High beside the
existing sun-shadows switch, disabled while sun shadows are off; a one-line
cost hint per level (High is 64 MB of GPU memory per cascade, four cascades;
Low is fastest with coarser shadows); persist the chosen level across reloads
the way the redesign persists other preferences; TDD first — the select shows
the store's level, changing it calls `setShadowQuality`, it is disabled when
shadows are off, and the persisted value is restored on load.

## 7. Carry-overs and known gaps

Recorded in the ledger; fold each into the task that owns it:

- The geo re-link control belongs in the active layer panel (12.3), not only
  on the list placeholder.
- A failed add while the left panel is collapsed shows only as a rail dot.
- `Layer.rulesEnabled` is vestigial and derived; delete it in T30 once the
  legend stops reading it. Two test fixtures build impossible states
  (`rulesEnabled` disagreeing with `colorBy`) — fix them where they are
  rewritten.
- The rule row renders the raw metric field name (`inclinationDeg`) while the
  rule form offers `roof.inclination`. Pick one vocabulary.
- `App.tsx`'s share-restore loop dereferences a non-object layer entry from a
  hand-edited hash (pre-existing; one-line guard).
- Deferred by ruling and recorded in the spec: the rule drag handle (12.6
  polish, Move up/down ships now), legend row counts and GEOMETRY's "Raw
  object" button (both 12.4), the raster colormap, and vector stroke colour if
  the engine cannot draw polygon outlines.
- The current `redesign` HEAD is mid-slice: adding a rule while `Color by` is
  "Surface type" paints nothing until the mode flips. Do not push to
  `develop` until slice 12.3's gate passes.

## 8. Reviews

Plans and finished milestones get an external review before the merge:

```bash
codex exec --skip-git-repo-check -m gpt-6-astra "<review instructions>" < input.md > out.md
```

Codex refuses to run inside an untrusted directory — run it from the repo
with `--skip-git-repo-check`, and redirect rather than pipe. If it is rate
limited, `claude -p --model opus` is the fallback reviewer.
