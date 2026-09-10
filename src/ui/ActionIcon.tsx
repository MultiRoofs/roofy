/** Decorative line icons; the adjacent action label supplies the accessible name. */
export function ActionIcon({
  name,
}: {
  name:
    | "draw"
    | "camera"
    | "table"
    | "addLayer"
    | "feature"
    | "surface"
    | "filter"
    | "columns"
    | "export"
    | "expand"
    | "restore"
    | "clear";
}) {
  const paths = {
    draw: "m4 16 11-11 4 4L8 20H4v-4ZM13 7l4 4M3 3h5M3 3v5",
    columns: "M3 4h18v16H3ZM9 4v16M15 4v16",
    export: "M12 3v12m-4-4 4 4 4-4M4 15v6h16v-6",
    expand: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
    restore: "M3 8h5V3m8 0v5h5M8 21v-5H3m13 5v-5h5",
    clear: "M4 4h6M4 4v6m16-6h-6m6 0v6M4 20h6m-6 0v-6m11 1 6 6m0-6-6 6",

    camera: "M3 7h4l2-3h6l2 3h4v13H3ZM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    table: "M3 4h18v16H3ZM3 9h18M9 9v11",
    addLayer: "m3 7 8-4 8 4-8 4-8-4Zm0 5 8 4 4-2M3 17l8 4 3-1M19 14v8m-4-4h8",
    feature: "m12 3 9 5v9l-9 5-9-5V8l9-5ZM3 8l9 5 9-5M12 13v9",
    surface: "m3 15 8-10 10 4-8 10-10-4ZM11 5l2 14",
    filter: "M3 4h18l-7 8v7l-4 2v-9L3 4Z",
  };
  return (
    <svg
      className="action-icon"
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
      <path d={paths[name]} />
    </svg>
  );
}
