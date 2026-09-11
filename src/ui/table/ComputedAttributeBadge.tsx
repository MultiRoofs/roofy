/**
 * Provenance comes from the generated-column set, never inferred from a name.
 *
 * `title` carries a tool run's provenance when there is one
 * (`formatProvenance`); the generic sentence is the fallback for the drawer's
 * three synthetic columns, which no run produced.
 */
export function ComputedAttributeBadge({
  title = "Computed by Roofy — this value is calculated by the app.",
}: {
  readonly title?: string;
} = {}) {
  return (
    <span
      className="computed-attribute-badge"
      tabIndex={0}
      role="img"
      aria-label="Computed by Roofy"
      title={title}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="5" y="2" width="14" height="20" rx="2" />
        <path d="M8 6h8M8 11h1m6 0h1M8 15h1m6 0h1M8 19h1m6 0h1" />
      </svg>
      {/* The CSS bubble says the same thing as the native tooltip, or the
          hover shows two different sentences at once. */}
      <span className="computed-attribute-tooltip" aria-hidden="true">
        {title}
      </span>
    </span>
  );
}
