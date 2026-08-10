# Urbis Rebrand + Landing Theme Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the product from "MultiRoof Viewer" to "Urbis" everywhere (including breaking storage-key renames), and rebuild the landing page's hardcoded parchment palette on the app's design tokens so both pages share one theme.

**Architecture:** Pure rename in six source files + one test; then a CSS-only rewrite of the landing section of `src/app/app.css` (lines ~136–505) onto the existing `:root` tokens, plus a small `ThemeToggleButton` component extracted from `ViewerToolbar` so the landing page can offer the same toggle. No new dependencies, no store changes, no engine involvement.

**Tech Stack:** React 19 + TypeScript, plain CSS with custom-property tokens, Vitest.

## Global Constraints

- Product name is exactly `Urbis` (capital U, no "Viewer" suffix in UI copy; the HTML title is `Urbis — 3D city viewer & analyser`).
- Hero headline is exactly `Your city, in 3D.`; the summary line `Drop a city model or pick one from the open catalog.` is unchanged.
- Storage keys change with NO migration: old `multiroof*` keys are never read again (spec: breaking changes acceptable).
- The landing section may use ONLY the design tokens defined at the top of `app.css` (`--bg-*`, `--fg-*`, `--accent*`, `--teal*`, `--border*`, `--radius*`) plus the existing literal reds (`#c53030` family) for error/danger, which are shared with the viewer already.
- Do not touch `.source-picker-panel` override rules (the Add Layer dialog variant) — they already use tokens and win on specificity.
- Repo name, `package.json` name, and CLAUDE.md prose are out of scope.
- Commit convention: `feat:`/`fix:`/`refactor:` prefix + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; run `npx tsc -b --noEmit` before each commit.

---

### Task 1: Rename MultiRoof → Urbis (visible strings, storage keys, debug handle)

**Files:**

- Modify: `index.html:6`
- Modify: `src/ui/toolbar/ViewerToolbar.tsx:73`
- Modify: `src/app/App.tsx:1338-1339`
- Modify: `src/persistence/urlShare.ts:118-119`
- Modify: `src/persistence/types.ts:384`
- Modify: `src/persistence/localStorage.ts:14-15`
- Modify: `src/features/theme/useTheme.ts:13`
- Modify: `src/features/debug/renderDebugStore.ts:110,121,126`
- Test: `tests/unit/app/appRestoreShare.test.tsx:460`

**Interfaces:**

- Consumes: nothing from other tasks.
- Produces: nothing later tasks rely on (Task 2 is independent).

- [ ] **Step 1: Update the failing test expectation first**

In `tests/unit/app/appRestoreShare.test.tsx` line 460, change:

```tsx
        screen.getByText(/older version of MultiRoof Viewer/),
```

to:

```tsx
        screen.getByText(/older version of Urbis/),
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/app/appRestoreShare.test.tsx`
Expected: FAIL — the rendered message still says "MultiRoof Viewer".

- [ ] **Step 3: Apply the renames**

`index.html` line 6:

```html
<title>Urbis — 3D city viewer & analyser</title>
```

`src/ui/toolbar/ViewerToolbar.tsx` line 73:

```tsx
<span className="toolbar-brand">Urbis</span>
```

`src/app/App.tsx` lines 1338–1339 (landing hero):

```tsx
        <p className="eyebrow">Urbis</p>
        <h1>Your city, in 3D.</h1>
```

`src/persistence/urlShare.ts` lines 118–119 — replace the two occurrences of
`MultiRoof Viewer` with `Urbis` inside the existing sentences (sentence
structure unchanged):

```ts
        ? `This share link was created by a newer version of Urbis (v${found}) than this one, so it cannot be opened here.`
        : "This share link was created by an older version of Urbis and can no longer be opened. Shared cameras changed from scene coordinates to geographic coordinates; please ask for a new link.",
```

`src/persistence/types.ts` line 384:

```ts
      `This saved workspace was created by an older version of Urbis (v${found}) and can no longer be restored. Saved cameras changed from scene coordinates to geographic coordinates; please re-save from the current version.`,
```

`src/persistence/localStorage.ts` lines 14–15:

```ts
const STORAGE_PREFIX = "urbis:snapshot:";
const INDEX_KEY = "urbis:snapshot-index";
```

`src/features/theme/useTheme.ts` line 13:

```ts
const STORAGE_KEY = "urbis-theme";
```

`src/features/debug/renderDebugStore.ts` — three sites: in the comment on
line 110 change ``(`window.__multiroofRenderDebug`)`` to
``(`window.__urbisRenderDebug`)``; line 121 and line 126 change the
identifier:

