/** A visible, keyboard-focusable marker for the enclosing field's help bubble. */
export function ProcessingInfo({
  description,
}: {
  readonly description?: string;
}) {
  if (!description) return null;
  return (
    <span
      className="processing-info"
      role="img"
      aria-label="More information"
      aria-description={description}
      tabIndex={0}
      onClick={(event) => event.preventDefault()}
    >
      <svg
        viewBox="0 0 16 16"
        width="14"
        height="14"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="8" cy="8" r="6" />
        <path d="M8 7v4M8 4.5v.5" />
      </svg>
    </span>
  );
}
