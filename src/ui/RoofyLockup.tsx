/**
 * The Roofy brand lockup: the "sun band" mark beside the wordmark.
 *
 * One component for the toolbar and the landing hero, so the two can never
 * drift. The mark's four fills are the `--layer-*` tokens from
 * `src/app/brand.css` — the same four hues the rule legend uses — and those
 * tokens re-point under `[data-theme="light"]`, so the logo follows the theme
 * toggle with no JS. Type, gap and size come from `.roofy-lockup` in the same
 * file; a host scales the whole lockup by setting its `font-size`.
 *
 * `small` switches to the kit's ≤20px geometry (the amber/orange split raised
 * from y20 to y17 so the orange plane survives at favicon size) — the
 * toolbar's 20px mark uses it, the hero's 28px one does not.
 *
 * The SVG is decorative; the wordmark beside it is the accessible name.
 */
export function RoofyLockup({ small = false }: { small?: boolean }) {
  const splitY = small ? 17 : 20;
  const splitX = small ? 33 : 36;
  return (
    <span className="roofy-lockup">
      <svg className="roofy-mark" viewBox="0 0 48 48" aria-hidden="true">
        <path d="M24 8 L24 29 L3 29 Z" fill="var(--layer-nature)" />
        <path
          d={`M24 8 L${splitX} ${splitY} L24 ${splitY} Z`}
          fill="var(--layer-energy)"
        />
        <path
          d={`M24 ${splitY} L${splitX} ${splitY} L45 29 L24 29 Z`}
          fill="var(--layer-social)"
        />
        <rect
          x="3"
          y="34"
          width="42"
          height="10"
          rx="2.5"
          fill="var(--layer-water)"
        />
      </svg>
      <span className="roofy-wordmark">Roofy</span>
    </span>
  );
}