```ts
    __urbisRenderDebug?: typeof useRenderDebugStore;
```

```ts
window.__urbisRenderDebug = useRenderDebugStore;
```

- [ ] **Step 4: Verify no stragglers**

Run: `grep -rn "multiroof\|MultiRoof\|Multiroof\|Rooftop analysis" src/ tests/ index.html`
Expected: NO matches (docs/ and CLAUDE.md are out of scope and not searched).

- [ ] **Step 5: Run the full app suite and typecheck**

Run: `npx vitest run && npx tsc -b --noEmit`
Expected: all tests pass (1369+), typecheck clean. If any other test fails on
a renamed string or key, update that test's expectation to the Urbis value —
same mechanical change as Step 1.

- [ ] **Step 6: Commit**

```bash
git add index.html src/ tests/
git commit -m "feat: rename MultiRoof Viewer to Urbis (breaking storage keys)

Product is a general 3D city viewer & analyser now. Storage keys
multiroof:snapshot:*/multiroof-theme become urbis:*; old keys are
orphaned deliberately — no migration, per project philosophy.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Landing page on design tokens + theme toggle on landing

**Files:**

- Create: `src/ui/ThemeToggleButton.tsx`
- Modify: `src/ui/toolbar/ViewerToolbar.tsx:214-255` (replace inline button with the component)
- Modify: `src/app/App.tsx` (landing return, after `<main className="app-shell">` opens, ~line 1336)
- Modify: `src/app/app.css:136-505` (landing section rewrite) and append one `.landing-theme-toggle` rule to that section
- Test: existing suites only (`npx vitest run`) — landing markup gains one labelled button; no test asserts landing colors.

**Interfaces:**

- Consumes: `useTheme` (already called in `App.tsx:191`, `theme`/`toggleTheme` in scope in the landing return; `ViewerToolbar` already receives `theme` and `onToggleTheme` props).
- Produces: `ThemeToggleButton` React component, props `{ theme: Theme; onToggle: () => void; tooltip?: boolean }` — renders the existing `.theme-toggle-btn` button; `tooltip` adds the toolbar's `data-tooltip` attributes (default false).

- [ ] **Step 1: Create `src/ui/ThemeToggleButton.tsx`**

```tsx
import type { Theme } from "../features/theme/useTheme";

/**
 * The sun/moon theme toggle, shared by the viewer toolbar and the landing
 * page so the two render one identical control (same class, same icons,
 * same aria wording). `tooltip` opts in to the toolbar's hover tooltip
 * attributes; the landing page has no tooltip system, so it stays off there.
 */
export function ThemeToggleButton({
  theme,
  onToggle,
  tooltip = false,
}: {
  theme: Theme;
  onToggle: () => void;
  tooltip?: boolean;
}) {
  const label = `Switch to ${theme === "dark" ? "light" : "dark"} theme`;
  return (
    <button
      className="theme-toggle-btn"
      aria-label={label}
      {...(tooltip
        ? { "data-tooltip": label, "data-tooltip-align": "end" }
        : {})}
      onClick={onToggle}
    >
      {theme === "dark" ? (
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
        </svg>
      )}
    </button>
  );
}
```

- [ ] **Step 2: Use it in `ViewerToolbar.tsx`**

Add the import next to the existing `Theme` type import:

```tsx
import { ThemeToggleButton } from "../ThemeToggleButton";
```

Replace the whole inline `<button className="theme-toggle-btn" …>…</button>`
block (lines 214–256, from `<button` through its closing `</button>`) with:

```tsx
<ThemeToggleButton theme={theme} onToggle={onToggleTheme} tooltip />
```

(`theme` and `onToggleTheme` are the toolbar's existing props — check the
prop names at the top of the file and use exactly those.)

- [ ] **Step 3: Run toolbar/app tests to prove the refactor is invisible**

Run: `npx vitest run tests/unit/ui tests/unit/app`
Expected: PASS — markup is byte-identical to before.

- [ ] **Step 4: Commit the extraction**

```bash
git add src/ui/ThemeToggleButton.tsx src/ui/toolbar/ViewerToolbar.tsx
git commit -m "refactor: extract ThemeToggleButton from ViewerToolbar

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Rewrite the landing section of `app.css` on tokens**

Replace the rules between the `LANDING PAGE` banner comment (line ~136) and
the `@media (max-width: 640px)` block's end (line ~505) — keeping every
selector, layout property and comment structure, changing ONLY color/border/
background declarations — with the following. (Layout values — grid, gap,
padding, widths, radii in `rem` — are unchanged from the current file; the
diff is colors only, plus the new `.landing-theme-toggle` rule at the end.)

