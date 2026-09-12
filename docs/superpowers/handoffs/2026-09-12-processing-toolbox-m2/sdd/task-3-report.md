# Task 3 report — The capability chips tell the truth, and offer Retry

Branch `develop`, base `689e75d`. One commit: `75b2221` — "feat(processing): the capability chips follow the extension and offer Retry". Not pushed.

## What was implemented

Spec §5's chip contract, end to end:

1. **`chipTitle(name, state)`** replaces the constant `CHIP_TITLE` map in
   `src/ui/processing/CatalogueView.tsx`. Four sentences, one per state:
   - `unloaded` → the cost sentence (`CHIP_COST`, spec §5 verbatim);
   - `loading` → "Loading the <name> extension…" (owner-accepted adapted copy);
   - `loaded` → "The <name> extension is loaded" (owner-accepted adapted copy);
   - `failed` → "The <name> extension could not be downloaded; check the
     connection and retry" — §5's own reason, the SAME string
     `eligibility.ts:73-81` puts on a row, so the chip and the reason cannot
     drift apart.
2. **The chip carries `data-state`**, so the muted/dimmed presentation is a
   CSS class hook rather than an inline colour.
3. **`ToolRow` is wrapped** in `<div className="processing-tool-row-wrap">`
   and the Retry **`<button>` is a SIBLING** of the row button, not a child:
   a button inside a button is invalid HTML and browsers un-nest it
   unpredictably. The row button keeps its role, accessible name, description,
   chip and reason line exactly as before — `CatalogueView.test.tsx` passes
   untouched, including its `row.querySelector(".processing-chip")` lookups.
4. **Retry is gated on the EXTENSION, not the row's reason**:
   `canRetry = ext !== null && extensionState[ext] === "failed"`. In M2 every
   extension tool is still `implemented: false`, so `eligibility.ts:44`'s "Not
   available yet" outranks the download reason and it never reaches a row —
   a string comparison against the reason would render no Retry at all. The
   chip's tooltip is where the user reads why.
5. **Retry calls `ensureExtension(ext)`, un-awaited** — never `retryEngine()`
   (the engine is up; rebooting DuckDB would rebuild every layer table to fix
   a download) and never a second loader (`ensureExtension` already
   de-duplicates concurrent loads and clears its memo on failure). The status
   publishes `loading` then `loaded`/`failed`; the chip follows because
   `useEligibilityContext` is subscribed through `useDuckDBStatus`.
6. **CSS** appended after the `.processing-chip` block in
   `src/ui/processing/processing.css`: the flex wrapper, the muted
   (`[data-state="failed"]`) and dimmed (`[data-state="loading"]`) chip, and
   `.processing-retry` as a small underlined link. No literal colours — only
   `--control-hover`, `--fg-muted` and `--accent`.

## Tests and results

New file: `tests/unit/ui/processing/extensionChip.test.tsx`, 5 cases.

The engine underneath is the package-level fake at the `@duckdb/duckdb-wasm`
boundary, the same shape `tests/unit/insights/useDuckDBStatus.test.tsx` builds.
`duckdb.ts`, `useDuckDBStatus` and `useEligibilityContext` all run for real, so
every state asserted was genuinely published by `setStatus` and delivered to
React. A hand-rolled fake publisher would go on passing if either broke — which
is the exact risk this task exists to cover.

| Case                                                                    | What it pins                                                                                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| offers the loading cost while the extension is unloaded                 | both chips' cost sentences                                                                                                |
| says so once the extension is loaded, and does so on a REAL load        | loaded sentence after a real `ensureExtension`; the OTHER chip is untouched; no Retry                                     |
| mutes the chip and offers Retry when the REAL load fails                | `data-state="failed"`, the failure sentence on the chip, 3 Retry buttons (one per spatial tool), 3D chip still `unloaded` |
| Retry asks the engine to load the extension again, and the chip follows | click → real load → `isExtensionLoaded("spatial")`, Retry gone, chip says loaded                                          |
| shows the loading state while a load is in flight                       | `data-state="loading"` and the loading sentence mid-flight, then loaded                                                   |

**Plan review residuals, both addressed as requirements:**

