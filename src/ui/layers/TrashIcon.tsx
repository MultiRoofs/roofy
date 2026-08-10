/**
 * The trash-can glyph both layer sections' remove button draws.
 *
 * Its own module for the same reason {@link VisibilityIcon} is: a city-model
 * row and a geospatial row have nothing else in common, but "get rid of this"
 * is the same question and must not be asked with two slightly different
 * icons. Carries its own attributes (unlike `VisibilityIcon`, whose styling
 * lives in `.layer-vis-btn svg`) because `.rule-action-btn` styles no `svg` of
 * its own — the fly-to icon next to it is drawn the same way.
 *
 * No inner lines on the lid: at 12 px they collapse into noise rather than
 * reading as a bin.
 */
export function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