```css
/* ═══════════════════════════════════════════════════════════════
   LANDING PAGE — same token palette as the viewer, both themes
   ═══════════════════════════════════════════════════════════════ */

.app-shell {
  display: grid;
  gap: 2rem;
  max-width: 960px;
  margin: 0 auto;
  padding: 4rem 1.5rem 5rem;
  color: var(--fg);
  background:
    radial-gradient(circle at top left, var(--accent-soft), transparent 40%),
    var(--bg-root);
  min-height: 100vh;
}

.hero {
  display: grid;
  gap: 1rem;
}

.eyebrow {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent-text);
}

.hero h1 {
  margin: 0;
  max-width: 16ch;
  font-size: clamp(2.8rem, 8vw, 5rem);
  line-height: 0.95;
  color: var(--fg);
}

.summary {
  margin: 0;
  max-width: 42rem;
  font-size: 1.1rem;
  color: var(--fg-muted);
}

/* ---- the two entry paths: own data | published catalog ---- */

/* The two doors plus the sample footnote are ONE choice, so they share a
   container with a gap of their own — the shell's 2rem grid gap would read as
   three unrelated blocks with the footnote as a peer of the cards. */
.entry-section {
  display: grid;
  gap: 0.9rem;
}

/* `auto-fit` rather than the file's usual fixed breakpoint: between 640px and
   ~900px the shell is still wide enough to look like it holds two columns, but
   two of them are unusably narrow. The track minimum stacks them there. */
.entry-paths {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr));
  gap: 1.5rem;
}

/* The 34rem cap is the picker's own (`.source-picker-hero`), restated so the
   catalog card stops at the same edge once the two stack. */
.entry-path {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  min-width: 0;
  max-width: 34rem;
}

.entry-path-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--fg-label);
}

/* Equal weight to the drop zone beside it: same radius, same padding, same
   panel surface — but a solid border, because nothing is dropped here.
   `flex: 1` is what makes the two columns end level. */
.catalog-entry {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 3rem 2rem;
  border: 2px solid var(--border-accent);
  border-radius: 1.25rem;
  background: var(--bg-panel);
  text-align: center;
  color: var(--fg-muted);
  transition:
    border-color 0.2s,
    background 0.2s;
}

.catalog-entry:hover {
  border-color: var(--accent);
  background: var(--bg-panel-hover);
}

.catalog-entry p {
  margin: 0;
  max-width: 22rem;
}

.catalog-entry-btn {
  padding: 0.5rem 1.25rem;
  border: none;
  border-radius: 0.5rem;
  background: var(--accent);
  color: var(--bg-panel);
  font-family: inherit;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}

.catalog-entry-btn:hover:not(:disabled) {
  background: var(--accent-text);
}

.catalog-entry-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* The sample is a demo convenience, not a third door: footnote type, and a
   button worn as a link so the keyboard still reaches it. */
.sample-footnote {
  margin: 0;
  font-size: 0.85rem;
  color: var(--fg-dim);
}

.sample-link {
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  color: var(--fg-muted);
  text-decoration: underline;
  text-underline-offset: 0.15em;
  cursor: pointer;
}

.sample-link:hover:not(:disabled) {
  color: var(--fg);
}

.sample-link:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.drop-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  width: min(100%, 34rem);
  padding: 3rem 2rem;
  border: 2px dashed var(--border-accent);
  border-radius: 1.25rem;
  background: var(--bg-panel);
  text-align: center;
  transition:
    border-color 0.2s,
    background 0.2s;
}

.drop-zone:hover {
  border-color: var(--accent);
  background: var(--bg-panel-hover);
}

.drop-zone p {
  margin: 0;
  color: var(--fg-muted);
}

.drop-or {
  font-size: 0.85rem;
  color: var(--fg-dim);
}

/* Browse files + Choose folder sit side by side: two ways in, one row.
   Wraps rather than overflowing — the panel variant is only ~30 rem wide. */
.file-label-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem;
}

.file-label {
  display: inline-block;
  padding: 0.5rem 1.25rem;
  background: var(--accent);
  color: var(--bg-panel);
  border-radius: 0.5rem;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  transition: background 0.15s;
}

.file-label:hover {
  background: var(--accent-text);
}

.fcb-url-form {
  width: min(100%, 34rem);
  margin-top: 1rem;
}

.fcb-url-label {
  display: block;
  font-size: 0.85rem;
  color: var(--fg-label);
  margin-bottom: 0.4rem;
}

.fcb-url-row {
  display: flex;
  gap: 0.5rem;
}

.fcb-url-input {
  flex: 1;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border-accent);
  border-radius: 0.5rem;
  font-size: 0.9rem;
  background: var(--bg-input);
  color: var(--fg);
}

.fcb-url-input::placeholder {
  color: var(--fg-dim);
}

.fcb-url-btn {
  padding: 0.5rem 1.25rem;
  background: var(--accent);
  color: var(--bg-panel);
  border: none;
  border-radius: 0.5rem;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  transition: background 0.15s;
}

.fcb-url-btn:hover:not(:disabled) {
  background: var(--accent-text);
}

.fcb-url-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.snapshot-list {
  width: min(100%, 34rem);
  margin-top: 1.5rem;
}

.snapshot-list-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--fg-label);
  margin-bottom: 0.5rem;
}

.snapshot-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: var(--bg-panel);
  margin-bottom: 0.4rem;
}

.snapshot-info {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.snapshot-label {
  font-size: 0.9rem;
  color: var(--fg);
  font-weight: 500;
}

.snapshot-date {
  font-size: 0.75rem;
  color: var(--fg-dim);
}

.snapshot-actions {
  display: flex;
  gap: 0.4rem;
}

.snapshot-btn {
  padding: 0.3rem 0.75rem;
  background: var(--accent);
  color: var(--bg-panel);
  border: none;
  border-radius: 0.35rem;
  cursor: pointer;
  font-size: 0.8rem;
  transition: background 0.15s;
}

.snapshot-btn:hover:not(:disabled) {
  background: var(--accent-text);
}

.snapshot-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.snapshot-btn-delete {
  background: transparent;
  color: var(--fg-muted);
  border: 1px solid var(--border-accent);
}

.snapshot-btn-delete:hover:not(:disabled) {
  background: rgba(197, 48, 48, 0.08);
  color: #c53030;
  border-color: rgba(197, 48, 48, 0.2);
}

.error-message {
  color: #c53030;
  background: rgba(197, 48, 48, 0.08);
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  width: min(100%, 34rem);
}

/* The landing page's only chrome: the same theme toggle the toolbar renders,
   pinned to the corner so the theme can be flipped before any data loads. */
.landing-theme-toggle {
  position: fixed;
  top: 1rem;
  right: 1rem;
  z-index: 20;
}

@media (max-width: 640px) {
  .app-shell {
    padding-top: 3rem;
  }

  .hero h1 {
    max-width: none;
  }
}
```

