# Urbis rebrand + landing-page theme unification — design

**Date**: 2026-08-10
**Status**: approved (user, 2026-08-10)

## Goal

The product is no longer MultiRoofs-specific: it is a general 3D city model
viewer & analyser (CityJSON, CityJSONSeq, FlatCityBuf, CityParquet, CityGML
archives) on a photorealistic globe. Two changes follow:

1. Rename the product to **Urbis**, everywhere — including storage keys
   (breaking, per project philosophy; no migration shims).
2. The landing / data-upload page currently uses a hardcoded parchment
   palette (`#f7f5ec` gradient, navy `#102a43`) that ignores the design-token
   system the viewer runs on. Rebuild it on the tokens so both pages share one
   visual system and both follow the theme toggle.

No logo work now; branding is text-only with a logo drop-in expected later.

## 1. Rename

### Visible strings

- `index.html` `<title>` → `Urbis — 3D city viewer & analyser`.
- `ViewerToolbar` brand span → `Urbis`.
- Landing hero: eyebrow → `Urbis`, headline → `Your city, in 3D.`
  (replaces `Rooftop analysis starts here.`); summary line unchanged
  (`Drop a city model or pick one from the open catalog.`).
- Version-mismatch sentences in `src/persistence/urlShare.ts` and
  `src/persistence/types.ts` say "Urbis" instead of "MultiRoof Viewer".

### Internal identifiers (breaking)

- `src/persistence/localStorage.ts`: `multiroof:snapshot:` →
  `urbis:snapshot:`, `multiroof:snapshot-index` → `urbis:snapshot-index`.
- `src/features/theme/useTheme.ts`: storage key `multiroof-theme` →
  `urbis-theme`.
- `src/features/debug/renderDebugStore.ts`: `window.__multiroofRenderDebug` →
  `window.__urbisRenderDebug` (comment mentions updated too).

Old keys are never read again; existing saved workspaces and the stored theme
preference are orphaned silently. No migration, per project philosophy.

### Out of scope

Repo name, `package.json` name, CLAUDE.md prose, the git remote, and any
logo/favicon work. The MultiRoofs project still owns the repository.

## 2. Landing page on the design tokens

Every landing-scoped rule in `src/app/app.css` — `.app-shell`, `.hero`,
`.eyebrow`, `.summary`, `.entry-*`, `.catalog-entry*`, `.sample-*`, the
landing error message — plus the SourcePicker hero-variant styles, drops its
hardcoded parchment/navy hexes for the existing tokens (`--bg-root`,
`--bg-panel`, `--bg-panel-hover`, `--bg-input`, `--fg`, `--fg-muted`,
`--fg-label`, `--accent`, `--accent-soft`, `--accent-text`, `--border`,
`--border-accent`, radii tokens).

Consequences, deliberate:

- Landing is **dark by default**, matching the viewer's default, and follows
  `[data-theme="light"]` exactly like the viewer chrome. One palette, two
  pages.
- A subtle radial accent glow (token-derived, e.g. `--accent-soft`) replaces
  the green parchment radial so the hero keeps some warmth; it must read
  correctly in both themes.
- The theme toggle button (the same control the toolbar renders) appears on
  the landing page top-right, so the theme can be flipped before any data
  loads.

## Testing

- Unit tests asserting the renamed strings/keys are updated
  (persistence round-trip tests, any toolbar/landing render tests).
- `npx vitest run` + `npx tsc -b --noEmit` green.
- Browser check of the landing page in dark and light themes, and of the
  landing → viewer transition, confirming no palette jump.