- _"the chip suite shares a loaded singleton across cases — reset modules per
  case"_: `beforeEach` calls `vi.resetModules()` and then dynamic-imports the
  WHOLE consumer graph — `CatalogueView`, `duckdb`, `layerStore`,
  `workspaceStore`, `layerTables`, `processingStore` — into module-level
  `let`s. Any of those imported statically would be a different instance from
  the one the freshly imported `CatalogueView` reads. `URL` is stubbed AFTER
  the dynamic imports, for the reason `useDuckDBStatus.test.tsx:80-87`
  documents (vitest's module runner calls `new URL(...)` while resolving).
- _"use a controlled deferred for the 'loading' assertion"_: the fake
  connection's `query` awaits a module-level `gate` promise when one is armed.
  It is armed only AFTER `initDuckDB()` resolves, so the boot's own
  `INSTALL cityjson` runs to completion and only the lazy load hangs. The test
  releases it by hand.

**One deliberate deviation from the brief, in the test.** The brief's Retry
case settles the un-awaited click with two `await Promise.resolve()`. That is
provably short: the chain is `query(INSTALL)` → `query(LOAD)` →
`readLoadedExtensions()` (another query) → `publishReady` → `.finally`. It is
replaced with `await waitFor(() => expect(queryAllByRole("button", {name:
"Retry"})).toHaveLength(0))`, which waits for the RENDER rather than counting
microtasks. The assertion is not weakened — it still requires the chip to have
re-rendered from a really-published status, and `isExtensionLoaded` plus the
loaded tooltip are asserted after it.

**One deliberate deviation in the source.** The brief declares a local
`type ExtensionName = "spatial" | "three_d"` in `CatalogueView.tsx`. The
codebase already exports `ToolExtension` (`features/processing/types.ts:16`)
with exactly that definition, and `EligibilityContext["extensionState"]`
already names the state union. Both are used instead of re-declaring; a local
`ExtensionName` would also have shadowed `duckdb.ts`'s own exported
`ExtensionName` (which includes `"cityjson"`) for any future reader.

### TDD evidence

**RED** — `npx vitest run tests/unit/ui/processing/extensionChip.test.tsx`
before any source change: `Test Files 1 failed (1)`, `Tests 4 failed | 1
passed (5)`. The failures were exactly the intended ones, not import or `act`
errors:

- `toHaveAttribute("title", "The spatial extension is loaded")` — received the
  cost sentence;
- `toHaveAttribute("data-state", "failed")` — received `null`;
- `getAllByRole("button", { name: "Retry" })` — "Unable to find an accessible
  element", with the printed DOM showing the row `<button>` and its chip with
  no `data-state` and no sibling;
- `toHaveAttribute("data-state", "loading")` — received `null`.

The one passing case was the unloaded-cost tooltip, which is pre-existing
behaviour the task must not regress.

**GREEN** — after steps 3-5: `npx vitest run tests/unit/ui/processing` →
`Test Files 8 passed (8)`, `Tests 81 passed (81)`. Run three times in a row
with identical results (the gate and the `waitFor` are not timing-sensitive).

**Full suite** — `npx vp test run`, logged to
`/tmp/claude-1020/-data2-hideba-multiroof-viewer/e57ba222-158b-4909-b356-6b4d18a2a687/scratchpad/full-suite-task3.log`:
`Test Files 234 passed | 2 skipped (236)`, `Tests 2858 passed | 31 skipped (2889)`, exit 0 — no regression anywhere.

**Gates** — `npx tsc -b --noEmit` exit 0. `npx vp check`: "Found 0 errors and
56 warnings in 512 files" (the 56-warning baseline, all pre-existing
`no-floating-promises` in unrelated test files). One formatting fix was applied
by `vp check --fix` to the new test file before the commit.

## Files changed

- `src/ui/processing/CatalogueView.tsx` — `chipTitle`, `CHIP_COST`,
  `data-state`, the row wrapper, the Retry button, `ensureExtension` import,
  `extensionState` passed from `ctx` to every `ToolRow`.
- `src/ui/processing/processing.css` — `.processing-tool-row-wrap`,
  `.processing-chip[data-state="failed"]`, `.processing-chip[data-state="loading"]`,
  `.processing-retry` (+ `:hover`).
- `tests/unit/ui/processing/extensionChip.test.tsx` — new.

Untouched, as instructed: `.github/hooks/`, `docs/design-history/`,
`.superpowers/` (beyond this report).

## Self-review

- **The ONE-writer rule holds.** Nothing here calls `setDuckdbStatus` or reads
  `getDuckDBStatus()` into a second copy. The chip's state comes from
  `ctx.extensionState`, which `useEligibilityContext` derives from the single
  subscribed `useDuckDBStatus()` value. `ensureExtension` is the only engine
  call added, and `duckdb.ts` remains the only importer of
  `@duckdb/duckdb-wasm` under `src/`.
- **`!implemented` still outranks everything.** `toolEligibility` is untouched;
  disabled rows still read "Not available yet". Only the Retry gate bypasses
  the reason, deliberately and with a comment saying why.
- **Existing tests survive the DOM change.** `CatalogueView.test.tsx` finds the
  row by `getByRole("button", { name: /…/ })` and the chip by
  `row.querySelector(".processing-chip")`; both still resolve. No other test
  asserts on the catalogue's DOM shape.