IMPORTANT: before replacing, `grep -n "drag" src/app/app.css | sed -n '1,10p'`
— if the landing section carries a drag-over state class for `.drop-zone`
(e.g. `.drop-zone.drag-over`) that the block above does not list, KEEP that
selector and re-express its colors the same way (`border-color: var(--accent);
background: var(--accent-soft)`), because `SourcePicker` toggles it during
drag and losing it removes the drop affordance.

- [ ] **Step 6: Add the toggle to the landing page in `App.tsx`**

Add the import next to the other `ui/` imports:

```tsx
import { ThemeToggleButton } from "../ui/ThemeToggleButton";
```

In the landing return (directly after `<main className="app-shell">`, before
`<div className="hero">`), insert:

```tsx
<div className="landing-theme-toggle">
  <ThemeToggleButton theme={theme} onToggle={toggleTheme} />
</div>
```

(`theme` and `toggleTheme` come from the `useTheme()` call already on
App.tsx line ~191, same component scope.)

- [ ] **Step 7: Full suite + typecheck**

Run: `npx vitest run && npx tsc -b --noEmit`
Expected: all green. A landing-rendering test that queries by role/text is
unaffected by the extra labelled button; if one asserts the exact button
count, update it.

- [ ] **Step 8: Browser check, both themes**

Run: `npm run dev` (background), then with agent-browser (`npx -y agent-browser`, per machine setup):
open `http://localhost:5173`, screenshot; click the corner theme toggle
(snapshot `-i` first to get its ref), screenshot again.
Expected: dark landing matches the viewer's dark palette (near-black
`#0c0e14` ground, amber accents); toggled landing matches the light viewer
chrome; no parchment/green remains. Then load the Delft sample and confirm
there is no palette jump from landing to viewer.

- [ ] **Step 9: Commit**

```bash
git add src/app/app.css src/app/App.tsx
git commit -m "feat: landing page joins the app design tokens, theme toggle on landing

Replaces the hardcoded parchment palette with the viewer's tokens so
the landing follows the dark/light toggle and matches the viewer.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
