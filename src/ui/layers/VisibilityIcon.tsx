/**
 * The eye / crossed-eye glyph every layer row's visibility toggle draws.
 *
 * Extracted when the Layers pane gained a second kind of row: a city model and
 * a geospatial layer are different in every other respect, but "is this on
 * screen?" is the same question and must not be asked with two slightly
 * different icons. Styling lives in `.layer-vis-btn svg`, so the glyph carries
 * no attributes of its own.
 */
export function VisibilityIcon({ visible }: { readonly visible: boolean }) {
  return visible ? (
    <svg viewBox="0 0 24 24">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