- **Blast radius of the new `ensureExtension` import.** Every test that mocks
  `src/insights/duckdb` and renders the catalogue (`CatalogueView.test.tsx`,
  `ProcessingPanel.test.tsx`, `ToolView.test.tsx`, `useToolForm.test.tsx`,
  the `app*` suites) already exports `ensureExtension` from its factory —
  checked by grep across `tests/`. The one file without it
  (`tests/unit/ui/table/useLayerCounts.test.tsx`) never renders the catalogue,
  and the binding is only read inside the click handler anyway.
- **UI consistency.** `.processing-retry` follows the documented-exception rule
  in `docs/ui-consistency.md`: it is a link-weight inline action beside a
  2-line list row, and the comment beside the CSS says why a 38px filled
  control would be wrong there. The `!important`s are only where
  `flatControls.css:20-27` sets every button's fill, colour, border and
  min-height; `color` needed `!important` too, which the brief's snippet
  omitted — without it `body button { color: var(--fg) !important }` wins and
  the "link" renders in body colour. The focus ring still comes from the
  shared `body button:focus-visible` rule, and the hover uses
  `--control-hover` like every other inline action.
- **Layout.** `.processing-tool-row-wrap .processing-tool-row` gets
  `flex: 1 1 auto; min-width: 0` so the row's two lines still wrap normally
  beside the `flex-shrink: 0` link instead of the row narrowing unpredictably,
  and `margin-bottom: 0` (the wrapper took the row's 4px).

## Concerns / follow-ups

1. **Three identical "Retry" links.** A failed `spatial` renders one Retry per
   spatial tool (3 today), all with the accessible name "Retry" — a screen
   reader hears three indistinguishable buttons in one list. The brief
   specifies the plain name and the test pins it, so it is left as specified;
   a `title` or `aria-describedby` naming the extension would fix it without
   changing the accessible name, if the owner wants it.
2. **Not verified in a real browser.** `docs/ui-consistency.md` asks for a
   visual comparison against peer controls in both themes. The muted chip and
   the Retry link were reasoned from the tokens, not seen rendered. Worth a
   look on the next browser smoke — in particular whether `--control-hover`
   behind `--fg-muted` reads as "muted" rather than "another chip colour" in
   the light theme.
3. **The row-level download reason is still unreachable** and stays so until a
   spatial or three_d tool ships (M13.3). The chip tooltip and the row reason
   are the same string in the source, so they cannot drift, but no test can
   assert the ROW carrying it until `implemented: true` exists for one of
   those tools. `eligibility.test.ts` covers the pure function directly.
4. **The chip is a `<span>` with a `title`.** Tooltips on non-interactive
   elements are not reachable by keyboard. That predates this task (the chip
   already carried a `title`), but the information it now carries is more
   load-bearing than before.

---

## Fix round 1

Codex review returned **Needs fixes**. All four findings addressed on top of
`b64fd35` (Task 4's engine-death work; nothing rebased). One commit: `78e32aa`. Not pushed.

Order matters for the evidence below: finding 3 renames the Retry button's
accessible name, so every `getAllByRole("button", { name: "Retry" })` in the
suite had to be renamed in the SAME edit pass as the new assertions. That
rename alone turns three cases red ("expected [] to have a length of 3"), which
would have masked finding 2's own failure — so finding 3 was implemented
first, and finding 2's RED was captured on the isolated re-run.

### Finding 1 (major) — Retry test waited for `loading`, not for completion

`tests/unit/ui/processing/extensionChip.test.tsx:341-346`. The `waitFor`
polled for ZERO Retry buttons, but the links disappear the instant the state
leaves `"failed"` — i.e. at the START of the retried load, not at its success.
The assertions after it (`isExtensionLoaded`, the loaded tooltip) could
therefore race the remaining `LOAD` and `readLoadedExtensions()` queries.

Fix: `waitFor` is kept, but it now waits on the thing that only completion can
produce — `expect(chip("Spatial")).toHaveAttribute("title", "The spatial
extension is loaded")`. `isExtensionLoaded("spatial")` and the zero-Retry
assertion moved AFTER it, where they are consequences rather than the gate.

RED/GREEN: this one tightens an assertion that already passed, so it has no
honest RED — reported as such rather than manufacturing one. It is GREEN on
the same run as the rest (`Tests 86 passed`), and the guarantee it adds is
structural: the polled condition is now unreachable before the load resolves.

### Finding 2 (major) — the failure explanation was not reachable by keyboard

`src/ui/processing/CatalogueView.tsx:131, :143, :170-172, :180-186`.
The download sentence lived only in the chip's native `title`, and a `<span>`
cannot be focused; the focusable row exposed "Not available yet" (M2's
outranking reason), and Retry had no explanation at all.

Fix: `ToolRow` takes a `useId()` (`:131`) and, when `canRetry`, renders the
sentence once in a clipped `<span id={failureId} className="processing-sr-only">`
(`:170-172`) — a sibling of the row button, never a child, or it would join the
row's accessible NAME. The row button (`:143`) and the Retry button (`:181`)
both point at it with `aria-describedby`; the Retry button also carries the
same sentence as a `title` (`:186`) for pointer users (`aria-describedby` outranks
`title` in the accessibility tree, so the description is not doubled — verified
by the exact-string `toHaveAccessibleDescription`). `aria-describedby` is
failure-only, so a merely-unloaded row never claims a download failed.

`.processing-sr-only` was added to `src/ui/processing/processing.css:196` on the
clip idiom `app.css`'s `.left-rail-count` already establishes (clipped, not
`display: none`, which would drop it from the accessibility tree with the
pixels). The class is new rather than a reuse of the rail-specific name.

Covering test: new case "puts the failure reason where a keyboard can reach it"
(`extensionChip.test.tsx:282-311`) — `toHaveAccessibleDescription(FAILED_REASON)`
on BOTH the `Join attributes by location` row and a Retry button, the Retry
`title`, that the visible text is still `"Retry"`, and the negative
(`Measure solids` has no `aria-describedby`).

RED (after finding 3 was in place, so the query itself resolved):
`Tests 1 failed | 5 passed (6)` —
`expect(element).toHaveAccessibleDescription()` at `:299` (the row assertion),
Received: empty.
GREEN: `Tests 86 passed (86)` across `tests/unit/ui/processing`.

### Finding 3 (minor) — extension-specific accessible name

`src/ui/processing/CatalogueView.tsx:180`. A failed `spatial` renders three
Retry links; all three were named "Retry". Each now carries
`aria-label={`Retry loading the ${ext} extension`}`. The visible text is
unchanged and is a prefix of the name, so WCAG 2.5.3 (Label in Name) holds.

Covering test: the `retries(ext)` helper (`extensionChip.test.tsx:153-161`)
queries by that exact name and is used by every Retry assertion in the file,
including the two `toHaveLength(0)` negatives.

RED: `Tests 3 failed | 3 passed (6)` — "expected [] to have a length of 3" in
the mute case and the Retry case, plus the new keyboard case failing on the
same empty result. GREEN after the `aria-label`: `Tests 1 failed | 5 passed (6)`,
the one remaining failure being finding 2's.

### Finding 4 (minor) — expected fake failures emitted unasserted engine warnings

`tests/unit/ui/processing/extensionChip.test.tsx:252, :287, :314` (the spies)
and `:209` (`afterEach`).
The two cases that refuse `spatial` provoke a REAL
`console.warn('DuckDB extension "spatial" did not load:', …)` from
`duckdb.ts:231`, which was neither scoped nor asserted — noise in the run, and
a silent pass if the module ever stopped reporting.

Fix: each failure case (and the new keyboard case) opens
`vi.spyOn(console, "warn").mockImplementation(() => {})`, asserts the message
by its exact prefix, and calls `mockRestore()`; `afterEach` also calls
`vi.restoreAllMocks()` so an assertion that throws early cannot leave
`console.warn` silenced for the rest of the file. `duckdb.ts` was re-grepped
after Task 4 landed — the extension path's only report is still that one
`console.warn` at `:231`.

RED: n/a in the same sense as finding 1 — the spy assertion passed on
introduction (the module does warn); what it fixes is unasserted noise, and
the evidence is the run's stderr going quiet while the message is now pinned.
GREEN: included in `Tests 86 passed (86)`.

### Verification for the round

- `npx vitest run tests/unit/ui/processing` → `Test Files 9 passed (9)`,
  `Tests 86 passed (86)`; 0 React "not wrapped in act(...)" warnings.
- `npx tsc -b --noEmit` → exit 0.
- `npx vp check` → "Found 0 errors and 56 warnings in 513 files"; no formatting
  issues.
- Full suite (`npx vp test run`, logged to
  `/tmp/claude-1020/-data2-hideba-multiroof-viewer/e57ba222-158b-4909-b356-6b4d18a2a687/scratchpad/full-suite-task3-fix1.log`):
  `Test Files 235 passed | 2 skipped (237)`, `Tests 2873 passed | 31 skipped
(2904)`, exit 0, no FAIL line — the `aria-label` rename broke nothing
  outside `tests/unit/ui/processing`.

### Concerns carried forward

Report concern 1 (three identical "Retry" names) is now CLOSED by finding 3.
Concern 4 (the chip's `title` is unreachable by keyboard) is CLOSED by finding
2 for the failure sentence — the cost and loading sentences are still
mouse-only on the chip, which is acceptable because they are informational
rather than an error the user must act on, but it is the same gap if the owner
wants it closed. Concerns 2 (no real-browser visual check, now including the
clipped span and the muted chip in the light theme) and 3 (row-level download
reason unreachable until M13.3) stand.
