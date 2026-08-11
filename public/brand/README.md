# Urbis brand assets

Drop this folder into the repo. Suggested placement:

- `public/brand/` — for anything the browser loads by URL (favicon, app icon, og image).
- `src/app/brand.css` — import next to `app.css`, or paste its `:root` block into `app.css`'s token section.

## Files

| File                                | Use                                        |
| ----------------------------------- | ------------------------------------------ |
| `urbis-mark.svg`                    | Symbol, dark backgrounds                   |
| `urbis-mark-light.svg`              | Symbol, light backgrounds                  |
| `urbis-mark-mono.svg`               | Single-colour, inherits `currentColor`     |
| `urbis-favicon.svg`                 | 16–20px only (heavier stroke)              |
| `urbis-app-icon.svg` / `-light.svg` | 512px plate icon (Tauri, PWA, store)       |
| `urbis-lockup.svg` / `-light.svg`   | Mark + wordmark, horizontal                |
| `brand.css`                         | CSS custom properties + `.urbis-lockup`    |
| `brand.tokens.json`                 | The same values for tooling / design tools |

The lockup SVGs set the wordmark as live `<text>` in IBM Plex Sans. Anywhere the font
is not guaranteed (email, third-party slides), use `urbis-mark.svg` plus real text, or
outline the type in a vector editor first.

## Favicon

```html
<link rel="icon" href="/brand/urbis-favicon.svg" type="image/svg+xml" />
```

## Toolbar

Replaces the `.toolbar-brand` text label in `src/ui/toolbar/ViewerToolbar.tsx`:

```tsx
<span className="urbis-lockup">
  <svg className="urbis-mark" viewBox="0 0 48 48" aria-hidden="true">
    <path
      className="urbis-mark-u"
      d="M14 12 V25 a10 10 0 0 0 20 0 V16"
      fill="none"
      strokeWidth="9"
      strokeLinecap="round"
    />
    <path
      className="urbis-mark-pitch"
      d="M34 16 L41 9"
      fill="none"
      strokeWidth="9"
      strokeLinecap="round"
    />
  </svg>
  <span className="urbis-wordmark">Urbis</span>
</span>
```

`brand.css` maps the two strokes to `--urbis-ink` / `--urbis-accent`, and the
`[data-theme="light"]` block re-points them, so the logo follows the app's theme
toggle with no JS.

## Rules

- **Colour.** Ink + one accent. The accent belongs to the pitch stroke only. Teal
  `#3ecfcf` stays a data colour and never enters the logo.
- **Clear space.** 25% of the mark's height on all four sides. In a 44px toolbar
  that means a 20px mark, nothing else inside 5px of it.
- **Minimum size.** 16px, and only with the small-size geometry
  (`urbis-favicon.svg`) — the 5-unit stroke fills in below 24px.
- **Plate.** Only for app icons and avatars. In-app the mark sits bare.
- **Don't** re-space or re-weight the wordmark, outline the mark, add a shadow,
  rotate it, or put it on a photograph without a plate.
