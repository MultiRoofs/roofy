/** Provenance comes from the generated-column set, never inferred from a name. */
export function ComputedAttributeBadge() {
  return (
    <span
      className="computed-attribute-badge"
      tabIndex={0}
      role="img"
      aria-label="Computed by Roofy"
      title="Computed by Roofy — this value is calculated by the app."
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
      <span className="computed-attribute-tooltip" aria-hidden="true">
        Computed by Roofy
      </span>
    </span>
  );
}
