/** Decorative category cues; the adjacent type name remains the accessible label. */
export function CityObjectIcon({ type }: { readonly type: string }) {
  const kind = /Building/.test(type)
    ? "building"
    : /Vegetation|PlantCover/.test(type)
      ? "vegetation"
      : /Water/.test(type)
        ? "water"
        : /Road|Railway|Transport|Square/.test(type)
          ? "transport"
          : /Bridge/.test(type)
            ? "bridge"
            : /Relief|LandUse/.test(type)
              ? "terrain"
              : "object";
  const paths = {
    building: "M5 21V3h14v18M3 21h18M9 7h1m4 0h1M9 11h1m4 0h1M10 21v-6h4v6",
    vegetation: "M12 3 5 12h3l-4 5h16l-4-5h3L12 3ZM12 17v5",
    water:
      "M12 3C9 7 6 10 6 14a6 6 0 0 0 12 0c0-4-3-7-6-11ZM9 15a3 3 0 0 0 3 3",
    transport: "M7 3 3 21M17 3l4 18M12 4v3m0 4v3m0 4v3",
    bridge: "M3 15h18M6 6v15M18 6v15M6 8c3 6 9 6 12 0M10 12v3m4-3v3",
    terrain: "M3 20 10 5l4 8 3-4 4 11H3ZM7 11l3 2 2-3",
    object: "m12 3 9 5v9l-9 5-9-5V8l9-5ZM3 8l9 5 9-5M12 13v9",
  };
  return (
    <svg
      className={`city-object-icon city-object-icon--${kind}`}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[kind]} />
    </svg>
  );
}
