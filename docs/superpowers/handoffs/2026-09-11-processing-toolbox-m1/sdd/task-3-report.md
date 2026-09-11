# Task 3 report — Tools button in the map header

## Implemented

- `src/ui/ActionIcon.tsx`: added `"tools"` to the name union and the wrench path, verbatim from the brief.
- `src/ui/processing/ToolsButton.tsx` (new): the brief's component verbatim — `aria-pressed` from `open`, `aria-label="Tools"`, `ActionIcon name="tools"`, a hidden-below-1280px label, and the activity dot (`data-tone` `running` when any run is queued/running/cancelling, `failed` for an unseen failure, absent otherwise). Click calls `useProcessingStore.getState().toggle()`.
- `src/ui/processing/processing.css` (new): the brief's CSS verbatim — 30 px `min-height` from `--control-height-compact`, `--lime-500` / `--brand-secondary` dot tones, label hidden under 1280 px.
- `src/app/App.tsx`: imported `ToolsButton` and mounted it between `SelectModeControl` and `AddressSearch` inside `.map-tool-header__editing`. Nothing else in App.tsx touched.
- `tests/unit/ui/processing/ToolsButton.test.tsx` (new): the brief's two tests verbatim.

`src/app/flatControls.css` was listed in the brief's "Files" header but no step edits it and Step 8's `git add` omits it, so it was left alone; `.tools-button { min-height: var(--control-height-compact) }` in `processing.css` supplies the explicit height (`body button` in flatControls sets none). See Concerns.

## TDD evidence

RED — `npx vitest run tests/unit/ui/processing/ToolsButton.test.tsx` after writing the test (icon added, component not yet):

```
Error: Failed to resolve import "../../../../src/ui/processing/ToolsButton" from
"tests/unit/ui/processing/ToolsButton.test.tsx". Does the file exist?
 Test Files  1 failed (1)
      Tests  no tests
```

GREEN — same command after adding `ToolsButton.tsx` + `processing.css`:

```
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

No `act(...)` warnings; output pristine.

## Checks

- `npx tsc -b --noEmit; echo $?` — no diagnostics, exit 0 (re-run unpiped to measure the real exit code). `tsconfig.app.json` includes `tests`, so the test's `RunRecord` literal is type-checked; its 24 fields match `RunRecord` in `src/features/processing/types.ts` exactly.
- `npx vitest run tests/unit/ui/processing/ToolsButton.test.tsx tests/unit/app` — 73 passed, 1 failed (pre-existing `appCityParquetLayers.test.tsx`, source-picker drop zone; untouched by this task).
- Full `npx vitest run` — 219 files: 217 passed, 1 skipped, 1 failed (the same pre-existing one). 2629 tests passed.
- Pre-commit hook (`vp staged` → `vp check --fix`) ran on the 5 staged files and made no modifications; the commit went through in one pass. Not pushed, so the pre-push `vp check` (which would hit the pre-existing DrawOverlay.tsx lint error) did not run.

## Browser check (performed, Playwright MCP)

`npm run dev` via the npm script (no server was listening on 5173 beforehand), loaded `http://localhost:5173/`, clicked "try the Delft sample". Measured with `getBoundingClientRect()` / `getComputedStyle()` at 1485 px wide, light theme:

| control                                   | height | radius | background                   | font |
| ----------------------------------------- | ------ | ------ | ---------------------------- | ---- |
| `.tools-button`                           | 30 px  | 8px    | `#f2f4ee` (`--control-rest`) | 12px |
| `.map-mode-control select` (Mode)         | 30 px  | 8px    | `#f2f4ee`                    | 12px |
| `.map-tool-header .address-search-toggle` | 32 px  | 8px    | `#f2f4ee`                    | 12px |
| `.map-tool-header .scene-buttons button`  | 32 px  | 8px    | `#f2f4ee`                    | 12px |

- DOM order inside `.map-tool-header__editing`: `map-mode-control`, `tools-button`, `address-search` — as specified.
- Exact height and radius match with the Mode select, and the same top edge (both at y=53; the 32 px peers sit at y=52, i.e. all vertically centred in the 48 px header).
- Click → `aria-pressed="true"`; unhovered computed background `#eaf2df` (`--control-selected`) with `#304d1d` foreground (`--control-selected-fg`) — the shared Soft Utility pressed look. (While the pointer still rests on the button the global `body button:hover` rule out-specifies the pressed rule and shows `--control-hover`; that is pre-existing app-wide behaviour, not introduced here.)
- Dark theme (`data-theme="dark"`): pressed background `#35452c`, foreground `#dcebcf` — the dark tokens, as expected.
- Activity dot absent with no runs (`.tools-button__dot` not in the DOM).
- At 1100 px the label is `display: none`, the button becomes 40×30 px and the accessible name stays "Tools".
- 0 console errors on load and after the click.
- Screenshot of the header taken and reviewed (Mode select · pressed "Tools" with the wrench · search), then deleted; the Playwright artefact directory was removed so the working tree stayed clean.

## Files changed

- `/Users/hbbaba/tudelft/projects/multiroof/multiroof-viewer/src/ui/ActionIcon.tsx`
- `/Users/hbbaba/tudelft/projects/multiroof/multiroof-viewer/src/ui/processing/ToolsButton.tsx` (new)
- `/Users/hbbaba/tudelft/projects/multiroof/multiroof-viewer/src/ui/processing/processing.css` (new)
- `/Users/hbbaba/tudelft/projects/multiroof/multiroof-viewer/src/app/App.tsx`
- `/Users/hbbaba/tudelft/projects/multiroof/multiroof-viewer/tests/unit/ui/processing/ToolsButton.test.tsx` (new)

Commit: `2d55992` `feat(processing): Tools button in the scene toolbar` on `develop` (not pushed). Working tree clean.

## Self-review

- Completeness: all eight brief steps done; every prescribed value used verbatim (icon path, component, CSS, test, mount point, commit message).
- Naming: `tools-button` / `tools-button__label` / `tools-button__dot` follow the app's BEM-ish class style; `src/ui/processing/` mirrors `src/features/processing/`.
- YAGNI: no extra props, no store fields, no flatControls edits, no right-panel work.
- Tests verify behaviour, not implementation: the accessible name and `aria-pressed`, the store's `open` after a click, and the dot's tone for a running run vs an unseen failure.
- Output pristine: no act warnings, no console errors in the browser, no stray files.
- Control consistency: verified against peers in a real browser in both themes and at a narrow width, per `docs/ui-consistency.md` (computed height and radius, not just appearance).

## Concerns

1. `src/app/flatControls.css` appears in the brief's Files list but no step modifies it and Step 8 does not stage it. Left untouched — flag for later tasks in case a shared rule was intended.
2. The Tools button and the Mode select are 30 px while the address-search toggle and the Sun & shade / Scene settings buttons in the same header are 32 px. That 2 px difference is pre-existing (`workspace.css` sizes those at 32 px) and not something this task should change; worth a separate consistency pass if the milestone wants one header rhythm.
3. Attribution trailer: `CLAUDE.md` asks commits to carry `Co-Authored-By: Claude …`; the task instructions said no attribution trailers. I followed the task instructions — the commit has no trailer.
4. The pre-existing `appCityParquetLayers.test.tsx` failure and the `DrawOverlay.tsx` lint error still stand on `develop`; the latter will fail `vp check` on the next push.
